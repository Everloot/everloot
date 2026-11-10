import { beforeEach, expect, test, vi } from "vitest";
const store = vi.hoisted(() => ({ snapshotWork: vi.fn(), writeCronRun: vi.fn(), writeSnapshot: vi.fn(), writeMarket: vi.fn(), writeCompletion: vi.fn(), writeCensus: vi.fn(), prune: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { snapshotWork: store.snapshotWork, writeCronRun: store.writeCronRun, writeSnapshot: store.writeSnapshot, writeMarket: store.writeMarket, writeCompletion: store.writeCompletion, writeCensus: store.writeCensus },
  sharingStore: { loadState: async () => ({ grants: [], suppressions: [] }) },
}));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { prune: store.prune } }));
const keys = vi.hoisted(() => ({ pruneKeys: vi.fn() }));
vi.mock("@/lib/api-keys", () => ({ pruneKeys: keys.pruneKeys }));
const players = vi.hoisted(() => ({ prune: vi.fn() }));
vi.mock("@/lib/player-store", () => ({ playerStore: () => ({ prune: players.prune }) }));
const pulls = vi.hoisted(() => ({ store: null as unknown as import("@/lib/pull-store").PullStore }));
vi.mock("@/lib/pull-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/pull-store")>()), pullStore: () => pulls.store }));
const coverage = vi.hoisted(() => ({ writeCoverage: vi.fn() }));
vi.mock("@/lib/coverage-store", () => ({ writeCoverage: coverage.writeCoverage }));
const settled = vi.hoisted(() => ({ writeSettled: vi.fn(), week: vi.fn(() => "2026-W43") }));
vi.mock("@/lib/settled-store", () => ({ writeSettled: settled.writeSettled, currentSettledWeek: settled.week }));
const view = vi.hoisted(() => ({ writeItemView: vi.fn() }));
vi.mock("@/lib/item-view-store", () => ({ writeItemView: view.writeItemView }));
const aggregates = vi.hoisted(() => ({ writeAggregates: vi.fn() }));
vi.mock("@/lib/aggregate-store", () => ({ writeAggregates: aggregates.writeAggregates }));
const professions = vi.hoisted(() => ({ writeProfessions: vi.fn() }));
vi.mock("@/lib/profession-store", () => professions);
const mapPins = vi.hoisted(() => ({ writeMapPins: vi.fn() }));
vi.mock("@/lib/map-pins-store", () => mapPins);
import { GET } from "./route";
beforeEach(() => {
  professions.writeProfessions.mockReset().mockResolvedValue({ written: false });
  mapPins.writeMapPins.mockReset().mockResolvedValue({ written: false });
  vi.stubEnv("CRON_SECRET", "synthetic-cron-key");
  store.snapshotWork.mockReset().mockResolvedValue({ idle: false, retryRollups: false });
  store.writeCronRun.mockReset().mockResolvedValue(undefined);
  store.writeSnapshot.mockReset().mockResolvedValue({ uploads: 0 });
  store.writeMarket.mockReset().mockResolvedValue({ added: 0, scans: 0 });
  store.writeCompletion.mockReset().mockResolvedValue({ added: 0, remaining: 0, trimmed: 0, rebuilding: false });
  store.writeCensus.mockReset().mockResolvedValue({ added: 0, rows: 0, remaining: 0 });
  view.writeItemView.mockReset().mockResolvedValue({ written: false });
  aggregates.writeAggregates.mockReset().mockResolvedValue({ written: false });
  store.prune.mockReset().mockResolvedValue(undefined);
  keys.pruneKeys.mockReset().mockResolvedValue(undefined);
  players.prune.mockReset().mockResolvedValue(undefined);
  pulls.store = { insert: vi.fn(), forget: vi.fn(), prune: vi.fn().mockResolvedValue(undefined) };
  coverage.writeCoverage.mockReset().mockResolvedValue({ written: false });
  settled.writeSettled.mockReset().mockResolvedValue({ written: false });
});
const req = (auth = "Bearer synthetic-cron-key", query = "") =>
  new Request(`https://everloot.app/api/cron/snapshot${query}`, { headers: { authorization: auth } });
test("unauthorized cron cannot prune counters or rebuild", async () => {
  expect((await GET(req("wrong"))).status).toBe(401);
  expect(store.prune).not.toHaveBeenCalled();
  expect(store.writeSnapshot).not.toHaveBeenCalled();
  expect(store.writeMarket).not.toHaveBeenCalled();
});
test("authorized cron prunes stale counters after snapshot success", async () => {
  expect((await GET(req())).status).toBe(200);
  expect(store.prune).toHaveBeenCalledOnce();
});

test("an idle run skips corpus and completion, day-gates market, and heartbeats", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: "2026-W43" });
  expect((await GET(req())).status).toBe(200);
  expect(store.writeSnapshot).not.toHaveBeenCalled();
  expect(store.writeCompletion).not.toHaveBeenCalled();
  expect(store.writeMarket).toHaveBeenCalledWith({ idle: true });
  expect(store.writeCronRun).toHaveBeenCalledWith(false, "2026-10-01", "2026-W43");
  expect(store.prune).toHaveBeenCalledOnce();
});

test("the coverage score is written after a snapshot that changed, dated by the snapshot, and never on an idle run", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: "2026-W43" });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, coverage: { written: false } });
  expect(coverage.writeCoverage).not.toHaveBeenCalled();
  store.snapshotWork.mockResolvedValue({ idle: false, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: null });
  store.writeSnapshot.mockResolvedValue({ uploads: 9, added: 2, dataAsOf: "2026-10-02T00:00:00.000Z" });
  coverage.writeCoverage.mockResolvedValue({ written: true });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, coverage: { written: true } });
  expect(coverage.writeCoverage).toHaveBeenCalledWith({ added: 2, rebuild: false, dataAsOf: "2026-10-02T00:00:00.000Z" });
  expect(store.writeCronRun).toHaveBeenLastCalledWith(false, "2026-10-02T00:00:00.000Z", null);
});

test("a coverage failure is logged and the run, its heartbeat included, still succeeds", async () => {
  store.writeSnapshot.mockResolvedValue({ uploads: 9, added: 1, dataAsOf: "2026-10-02T00:00:00.000Z" });
  coverage.writeCoverage.mockRejectedValue(new Error("r2 down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, coverage: null });
  expect(store.writeCronRun).toHaveBeenCalledOnce();
});

test("idle does not strand rollups left behind by failure or a bounded completion batch", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: true, dataAsOf: "2026-10-01", settledWeek: "2026-W43" });
  store.writeCompletion.mockResolvedValue({ added: 1, remaining: 2, trimmed: 0, rebuilding: false });
  expect((await GET(req())).status).toBe(200);
  expect(store.writeSnapshot).not.toHaveBeenCalled();
  expect(store.writeMarket).toHaveBeenCalledWith({ rebuild: false });
  expect(store.writeCompletion).toHaveBeenCalledOnce();
  expect(store.writeCronRun).toHaveBeenCalledWith(true, "2026-10-01", "2026-W43");
});

test("a market backlog marks the run pending, so an idle next run still folds it", async () => {
  store.writeMarket.mockResolvedValue({ added: 1500, scans: 1500, remaining: 40, dropped: 0, trimmedDays: 0 });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, market: { remaining: 40 } });
  expect(store.writeCronRun).toHaveBeenCalledWith(true, undefined, null);
});

test("an explicit rebuild bypasses idle and a failed run never advances the heartbeat", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false });
  store.writeMarket.mockRejectedValue(new Error("down"));
  expect((await GET(req(undefined, "?rebuild=1"))).status).toBe(500);
  expect(store.writeSnapshot).toHaveBeenCalledWith({ rebuild: true });
  expect(store.writeCronRun).not.toHaveBeenCalled();
});
test("quota cleanup failure is reported so stale storage cannot silently grow", async () => {
  store.prune.mockRejectedValue(new Error("quota database down"));
  expect((await GET(req())).status).toBe(500);
});
test("the market rollup runs with the snapshot and rebuilds with it", async () => {
  store.writeMarket.mockResolvedValue({ added: 2, scans: 5 });
  const body = await (await GET(req(undefined, "?rebuild=1"))).json();
  expect(body).toMatchObject({ ok: true, market: { added: 2, scans: 5 } });
  expect(store.writeMarket).toHaveBeenCalledWith({ rebuild: true });
});
test("the completion rollup runs after the market, rebuilds with it, and a failure is reported", async () => {
  store.writeCompletion.mockResolvedValue({ added: 3, remaining: 7, trimmed: 0, rebuilding: true });
  const body = await (await GET(req(undefined, "?rebuild=1"))).json();
  expect(body).toMatchObject({ ok: true, completion: { added: 3, remaining: 7, rebuilding: true } });
  expect(store.writeCompletion).toHaveBeenCalledWith({ rebuild: true, authority: expect.any(Function) });
  store.writeCompletion.mockRejectedValue(new Error("completion down"));
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect(await res.json()).toMatchObject({ ok: false, error: "completion rollup failed" });
});
test("a market failure is reported but does not block the corpus snapshot or cleanup", async () => {
  // Cleanup runs before the market step, so a market that times out cannot starve it.
  const order: string[] = [];
  store.prune.mockImplementation(async () => { order.push("prune"); });
  store.writeMarket.mockImplementation(async () => { order.push("market"); throw new Error("market down"); });
  const res = await GET(req());
  expect(order).toEqual(["prune", "market"]);
  expect(res.status).toBe(500);
  expect(store.writeSnapshot).toHaveBeenCalledOnce();
  expect(store.prune).toHaveBeenCalledOnce();
  expect(await res.json()).toMatchObject({ ok: false, error: "market rollup failed" });
});

test("a corpus failure still folds the market and completion, is reported, and never advances the heartbeat", async () => {
  // The corpus snapshot grows with every record; the rollups have their own watermarks and must not wait on it.
  const order: string[] = [];
  store.writeSnapshot.mockImplementation(async () => { order.push("snapshot"); throw new Error("snapshot too big"); });
  store.prune.mockImplementation(async () => { order.push("prune"); });
  store.writeMarket.mockImplementation(async () => { order.push("market"); return { added: 3, scans: 7 }; });
  store.writeCompletion.mockImplementation(async () => { order.push("completion"); return { added: 1, remaining: 0, trimmed: 0, rebuilding: false }; });
  const res = await GET(req());
  expect(order).toEqual(["snapshot", "prune", "market", "completion"]);
  expect(res.status).toBe(500);
  expect(await res.json()).toMatchObject({ ok: false, error: "snapshot failed", market: { added: 3, scans: 7 }, completion: { added: 1 } });
  expect(store.writeMarket).toHaveBeenCalledWith({ rebuild: false });
  expect(coverage.writeCoverage).not.toHaveBeenCalled();
  expect(settled.writeSettled).not.toHaveBeenCalled();
  expect(store.writeCronRun).not.toHaveBeenCalled();
});

test("key retention runs only once the data guard is on, and its failure does not fail the snapshot", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "");
  expect((await GET(req())).status).toBe(200);
  expect(keys.pruneKeys).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  expect((await GET(req())).status).toBe(200);
  expect(keys.pruneKeys).toHaveBeenCalledOnce();
  keys.pruneKeys.mockRejectedValue(new Error("down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await GET(req())).status).toBe(200);
  vi.stubEnv("EVERLOOT_DATA_GUARD", "");
});
test("player rows are pruned only with the player pages on, and a failure does not fail the run", async () => {
  expect((await GET(req())).status).toBe(200);
  expect(players.prune).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  players.prune.mockRejectedValue(new Error("players down"));
  expect((await GET(req())).status).toBe(200);
  expect(players.prune).toHaveBeenCalledOnce();
  vi.unstubAllEnvs();
});

test("pull summaries are pruned with their collection switch off, and a database without their tables is no error", async () => {
  vi.stubEnv("EVERLOOT_PULL_SUMMARIES", "");
  expect((await GET(req())).status).toBe(200);
  expect(pulls.store.prune).toHaveBeenCalledOnce();
  // Before the migration: PostgREST has no prune_pull_summaries and answers PGRST202.
  const { createCloudPullStore } = await vi.importActual<typeof import("@/lib/pull-store")>("@/lib/pull-store");
  const doFetch = vi.fn(async () => new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }));
  pulls.store = createCloudPullStore("https://db.example", "key", doFetch as unknown as typeof fetch);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await GET(req())).status).toBe(200);
  expect(doFetch).toHaveBeenCalledOnce();
  expect(logged).not.toHaveBeenCalled();
  // A store that fails for another reason is logged and the run still succeeds.
  pulls.store = { insert: vi.fn(), forget: vi.fn(), prune: vi.fn().mockRejectedValue(new Error("pulls down")) };
  expect((await GET(req())).status).toBe(200);
  expect(logged).toHaveBeenCalledWith("pull retention failed", expect.any(Error));
  logged.mockRestore();
  vi.unstubAllEnvs();
});

test("the settled list is written beside the score after a changed snapshot, never on an idle run, and a failure does not fail the run", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: "2026-W43" });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, settled: { written: false } });
  expect(settled.writeSettled).not.toHaveBeenCalled();
  store.snapshotWork.mockResolvedValue({ idle: false, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: null });
  store.writeSnapshot.mockResolvedValue({ uploads: 9, added: 2, dataAsOf: "2026-10-02T00:00:00.000Z" });
  settled.writeSettled.mockResolvedValue({ written: true, facts: 3, week: "2026-W43" });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, settled: { written: true, facts: 3 } });
  expect(settled.writeSettled).toHaveBeenCalledWith({ added: 2, rebuild: false, dataAsOf: "2026-10-02T00:00:00.000Z", force: false, week: "2026-W43" });
  expect(store.writeCronRun).toHaveBeenLastCalledWith(false, "2026-10-02T00:00:00.000Z", "2026-W43");
  settled.writeSettled.mockRejectedValue(new Error("r2 down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, settled: null });
});

test("an idle run rewrites the settled list so the weekly spot check rotates without new uploads", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: "2026-W42" });
  settled.writeSettled.mockResolvedValue({ written: true, facts: 3, week: "2026-W43" });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, settled: { written: true, facts: 3 } });
  expect(store.writeSnapshot).not.toHaveBeenCalled();
  expect(settled.writeSettled).toHaveBeenCalledWith({ added: 0, rebuild: false, dataAsOf: "2026-10-01", force: true, week: "2026-W43" });
  expect(store.writeCronRun).toHaveBeenCalledWith(false, "2026-10-01", "2026-W43");
});

test("a failed weekly settled refresh keeps the old week so the next run retries it", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: "2026-W42" });
  settled.writeSettled.mockRejectedValue(new Error("r2 down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await GET(req())).status).toBe(200);
  expect(store.writeCronRun).toHaveBeenCalledWith(false, "2026-10-01", "2026-W42");
});

test("the census snapshot folds on every run with uploads, skips on an idle one, and leftovers keep the run pending", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: "2026-W43" });
  await GET(req());
  expect(store.writeCensus).toHaveBeenLastCalledWith({ idle: true });
  store.snapshotWork.mockResolvedValue({ idle: false, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: "2026-W43" });
  store.writeSnapshot.mockResolvedValue({ uploads: 9, added: 3, dataAsOf: "2026-10-02T00:00:00.000Z" });
  store.writeCensus.mockResolvedValue({ added: 3, rows: 40, remaining: 5 });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, census: { added: 3, rows: 40, remaining: 5 } });
  expect(store.writeCensus).toHaveBeenLastCalledWith({ rebuild: false });
  expect(store.writeCronRun).toHaveBeenLastCalledWith(true, "2026-10-02T00:00:00.000Z", "2026-W43");
  await GET(req("Bearer synthetic-cron-key", "?rebuild=1"));
  expect(store.writeCensus).toHaveBeenLastCalledWith({ rebuild: true });
});

test("the item view is written after the snapshot with what that run added; a census or view failure is logged and the run succeeds", async () => {
  store.writeSnapshot.mockResolvedValue({ uploads: 9, added: 2, dataAsOf: "2026-10-02T00:00:00.000Z" });
  view.writeItemView.mockResolvedValue({ written: true, items: 12 });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, itemView: { written: true, items: 12 } });
  expect(view.writeItemView).toHaveBeenCalledWith({ added: 2, rebuild: false, dataAsOf: "2026-10-02T00:00:00.000Z" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  store.writeCensus.mockRejectedValue(new Error("r2 down"));
  view.writeItemView.mockRejectedValue(new Error("r2 down"));
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, census: null, itemView: null });
});

test("the stored aggregates are written after the item view with what that run added; a failure is logged and the run succeeds", async () => {
  const order: string[] = [];
  store.writeSnapshot.mockResolvedValue({ uploads: 9, added: 2, dataAsOf: "2026-10-02T00:00:00.000Z" });
  view.writeItemView.mockImplementation(async () => { order.push("itemView"); return { written: true, items: 12 }; });
  aggregates.writeAggregates.mockImplementation(async () => { order.push("aggregates"); return { written: true, bytes: 4096 }; });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, itemView: { written: true }, aggregates: { written: true, bytes: 4096 } });
  expect(order).toEqual(["itemView", "aggregates"]);
  expect(aggregates.writeAggregates).toHaveBeenCalledWith({ added: 2, rebuild: false, dataAsOf: "2026-10-02T00:00:00.000Z" });
  await GET(req("Bearer synthetic-cron-key", "?rebuild=1"));
  expect(aggregates.writeAggregates).toHaveBeenLastCalledWith(expect.objectContaining({ rebuild: true }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  aggregates.writeAggregates.mockRejectedValue(new Error("r2 down"));
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, aggregates: null });
  expect(store.writeCronRun).toHaveBeenCalled();
});

test("an idle run still asks for the stored aggregates, so a missing file is written", async () => {
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false, dataAsOf: "2026-10-01", settledWeek: "2026-W43" });
  await GET(req());
  expect(aggregates.writeAggregates).toHaveBeenCalledWith({ added: 0, rebuild: false, dataAsOf: "2026-10-01" });
});

test("profession and map views follow aggregates, including idle runs and rebuilds; failures are logged", async () => {
  for (const rebuild of [false, true]) {
    store.writeSnapshot.mockResolvedValue({ uploads: 3, added: 2, dataAsOf: "2026-11-09" });
    await GET(req("Bearer synthetic-cron-key", rebuild ? "?rebuild=1" : ""));
    for (const write of [professions.writeProfessions, mapPins.writeMapPins]) {
      expect(write).toHaveBeenLastCalledWith({ added: 2, rebuild, dataAsOf: "2026-11-09" });
      expect(write.mock.invocationCallOrder.at(-1)).toBeGreaterThan(aggregates.writeAggregates.mock.invocationCallOrder.at(-1)!);
    }
  }
  store.snapshotWork.mockResolvedValue({ idle: true, retryRollups: false, dataAsOf: "2026-11-09" });
  await GET(req());
  expect(professions.writeProfessions).toHaveBeenLastCalledWith({ added: 0, rebuild: false, dataAsOf: "2026-11-09" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  professions.writeProfessions.mockRejectedValue(new Error("offline"));
  mapPins.writeMapPins.mockRejectedValue(new Error("offline"));
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, professions: null, mapPins: null });
});
