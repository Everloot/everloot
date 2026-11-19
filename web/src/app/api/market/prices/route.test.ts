import { beforeEach, expect, test, vi } from "vitest";
import { MAX_PRICE_ROWS, emptyMarket, foldMarket } from "@kb/market";

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

test("realm-only price requests never publish a cross-house consensus", async () => {
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
  // Item 1 ranks below the default cutoff but can be fetched explicitly.
  expect(body.items.some((row: number[]) => row[0] === 1)).toBe(false);
  const selected = await (await GET(req("?realm=Forever&items=1,1,999999"))).json();
  expect(selected.items).toEqual([[1, 1000, 1000, 1000, 10000, day, 3]]);
  expect(selected.fields).toEqual(body.fields);
  expect(() => marketPricesResponse.parse(selected)).not.toThrow();
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
  // Without a house only the scans that named none answer: the Horde scans never join them.
  const unknown = await (await GET(req("?realm=Forever"))).json();
  expect(unknown).not.toHaveProperty("house");
  expect(unknown.items[0][6]).toBe(3);
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
    scanId: `p-${i}`, part: 1, parts: 1, faction: "Horde", items: [[2589, 2, 40, 12345, 12345]],
  }));
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), [...scans, ...pendingScans], NOW), dataAsOf: "2026-10-20T12:00:00.000Z" });
  const body = await (await GET(req())).json();
  expect(body).toMatchObject({ ok: true, realms: ["Forever"], pending: [{ realm: "CAMWOW US1 Realm 4 PvP", reporters: 2, needed: 3 }] });
  expect(Object.keys(body.pending[0]).sort()).toEqual(["needed", "realm", "reporters"]);
  expect(JSON.stringify(body)).not.toMatch(/12345|install-p/);
  expect(() => marketRealmsResponse.parse(body)).not.toThrow();
  expect(marketRealmsResponse.parse(body).pending).toEqual(body.pending);
});


test("item selection requires a realm and at most 100 positive safe integer ids", async () => {
  for (const query of ["?items=2589", "?realm=Forever&items=", "?realm=Forever&items=0",
    "?realm=Forever&items=-1", "?realm=Forever&items=1.5", "?realm=Forever&items=1e3",
    "?realm=Forever&items=9007199254740992", "?realm=Forever&items=2589,",
    "?realm=Forever&items=2589&items=42", `?realm=Forever&items=${Array.from({ length: 101 }, (_, i) => i + 1).join(",")}`]) {
    const res = await GET(req(query));
    expect(res.status, query).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  }
  expect(store.loadMarket).not.toHaveBeenCalled();
  const selected = await (await GET(req(`?realm=Forever&items=${Array.from({ length: 100 }, (_, i) => i + 2589).join(",")}`))).json();
  expect(selected.items).toEqual([[2589, 205, 200, 205, 40, day, 3]]);
});

test("item selection preserves house isolation and the public reporter threshold", async () => {
  const rows = [
    ...scans.map((s) => ({ ...s, house: "Horde", items: [[2589, 1, 10, 900, 900]] })),
    ...scans.slice(0, 2).map((s) => ({ ...s, eventId: `private:${s.eventId}`, scanId: `private:${s.scanId}`, house: "Horde", items: [[42, 1, 10, 12345, 12345]] })),
  ];
  store.loadMarket.mockResolvedValue({ state: foldMarket(emptyMarket(), rows, NOW), dataAsOf: NOW.toISOString() });
  const horde = await (await GET(req("?realm=Forever&house=Horde&items=2589,42"))).json();
  expect(horde.items).toEqual([[2589, 900, 900, 900, 10, day, 3]]);
  for (const query of ["?realm=Forever&house=Alliance&items=2589,42", "?realm=Forever&items=2589,42"]) {
    expect((await (await GET(req(query))).json()).items).toEqual([]);
  }
  expect(JSON.stringify(horde)).not.toMatch(/install-secret|12345/);
});
