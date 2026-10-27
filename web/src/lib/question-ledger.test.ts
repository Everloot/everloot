import { expect, test } from "vitest";
import { found, ledgerMetrics } from "./question-ledger";
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
