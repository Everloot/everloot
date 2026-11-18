import { expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../../../kb/src/market";
import { STAMP } from "./stored-view-freshness";
import { buildVendorLists, writeVendorThese, type SellPrices, type StoredVendorRealm } from "./vendor-these-store";

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
const market = async () => ({ state, dataAsOf: "2026-11-18T11:50:00.000Z" });
const sell = (over: Partial<SellPrices> = {}) => async (): Promise<SellPrices> => ({ prices: new Map([[1, 120], [2, 10]]), names: new Map([[1, "Linen Cloth"]]), unread: new Set(), ...over });

/** A bucket in memory: HEAD and GET answer from what was PUT; `failPut` paths answer a PUT with a 500. */
function bucket(failPut: string[] = []) {
  const files = new Map<string, { body: string; stamp: string | null }>();
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const req = input as Request;
    const path = new URL(req.url).pathname;
    if (req.method === "PUT") {
      if (failPut.includes(path)) return new Response(null, { status: 500 });
      files.set(path, { body: await req.text(), stamp: req.headers.get(STAMP) });
      return new Response(null);
    }
    const file = files.get(path);
    if (!file) return new Response(null, { status: 404 });
    return new Response(req.method === "HEAD" ? null : file.body, { headers: file.stamp ? { [STAMP]: file.stamp } : {} });
  });
  const read = (slug: string) => JSON.parse(files.get(`/bucket/snapshots/vendor-these/${slug}.json`)!.body) as StoredVendorRealm;
  return { fetch: fetch as unknown as typeof globalThis.fetch, files, read };
}

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
  const lists = await buildVendorLists(many, now, null, async () => ({ prices: new Map(Array.from({ length: 45 }, (_, i) => [100 + i, 200 + i])), names: new Map(), unread: new Set() }));
  const horde = lists.get("forever")!.houses[0]!;
  expect(horde.total).toBe(45);
  expect(horde.rows).toHaveLength(40);
  expect(horde.rows[0]!.itemId).toBe(144);
});

const INDEX = "/bucket/snapshots/vendor-these/index.json";
const indexOf = (b: ReturnType<typeof bucket>) => JSON.parse(b.files.get(INDEX)!.body) as { builtAt: string; complete: boolean; dataAsOf: string | null; failed: number; unread: number };
const marketAt = (dataAsOf: string) => async () => ({ state, dataAsOf });
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

test("a complete run writes every realm and an index with the market's snapshot and the build time", async () => {
  const b = bucket();
  expect(await writeVendorThese(now, { cloud, fetch: b.fetch, market, read: sell() })).toEqual({ written: true, realms: 2, failed: 0, unread: 0 });
  expect(b.read("forever").houses).toHaveLength(2);
  expect(b.read("elsewhere").houses[0]).toMatchObject({ house: "Alliance", candidates: 2, unread: 0 });
  expect(indexOf(b)).toMatchObject({ dataAsOf: "2026-11-18T11:50:00.000Z", builtAt: now.toISOString(), complete: true });
  // The next run, with the same market, builds nothing.
  const read = vi.fn(sell());
  expect(await writeVendorThese(minutes(10), { cloud, fetch: b.fetch, market, read })).toEqual({ written: false });
  expect(read).not.toHaveBeenCalled();
});

test("a changed market rebuilds at most once an hour", async () => {
  const b = bucket();
  await writeVendorThese(now, { cloud, fetch: b.fetch, market, read: sell() });
  const read = vi.fn(sell());
  // The market changes 10 and 59 minutes after the build: both wait.
  expect(await writeVendorThese(minutes(10), { cloud, fetch: b.fetch, market: marketAt("2026-11-18T12:05:00.000Z"), read })).toEqual({ written: false });
  expect(await writeVendorThese(minutes(59), { cloud, fetch: b.fetch, market: marketAt("2026-11-18T12:55:00.000Z"), read })).toEqual({ written: false });
  expect(read).not.toHaveBeenCalled();
  // An hour after the build, the newest market is built.
  expect((await writeVendorThese(minutes(60), { cloud, fetch: b.fetch, market: marketAt("2026-11-18T12:55:00.000Z"), read })).written).toBe(true);
  expect(read).toHaveBeenCalledOnce();
  expect(indexOf(b)).toMatchObject({ dataAsOf: "2026-11-18T12:55:00.000Z", builtAt: minutes(60).toISOString() });
});

test("a new UTC day rebuilds right away, even within the hour: a market goes stale by the calendar", async () => {
  const b = bucket();
  const late = new Date("2026-11-18T23:55:00Z");
  await writeVendorThese(late, { cloud, fetch: b.fetch, market, read: sell() });
  const read = vi.fn(sell());
  expect((await writeVendorThese(new Date("2026-11-19T00:05:00Z"), { cloud, fetch: b.fetch, market, read })).written).toBe(true);
  expect(read).toHaveBeenCalledOnce();
});

test("sell prices that could not be read are counted, and the next run retries without waiting the hour", async () => {
  const b = bucket();
  const result = await writeVendorThese(now, { cloud, fetch: b.fetch, market, read: sell({ prices: new Map([[2, 10]]), unread: new Set([1]) }) });
  expect(result).toEqual({ written: true, realms: 2, failed: 0, unread: 3 });
  const horde = b.read("forever").houses.find((h) => h.house === "Horde")!;
  // Item 1 is left out and counted, never shown as a complete empty list.
  expect(horde).toMatchObject({ candidates: 2, unread: 1, total: 0, rows: [] });
  expect(indexOf(b)).toMatchObject({ complete: false, unread: 3 });
  // Ten minutes later, same market: the retry runs, and a complete build ends the retries.
  const read = vi.fn(sell());
  expect((await writeVendorThese(minutes(10), { cloud, fetch: b.fetch, market, read })).written).toBe(true);
  expect(read).toHaveBeenCalledOnce();
  expect(indexOf(b).complete).toBe(true);
  expect((await writeVendorThese(minutes(20), { cloud, fetch: b.fetch, market, read })).written).toBe(false);
});

test("one realm that fails to write leaves the others written, and the next run tries again", async () => {
  const b = bucket(["/bucket/snapshots/vendor-these/forever.json"]);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await writeVendorThese(now, { cloud, fetch: b.fetch, market, read: sell() })).toEqual({ written: true, realms: 2, failed: 1, unread: 0 });
  expect(b.read("elsewhere").houses).toHaveLength(1);
  expect(b.files.has("/bucket/snapshots/vendor-these/forever.json")).toBe(false);
  expect(indexOf(b)).toMatchObject({ complete: false, failed: 1 });
  error.mockRestore();
});

test("an index that cannot be read waits for the next run instead of rebuilding", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const read = vi.fn(sell());
  const fetch = vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof globalThis.fetch;
  expect(await writeVendorThese(now, { cloud, fetch, market, read })).toEqual({ written: false });
  expect(read).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("no market, or no store, writes nothing", async () => {
  const b = bucket();
  await expect(writeVendorThese(now, { cloud, fetch: b.fetch, market: async () => ({ state: null, dataAsOf: null }), read: sell() })).rejects.toThrow("market unavailable");
  await expect(writeVendorThese(now, { cloud: null, market, read: sell() })).rejects.toThrow("cloud store");
  expect(b.files.size).toBe(0);
});
