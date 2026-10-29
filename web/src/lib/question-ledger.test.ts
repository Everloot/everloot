import { expect, test } from "vitest";
import { found, ledgerMetrics, mcpLedgerMetrics } from "./question-ledger";
import { recordUsage } from "./usage-metrics";

test("found: each lookup tool's structured answer says whether it found anything; other tools are not counted", () => {
  expect(found("search_knowledge", { hits: [{ id: 1 }] })).toBe(true);
  expect(found("search_knowledge", { hits: [] })).toBe(false);
  expect(found("get_by_name", { hits: [] })).toBe(false);
  expect(found("get_entity", { hit: null })).toBe(false);
  expect(found("get_entity", { hit: { id: 3 } })).toBe(true);
  expect(found("search", { results: [{ id: "1" }] })).toBe(true);
  expect(found("answer_sources", { evidence: [], furtherReading: [] })).toBe(false);
  expect(found("answer_sources", { evidence: [{ claim: "x" }] })).toBe(true);
  expect(found("item_page", { page: {} })).toBeNull();
  expect(found("get_by_name", "not an object")).toBe(false);
});

test("ledgerMetrics: one hit or miss counter named by the tool, nothing from the lookup itself; the name passes the counters' guard", () => {
  expect(ledgerMetrics("get_by_name", { hits: [] })).toEqual(["ledger.get_by_name.miss"]);
  expect(ledgerMetrics("answer_sources", { evidence: [{ claim: "x" }] })).toEqual(["ledger.answer_sources.hit"]);
  expect(ledgerMetrics("vendor_page", { offers: [] })).toEqual([]);
  // The metric reaches the counter as is: the same guard the other usage counters pass.
  const sent: string[] = [];
  const doFetch = (async (_url: string | URL | Request, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body)).p_metric); return new Response("ok"); }) as typeof fetch;
  recordUsage(ledgerMetrics("search", { results: [] }), { EVERLOOT_USAGE_METRICS: "1", SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k" }, doFetch);
  return new Promise<void>((resolve) => setTimeout(() => { expect(sent).toEqual(["ledger.search.miss"]); resolve(); }, 10));
});

test("mcpLedgerMetrics: each lookup on an MCP mount, matched to its answer by id; errors, other tools and other methods are not counted", () => {
  const call = (id: number, name: string) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { question: "secret words" } } });
  const result = (id: number, structuredContent: unknown, isError = false) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "secret answer" }], structuredContent, isError } });
  const request = JSON.stringify([call(1, "answer_sources"), call(2, "get_by_name"), call(3, "item_page"), call(4, "search"), { jsonrpc: "2.0", id: 5, method: "tools/list" }]);
  const response = JSON.stringify([
    result(1, { evidence: [{ claim: "x" }] }), result(2, { hits: [] }), result(3, { page: {} }), result(4, { results: [] }, true), { jsonrpc: "2.0", id: 5, result: { tools: [] } },
  ]);
  expect(mcpLedgerMetrics(request, response)).toEqual(["ledger.answer_sources.hit", "ledger.get_by_name.miss"]);
  // One call and one answer, as the clients send them.
  expect(mcpLedgerMetrics(JSON.stringify(call(7, "search_knowledge")), JSON.stringify(result(7, { hits: [{ id: 1 }] })))).toEqual(["ledger.search_knowledge.hit"]);
  // An answer for an id nobody asked, a text-only result, or bodies that are not JSON count nothing.
  expect(mcpLedgerMetrics(JSON.stringify(call(1, "search")), JSON.stringify(result(2, { results: [] })))).toEqual([]);
  expect(mcpLedgerMetrics(JSON.stringify(call(1, "search")), JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }))).toEqual([]);
  expect(mcpLedgerMetrics("not json", "{}")).toEqual([]);
});
