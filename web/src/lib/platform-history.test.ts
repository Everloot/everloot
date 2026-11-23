import { expect, test, vi } from "vitest";
import type { MarketState } from "@kb/market";
import type { Corpus } from "./upload-store";
import { backfillRows, completedDay, HISTORY_KEY, marketCounts, readDailyHistory, snapshotRow, writeDailyHistory, type DayRow } from "./platform-history";

const cloud = { r2AccountId: "acct", r2AccessKeyId: "synthetic-id", r2SecretAccessKey: "synthetic-secret", r2Bucket: "bucket" };
const rec = (kind: string, installId: string, capturedAt: string) => ({ kind, installId, capturedAt }) as unknown as Corpus["records"][number];
const corpus: Corpus = {
  uploads: 3, dataAsOf: "2026-11-23T00:00:12Z",
  records: [rec("loot", "a", "2026-11-20T10:00:00Z"), rec("loot", "b", "2026-11-21T23:59:59Z"), rec("vendor", "a", "2026-11-22T05:00:00Z")],
};
const market = {
  version: 3,
  realms: { r1: { name: "R1", items: { "10": { open: {}, closed: {} }, "11": { open: {}, closed: {} } } } },
  houses: { "r1|a": { name: "R1", items: { "11": { open: {}, closed: {} }, "12": { open: {}, closed: {} } } } },
} as unknown as MarketState;
const coverage = { installs: 4, confirmed: 120, waiting: 30, dataAsOf: null, build: "1.60.1.70959" };

/**
 * An R2 holding one history file, honouring if-match and if-none-match as R2 does. Like R2, a read that may be
 * compressed (no `accept-encoding: identity`) answers with a weak ETag, which no If-Match accepts.
 */
function bucket(initial?: unknown) {
  const state = { body: initial === undefined ? undefined : JSON.stringify(initial), etag: 1 };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    expect(new URL(req.url).pathname).toBe(`/bucket/${HISTORY_KEY}`);
    const weak = req.headers.get("accept-encoding") === "identity" ? "" : "W/";
    if (req.method === "GET") return state.body === undefined ? new Response("missing", { status: 404 }) : new Response(state.body, { headers: { etag: `${weak}"${state.etag}"` } });
    const match = req.headers.get("if-match");
    if ((match && match !== `"${state.etag}"`) || (req.headers.get("if-none-match") === "*" && state.body !== undefined)) return new Response("precondition", { status: 412 });
    state.body = await req.text();
    state.etag++;
    return new Response(null, { status: 200 });
  });
  return { fetch, state };
}
const sources = () => ({ corpus: vi.fn(async () => corpus), market: vi.fn(async () => market), coverage: vi.fn(async () => coverage) });

test("the completed day is the UTC day before now", () => {
  expect(completedDay(new Date("2026-11-23T00:05:00Z"))).toBe("2026-11-22");
});

test("a snapshot row counts records by kind and distinct contributors, the market's realms, houses and items, and the coverage", () => {
  expect(snapshotRow("2026-11-22", corpus, market, coverage)).toEqual({
    date: "2026-11-22", source: "snapshot", dataAsOf: "2026-11-23T00:00:12Z", uploads: 3, records: 3, contributors: 2,
    kinds: { loot: 2, vendor: 1 }, market: { realms: 1, houses: 1, items: 3 }, coverage: { installs: 4, confirmed: 120, waiting: 30 },
  });
  expect(marketCounts(null)).toBeNull();
});

test("the backfill gives every day from the first capture, each counting what was captured by its end", () => {
  const rows = backfillRows(corpus, "2026-11-21");
  expect(rows.map((r) => [r.date, r.records, r.contributors])).toEqual([["2026-11-20", 1, 1], ["2026-11-21", 2, 2]]);
  expect(rows.every((r) => r.source === "backfill" && r.uploads === null && r.market === null)).toBe(true);
});

test("the first write starts the file with the backfill and the completed day; the next run that day writes nothing", async () => {
  const { fetch, state } = bucket();
  const src = sources();
  expect(await writeDailyHistory(new Date("2026-11-23T00:05:00Z"), { cloud, fetch, ...src })).toEqual({ written: true, date: "2026-11-22", days: 3 });
  const days = JSON.parse(state.body!).days as DayRow[];
  expect(days.map((d) => [d.date, d.source])).toEqual([["2026-11-20", "backfill"], ["2026-11-21", "backfill"], ["2026-11-22", "snapshot"]]);
  src.corpus.mockClear();
  expect(await writeDailyHistory(new Date("2026-11-23T00:15:00Z"), { cloud, fetch, ...src })).toEqual({ written: false, date: "2026-11-22" });
  expect(src.corpus).not.toHaveBeenCalled();
  expect(await readDailyHistory({ cloud, fetch })).toHaveLength(3);
});

test("each later day is appended to the file as it stands, read uncompressed so its ETag is strong", async () => {
  const { fetch, state } = bucket({ version: 1, days: [{ date: "2026-11-21", source: "snapshot" }] });
  expect(await writeDailyHistory(new Date("2026-11-23T00:05:00Z"), { cloud, fetch, ...sources() })).toMatchObject({ written: true, days: 2 });
  expect(await writeDailyHistory(new Date("2026-11-24T00:05:00Z"), { cloud, fetch, ...sources() })).toMatchObject({ written: true, days: 3 });
  expect((JSON.parse(state.body!).days as DayRow[]).map((d) => d.date)).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
  const get = (fetch.mock.calls[0][0] as Request);
  expect(get.headers.get("accept-encoding")).toBe("identity");
});

test("a file that changed since it was read, or answers without a strong ETag, fails the write loudly so the next run retries", async () => {
  const racing = bucket({ version: 1, days: [] });
  const slow = sources();
  slow.corpus.mockImplementation(async () => { racing.state.etag++; return corpus; });
  await expect(writeDailyHistory(new Date("2026-11-24T00:05:00Z"), { cloud, fetch: racing.fetch, ...slow })).rejects.toThrow("412");
  const weak = vi.fn(async () => new Response(JSON.stringify({ version: 1, days: [] }), { headers: { etag: 'W/"1"' } }));
  await expect(writeDailyHistory(new Date("2026-11-24T00:05:00Z"), { cloud, fetch: weak, ...sources() })).rejects.toThrow("no strong ETag");
  expect(weak).toHaveBeenCalledOnce();
});

test("a file this code cannot read is left alone, and an unreachable corpus writes nothing", async () => {
  const { fetch, state } = bucket({ version: 9 });
  await expect(writeDailyHistory(new Date("2026-11-23T00:05:00Z"), { cloud, fetch, ...sources() })).rejects.toThrow("not readable");
  expect(JSON.parse(state.body!)).toEqual({ version: 9 });
  const empty = bucket();
  const src = sources();
  src.corpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  await expect(writeDailyHistory(new Date("2026-11-23T00:05:00Z"), { cloud, fetch: empty.fetch, ...src })).rejects.toThrow("corpus unreachable");
  expect(empty.state.body).toBeUndefined();
});
