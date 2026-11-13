import { expect, it, vi } from "vitest";
import { ApiError, ForeverApi, type ApiResult } from "../armory/api.js";
import { StoreError } from "../armory/store.js";
import { PartialFailure, runAuctions } from "./job.js";
import { AuctionStore, type JobStore } from "./store.js";
import { listings, summarize } from "./summary.js";

// Invented listings in the two shapes Forever serves: items (buyout per auction) and commodities (unit_price).
const items = {
  id: 110,
  name: "Alliance Auction House",
  auctions: [
    { id: 1, item: { id: 9797, bonus_lists: [12743] }, buyout: 2100, quantity: 1, time_left: "SHORT" },
    { id: 2, item: { id: 9797 }, buyout: 1900, quantity: 1, time_left: "LONG" },
    { id: 3, item: { id: 9797 }, buyout: 99_000, quantity: 1, time_left: "LONG" },
    { id: 4, item: { id: 2974 }, bid: 300, quantity: 1, time_left: "LONG" },
    { id: 5, item: { id: 14248, modifiers: [{ type: 28, value: 5245 }] }, buyout: 10_500, quantity: 1, time_left: "SHORT" },
    { id: 6, item: { id: "x" }, buyout: 10, quantity: 1 },
  ],
};
const commodities = {
  auctions: [
    { id: 10, item: { id: 954 }, quantity: 20, unit_price: 172, time_left: "SHORT" },
    { id: 11, item: { id: 954 }, quantity: 1, unit_price: 150, time_left: "SHORT" },
    { id: 12, item: { id: 954 }, quantity: 5, unit_price: 900, time_left: "LONG" },
  ],
};

it("summarizes each item: lowest unit, quantity-weighted median, units and listings; bid-only and malformed left out", () => {
  expect(summarize(items, commodities)).toEqual([
    { item_id: 954, min_unit: 150, typical_unit: 172, quantity: 26, auctions: 3 },
    { item_id: 9797, min_unit: 1900, typical_unit: 2100, quantity: 3, auctions: 3 },
    { item_id: 14248, min_unit: 10_500, typical_unit: 10_500, quantity: 1, auctions: 1 },
  ]);
  // A buyout covers the whole auction: a stack of 4 for 1000 is 250 a unit.
  expect(listings({ auctions: [{ item: { id: 7 }, buyout: 1000, quantity: 4 }] })).toEqual([[7, 250, 4]]);
  // An empty house answers without an `auctions` key.
  expect(summarize({ id: 112, name: "Alliance Auction House" }, null)).toEqual([]);
});

const ok = (body: unknown, lastModified: string | null = "Fri, 13 Nov 2026 12:22:32 GMT"): ApiResult => ({ status: 200, body, lastModified });
const index = { rulesets: [{ id: 15 }, { id: 1 }] };
const houses = (ids: number[]) => ({ auctions: ids.map((id) => ({ id, name: id < 113 ? "Alliance Auction House" : "Horde Auction House" })) });

function fakeApi(over: Record<string, () => Promise<ApiResult>> = {}) {
  const responses: Record<string, ApiResult> = {
    "/data/wow/ruleset/index": ok(index),
    "/data/wow/ruleset/1/auctions/": ok(houses([110, 113])),
    "/data/wow/ruleset/15/auctions/": ok(houses([110, 113, 116])),
    "/data/wow/ruleset/1/auctions/110": ok(items),
    "/data/wow/ruleset/1/auctions/110/commodities": ok(commodities, "Fri, 13 Nov 2026 12:22:40 GMT"),
    "/data/wow/ruleset/1/auctions/113": ok({ id: 113 }),
    "/data/wow/ruleset/1/auctions/113/commodities": ok({}),
    "/data/wow/ruleset/15/auctions/116": ok(items, null),
    "/data/wow/ruleset/15/auctions/116/commodities": ok({}, null),
  };
  return { get: vi.fn(async (path: string): Promise<ApiResult> => (over[path] ? over[path]() : responses[path] ?? { status: 404, body: null, lastModified: null })) };
}
const fakeStore = (put: JobStore["put"] = async (_r, _h, rows) => rows.length) => ({ put: vi.fn(put), purge: vi.fn(async () => 7) });
const now = () => new Date("2026-11-13T13:41:00Z");

it("reads each house once through the first ruleset listing it, stamps each document with its own time, and purges", async () => {
  const api = fakeApi();
  const store = fakeStore();
  const log: string[] = [];
  const result = await runAuctions({ region: "us", budget: 100, api, store, log: (l) => log.push(l), now });
  expect(api.get.mock.calls.map(([p]) => p)).toEqual([
    "/data/wow/ruleset/index",
    "/data/wow/ruleset/1/auctions/",
    "/data/wow/ruleset/15/auctions/",
    "/data/wow/ruleset/1/auctions/110",
    "/data/wow/ruleset/1/auctions/110/commodities",
    "/data/wow/ruleset/1/auctions/113",
    "/data/wow/ruleset/1/auctions/113/commodities",
    "/data/wow/ruleset/15/auctions/116",
    "/data/wow/ruleset/15/auctions/116/commodities",
  ]);
  expect(store.put.mock.calls.map(([region, house, rows]) => [region, house, rows.length])).toEqual([
    ["us", { house_id: 110, name: "Alliance Auction House", kind: "items", snapshot_at: "2026-11-13T12:22:32.000Z" }, 2],
    ["us", { house_id: 110, name: "Alliance Auction House", kind: "commodities", snapshot_at: "2026-11-13T12:22:40.000Z" }, 1],
    ["us", { house_id: 113, name: "Horde Auction House", kind: "items", snapshot_at: "2026-11-13T12:22:32.000Z" }, 0],
    ["us", { house_id: 113, name: "Horde Auction House", kind: "commodities", snapshot_at: "2026-11-13T12:22:32.000Z" }, 0],
    ["us", { house_id: 116, name: "Horde Auction House", kind: "items", snapshot_at: "2026-11-13T13:41:00.000Z" }, 2],
    ["us", { house_id: 116, name: "Horde Auction House", kind: "commodities", snapshot_at: "2026-11-13T13:41:00.000Z" }, 0],
  ]);
  expect(store.purge).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ calls: 9, houses: 3, written: 5, unchanged: 0, failed: 0, purged: 7 });
  expect(log.at(-1)).toBe("us: 9 Blizzard API calls of 100; 3 houses, 5 item rows, 0 unchanged, 0 failed; 7 rows past 30 days purged");
});

it("takes a newer commodities document while the items one is unchanged, each with its own time", async () => {
  // A store that, like blizzard_auctions_put, keeps one time per house document and refuses one that is not newer.
  const stored = new Map<string, string>();
  const store = fakeStore(async (_r, h, rows) => {
    const key = `${h.house_id}:${h.kind}`;
    if ((stored.get(key) ?? "") >= h.snapshot_at) return null;
    stored.set(key, h.snapshot_at);
    return rows.length;
  });
  await runAuctions({ region: "us", budget: 100, api: fakeApi(), store, log: () => {}, now });
  const later = fakeApi({
    "/data/wow/ruleset/1/auctions/110/commodities": async () => ok(commodities, "Fri, 13 Nov 2026 13:22:40 GMT"),
  });
  const log: string[] = [];
  const result = await runAuctions({ region: "us", budget: 100, api: later, store, log: (l) => log.push(l), now });
  expect(log).toContain("house 110 (Alliance Auction House) items: unchanged since 2026-11-13T12:22:32.000Z");
  expect(log).toContain("house 110 (Alliance Auction House) commodities: 1 items as of 2026-11-13T13:22:40.000Z");
  expect(stored.get("110:items")).toBe("2026-11-13T12:22:32.000Z");
  expect(stored.get("110:commodities")).toBe("2026-11-13T13:22:40.000Z");
  expect(result).toMatchObject({ written: 1, failed: 0 });
});

it("stops at the call budget and still purges", async () => {
  const api = fakeApi();
  const store = fakeStore();
  const log: string[] = [];
  const result = await runAuctions({ region: "eu", budget: 4, api, store, log: (l) => log.push(l), now });
  expect(api.get).toHaveBeenCalledTimes(4);
  expect(result.calls).toBe(4);
  // The fourth call read house 110's items, which are stored; its commodities wait for the next pass.
  expect(store.put.mock.calls.map(([, h]) => [h.house_id, h.kind])).toEqual([[110, "items"]]);
  expect(store.purge).toHaveBeenCalledTimes(1);
  expect(log).toContain("budget of 4 calls spent; the rest waits for the next pass");
});

it("skips a house on a transient Blizzard error, finishes the others and the purge, then reports the partial failure", async () => {
  const api = fakeApi({ "/data/wow/ruleset/1/auctions/113": async () => { throw new ApiError(503, "api"); } });
  const store = fakeStore(async (_r, house) => (house.house_id === 116 ? null : 1));
  const log: string[] = [];
  const failure = await runAuctions({ region: "us", budget: 100, api, store, log: (l) => log.push(l), now }).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(PartialFailure);
  expect((failure as PartialFailure).result).toMatchObject({ houses: 2, written: 2, unchanged: 2, failed: 1, purged: 7 });
  expect(store.purge).toHaveBeenCalledTimes(1);
  expect(log).toContain("house 113: Blizzard API HTTP 503, skipped this pass");

  const broken = fakeApi({ "/data/wow/ruleset/index": async () => { throw new ApiError(401, "oauth"); } });
  const after = fakeStore();
  await expect(runAuctions({ region: "us", budget: 100, api: broken, store: after, log: () => {}, now })).rejects.toThrow("OAuth");
  expect(after.purge).toHaveBeenCalledTimes(1);
});

it("isolates a house whose storage write fails on a 503 or lock timeout; a missing function stops the pass after the purge", async () => {
  const api = fakeApi();
  const store = fakeStore(async (_r, house, rows) => {
    if (house.house_id === 110) throw new StoreError(503);
    return rows.length;
  });
  const failure = await runAuctions({ region: "us", budget: 100, api, store, log: () => {}, now }).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(PartialFailure);
  // 113 and 116 were still read and stored after 110 failed.
  expect(store.put.mock.calls.map(([, h]) => h.house_id)).toEqual([110, 113, 113, 116, 116]);
  expect((failure as PartialFailure).result).toMatchObject({ houses: 2, written: 2, failed: 1 });
  expect(store.purge).toHaveBeenCalledTimes(1);

  const missing = fakeStore(async () => { throw new StoreError(404); });
  await expect(runAuctions({ region: "us", budget: 100, api: fakeApi(), store: missing, log: () => {}, now })).rejects.toThrow("HTTP 404");
  expect(missing.put).toHaveBeenCalledTimes(1);
  expect(missing.purge).toHaveBeenCalledTimes(1);
});

it("calls Blizzard in the dynamic Forever namespace", async () => {
  const fetchImpl = vi.fn(async (url: string) =>
    url.includes("oauth") ? Response.json({ access_token: "fake", expires_in: 3600 }) : Response.json({ rulesets: [] }),
  );
  const api = new ForeverApi({ clientId: "id", clientSecret: "secret", region: "eu", fetchImpl: fetchImpl as unknown as typeof fetch });
  const store = fakeStore();
  await runAuctions({ region: "eu", budget: 100, api, store, log: () => {}, now });
  expect(fetchImpl.mock.calls[1][0]).toBe("https://eu.api.blizzard.com/data/wow/ruleset/index?namespace=dynamic-forever-eu&locale=en_US");
});

it("uses the migration's function names, arguments and the service key", async () => {
  const fetchImpl = vi.fn(async () => Response.json(2));
  const store = new AuctionStore({ url: "https://example.test/", serviceKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch });
  const house = { house_id: 110, name: "Alliance Auction House", kind: "commodities" as const, snapshot_at: "2026-11-13T12:22:32.000Z" };
  const rows = [{ item_id: 954, min_unit: 150, typical_unit: 172, quantity: 26, auctions: 3 }];
  expect(await store.put("us", house, rows)).toBe(2);
  expect(await store.purge()).toBe(2);
  const calls = fetchImpl.mock.calls.map((call) => {
    const [url, init] = call as unknown as [string, RequestInit];
    return { url, args: JSON.parse(String(init.body)), key: new Headers(init.headers).get("apikey") };
  });
  expect(calls).toEqual([
    { url: "https://example.test/rest/v1/rpc/blizzard_auctions_put", args: { p_region: "us", p_house: house, p_rows: rows }, key: "test-key" },
    { url: "https://example.test/rest/v1/rpc/blizzard_auctions_purge", args: {}, key: "test-key" },
  ]);
  const failing = new AuctionStore({ url: "https://example.test", serviceKey: "k", fetchImpl: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch });
  await expect(failing.purge()).rejects.toThrow("HTTP 503");
});
