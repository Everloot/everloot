import { MCP_TOOL_NAMES } from "@everloot/protocol";
import { after } from "next/server";

/**
 * Daily counters for our own endpoints: which MCP tools get called, how often the API is hit.
 * A metric is only a name (for example "mcp_public.search_knowledge"); no address, install id, query
 * or user agent is recorded. Off unless EVERLOOT_USAGE_METRICS=1 (set after the usage_counters
 * migration is applied) and Supabase is configured. A failure here never affects a response.
 */
/** Every tool the protocol publishes; a hand-kept list here had fallen behind it (answer_sources counted as "other"). */
export const MCP_TOOLS: readonly string[] = MCP_TOOL_NAMES;

/** A batched JSON-RPC request counts at most this many calls. */
export const MAX_BUMPS_PER_REQUEST = 5;

/** Tool names from a JSON-RPC body. Unknown names collapse to "other" so a caller cannot invent metric names. */
export function mcpToolMetrics(body: string, mount: "mcp" | "mcp_public"): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return []; }
  const messages = Array.isArray(parsed) ? parsed.slice(0, MAX_BUMPS_PER_REQUEST) : [parsed];
  const metrics: string[] = [];
  for (const message of messages) {
    const m = message as { method?: unknown; params?: { name?: unknown } } | null;
    if (m?.method !== "tools/call") continue;
    const name = m.params?.name;
    metrics.push(`${mount}.${typeof name === "string" && (MCP_TOOLS as readonly string[]).includes(name) ? name : "other"}`);
  }
  return metrics;
}

async function bump(metric: string, env: Record<string, string | undefined>, doFetch: typeof fetch): Promise<void> {
  const url = env.SUPABASE_URL?.trim();
  const secret = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (env.EVERLOOT_USAGE_METRICS !== "1" || !url || !secret) return;
  try {
    await doFetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/bump_usage_counter`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(3000),
      headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ p_metric: metric }),
    });
  } catch {
    // Counting is best effort.
  }
}

export function recordUsage(metrics: string | string[], env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): void {
  const list = (Array.isArray(metrics) ? metrics : [metrics]).slice(0, MAX_BUMPS_PER_REQUEST).filter((m) => /^[a-z0-9_.]{1,64}$/.test(m));
  if (!list.length || env.EVERLOOT_USAGE_METRICS !== "1") return;
  const work = async () => { await Promise.all(list.map((m) => bump(m, env, doFetch))); };
  // after() lets the write finish once the response is sent; outside a request it throws, so run it directly.
  try { after(work); } catch { void work(); }
}
