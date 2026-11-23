import { beforeEach, expect, test, vi } from "vitest";
import type { CensusRead } from "./upload-store";
import { forgetStoredRankingWeeks, loadStoredRankingWeeks, parseRankingWeeks, RANKING_WEEKS_KEY, RANKING_WEEKS_REVISION, writeRankingWeeks } from "./ranking-weeks-store";
import { rankingWeeks, type RankingWeek } from "./rankings";
import { STAMP, stampOf } from "./stored-view-freshness";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "synthetic-id", r2SecretAccessKey: "synthetic-secret", r2Bucket: "bucket" };
const census: CensusRead = { rows: [], dataAsOf: "2026-11-23T02:41:00.000Z" };
const week = { start: "2026-11-17", to: "2026-11-23T02:41:00.000Z", current: true, window: { classes: [], races: [], factions: [] } } as unknown as RankingWeek;

/** One stored file, served with its stamp; a PUT replaces it. */
function bucket(initial?: { body: string; stamp: string }) {
  const state = { ...initial, puts: 0 };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    expect(new URL(req.url).pathname).toBe(`/bucket/${RANKING_WEEKS_KEY}`);
    if (req.method === "PUT") { state.body = await req.text(); state.stamp = req.headers.get(STAMP) ?? ""; state.puts++; return new Response(null); }
    if (state.body === undefined) return new Response("missing", { status: 404 });
    return new Response(req.method === "HEAD" ? null : state.body, { headers: { [STAMP]: state.stamp!, etag: '"1"' } });
  });
  return { fetch, state };
}

beforeEach(() => forgetStoredRankingWeeks());

test("the file reads back as written, and anything else is not the file", () => {
  const file = { version: 1, revision: RANKING_WEEKS_REVISION, dataAsOf: census.dataAsOf, weeks: [week] };
  expect(parseRankingWeeks(JSON.stringify(file))).toEqual({ dataAsOf: census.dataAsOf, weeks: [week] });
  expect(parseRankingWeeks("{")).toBeNull();
  expect(parseRankingWeeks(JSON.stringify({ ...file, version: 2 }))).toBeNull();
  expect(parseRankingWeeks(JSON.stringify({ ...file, weeks: [{ start: "2026-11-17" }] }))).toBeNull();
});

test("the job stores the weeks rankingWeeks gives for the census as of its own time, and rewrites only when the census moved on", async () => {
  const { fetch, state } = bucket();
  const weeks = vi.fn((rows: CensusRead["rows"], asOf: string | Date) => rankingWeeks(rows, asOf));
  expect(await writeRankingWeeks({ census: async () => census, weeks, cloud, fetch })).toMatchObject({ written: true });
  expect(weeks).toHaveBeenCalledWith([], census.dataAsOf);
  expect(state.stamp).toBe(stampOf(census.dataAsOf, RANKING_WEEKS_REVISION));
  expect(parseRankingWeeks(state.body!)?.weeks).toEqual(JSON.parse(JSON.stringify(rankingWeeks([], census.dataAsOf!))));
  expect(await writeRankingWeeks({ census: async () => census, weeks, cloud, fetch })).toEqual({ written: false });
  expect(weeks).toHaveBeenCalledOnce();
  expect(await writeRankingWeeks({ census: async () => ({ ...census, dataAsOf: "2026-11-23T03:00:00.000Z" }), weeks, cloud, fetch })).toMatchObject({ written: true });
  await expect(writeRankingWeeks({ census: async () => ({ rows: [], dataAsOf: null, unreachable: true }), weeks, cloud, fetch })).rejects.toThrow("census unreachable");
  expect(state.puts).toBe(2);
});

test("a page reads the stored weeks once and keeps them; with no file it gets null and reads the census itself", async () => {
  const body = JSON.stringify({ version: 1, revision: RANKING_WEEKS_REVISION, dataAsOf: census.dataAsOf, weeks: [week] });
  const { fetch } = bucket({ body, stamp: stampOf(census.dataAsOf, RANKING_WEEKS_REVISION) });
  const now = () => Date.parse("2026-11-23T03:00:00Z");
  expect(await loadStoredRankingWeeks({ cloud, fetch, now })).toEqual({ dataAsOf: census.dataAsOf, weeks: [week] });
  await loadStoredRankingWeeks({ cloud, fetch, now });
  expect(fetch).toHaveBeenCalledOnce();
  forgetStoredRankingWeeks();
  expect(await loadStoredRankingWeeks({ cloud, fetch: bucket().fetch, now })).toBeNull();
});

test("loadRankingWeeks serves the stored weeks without reading a census row", async () => {
  vi.resetModules();
  const loadCensus = vi.fn();
  vi.doMock("./upload-store", async (orig) => ({ ...(await orig<typeof import("./upload-store")>()), uploadStore: { loadCensus } }));
  vi.doMock("./ranking-weeks-store", () => ({ loadStoredRankingWeeks: async () => ({ dataAsOf: census.dataAsOf, weeks: [week] }) }));
  const { loadRankingWeeks } = await import("./rankings");
  expect(await loadRankingWeeks()).toEqual({ weeks: [week], unreachable: false, dataAsOf: census.dataAsOf });
  expect(loadCensus).not.toHaveBeenCalled();
  vi.doUnmock("./upload-store");
  vi.doUnmock("./ranking-weeks-store");
});
