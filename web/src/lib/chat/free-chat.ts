import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { RateLimitStore } from "../auth/db";
import { ipv6Subscriber } from "../intake-quota";
import { FREE_BUDGET, FREE_TOOLS, SYSTEM } from "./agent";
import { CATALOGUE } from "./catalogue";

/**
 * Everloot (free): an OpenAI-compatible POST /chat/completions on this site, in front of a provider's free tier, for
 * /chat visitors with no key of their own. The key lives here, on the server, and never reaches the page. The proxy
 * picks the model, puts Everloot's own system prompt first, offers only the free tools, caps what is written, and
 * sends the provider nothing of the visitor's but the conversation: no cookie, no key, no address.
 *
 * Providers are tried in order, each on only when its env is set:
 * 1. EVERLOOT_FREE_CHAT_KEY, with optional EVERLOOT_FREE_CHAT_BASE_URL (https only) and EVERLOOT_FREE_CHAT_MODEL:
 *    Groq's free plan with openai/gpt-oss-120b by default.
 * 2. EVERLOOT_FREE_CHAT_CF_ACCOUNT_ID and EVERLOOT_FREE_CHAT_CF_TOKEN: Cloudflare Workers AI's free daily Neurons,
 *    with @cf/openai/gpt-oss-20b. It is asked only when the one before it answered 429, a 5xx or nothing in time,
 *    before any of the answer reached the page; once the answer streams, it is that provider's.
 */

export const FREE_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const FREE_DEFAULT_MODEL = "openai/gpt-oss-120b";
const CLOUDFLARE_MODEL = "@cf/openai/gpt-oss-20b";

/**
 * Completion calls, not answers: one answer is one call plus one per tool round (FREE_BUDGET.rounds), so usually 2
 * or 3. A visitor gets 6 a minute and 45 a day (about 15 answers), whichever provider answers.
 *
 * Each provider has its own daily cap under its free tier. The first, 900, is under the 1,000 requests a day Groq's
 * free plan allows the model. Cloudflare's 10,000 free Neurons a day cost gpt-oss-20b 18,182 Neurons per million
 * input tokens and 27,273 per million output tokens; a call there is at most `cloudflareBytes` of request, which is
 * at most 8,000 tokens at 2.5 bytes a token (145.5 Neurons), plus 1,000 tokens written (27.3 Neurons): 172.8
 * Neurons. 55 such calls are 9,504 Neurons, under the free 10,000 even if every call were that long. A typical call
 * measures 8 to 12 KB; a longer one skips Cloudflare. Tokens may run out sooner on Groq; then its 429 hands the call
 * to Cloudflare, and past both, the page shows Everloot search.
 */
export const FREE_CHAT_LIMITS = { perMinute: 6, perDay: 45, siteDay: 900, cloudflareDay: 55, cloudflareBytes: 20_000 } as const;

const DAY = 86_400;
const MAX_BODY = 96_000;
const MAX_MESSAGES = 40;
const MAX_CONTENT = 12_000;
const MAX_TOOL_CHARS = 4_000;
/** How long a provider has to start answering before the next one is asked. */
const HEADERS_TIMEOUT_MS = 15_000;

export interface FreeProvider {
  /** Names its daily cap's key. */
  id: string;
  /** Shown on /chat and on each answer it writes. */
  name: string;
  key: string;
  baseUrl: string;
  model: string;
  /** Completion calls a day across the site. */
  siteDay: number;
  /** reasoning_effort to send, only where the provider documents it for the model; null sends none. */
  reasoning: "low" | null;
  /** The largest request it is sent, in bytes; a longer one skips it. */
  maxBytes?: number;
}

/** The free providers that are on, in the order they are tried. */
export function freeChatProviders(env: Record<string, string | undefined> = process.env): FreeProvider[] {
  const out: FreeProvider[] = [];
  const key = env.EVERLOOT_FREE_CHAT_KEY?.trim();
  if (key) {
    const baseUrl = (env.EVERLOOT_FREE_CHAT_BASE_URL?.trim() || FREE_DEFAULT_BASE_URL).replace(/\/+$/, "");
    let url: URL | null = null;
    try { url = new URL(baseUrl); } catch { /* off */ }
    if (url?.protocol === "https:") {
      const model = env.EVERLOOT_FREE_CHAT_MODEL?.trim() || FREE_DEFAULT_MODEL;
      const name = CATALOGUE.find((p) => p.baseUrl === baseUrl)?.name ?? url.host;
      // Groq documents reasoning_effort low/medium/high for its gpt-oss models (console.groq.com/docs/reasoning).
      const reasoning = baseUrl === FREE_DEFAULT_BASE_URL && model.startsWith("openai/gpt-oss-") ? "low" : null;
      out.push({ id: name.toLowerCase(), name, key, baseUrl, model, siteDay: FREE_CHAT_LIMITS.siteDay, reasoning });
    }
  }
  const account = env.EVERLOOT_FREE_CHAT_CF_ACCOUNT_ID?.trim() ?? "";
  const token = env.EVERLOOT_FREE_CHAT_CF_TOKEN?.trim();
  if (/^[0-9a-f]{32}$/i.test(account) && token) {
    out.push({
      id: "cloudflare", name: "Cloudflare", key: token, baseUrl: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
      // Cloudflare lists reasoning levels for gpt-oss-20b but documents no parameter for them on this endpoint: none is sent.
      model: CLOUDFLARE_MODEL, siteDay: FREE_CHAT_LIMITS.cloudflareDay, reasoning: null, maxBytes: FREE_CHAT_LIMITS.cloudflareBytes,
    });
  }
  return out;
}

/** What the /chat page is told: the names of the providers that are on, in order. Never a key. */
export function freeChatNames(env: Record<string, string | undefined> = process.env): string[] {
  return freeChatProviders(env).map((p) => p.name);
}

type Code = "free_chat_off" | "free_chat_bad_request" | "free_chat_limit" | "free_chat_unavailable" | "free_chat_upstream";

function refuse(status: number, code: Code, message: string, retryAfter?: number | string | null): Response {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (retryAfter !== undefined && retryAfter !== null && /^\d+$/.test(String(retryAfter))) headers["retry-after"] = String(retryAfter);
  return Response.json({ error: { message, code } }, { status, headers });
}

interface Message { role: "user" | "assistant" | "tool"; content: string | null; tool_calls?: unknown[]; tool_call_id?: string }

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/** The page's messages with only the fields a chat turn has; null when any is malformed or too long. System turns are dropped. */
function readMessages(raw: unknown): Message[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out: Message[] = [];
  for (const m of raw as Record<string, unknown>[]) {
    if (!m || typeof m !== "object") return null;
    if (m.role === "system") continue;
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "tool") return null;
    if (m.content !== null && !text(m.content, MAX_CONTENT)) return null;
    const message: Message = { role: m.role, content: m.content as string | null };
    if (m.role === "tool") {
      if (!text(m.tool_call_id, 200)) return null;
      message.tool_call_id = m.tool_call_id;
    }
    if (m.role === "assistant" && m.tool_calls !== undefined) {
      if (!Array.isArray(m.tool_calls) || m.tool_calls.length > 8) return null;
      const calls = [];
      for (const c of m.tool_calls as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[]) {
        if (!text(c?.id, 200) || !text(c.function?.name, 64) || !text(c.function?.arguments, MAX_TOOL_CHARS)) return null;
        calls.push({ id: c.id, type: "function", function: { name: c.function!.name, arguments: c.function!.arguments } });
      }
      message.tool_calls = calls;
    }
    out.push(message);
  }
  return out.some((m) => m.role === "user") ? out : null;
}

/** The page's tools that are free tools, each small; null when one is oversized. Any other tool is left out. */
function readTools(raw: unknown): unknown[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const t of raw as { function?: { name?: unknown } }[]) {
    const name = t?.function?.name;
    if (typeof name !== "string" || !(FREE_TOOLS as readonly string[]).includes(name)) continue;
    if (JSON.stringify(t).length > MAX_TOOL_CHARS) return null;
    out.push(t);
  }
  return out;
}

/** The caller's address as Vercel saw it (an IPv6 one by its /64), or "local" in development; null when it cannot be trusted. */
function clientAddress(req: Request, env: Record<string, string | undefined>): string | null {
  if (env.VERCEL !== "1") return env.NODE_ENV === "production" ? null : "local";
  const ip = req.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  if (!isIP(ip)) return null;
  return isIP(ip) === 6 ? ipv6Subscriber(ip) : ip;
}

type Attempt = { ok: Response } | { next: "limit"; retryAfter: string | null } | { next: "failed" } | { stop: Response };

export function createFreeChat(deps: { env?: Record<string, string | undefined>; store: () => RateLimitStore; send?: typeof fetch; timeoutMs?: number }) {
  const env = deps.env ?? process.env;
  const send = deps.send ?? fetch;
  const timeoutMs = deps.timeoutMs ?? HEADERS_TIMEOUT_MS;

  /** One provider, until its answer starts. A 429, a 5xx or no answer in time hands the call on; nothing has reached the page yet. */
  async function attempt(p: FreeProvider, body: string, req: Request): Promise<Attempt> {
    const timer = new AbortController();
    const clock = setTimeout(() => timer.abort(), timeoutMs);
    let upstream: Response;
    try {
      upstream = await send(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        // Only these two headers, and only this provider's key: nothing of the visitor's request goes on.
        headers: { "content-type": "application/json", authorization: `Bearer ${p.key}` },
        body,
        signal: AbortSignal.any([req.signal, timer.signal]),
        cache: "no-store",
      });
    } catch {
      return { next: "failed" };
    } finally {
      clearTimeout(clock);
    }
    // The provider's own words can name its account; the page gets ours.
    if (upstream.status === 429) return { next: "limit", retryAfter: upstream.headers.get("retry-after") };
    if (upstream.status >= 500) return { next: "failed" };
    if (!upstream.ok || !upstream.body) return { stop: refuse(502, "free_chat_upstream", `The free model did not answer (HTTP ${upstream.status}).`) };
    return {
      ok: new Response(upstream.body, {
        status: 200,
        headers: { "content-type": upstream.headers.get("content-type") ?? "text/event-stream", "cache-control": "no-store", "x-everloot-provider": p.name },
      }),
    };
  }

  async function POST(req: Request): Promise<Response> {
    const providers = freeChatProviders(env);
    if (providers.length === 0) return refuse(404, "free_chat_off", "The free model is off.");

    const raw = await req.text();
    if (raw.length > MAX_BODY) return refuse(413, "free_chat_bad_request", "The conversation is too long for the free model.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return refuse(400, "free_chat_bad_request", "The request is not JSON."); }
    const messages = body && typeof body === "object" ? readMessages(body.messages) : null;
    const tools = messages ? readTools(body.tools) : null;
    if (!messages || !tools) return refuse(400, "free_chat_bad_request", "The request is not a chat the free model takes.");
    const asked = typeof body.max_tokens === "number" && body.max_tokens > 0 ? Math.floor(body.max_tokens) : FREE_BUDGET.maxTokens;

    // The visitor's limits count once per completion call, whichever provider answers. The address is kept only as a keyed hash.
    const address = clientAddress(req, env);
    if (!address) return refuse(503, "free_chat_unavailable", "The free model is not available right now.");
    const visitor = createHmac("sha256", providers[0].key).update(`free-chat:${address}`).digest("hex").slice(0, 32);
    let store: RateLimitStore;
    try {
      store = deps.store();
      for (const [key, window, max, message] of [
        [`free-chat:minute:${visitor}`, 60, FREE_CHAT_LIMITS.perMinute, "You have asked the free model a lot this minute. Try again shortly."],
        [`daily:free-chat:${visitor}`, DAY, FREE_CHAT_LIMITS.perDay, "You have used today's free answers."],
      ] as const) {
        const r = await store.consume(key, { window, max });
        if (!r.allowed) return refuse(429, "free_chat_limit", message, r.retryAfter);
      }
    } catch {
      return refuse(503, "free_chat_unavailable", "The free model is not available right now.");
    }

    let limited = false;
    let retryAfter: number | string | null = null;
    for (const p of providers) {
      const upstreamBody = JSON.stringify({
        model: p.model,
        messages: [{ role: "system", content: SYSTEM }, ...messages],
        ...(tools.length ? { tools } : {}),
        max_tokens: Math.min(asked, FREE_BUDGET.maxTokens),
        ...(p.reasoning ? { reasoning_effort: p.reasoning } : {}),
        stream: true,
      });
      if (p.maxBytes !== undefined && new TextEncoder().encode(upstreamBody).length > p.maxBytes) continue;
      // Each provider's own day, counted before it is asked.
      try {
        const cap = await store.consume(`daily:free-chat:site:${p.id}`, { window: DAY, max: p.siteDay });
        if (!cap.allowed) { limited = true; retryAfter = cap.retryAfter; continue; }
      } catch {
        continue;
      }
      const r = await attempt(p, upstreamBody, req);
      if ("ok" in r) return r.ok;
      if ("stop" in r) return r.stop;
      if (r.next === "limit") { limited = true; retryAfter = r.retryAfter; }
      if (req.signal.aborted) break;
    }
    return limited
      ? refuse(429, "free_chat_limit", "The free model has reached its limit for now.", retryAfter)
      : refuse(502, "free_chat_upstream", "The free model did not answer.");
  }

  return { POST };
}