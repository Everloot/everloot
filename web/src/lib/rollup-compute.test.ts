import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), loadCensus: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus, loadCensus: store.loadCensus } }));

const fns = vi.hoisted(() => ({
  windows: vi.fn((records: unknown[]) => records.map((_, i) => ({ i }))),
  rollup: vi.fn(() => ({ rates: [], measuredZeros: [], rejected: [] })),
  itemFacts: vi.fn(() => ({ rates: [], names: [], npcs: [] })),
  worldFacts: vi.fn(() => ({ npcs: [], quests: [], vendors: [] })),
  addons: vi.fn(() => ({ addons: [], reportingInstalls: 0 })),
  edges: vi.fn(() => []),
  trends: vi.fn(() => ({})),
}));
// No recheck scopes: the cut-off hands the same records back, so the windows are read once.
vi.mock("../../../kb/src/drop-rollup", () => ({ itemFactsFromRecords: fns.itemFacts, recheckLootRecords: (records: unknown[]) => records }));
vi.mock("../../../kb/src/world-pages", () => ({ worldFactsFromRecords: fns.worldFacts }));
vi.mock("../../../kb/src/addon-rollup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../kb/src/addon-rollup")>()),
  popularAddonsFromRecords: fns.addons,
  addonTrends: fns.trends,
}));
vi.mock("../../../kb/src/edges", () => ({ observedEdges: fns.edges }));
vi.mock("./rollups", () => ({ lootWindowsFromRecords: fns.windows, rollupDrops: fns.rollup }));

import { RECHECK_SCOPES } from "./recheck-scopes";
import { computeRollups, loadCensus, loadItemFacts, loadAddonLeaderboard, loadObservedEdges, loadPopularAddons, loadWorldFacts } from "./rollup-compute";

const V1 = { uploads: 2, records: [{ kind: "loot" }, { kind: "quest" }], dataAsOf: "2026-10-10T10:00:00.000Z" };
const V2 = { ...V1, dataAsOf: "2026-10-10T10:05:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
});

test("the answers share one aggregation set per corpus version", async () => {
  store.loadCorpus.mockResolvedValue(V1);
  await computeRollups();
  await loadItemFacts();
  await loadWorldFacts();
  await loadPopularAddons();
  expect(fns.windows).toHaveBeenCalledTimes(1);
  expect(fns.rollup).toHaveBeenCalledTimes(1);
  expect(fns.itemFacts).toHaveBeenCalledTimes(1);
  expect(fns.worldFacts).toHaveBeenCalledTimes(1);
  expect(fns.addons).toHaveBeenCalledTimes(1);
  expect(fns.edges).toHaveBeenCalledTimes(1);
  expect(fns.edges).toHaveBeenCalledWith(V1.records, V1.dataAsOf, RECHECK_SCOPES);
  // Addon rows dated after the corpus was current are not facts yet.
  expect(fns.addons).toHaveBeenCalledWith(V1.records, V1.dataAsOf);
  // Same corpus version: repeated answers reuse the aggregates, no recompute.
  await computeRollups();
  await loadItemFacts();
  await loadWorldFacts();
  await loadPopularAddons();
  expect(fns.windows).toHaveBeenCalledTimes(1);
  expect(fns.rollup).toHaveBeenCalledTimes(1);
  expect(fns.itemFacts).toHaveBeenCalledTimes(1);
  expect(fns.worldFacts).toHaveBeenCalledTimes(1);
  expect(fns.addons).toHaveBeenCalledTimes(1);
  // New snapshot time: the aggregates rebuild once for the new version.
  store.loadCorpus.mockResolvedValue(V2);
  await computeRollups();
  await loadItemFacts();
  await loadWorldFacts();
  await loadPopularAddons();
  await loadObservedEdges();
  expect(fns.windows).toHaveBeenCalledTimes(2);
  expect(fns.edges).toHaveBeenCalledTimes(2);
  expect(fns.rollup).toHaveBeenCalledTimes(2);
  expect(fns.itemFacts).toHaveBeenCalledTimes(2);
  expect(fns.worldFacts).toHaveBeenCalledTimes(2);
  expect(fns.addons).toHaveBeenCalledTimes(2);
});

test("the addon history is worked out only for the leaderboard, once per corpus version", async () => {
  store.loadCorpus.mockResolvedValue({ ...V1, dataAsOf: "2026-10-10T10:30:00.000Z" });
  await computeRollups();
  await loadItemFacts();
  await loadPopularAddons();
  expect(fns.trends).not.toHaveBeenCalled();
  await loadAddonLeaderboard();
  await loadAddonLeaderboard();
  expect(fns.trends).toHaveBeenCalledTimes(1);
  expect(fns.trends).toHaveBeenCalledWith([], "2026-10-10T10:30:00.000Z");
});

test("answer shapes are unchanged", async () => {
  store.loadCorpus.mockResolvedValue({ ...V1, dataAsOf: "2026-10-10T11:00:00.000Z" });
  const rollup = await computeRollups();
  expect(rollup.stats).toEqual({ uploads: 2, lootWindows: 2, records: 2, unreachable: false, dataAsOf: "2026-10-10T11:00:00.000Z" });
  expect(await loadItemFacts()).toEqual({ rates: [], names: [], npcs: [], unreachable: false });
  // The world facts carry the recheck scopes the readers apply (kb/curated/recheck.json holds none today).
  expect(await loadWorldFacts()).toEqual({ npcs: [], quests: [], vendors: [], recheck: [], unreachable: false, dataAsOf: "2026-10-10T11:00:00.000Z" });
  expect(await loadPopularAddons()).toEqual({ addons: [], reportingInstalls: 0, unreachable: false, dataAsOf: "2026-10-10T11:00:00.000Z" });
  expect(await loadAddonLeaderboard()).toEqual({ addons: [], reportingInstalls: 0, trends: {}, unreachable: false, dataAsOf: "2026-10-10T11:00:00.000Z" });
  expect(await loadObservedEdges()).toEqual({ edges: [], unreachable: false, dataAsOf: "2026-10-10T11:00:00.000Z" });
});

test("an unreadable store stays unreadable and never serves stale aggregates", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  expect((await computeRollups()).stats.unreachable).toBe(true);
  expect((await loadItemFacts()).unreachable).toBe(true);
  expect((await loadWorldFacts()).unreachable).toBe(true);
  expect(await loadPopularAddons()).toEqual({ addons: [], reportingInstalls: 0, unreachable: true, dataAsOf: null });
  expect(await loadAddonLeaderboard()).toEqual({ addons: [], reportingInstalls: 0, trends: {}, unreachable: true, dataAsOf: null });
  expect(await loadObservedEdges()).toEqual({ edges: [], unreachable: true, dataAsOf: null });
  store.loadCensus.mockResolvedValue({ rows: [], dataAsOf: null, unreachable: true });
  expect(await loadCensus()).toEqual({ view: null, unreachable: true, dataAsOf: null });
  expect(fns.windows).not.toHaveBeenCalled();
  // A readable corpus afterwards still aggregates fresh.
  store.loadCorpus.mockResolvedValue({ ...V1, dataAsOf: "2026-10-10T12:00:00.000Z" });
  expect((await computeRollups()).stats.unreachable).toBe(false);
  expect(fns.windows).toHaveBeenCalledTimes(1);
});
