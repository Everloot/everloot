/**
 * The question ledger, phase 3a: for each lookup the chat makes through /api/tools, one daily counter saying
 * whether the lookup found something or nothing. A metric is only a name ("ledger.get_by_name.miss"): no
 * question text, no looked-up name, no address, install id or account is recorded, the same rule as the
 * other usage counters (docs/DATA_POLICY.md, "The question ledger"). The miss rate per tool is the demand
 * signal the question bank's eval reads beside its own gap lists
 * (docs/design/specs/2026-10-27-question-bank-design.md, phase 3).
 */

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
