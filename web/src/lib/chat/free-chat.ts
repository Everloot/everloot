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
 * Off until EVERLOOT_FREE_CHAT_KEY is set. EVERLOOT_FREE_CHAT_BASE_URL (https only) and EVERLOOT_FREE_CHAT_MODEL pick
 * another OpenAI-compatible provider or model; the default is Groq's free plan with openai/gpt-oss-120b.
 */

export const FREE_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const FREE_DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * Completion calls, not answers: one answer is one call plus one per tool round (FREE_BUDGET.rounds), so usually 2
 * or 3. A visitor gets 6 a minute and 45 a day (about 15 answers); the whole site 900 a day, under the 1,000 requests
 * a day Groq's free plan allows the model, leaving room for the owner's own checks. The free plan's tokens a minute
 * and a day may run out first; then the provider's 429 ends the answer the same way, with Everloot search instead.
 */
export const FREE_CHAT_LIMITS = { perMinute: 6, perDay: 45, siteDay: 900 } as const;

const DAY = 86_400;
const MAX_BODY = 96_000;
const MAX_MESSAGES = 40;
const MAX_CONTENT = 12_000;
const MAX_TOOL_CHARS = 4_000;
const UPSTREAM_TIMEOUT_MS = 50_000;

export interface FreeChatConfig { key: string; baseUrl: string; model: string; provider: string }

/** The free model's settings, or null while it is off. The provider is its catalogue name, or the base URL's host. */
export function freeChatConfig(env: Record<string, string | undefined> = process.env): FreeChatConfig | null {
  const key = env.EVERLOOT_FREE_CHAT_KEY?.trim();
  if (!key) return null;
  const baseUrl = (env.EVERLOOT_FREE_CHAT_BASE_URL?.trim() || FREE_DEFAULT_BASE_URL).replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(baseUrl); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const model = env.EVERLOOT_FREE_CHAT_MODEL?.trim() || FREE_DEFAULT_MODEL;
  return { key, baseUrl, model, provider: CATALOGUE.find((p) => p.baseUrl === baseUrl)?.name ?? url.host };
}

/** What the /chat page is told: the provider's name while the free model is on, else null. Never the key. */
export function freeChatProvider(env: Record<string, string | undefined> = process.env): string | null {
  return freeChatConfig(env)?.provider ?? null;
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

export function createFreeChat(deps: { env?: Record<string, string | undefined>; store: () => RateLimitStore; send?: typeof fetch }) {
  const env = deps.env ?? process.env;
  const send = deps.send ?? fetch;

  async function POST(req: Request): Promise<Response> {
    const config = freeChatConfig(env);
    if (!config) return refuse(404, "free_chat_off", "The free model is off.");

    const raw = await req.text();
    if (raw.length > MAX_BODY) return refuse(413, "free_chat_bad_request", "The conversation is too long for the free model.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return refuse(400, "free_chat_bad_request", "The request is not JSON."); }
    const messages = body && typeof body === "object" ? readMessages(body.messages) : null;
    const tools = messages ? readTools(body.tools) : null;
    if (!messages || !tools) return refuse(400, "free_chat_bad_request", "The request is not a chat the free model takes.");
    const asked = typeof body.max_tokens === "number" && body.max_tokens > 0 ? Math.floor(body.max_tokens) : FREE_BUDGET.maxTokens;

    // Counted per completion call, before the provider is asked. The address is kept only as a keyed hash.
    const address = clientAddress(req, env);
    if (!address) return refuse(503, "free_chat_unavailable", "The free model is not available right now.");
    const visitor = createHmac("sha256", config.key).update(`free-chat:${address}`).digest("hex").slice(0, 32);
    try {
      const store = deps.store();
      for (const [key, window, max, message] of [
        [`free-chat:minute:${visitor}`, 60, FREE_CHAT_LIMITS.perMinute, "You have asked the free model a lot this minute. Try again shortly."],
        [`daily:free-chat:${visitor}`, DAY, FREE_CHAT_LIMITS.perDay, "You have used today's free answers."],
        ["daily:free-chat:site", DAY, FREE_CHAT_LIMITS.siteDay, "The free model has used today's answers for everyone."],
      ] as const) {
        const r = await store.consume(key, { window, max });
        if (!r.allowed) return refuse(429, "free_chat_limit", message, r.retryAfter);
      }
    } catch {
      return refuse(503, "free_chat_unavailable", "The free model is not available right now.");
    }

    let upstream: Response;
    try {
      upstream = await send(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        // Only these two headers: nothing of the visitor's request goes on.
        headers: { "content-type": "application/json", authorization: `Bearer ${config.key}` },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "system", content: SYSTEM }, ...messages],
          ...(tools.length ? { tools } : {}),
          max_tokens: Math.min(asked, FREE_BUDGET.maxTokens),
          stream: true,
        }),
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
        cache: "no-store",
      });
    } catch {
      return refuse(502, "free_chat_upstream", "The free model did not answer.");
    }
    // The provider's own words can name its account; the page gets ours.
    if (upstream.status === 429) return refuse(429, "free_chat_limit", "The free model has reached its limit for now.", upstream.headers.get("retry-after"));
    if (!upstream.ok || !upstream.body) return refuse(502, "free_chat_upstream", `The free model did not answer (HTTP ${upstream.status}).`);
    return new Response(upstream.body, {
      status: 200,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/event-stream", "cache-control": "no-store" },
    });
  }

  return { POST };
}
