import { expect, test, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ authQuery: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { snapshotHealth: vi.fn() } }));
vi.mock("./store", () => ({ readOpsSummary: vi.fn(), writeOpsSummary: vi.fn() }));
import { collectOpsSummary, collectCpu } from "./collector";
import { exclusions, installKey } from "./metrics";
const env = { EVERLOOT_OPS_HMAC_SECRET: "synthetic-stable-key", EVERLOOT_OPS_METRICS: "1" };
test("failed sources remain unavailable rather than becoming zero activity", async () => {
  const query = vi.fn().mockRejectedValue(new Error("offline"));
  const result = await collectOpsSummary({ env, query, previous: null, now: "2026-11-12T15:00:00Z", health: async () => ({ status: "unavailable" }), write: async () => {} });
  expect(result.activity.today).toBeNull();
  expect(result.sources.receipts.status).toBe("unavailable");
  expect(result.costs.cpu).toBeNull();
  expect(result.daily).toEqual([]);
});
test("keeps last good activity dated and stale when receipt storage fails", async () => {
  const goodQuery = vi.fn().mockImplementation(async (path: string) => path.includes("ops_state") ? [{ started_at: "2026-11-01T00:00:00Z" }] : path.includes("ops_install_days") ? [{ day: "2026-11-12", install_key: "a".repeat(64), receipts: 2, records: 5, last_received_at: "2026-11-12T12:00:00Z", realms: [], kinds: [] }] : []);
  const common = { env, health: async () => ({ status: "fresh" }), write: async () => {} };
  const previous = await collectOpsSummary({ ...common, query: goodQuery, previous: null, now: "2026-11-12T15:00:00Z" });
  const result = await collectOpsSummary({ ...common, query: vi.fn().mockRejectedValue(new Error("offline")), previous, now: "2026-11-12T16:00:00Z" });
  expect(result.activity.today).toBe(1);
  expect(result.sources.receipts).toMatchObject({ status: "stale", asOf: "2026-11-12T15:00:00Z" });
  const changed = await collectOpsSummary({ ...common, env: { ...env, EVERLOOT_OPS_EXCLUDED_INSTALLS: '["synthetic-owner"]' }, query: vi.fn().mockRejectedValue(new Error("offline")), previous, now: "2026-11-12T16:00:00Z" });
  expect(changed.activity.today).toBeNull();
  expect(changed.exclusionVersion).not.toBe(exclusions(env).version);
});
test("CPU microseconds become milliseconds before applying the estimate rate, with no billed-total claim", async () => {
  const doFetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { cpuTimeUs: 1_000_000_000 } }, { sum: { cpuTimeUs: 1_000_000_000 } }] }] } } })));
  const result = await collectCpu({ EVERLOOT_OPS_CF_ANALYTICS_TOKEN: "synthetic-token", R2_ACCOUNT_ID: "synthetic-account", EVERLOOT_OPS_WORKER_NAME: "synthetic-worker" }, "2026-11-03T15:00:00Z", doFetch);
  expect(doFetch).toHaveBeenCalledOnce();
  expect(JSON.parse(doFetch.mock.calls[0][1].body).query).toContain("limit: 32");
  expect(result).toMatchObject({ cpuMs: 2_000_000, estimatedUsd: 0.04, monthlyPaceUsd: 0.6, until: "2026-11-03T00:00:00.000Z" });
  expect(result?.formula).toContain("before account-shared allowance");
});
test("historical hints match only exact HMAC aliases and never create receipt activity", async () => {
  const key = installKey("synthetic-history", env.EVERLOOT_OPS_HMAC_SECRET);
  const otherKey = installKey("synthetic-unrelated", env.EVERLOOT_OPS_HMAC_SECRET);
  const query = vi.fn().mockImplementation(async (path: string) => path.startsWith("uploads?") ? [{ id: "synthetic-upload", install_id: "synthetic-history", received_at: "2026-11-10T14:00:00Z", record_count: 4 }] : []);
  const common = { env, query, previous: null, now: "2026-11-12T15:00:00Z", health: async () => ({ status: "fresh" }), write: async () => {} };
  const missing = await collectOpsSummary({ ...common, hints: async () => ({ version: 1, generatedAt: "2026-11-11T00:00:00Z", contributors: [{ id: otherKey, realms: ["Unrelated realm"], kinds: ["quest"] }] }) });
  expect(missing.contributors[0]).toMatchObject({ id: key, realms: [], kinds: [] });
  const matching = await collectOpsSummary({ ...common, hints: async () => ({ version: 1, generatedAt: "2026-11-11T00:00:00Z", contributors: [{ id: key, realms: ["CAMWOW US1 Realm 4 PvP"], kinds: ["quest"] }] }) });
  expect(matching.contributors[0]).toMatchObject({ realms: ["CAMWOW US1 Realm 4 PvP"], kinds: ["quest"], series: "stored-uploads", lastReceivedAt: "2026-11-10T14:00:00Z", daysActive: ["2026-11-10"] });
  expect(matching.activity.today).toBeNull();
  expect(matching.daily).toEqual([]);
  expect(matching.sources.hints).toMatchObject({ status: "stale", asOf: "2026-11-11T00:00:00Z" });
});
test("collector reads bounded index metadata only, never upload objects or corpus", async () => {
  const query = vi.fn().mockImplementation(async (path: string) => path.includes("ops_state") ? [{ started_at: "2026-11-12T14:00:00Z" }] : []);
  const result = await collectOpsSummary({ env, query, previous: null, now: "2026-11-12T15:00:00Z", health: async () => ({ status: "fresh" }), write: async () => {} });
  expect(result.activity.today).toBe(0);
  expect(result.sources.receipts.status).toBe("fresh");
  expect(query.mock.calls.every(([path]) => !path.includes("object_key") && !path.includes("corpus"))).toBe(true);
  expect(query.mock.calls.find(([path]) => path.startsWith("uploads?"))?.[0]).toContain("limit=1000");
});
test("truncated receipt history never fabricates current-window zeroes or complete daily totals", async () => {
  const receipt = { day: "2026-11-11", install_key: "a".repeat(64), receipts: 1, records: 1, last_received_at: "2026-11-11T12:00:00Z", realms: [], kinds: [] };
  const query = vi.fn().mockImplementation(async (path: string) => path.startsWith("ops_state?") ? [{ started_at: "2026-10-01T00:00:00Z" }] : path.startsWith("ops_install_days?") ? Array(1000).fill(receipt) : []);
  const summary = await collectOpsSummary({ env, query, previous: null, now: "2026-11-12T15:00:00Z", health: async () => ({ status: "fresh" }), write: async () => {}, hints: async () => null });
  expect(summary.activity).toMatchObject({ today: null, past7Days: null, returning: null });
  expect(summary.daily).toEqual([]);
  expect(summary.sources.receipts.status).toBe("partial");
  expect(summary.sources.receipts.detail).toContain("lower bounds");
  expect(query.mock.calls.filter(([path]) => path.startsWith("ops_install_days?")).every(([path]) => path.includes("order=day.desc,install_key.asc"))).toBe(true);
});
test("truncated counter history cannot become exact MCP totals or false per-day zero outcomes", async () => {
  const counter = { day: "2026-11-11", metric: "mcp.search", count: 1 };
  const query = vi.fn().mockImplementation(async (path: string) => path.startsWith("ops_state?") ? [{ started_at: "2026-11-12T00:00:00Z" }] : path.startsWith("usage_counters?") ? Array(1000).fill(counter) : []);
  const summary = await collectOpsSummary({ env: { ...env, EVERLOOT_USAGE_METRICS: "1" }, query, previous: null, now: "2026-11-12T15:00:00Z", health: async () => ({ status: "fresh" }), write: async () => {}, hints: async () => null });
  expect(summary.usage.mcp).toBeNull();
  expect(summary.daily[0]).toMatchObject({ rejected: null, limited: null, storageFailures: null, reasons: null });
  expect(summary.sources.outcomes.status).toBe("partial");
  expect(summary.sources.mcp.status).toBe("partial");
});
