/**
 * The question ledger, phase 3a: for each lookup made through /api/tools or an MCP mount, one daily counter saying
 * whether the lookup found something or nothing. A metric is only a name ("ledger.get_by_name.miss"): no
 * question text, no looked-up name, no address, install id or account is recorded, the same rule as the
 * other usage counters (docs/DATA_POLICY.md, "The question ledger"). The miss rate per tool is the demand
 * signal the question bank's eval reads beside its own gap lists
 * (docs/design/specs/2026-10-27-question-bank-design.md, phase 3).
 */
import { MAX_BUMPS_PER_REQUEST } from "./usage-metrics";

/** The lookup tools whose answers say plainly whether anything was found. */
export const LEDGER_TOOLS = ["search_knowledge", "get_by_name", "get_entity", "search", "answer_sources"] as const;
export type LedgerTool = (typeof LEDGER_TOOLS)[number];

const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Whether a lookup tool's structured answer found anything; null for a tool the ledger does not count. */
export function found(tool: string, structured: unknown): boolean | null {
  const s = (structured && typeof structured === "object" ? structured : {}) as Record<string, unknown>;
  switch (tool as LedgerTool) {
    case "search_knowledge":
    case "get_by_name": return count(s.hits) > 0;
    case "get_entity": return s.hit !== null && s.hit !== undefined;
    case "search": return count(s.results) > 0;
    case "answer_sources": return count(s.evidence) > 0;
    default: return null;
  }
}

/** The counter to bump for one lookup, or none for a tool the ledger does not count. */
export function ledgerMetrics(tool: string, structured: unknown): string[] {
  const hit = found(tool, structured);
  return hit === null ? [] : [`ledger.${tool}.${hit ? "hit" : "miss"}`];
}

/**
 * The same counters for one request to an MCP mount (the Desktop App, in-game /ask, AI clients) and its JSON answer:
 * each tools/call of a lookup tool, matched to its result by JSON-RPC id. Only the tool's name and whether its
 * structured answer found anything are read; a tool error or a result with no structured answer is not counted.
 */
export function mcpLedgerMetrics(requestBody: string, responseBody: string): string[] {
  let request: unknown;
  let response: unknown;
  try { request = JSON.parse(requestBody); response = JSON.parse(responseBody); } catch { return []; }
  const names = new Map<unknown, string>();
  for (const message of (Array.isArray(request) ? request : [request]).slice(0, MAX_BUMPS_PER_REQUEST)) {
    const m = message as { method?: unknown; id?: unknown; params?: { name?: unknown } } | null;
    if (m?.method === "tools/call" && m.id !== undefined && typeof m.params?.name === "string") names.set(m.id, m.params.name);
  }
  return (Array.isArray(response) ? response : [response]).flatMap((message) => {
    const m = message as { id?: unknown; result?: { isError?: unknown; structuredContent?: unknown } } | null;
    const name = m ? names.get(m.id) : undefined;
    if (!name || !m?.result || m.result.isError === true || m.result.structuredContent === undefined) return [];
    return ledgerMetrics(name, m.result.structuredContent);
  });
}
