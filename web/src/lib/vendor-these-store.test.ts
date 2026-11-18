import { expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../kb/src/market";
import { buildVendorLists, storedVendorThese, VENDOR_BUDGET, writeVendorThese, type SellPrices, type StoredVendorRealm } from "./vendor-these-store";

const cloud = { r2AccountId: "account", r2AccessKeyId: "key", r2SecretAccessKey: "secret", r2Bucket: "bucket" };
const now = new Date("2026-11-18T12:00:00Z");
const scans = (realm: string, house: string, items: [number, number][]) => ["install-a", "install-b", "install-c"].map((installId) => ({
  kind: "auction_snapshot", installId, eventId: `${installId}:${realm}:${house}`, capturedAt: now.toISOString(), realm, house,
  scanId: `${installId}-${realm}-${house}`, part: 1, parts: 1, items: items.map(([id, market]) => [id, 2, 40, market, market]),
}));
// On each realm: item 1 at 100 a unit (95 after a faction cut), item 2 at 1,000.
const state = foldMarket(emptyMarket(), [
  ...scans("Forever", "Horde", [[1, 100], [2, 1000]]),
  ...scans("Forever", "Neutral", [[1, 100]]),
  ...scans("Elsewhere", "Alliance", [[1, 100], [2, 1000]]),
], now);
const marketAt = (dataAsOf: string) => async () => ({ state, dataAsOf });
const market = marketAt("2026-11-18T11:50:00.000Z");
const sell = (over: Partial<SellPrices> = {}) => async (): Promise<SellPrices> =>
  ({ prices: new Map([[1, 120], [2, 10]]), names: new Map([[1, "Linen Cloth"]]), unread: new Set(), skipped: 0, ...over });
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

const INDEX = "/bucket/snapshots/vendor-these/index.json";
interface Index { generation: string; realms: Record<string, string>; retired: Record<string, string>; dataAsOf: string | null; builtAt: string; attemptAt: string; complete: boolean; failed: number; unread: number; skipped: number; building: { since: string; id: string } | null }

/**
 * A bucket in memory that honours `if-match` and `if-none-match: *` on PUT, as R2 does, and DELETE. `failPut` paths
 * answer a PUT with a 500, `failIndexPut` fails the index's PUT number n (1 is the lease).
 */
function bucket(opts: { failPut?: string[]; failIndexPut?: number } = {}) {
  const files = new Map<string, { body: string; etag: string }>();
  let etags = 0, indexPuts = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    const path = new URL(req.url).pathname;
    const file = files.get(path);
    if (req.method === "PUT") {
      if (path === INDEX && ++indexPuts === opts.failIndexPut) return new Response(null, { status: 500 });
      if (opts.failPut?.includes(path)) return new Response(null, { status: 500 });
      const ifMatch = req.headers.get("if-match"), ifNone = req.headers.get("if-none-match");
      if ((ifMatch && ifMatch !== file?.etag) || (ifNone === "*" && file)) return new Response(null, { status: 412 });
      const etag = `"${++etags}"`;
      files.set(path, { body: await req.text(), etag });
      return new Response(null, { headers: { etag } });
    }
    if (req.method === "DELETE") { files.delete(path); return new Response(null, { status: 204 }); }
    if (!file) return new Response(null, { status: 404 });
    return new Response(file.body, { headers: { etag: file.etag } });
  });
  const index = () => JSON.parse(files.get(INDEX)!.body) as Index;
  const read = (slug: string) => JSON.parse(files.get(`/bucket/snapshots/vendor-these/g/${index().realms[slug]}/${slug}.json`)!.body) as StoredVendorRealm;
  const realmKeys = () => [...files.keys()].filter((k) => k !== INDEX).sort();
  return { fetch: fetch as unknown as typeof globalThis.fetch, files, index, read, realmKeys };
}
type Bucket = ReturnType<typeof bucket>;
const run = (b: Bucket, at: Date, over: Parameters<typeof writeVendorThese>[1] = {}) => writeVendorThese(at, { cloud, fetch: b.fetch, market, read: sell(), ...over });

test("each realm's houses are listed from one read of every realm's sell prices", async () => {
  const read = vi.fn(sell());
  const lists = await buildVendorLists(state, now, "2026-11-18T11:50:00.000Z", read);
  expect(read).toHaveBeenCalledOnce();
  expect([...lists.keys()].sort()).toEqual(["elsewhere", "forever"]);
  const forever = lists.get("forever")!;
  expect(forever.dataAsOf).toBe("2026-11-18T11:50:00.000Z");
  expect(forever.houses.map((h) => h.house).sort()).toEqual(["Horde", "Neutral"]);
  const horde = forever.houses.find((h) => h.house === "Horde")!;
  // 100 less 5% is 95, under the vendor's 120; 1,000 is far over the vendor's 10.
  expect(horde).toMatchObject({ candidates: 2, unread: 0, total: 1 });
  expect(horde.rows).toEqual([{ itemId: 1, name: "Linen Cloth", vendor: 120, market: 100, afterCut: 95, more: 25, quantity: 40, day: now.toISOString().slice(0, 10) }]);
  // The neutral house's 15% leaves 85.
  expect(forever.houses.find((h) => h.house === "Neutral")!.rows[0]).toMatchObject({ afterCut: 85, more: 35 });
});

test("only the first 40 rows are kept, with the full count", async () => {
  const many = foldMarket(emptyMarket(), scans("Forever", "Horde", Array.from({ length: 45 }, (_, i) => [100 + i, 100] as [number, number])), now);
  const lists = await buildVendorLists(many, now, null, async () => ({ prices: new Map(Array.from({ length: 45 }, (_, i) => [100 + i, 200 + i])), names: new Map(), unread: new Set(), skipped: 0 }));
  const horde = lists.get("forever")!.houses[0]!;
  expect(horde.total).toBe(45);
  expect(horde.rows).toHaveLength(40);
  expect(horde.rows[0]!.itemId).toBe(144);
});

test("a complete run writes every realm under its generation, then the index pointing at it; the page reads that generation", async () => {
  const b = bucket();
  expect(await run(b, now, { id: "gen-a" })).toEqual({ written: true, realms: 2, failed: 0, unread: 0, skipped: 0 });
  expect(b.realmKeys()).toEqual(["/bucket/snapshots/vendor-these/g/gen-a/elsewhere.json", "/bucket/snapshots/vendor-these/g/gen-a/forever.json"]);
  expect(b.index()).toMatchObject({ generation: "gen-a", realms: { forever: "gen-a", elsewhere: "gen-a" }, dataAsOf: "2026-11-18T11:50:00.000Z", attemptAt: now.toISOString(), complete: true, building: null });
  expect(b.read("elsewhere").houses[0]).toMatchObject({ house: "Alliance", candidates: 2, unread: 0 });
  const page = await storedVendorThese("forever", { cloud, fetch: b.fetch });
  expect(page.missing).toBe(false);
  expect(page.realm?.houses).toHaveLength(2);
  expect(await storedVendorThese("nowhere", { cloud, fetch: b.fetch })).toEqual({ realm: null, missing: true });
  // The next run, with the same market, builds nothing.
  const read = vi.fn(sell());
  expect(await run(b, minutes(10), { read })).toEqual({ written: false, reason: "throttled" });
  expect(await run(b, minutes(70), { read })).toEqual({ written: false, reason: "current" });
  expect(read).not.toHaveBeenCalled();
});

test("before the first build the page says it is not built; an unreadable index is unavailable", async () => {
  expect(await storedVendorThese("forever", { cloud, fetch: bucket().fetch })).toEqual({ realm: null, missing: true });
  const down = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
  expect(await storedVendorThese("forever", { cloud, fetch: down })).toEqual({ realm: null, missing: false });
});

test("a changed market builds at most once an hour", async () => {
  const b = bucket();
  await run(b, now);
  const read = vi.fn(sell());
  // The market changes 10 and 59 minutes after the build: both wait.
  expect(await run(b, minutes(10), { market: marketAt("2026-11-18T12:05:00.000Z"), read })).toEqual({ written: false, reason: "throttled" });
  expect(await run(b, minutes(59), { market: marketAt("2026-11-18T12:55:00.000Z"), read })).toEqual({ written: false, reason: "throttled" });
  expect(read).not.toHaveBeenCalled();
  // An hour after the build, the newest market is built.
  expect((await run(b, minutes(60), { market: marketAt("2026-11-18T12:55:00.000Z"), read })).written).toBe(true);
  expect(read).toHaveBeenCalledOnce();
  expect(b.index()).toMatchObject({ dataAsOf: "2026-11-18T12:55:00.000Z", attemptAt: minutes(60).toISOString() });
});

test("the first run of a new UTC day builds right away, even within the hour", async () => {
  const b = bucket();
  await run(b, new Date("2026-11-18T23:55:00Z"));
  const read = vi.fn(sell());
  expect((await run(b, new Date("2026-11-19T00:05:00Z"), { read })).written).toBe(true);
  expect(read).toHaveBeenCalledOnce();
  expect(await run(b, new Date("2026-11-19T00:15:00Z"), { read })).toEqual({ written: false, reason: "throttled" });
});

test("while sell prices keep failing, the build is attempted at most once an hour, with the counts kept", async () => {
  const b = bucket();
  const read = vi.fn(sell({ prices: new Map([[2, 10]]), unread: new Set([1]) }));
  // Every 10-minute run for two hours, the market unchanged.
  const results = [];
  for (let m = 0; m < 120; m += 10) results.push(await run(b, minutes(m), { read }));
  expect(read).toHaveBeenCalledTimes(2);
  expect(results.filter((r) => r.written).length).toBe(2);
  expect(b.index()).toMatchObject({ complete: false, unread: 3, attemptAt: minutes(60).toISOString() });
  // Item 1 is left out and counted, never shown as a complete empty list.
  expect(b.read("forever").houses.find((h) => h.house === "Horde")).toMatchObject({ candidates: 2, unread: 1, total: 0, rows: [] });
  // Once prices read again, the next hourly attempt completes and the list is current.
  expect((await run(b, minutes(120))).written).toBe(true);
  expect(b.index().complete).toBe(true);
});

test("the attempt is recorded before the expensive work: a build that throws still counts against the hour", async () => {
  const b = bucket();
  await expect(run(b, now, { read: async () => { throw new Error("tooltips"); } })).rejects.toThrow("tooltips");
  expect(b.index()).toMatchObject({ attemptAt: now.toISOString(), building: { since: now.toISOString() } });
  expect(b.realmKeys()).toEqual([]);
  const read = vi.fn(sell());
  // The lease holds for 15 minutes, then the hourly cap.
  expect(await run(b, minutes(10), { read })).toEqual({ written: false, reason: "building" });
  expect(await run(b, minutes(20), { read })).toEqual({ written: false, reason: "throttled" });
  expect(read).not.toHaveBeenCalled();
  expect((await run(b, minutes(60), { read })).written).toBe(true);
});

test("an index write that fails after the lease still counts against the hour, and the page keeps the last build", async () => {
  const b = bucket();
  await run(b, now, { id: "gen-a" });
  // A copy of the bucket whose second index PUT fails: the lease is the first, the publish the second.
  const failing = bucket({ failIndexPut: 2 });
  for (const [k, v] of b.files) failing.files.set(k, v);
  await expect(run(failing, minutes(60), { id: "gen-b", market: marketAt("2026-11-18T12:55:00.000Z") })).rejects.toThrow("index write failed");
  expect(failing.index()).toMatchObject({ generation: "gen-a", realms: { forever: "gen-a" }, attemptAt: minutes(60).toISOString() });
  // gen-b's objects were removed; the page still reads gen-a.
  expect(failing.realmKeys().every((k) => k.includes("/g/gen-a/"))).toBe(true);
  expect((await storedVendorThese("forever", { cloud, fetch: failing.fetch })).realm?.dataAsOf).toBe("2026-11-18T11:50:00.000Z");
  const read = vi.fn(sell());
  expect((await run(failing, minutes(70), { read })).written).toBe(false);
  expect(read).not.toHaveBeenCalled();
});

test("one realm that fails to write keeps its last generation, and the others are written", async () => {
  const b = bucket();
  await run(b, now, { id: "gen-a" });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const failing = bucket({ failPut: ["/bucket/snapshots/vendor-these/g/gen-b/forever.json"] });
  for (const [k, v] of b.files) failing.files.set(k, v);
  expect(await run(failing, minutes(60), { id: "gen-b", market: marketAt("2026-11-18T12:55:00.000Z") })).toEqual({ written: true, realms: 2, failed: 1, unread: 0, skipped: 0 });
  expect(failing.index()).toMatchObject({ generation: "gen-b", realms: { forever: "gen-a", elsewhere: "gen-b" }, complete: false, failed: 1 });
  expect(failing.read("forever").dataAsOf).toBe("2026-11-18T11:50:00.000Z");
  expect(failing.read("elsewhere").dataAsOf).toBe("2026-11-18T12:55:00.000Z");
  error.mockRestore();
});

test("the build's budget is passed to the sell price read; a build cut short is incomplete, with the shards it left", async () => {
  const b = bucket();
  const read = vi.fn(sell({ prices: new Map([[2, 10]]), unread: new Set([1]), skipped: 3 }));
  expect(await run(b, now, { read, clock: () => 1_000 })).toEqual({ written: true, realms: 2, failed: 0, unread: 3, skipped: 3 });
  expect(read).toHaveBeenCalledWith([1, 2], 1_000 + VENDOR_BUDGET.wallMs);
  expect(b.index()).toMatchObject({ complete: false, skipped: 3 });
});

test("two runs at once: only one claims the index and builds", async () => {
  const b = bucket();
  const read = vi.fn(sell());
  const results = await Promise.all([run(b, now, { read, id: "gen-a" }), run(b, now, { read, id: "gen-b" })]);
  expect(read).toHaveBeenCalledOnce();
  expect(results.filter((r) => r.written)).toHaveLength(1);
  expect(results.filter((r) => !r.written)).toEqual([{ written: false, reason: "building" }]);
});

test("an older run that finishes last does not regress the published data", async () => {
  const b = bucket();
  let newer: Awaited<ReturnType<typeof writeVendorThese>> | null = null;
  // Run A starts at 12:00 on the 11:50 market and stalls in its tooltip read. Its lease runs out, and at 13:01 run B
  // builds the 12:55 market and publishes; then A wakes up and finishes.
  const stalled = async () => {
    newer = await run(b, minutes(61), { id: "gen-b", market: marketAt("2026-11-18T12:55:00.000Z") });
    return sell()();
  };
  expect(await run(b, now, { id: "gen-a", read: stalled })).toEqual({ written: false, reason: "lost the lease" });
  expect(newer).toMatchObject({ written: true });
  expect(b.index()).toMatchObject({ generation: "gen-b", dataAsOf: "2026-11-18T12:55:00.000Z", building: null });
  // A removed what it wrote; the page reads B's lists only.
  expect(b.realmKeys().every((k) => k.includes("/g/gen-b/"))).toBe(true);
  expect((await storedVendorThese("forever", { cloud, fetch: b.fetch })).realm?.dataAsOf).toBe("2026-11-18T12:55:00.000Z");
});

test("old generations are cleaned up, keeping the previous one for a page mid-switch", async () => {
  const b = bucket();
  await run(b, now, { id: "gen-a" });
  await run(b, minutes(60), { id: "gen-b", market: marketAt("2026-11-18T12:55:00.000Z") });
  expect(b.realmKeys().filter((k) => k.includes("/g/gen-a/"))).toHaveLength(2);
  await run(b, minutes(120), { id: "gen-c", market: marketAt("2026-11-18T13:55:00.000Z") });
  expect(b.realmKeys().filter((k) => k.includes("/g/gen-a/"))).toEqual([]);
  expect(b.realmKeys().filter((k) => k.includes("/g/gen-b/"))).toHaveLength(2);
  expect(b.index()).toMatchObject({ generation: "gen-c", retired: { forever: "gen-b", elsewhere: "gen-b" } });
});

test("an index that is JSON null, or of another shape, is no index: the run builds over it and the page says unavailable", async () => {
  for (const body of ["null", "[]", JSON.stringify({ version: 1, dataAsOf: null })]) {
    const b = bucket();
    b.files.set(INDEX, { body, etag: '"old"' });
    expect(await storedVendorThese("forever", { cloud, fetch: b.fetch })).toEqual({ realm: null, missing: false });
    expect((await run(b, now)).written, body).toBe(true);
    expect(b.index().generation).toBeTruthy();
  }
});

test("an index that cannot be read waits for the next run instead of building", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const read = vi.fn(sell());
  const fetch = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof globalThis.fetch;
  expect(await writeVendorThese(now, { cloud, fetch, market, read })).toEqual({ written: false, reason: "index unreadable" });
  expect(read).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("no market, or no store, writes nothing", async () => {
  const b = bucket();
  await expect(run(b, now, { market: async () => ({ state: null, dataAsOf: null }) })).rejects.toThrow("market unavailable");
  await expect(writeVendorThese(now, { cloud: null, market, read: sell() })).rejects.toThrow("cloud store");
  expect(b.files.size).toBe(0);
});
