vi.mock("@/lib/auction-report-store", () => ({ writeAuctionReports: vi.fn().mockResolvedValue({ written: false }) }));
vi.mock("@/lib/market-boards", () => ({ writeMarketBoards: vi.fn().mockResolvedValue({ written: false }) }));
import { beforeEach, expect, test, vi } from "vitest";
const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), viewsWork: vi.fn(), forgetReads: vi.fn(), forgetPublished: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus, viewsWork: store.viewsWork, forgetReads: store.forgetReads },
  sharingStore: { forgetPublished: store.forgetPublished },
}));
const coverage = vi.hoisted(() => ({ writeCoverage: vi.fn() }));
vi.mock("@/lib/coverage-store", () => ({ writeCoverage: coverage.writeCoverage }));
const view = vi.hoisted(() => ({ writeItemView: vi.fn(), buildItemView: vi.fn() }));
vi.mock("@/lib/item-view-store", () => view);
const aggregates = vi.hoisted(() => ({ writeAggregates: vi.fn(), anonymousAggregates: vi.fn() }));
vi.mock("@/lib/aggregate-store", () => aggregates);
const searchNames = vi.hoisted(() => ({ writeSearchNames: vi.fn() }));
vi.mock("@/lib/search-names-store", () => searchNames);
const auctions = vi.hoisted(() => ({ writeAuctionHistory: vi.fn(), buildAuctionHistory: vi.fn() }));
vi.mock("@/lib/auction-history-store", () => auctions);
const professions = vi.hoisted(() => ({ writeProfessions: vi.fn(), buildProfessions: vi.fn() }));
vi.mock("@/lib/profession-store", () => professions);
const mapPins = vi.hoisted(() => ({ writeMapPins: vi.fn(), buildMapPins: vi.fn() }));
vi.mock("@/lib/map-pins-store", () => mapPins);
const activity = vi.hoisted(() => ({ writeDatabaseActivity: vi.fn(), buildDatabaseActivity: vi.fn() }));
vi.mock("@/lib/database-activity-store", () => ({ writeDatabaseActivity: activity.writeDatabaseActivity }));
vi.mock("@/lib/database-activity", () => ({ buildDatabaseActivity: activity.buildDatabaseActivity }));
const guilds = vi.hoisted(() => ({ writeGuildLadder: vi.fn() }));
vi.mock("@/lib/guild-ladder-store", () => guilds);
import { GET } from "./route";
import { writeAuctionReports } from "@/lib/auction-report-store";
import { writeMarketBoards } from "@/lib/market-boards";

const AS_OF = "2026-10-02T00:00:00.000Z";
const opts = { added: 0, rebuild: false, dataAsOf: AS_OF };
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "synthetic-cron-key");
  store.loadCorpus.mockReset();
  store.viewsWork.mockReset().mockResolvedValue({ dataAsOf: AS_OF, rollupsPending: false });
  store.forgetReads.mockReset();
  store.forgetPublished.mockReset();
  for (const write of [view.writeItemView, aggregates.writeAggregates, searchNames.writeSearchNames, auctions.writeAuctionHistory,
    professions.writeProfessions, mapPins.writeMapPins, activity.writeDatabaseActivity, guilds.writeGuildLadder, coverage.writeCoverage]) {
    write.mockReset().mockResolvedValue({ written: false });
  }
  aggregates.anonymousAggregates.mockReset();
  vi.mocked(writeAuctionReports).mockReset().mockResolvedValue({ written: false });
  vi.mocked(writeMarketBoards).mockReset().mockResolvedValue({ written: false });
});
const req = (auth = "Bearer synthetic-cron-key", query = "") =>
  new Request(`https://everloot.app/api/cron/views${query}`, { headers: { authorization: auth } });
const views = [view.writeItemView, aggregates.writeAggregates, auctions.writeAuctionHistory, professions.writeProfessions, mapPins.writeMapPins, activity.writeDatabaseActivity];

test("an unauthorized or unconfigured call builds nothing", async () => {
  expect((await GET(req("wrong"))).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(req())).status).toBe(503);
  expect(store.viewsWork).not.toHaveBeenCalled();
  expect(view.writeItemView).not.toHaveBeenCalled();
});

test("every view, the ladder and the coverage score are asked with the stored corpus's time, and each writer decides from its stamp", async () => {
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, rebuild: false, dataAsOf: AS_OF });
  for (const write of views) expect(write).toHaveBeenCalledWith(opts, expect.anything());
  expect(guilds.writeGuildLadder).toHaveBeenCalledWith(opts);
  expect(coverage.writeCoverage).toHaveBeenCalledWith(opts);
  expect(writeMarketBoards).toHaveBeenCalledOnce();
  // Nothing needed writing, so no corpus was read.
  expect(store.loadCorpus).not.toHaveBeenCalled();
});

test("?rebuild=1 asks every writer to rewrite, whatever its stamp", async () => {
  await GET(req(undefined, "?rebuild=1"));
  for (const write of views) expect(write).toHaveBeenCalledWith({ ...opts, rebuild: true }, expect.anything());
  expect(searchNames.writeSearchNames).toHaveBeenCalledWith({ ...opts, rebuild: true }, expect.anything());
  expect(coverage.writeCoverage).toHaveBeenCalledWith({ ...opts, rebuild: true });
});

test("with no stored corpus there is nothing to build", async () => {
  store.viewsWork.mockResolvedValue({ dataAsOf: null, rollupsPending: true });
  expect(await (await GET(req())).json()).toEqual({ ok: true, skipped: "no snapshot" });
  expect(view.writeItemView).not.toHaveBeenCalled();
  expect(guilds.writeGuildLadder).not.toHaveBeenCalled();
});

test("an unreadable snapshot fails the run, so the trigger reports it", async () => {
  store.viewsWork.mockRejectedValue(new Error("r2 down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await GET(req())).status).toBe(500);
  expect(view.writeItemView).not.toHaveBeenCalled();
});

test("the views share one corpus read, and an unreachable corpus fails each view that needs it while the run succeeds", async () => {
  const corpus = { uploads: 9, records: [{ kind: "item_seen" }], dataAsOf: AS_OF };
  store.loadCorpus.mockResolvedValue(corpus);
  for (const write of views) write.mockImplementation(async (_opts: unknown, deps: { build: (previous?: unknown) => Promise<unknown> }) => { await deps.build(null); return { written: true }; });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, itemView: { written: true }, aggregates: { written: true }, auctionHistory: { written: true }, professions: { written: true }, mapPins: { written: true }, databaseActivity: { written: true } });
  expect(store.loadCorpus).toHaveBeenCalledOnce();
  expect(view.buildItemView).toHaveBeenCalledWith(AS_OF, expect.any(Date), corpus);
  for (const build of [aggregates.anonymousAggregates, auctions.buildAuctionHistory, professions.buildProfessions, mapPins.buildMapPins]) expect(build).toHaveBeenCalledWith(corpus);
  expect(activity.buildDatabaseActivity).toHaveBeenCalledWith(corpus, expect.any(Date), null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  store.loadCorpus.mockClear().mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, itemView: null, aggregates: null, auctionHistory: null, professions: null, mapPins: null, databaseActivity: null });
  expect(store.loadCorpus).toHaveBeenCalledOnce();
});

test("the search names come from the aggregates' set, only on a run that builds it", async () => {
  const set = { key: "set" };
  store.loadCorpus.mockResolvedValue({ uploads: 9, records: [] });
  aggregates.anonymousAggregates.mockReturnValue(set);
  const built: unknown[] = [];
  aggregates.writeAggregates.mockImplementation(async (_o: unknown, deps: { build: () => Promise<unknown> }) => { built.push(await deps.build()); return { written: true }; });
  searchNames.writeSearchNames.mockImplementation(async (_o: unknown, deps: { build: () => Promise<unknown> }) => { built.push(await deps.build()); return { written: true, bytes: 2048 }; });
  expect(await (await GET(req())).json()).toMatchObject({ searchNames: { written: true, bytes: 2048 } });
  expect(searchNames.writeSearchNames).toHaveBeenCalledWith(opts, expect.anything());
  expect(built).toEqual([set, set]);
  expect(aggregates.anonymousAggregates).toHaveBeenCalledOnce();
  // Current aggregates: the set is never built for the names file alone.
  aggregates.writeAggregates.mockResolvedValue({ written: false });
  searchNames.writeSearchNames.mockClear();
  expect(await (await GET(req())).json()).toMatchObject({ searchNames: { written: false } });
  expect(searchNames.writeSearchNames).not.toHaveBeenCalled();
});

test("the auction reports wait while a rollup has uploads left to fold", async () => {
  store.viewsWork.mockResolvedValue({ dataAsOf: AS_OF, rollupsPending: true });
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, auctionReports: null });
  expect(writeAuctionReports).not.toHaveBeenCalled();
  store.viewsWork.mockResolvedValue({ dataAsOf: AS_OF, rollupsPending: false });
  vi.mocked(writeAuctionReports).mockResolvedValue({ written: true, reports: 1 });
  expect(await (await GET(req())).json()).toMatchObject({ auctionReports: { written: true, reports: 1 } });
});

test("each step's failure is logged and the next still runs, in order, with memory let go between steps (#1354)", async () => {
  const order: string[] = [];
  const fail = (name: string) => async () => { order.push(name); throw new Error("out of memory"); };
  view.writeItemView.mockImplementation(fail("item view"));
  aggregates.writeAggregates.mockImplementation(fail("aggregates"));
  auctions.writeAuctionHistory.mockImplementation(fail("auction history"));
  professions.writeProfessions.mockImplementation(fail("professions"));
  mapPins.writeMapPins.mockImplementation(fail("map pins"));
  activity.writeDatabaseActivity.mockImplementation(fail("database activity"));
  guilds.writeGuildLadder.mockImplementation(fail("ladder"));
  vi.mocked(writeMarketBoards).mockImplementation(fail("boards"));
  coverage.writeCoverage.mockImplementation(fail("coverage"));
  vi.mocked(writeAuctionReports).mockImplementation(fail("reports"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, itemView: null, aggregates: null, guildLadder: null, marketBoards: null, coverage: null, auctionReports: null });
  expect(order).toEqual(["item view", "aggregates", "auction history", "professions", "map pins", "database activity", "ladder", "boards", "coverage", "reports"]);
  // After the item view, the aggregates and names, each later view and each step after them.
  expect(store.forgetReads).toHaveBeenCalledTimes(10);
  expect(store.forgetPublished).toHaveBeenCalledTimes(10);
});
