import { beforeEach, expect, test, vi } from "vitest";
import { MAX_PRICE_ROWS, emptyMarket, foldMarket } from "../../../../../../kb/src/market";

const store = vi.hoisted(() => ({ loadMarket: vi.fn(), market: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadMarket: store.loadMarket } }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { market: store.market } }));

import { GET } from "./route";
import { marketPricesResponse, marketRealmsResponse } from "@everloot/protocol";

const NOW = new Date();
const day = NOW.toISOString().slice(0, 10);
const scans = ["install-secret-1", "install-secret-2", "install-secret-3"].map((installId, i) => ({
  kind: "auction_snapshot", installId, eventId: `e:${i}`, capturedAt: NOW.toISOString(), realm: "Forever",
  scanId: `s-${i}`, part: 1, parts: 1, items: [[2589, 2, 40, 100 * (i + 1), 100 * (i + 1) + 5]],
}));
const state = foldMarket(emptyMarket(), scans, NOW);
const req = (query = "") => new Request(`https://everloot.app/api/market/prices${query}`);

test("explicit price requests isolate region, ruleset and all three houses", async () => {
  const realms = ["CAMWOW US1 Realm 4 PVE", "CAMWOW US1 Realm 4 PVP", "CAMWOW US1 Realm 4 RP",
    "CAMWOW US1 Realm 4 RPPVP", "CAMWOW US1 Realm 4 Hardcore", "CAMWOW EU1 Realm 4 PVP"];
  const houses = ["Alliance", "Horde", "Neutral"];
  const rows = realms.flatMap((realm, r) => houses.flatMap((house, h) => scans.map((s) => ({
    ...s, realm, house, faction: house === "Neutral" ? "Alliance" : house,
    items: [[2589, 2, 40, 100 + r * 10 + h, 100 + r * 10 + h]],
  }))));
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), rows, NOW), dataAsOf: NOW.toISOString() });
  for (const [r, realm] of realms.entries()) for (const [h, house] of houses.entries()) {
    const body = await (await GET(req(`?realm=${encodeURIComponent(realm)}&house=${house}`))).json();
    expect(body).toMatchObject({ realm, house, items: [[2589, 100 + r * 10 + h, 100 + r * 10 + h, 100 + r * 10 + h, 40, day, 3]] });
  }
});

test.fails("owner review: realm-only price requests must not publish a cross-house consensus", async () => {
  const rows = scans.map((s, i) => ({ ...s, house: i ? "Horde" : "Alliance", items: [[2589, 2, 40, 100 + i, 100 + i]] }));
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), rows, NOW), dataAsOf: NOW.toISOString() });
  expect((await (await GET(req("?realm=Forever"))).json()).items).toEqual([]);
});

beforeEach(() => {
  store.market.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.loadMarket.mockReset().mockResolvedValue({ state, dataAsOf: "2026-10-20T12:00:00.000Z" });
});

test("a realm's prices are compact tuples with the data age and the rule", async () => {
  const res = await GET(req("?realm=forever"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({
    ok: true, realm: "Forever", dataAsOf: "2026-10-20T12:00:00.000Z",
    fields: ["itemId", "market", "min", "historical", "quantity", "day", "reporters"],
    items: [[2589, 205, 200, 205, 40, day, 3]],
  });
  expect(body.rule).toContain("3 reporters");
});

test("without a realm it lists the realms that have scans", async () => {
  expect(await (await GET(req())).json()).toMatchObject({ ok: true, realms: ["Forever"] });
});

test("install ids never leave the site", async () => {
  for (const query of ["", "?realm=Forever"]) {
    expect(JSON.stringify(await (await GET(req(query))).json())).not.toContain("install-secret");
  }
});

test("an unreadable rollup is unavailable, not an empty market", async () => {
  store.loadMarket.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  const res = await GET(req("?realm=Forever"));
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ ok: false });
});

test("a realm name must be a plain name", async () => {
  for (const realm of ["x".repeat(61), "visit scam.example", "a", "<script>"]) {
    expect((await GET(req(`?realm=${encodeURIComponent(realm)}`))).status).toBe(400);
  }
  expect(store.loadMarket).not.toHaveBeenCalled();
});

test("each IP has a quota: a refused request is 429 with Retry-After and reads nothing", async () => {
  store.market.mockResolvedValue({ allowed: false, retryAfter: 120 });
  const res = await GET(req("?realm=Forever"));
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("120");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(store.loadMarket).not.toHaveBeenCalled();
});

test("quota storage that fails is 503, not an open door", async () => {
  store.market.mockRejectedValue(new Error("down"));
  expect((await GET(req("?realm=Forever"))).status).toBe(503);
});

test("a realm's rows are capped at MAX_PRICE_ROWS, the items with the most units, and the answer stays small", async () => {
  const total = MAX_PRICE_ROWS + 500;
  const items = Array.from({ length: total }, (_, i) => [i + 1, 1, 10_000 + i, 1000, 1000]);
  const rows = ["install-big-1", "install-big-2", "install-big-3"].map((installId, n) => ({
    kind: "auction_snapshot", installId, eventId: `big:${n}`, capturedAt: NOW.toISOString(), realm: "Forever",
    scanId: `big-${n}`, part: 1, parts: 1, items: items.slice(0, 1000),
  }));
  // Items beyond one record's 1,000 come from further parts.
  const more = [1000, 2000].flatMap((from) => ["install-big-1", "install-big-2", "install-big-3"].map((installId, n) => ({
    kind: "auction_snapshot", installId, eventId: `big:${from}:${n}`, capturedAt: NOW.toISOString(), realm: "Forever",
    scanId: `big-${from}-${n}`, part: 1, parts: 1, items: items.slice(from, from + 1000),
  })));
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), [...rows, ...more], NOW), dataAsOf: "2026-10-20T12:00:00.000Z" });
  const res = await GET(req("?realm=Forever"));
  const body = await res.json();
  expect(body.items).toHaveLength(MAX_PRICE_ROWS);
  // Most units first: the highest item ids were given the most units.
  expect(body.items[0][0]).toBe(total);
  expect(JSON.stringify(body).length).toBeLessThan(MAX_PRICE_ROWS * 60);
});

test("every answer carries the licence and credit line, and stays cacheable for anonymous callers", async () => {
  for (const query of ["", "?realm=Forever"]) {
    const res = await GET(req(query));
    expect((await res.json()).attribution).toMatchObject({ licence: "CC BY-SA 4.0", source: "https://everloot.app/tools/auctions" });
    expect(res.headers.get("x-everloot-licence")).toBe("CC BY-SA 4.0");
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    // The Worker's edge cache keeps only responses that say so in this header (lib/cf-edge-cache.ts).
    expect(res.headers.get("cdn-cache-control")).toBe("max-age=300");
  }
});

test("a refused or unavailable answer is never kept by the edge cache", async () => {
  store.market.mockResolvedValue({ allowed: false, retryAfter: 120 });
  expect((await GET(req("?realm=Forever"))).headers.get("cdn-cache-control")).toBeNull();
  store.market.mockResolvedValue({ allowed: true, retryAfter: 0 });
  store.loadMarket.mockResolvedValue({ state: null, dataAsOf: null, unreachable: true });
  expect((await GET(req("?realm=Forever"))).headers.get("cdn-cache-control")).toBeNull();
});

test("the bodies are the protocol's market responses", async () => {
  const realms = await (await GET(req())).json();
  if (realms.ok) expect(() => marketRealmsResponse.parse(realms)).not.toThrow();
  const first = realms.ok ? realms.realms[0] : undefined;
  if (first) {
    const prices = await (await GET(req(`?realm=${encodeURIComponent(first)}`))).json();
    expect(() => marketPricesResponse.parse(prices)).not.toThrow();
  }
});

test("a house narrows a realm to the scans of that auction house; the realm list says which houses have values", async () => {
  const hordeScans = ["install-h-1", "install-h-2", "install-h-3"].map((installId, i) => ({
    kind: "auction_snapshot", installId, eventId: `h:${i}`, capturedAt: NOW.toISOString(), realm: "Forever",
    scanId: `h-${i}`, part: 1, parts: 1, faction: "Horde", house: "Horde", items: [[2589, 1, 10, 900, 900]],
  }));
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), [...scans, ...hordeScans], NOW), dataAsOf: "2026-10-20T12:00:00.000Z" });
  const horde = await (await GET(req("?realm=Forever&house=horde"))).json();
  expect(horde).toMatchObject({ ok: true, realm: "Forever", house: "Horde", items: [[2589, 900, 900, 900, 10, day, 3]] });
  expect(() => marketPricesResponse.parse(horde)).not.toThrow();
  expect((await (await GET(req("?realm=Forever&house=Alliance"))).json())).toMatchObject({ ok: true, house: "Alliance", items: [] });
  const blended = await (await GET(req("?realm=Forever"))).json();
  expect(blended).not.toHaveProperty("house");
  expect(blended.items[0][6]).toBe(6);
  const realms = await (await GET(req())).json();
  expect(realms).toMatchObject({ realms: ["Forever"], houses: { Forever: ["Horde"] } });
  expect(() => marketRealmsResponse.parse(realms)).not.toThrow();
});

test("a house must be Alliance, Horde or Neutral, and needs a realm", async () => {
  for (const query of ["?realm=Forever&house=goblin", "?realm=Forever&house=", "?house=horde"]) {
    expect((await GET(req(query))).status).toBe(400);
  }
  expect(store.loadMarket).not.toHaveBeenCalled();
});
test("without a realm it also counts the players behind each realm that has scans but no public prices, never a value", async () => {
  const pendingScans = ["install-p-1", "install-p-2"].map((installId, i) => ({
    kind: "auction_snapshot", installId, eventId: `p:${i}`, capturedAt: NOW.toISOString(), realm: "CAMWOW US1 Realm 4 PvP",
    scanId: `p-${i}`, part: 1, parts: 1, items: [[2589, 2, 40, 12345, 12345]],
  }));
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), [...scans, ...pendingScans], NOW), dataAsOf: "2026-10-20T12:00:00.000Z" });
  const body = await (await GET(req())).json();
  expect(body).toMatchObject({ ok: true, realms: ["Forever"], pending: [{ realm: "CAMWOW US1 Realm 4 PvP", reporters: 2, needed: 3 }] });
  expect(Object.keys(body.pending[0]).sort()).toEqual(["needed", "realm", "reporters"]);
  expect(JSON.stringify(body)).not.toMatch(/12345|install-p/);
  expect(() => marketRealmsResponse.parse(body)).not.toThrow();
  expect(marketRealmsResponse.parse(body).pending).toEqual(body.pending);
});
