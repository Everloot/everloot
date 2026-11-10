import { beforeEach, expect, test, vi } from "vitest";
import { auctionSightingsFromRecords, handleAuctionHistory, handleStoredAuctionHistory } from "../../../kb/src/auction-history";
import {
  AUCTION_HISTORY_KEY, buildAuctionHistory, forgetAuctionHistory, parseAuctionHistory, storedAuctionHistory, writeAuctionHistory,
} from "./auction-history-store";
import { uploadStore, type Corpus } from "./upload-store";

const CLOUD = { r2AccountId: "acct", r2AccessKeyId: "id", r2SecretAccessKey: "secret", r2Bucket: "everloot-uploads", supabaseUrl: "https://db.test", supabaseServiceKey: "service" };
const AT = new Date("2026-11-09T12:00:00Z");
const AS_OF = "2026-11-09T11:50:00.000Z";

const scan = (installId: string, realm: string, itemId: number, copper: number, capturedAt: string, priceBasis = "unit") =>
  ({ kind: "auction_scan", installId, eventId: `${installId}:${realm}:${itemId}:${capturedAt}`, realm, itemId, copper, capturedAt, priceBasis });

// Item 5 on Forever: two public days (one install scanning twice keeps its last scan), a thin day, a stack-priced row,
// and the realm written three ways. Item 6 on Forever and item 5 on Nightfall never reach 3 installs.
const records = [
  scan("a", "Forever", 5, 100, "2026-11-01T06:00:00Z"), scan("b", "forever ", 5, 300, "2026-11-01T07:00:00Z"),
  scan("c", "FOREVER", 5, 500, "2026-11-01T08:00:00Z"), scan("c", "Forever", 5, 700, "2026-11-01T09:00:00Z"),
  scan("a", "Forever", 5, 200, "2026-11-02T06:00:00Z"), scan("b", "Forever", 5, 200, "2026-11-02T06:00:00Z"),
  scan("c", "Forever", 5, 210, "2026-11-02T06:00:00Z"), scan("d", "Forever", 5, 9000, "2026-11-02T06:00:00Z", "stack"),
  scan("a", "Forever", 5, 50, "2026-11-03T06:00:00Z"), scan("b", "Forever", 5, 50, "2026-11-03T06:00:00Z"),
  scan("a", "Forever", 6, 10, "2026-11-01T06:00:00Z"), scan("b", "Forever", 6, 10, "2026-11-01T06:00:00Z"),
  scan("a", "Nightfall", 5, 10, "2026-11-01T06:00:00Z"),
  { kind: "loot", installId: "a", eventId: "loot-1" },
];
const corpus = { uploads: 4, records, dataAsOf: AS_OF } as unknown as Corpus;

beforeEach(() => { forgetAuctionHistory(); vi.restoreAllMocks(); });

test("the file holds each realm and item's public days from the corpus, dated by it, and no install or single scan", () => {
  const file = buildAuctionHistory(corpus, AT);
  expect(file).toEqual({
    version: 1, generatedAt: AT.toISOString(), dataAsOf: AS_OF,
    histories: [["forever|5", [{ day: "2026-11-01", copper: 300, reporters: 3 }, { day: "2026-11-02", copper: 200, reporters: 3 }]]],
  });
  expect(JSON.stringify(file)).not.toMatch(/"a"|installId|9000/);
  expect(() => buildAuctionHistory({ uploads: 0, records: [], unreachable: true }, AT)).toThrow(/unreachable/);
});

test("the stored days answer exactly as the corpus path does, for every realm spelling and item", async () => {
  const file = buildAuctionHistory(corpus, AT);
  const fetch = vi.fn(async () => new Response(JSON.stringify(file), { status: 200 }));
  const sightings = auctionSightingsFromRecords(records);
  for (const realm of ["Forever", " forever", "FOREVER", "Nightfall", "Elsewhere", " "]) {
    for (const itemId of [5, 6, 7, 0]) {
      const stored = await storedAuctionHistory(realm, itemId, { cloud: CLOUD, fetch: fetch as unknown as typeof globalThis.fetch });
      expect(stored?.dataAsOf).toBe(AS_OF);
      expect(handleStoredAuctionHistory({ realm, itemId }, stored!.points), `${realm} ${itemId}`).toBe(handleAuctionHistory({ realm, itemId }, sightings));
    }
  }
  expect(fetch).toHaveBeenCalledOnce();
});

test("the cron writes it from the corpus after a change or when it is missing, and an idle run with the file reads only a HEAD", async () => {
  const file = buildAuctionHistory(corpus, AT);
  const calls: Request[] = [];
  const answer = (head: number) => vi.fn(async (req: Request) => { calls.push(req); return new Response(null, { status: req.method === "HEAD" ? head : 200 }); });
  const build = async () => file;
  expect(await writeAuctionHistory({ added: 0 }, { cloud: CLOUD, fetch: answer(200) as unknown as typeof fetch, build })).toEqual({ written: false });
  expect(calls.map((c) => c.method)).toEqual(["HEAD"]);
  calls.length = 0;
  expect(await writeAuctionHistory({ added: 0 }, { cloud: CLOUD, fetch: answer(404) as unknown as typeof fetch, build })).toEqual({ written: true, items: 1 });
  expect(calls.map((c) => c.method)).toEqual(["HEAD", "PUT"]);
  calls.length = 0;
  expect(await writeAuctionHistory({ added: 0, rebuild: true }, { cloud: CLOUD, fetch: answer(200) as unknown as typeof fetch, build })).toEqual({ written: true, items: 1 });
  expect(calls.map((c) => c.method)).toEqual(["PUT"]);
  calls.length = 0;
  // Without a build of its own, the step reads the corpus once and stores what it holds.
  const load = vi.spyOn(uploadStore, "loadCorpus").mockResolvedValue(corpus);
  expect(await writeAuctionHistory({ added: 2 }, { cloud: CLOUD, fetch: answer(200) as unknown as typeof fetch })).toEqual({ written: true, items: 1 });
  expect(load).toHaveBeenCalledOnce();
  expect(calls[0]!.url).toBe(`https://acct.r2.cloudflarestorage.com/everloot-uploads/${AUCTION_HISTORY_KEY}`);
  expect(JSON.parse(await calls[0]!.text())).toMatchObject({ dataAsOf: AS_OF, histories: file.histories });
  await expect(writeAuctionHistory({ added: 1 }, { cloud: null })).rejects.toThrow(/cloud/);
  // An unreachable corpus is never stored as an empty history.
  load.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  calls.length = 0;
  await expect(writeAuctionHistory({ added: 1 }, { cloud: CLOUD, fetch: answer(200) as unknown as typeof fetch })).rejects.toThrow(/unreachable/);
  expect(calls).toEqual([]);
});

test("a file of an unknown shape, a missing one or one out of reach is no history, so the readers fall back to the corpus", async () => {
  const file = buildAuctionHistory(corpus, AT);
  expect(parseAuctionHistory(file)).toEqual(file);
  for (const bad of [null, {}, { ...file, version: 2 }, { ...file, histories: [["forever|5"]] }, { ...file, histories: [["forever|5", [{ day: "2026-11-01", copper: "5" }]]] }]) {
    expect(parseAuctionHistory(bad)).toBeNull();
  }
  const read = (fetch: () => Promise<Response>) => storedAuctionHistory("Forever", 5, { cloud: CLOUD, fetch: fetch as unknown as typeof globalThis.fetch });
  expect(await read(async () => new Response(null, { status: 404 }))).toBeNull();
  forgetAuctionHistory();
  expect(await read(async () => { throw new Error("r2 down"); })).toBeNull();
  forgetAuctionHistory();
  expect(await read(async () => new Response("not json", { status: 200 }))).toBeNull();
  forgetAuctionHistory();
  expect(await storedAuctionHistory("Forever", 5, { cloud: null })).toBeNull();
});

test("a server instance reads the file once for five minutes, and asks again after a minute when there was none", async () => {
  const file = buildAuctionHistory(corpus, AT);
  const fetch = vi.fn(async () => new Response(JSON.stringify(file), { status: 200 }));
  let now = 0;
  const read = (f: typeof fetch) => storedAuctionHistory("Forever", 5, { cloud: CLOUD, fetch: f as unknown as typeof globalThis.fetch, now: () => now });
  expect((await read(fetch))?.points).toHaveLength(2);
  now = 4 * 60_000;
  await read(fetch);
  expect(fetch).toHaveBeenCalledTimes(1);
  now = 5 * 60_000;
  await read(fetch);
  expect(fetch).toHaveBeenCalledTimes(2);
  forgetAuctionHistory();
  const missing = vi.fn(async () => new Response(null, { status: 404 }));
  now = 0;
  await read(missing);
  now = 30_000;
  await read(missing);
  expect(missing).toHaveBeenCalledTimes(1);
  now = 61_000;
  await read(missing);
  expect(missing).toHaveBeenCalledTimes(2);
});
