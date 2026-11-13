import { gzipSync } from "node:zlib";
import { beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus } }));

import { GET } from "./route";
import { readPinSet } from "@/lib/map-view";
import { WORLD_MAP } from "@/lib/world-map";

/** The budget for one continent's answer, gzipped, as the browser downloads it. */
const BUDGET = 150 * 1024;

const req = (query: string) => new Request(`https://everloot.app/api/map/pins${query}`);
const sightings = (npcId: number, mapId: number, x: number, y: number, name: string) =>
  ["install-secret-a", "install-secret-b", "install-secret-c"].map((installId) => ({
    kind: "npc_sighting", installId, npcId, name, mapId, x, y, level: 5, reaction: "friendly", positionKind: "npc", capturedAt: "2026-10-17T00:00:00Z",
  }));

beforeEach(() => {
  store.loadCorpus.mockReset().mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-20T12:00:00.000Z" });
});

test("a continent's answer holds what the map draws besides the zones, cached at the CDN and never indexed", async () => {
  const res = await GET(req("?continent=1"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=300");
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, continent: 1, spoilers: false, dataAsOf: "2026-10-20T12:00:00.000Z", unreachable: false });
  const set = readPinSet(body)!;
  expect(set.entrances.map((e) => e.names[0])).toContain("Ragefire Chasm");
  expect(set.flightMasters.map((f) => f.name)).toContain("Orgrimmar, Durotar");
  expect(set.flightLines.length).toBeGreaterThan(50);
  expect(set.pins).toEqual([]);
  // Zones are the page's own, not this route's.
  expect(body).not.toHaveProperty("zones");
});

test("held-back zones' items come only with spoilers=1", async () => {
  // Mount Hyjal, held back on Kalimdor.
  store.loadCorpus.mockResolvedValue({ uploads: 3, records: sightings(8, 2482, 50, 50, "Held Warden"), dataAsOf: null });
  const off = readPinSet(await (await GET(req("?continent=1"))).json())!;
  const on = readPinSet(await (await GET(req("?continent=1&spoilers=1"))).json())!;
  expect(off.flightMasters.every((f) => !f.heldBack)).toBe(true);
  expect(off.flightLines.every((l) => !l.heldBack)).toBe(true);
  expect(off.pins).toEqual([]);
  expect(on.flightMasters.length + on.pins.length).toBeGreaterThan(off.flightMasters.length + off.pins.length);
  expect(on.pins.map((p) => p.name)).toEqual(["Held Warden"]);
});

test("player points need 3 installs, and no install id leaves the site", async () => {
  store.loadCorpus.mockResolvedValue({
    uploads: 3,
    records: [...sightings(7, 1429, 40, 60, "Guard Marlow"), ...sightings(9, 1429, 10, 10, "Two Installs").slice(0, 2)],
    dataAsOf: null,
  });
  const text = await (await GET(req("?continent=0"))).text();
  const set = readPinSet(JSON.parse(text))!;
  expect(set.pins.map((p) => [p.name, p.reporters])).toEqual([["Guard Marlow", 3]]);
  expect(text).not.toContain("install-secret");
  expect(text).not.toContain("Two Installs");
});

test("a bad continent is refused, uncached", async () => {
  for (const q of ["", "?continent=", "?continent=7", "?continent=1.0", "?continent=-1", "?continent=abc"]) {
    const res = await GET(req(q));
    expect(res.status, q).toBe(400);
    expect(res.headers.get("cache-control"), q).toBe("no-store");
  }
});

test("unreachable storage still answers with the game-file items, marked so and not cached", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const res = await GET(req("?continent=0"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(body).toMatchObject({ unreachable: true, dataAsOf: null, pins: [] });
  expect(readPinSet(body)!.flightMasters.length).toBeGreaterThan(0);
});

test("each continent's answer stays under 150 KB gzipped, with spoilers on and with 2,000 agreed points", async () => {
  const sizes: number[] = [];
  for (const continent of [0, 1]) {
    const zone = WORLD_MAP.zones.find((z) => z.continentId === continent)!.uiMapId;
    const busy = Array.from({ length: 2000 }, (_, i) => sightings(100_000 + i, zone, (i * 7) % 100, (i * 13) % 100, `Busy Npc ${i}`)).flat();
    for (const records of [[], busy]) {
      store.loadCorpus.mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-10-20T12:00:00.000Z" });
      const text = await (await GET(req(`?continent=${continent}&spoilers=1`))).text();
      if (records.length) expect(readPinSet(JSON.parse(text))!.pins).toHaveLength(2000);
      const size = gzipSync(text).length;
      sizes.push(size);
      expect(size, `continent ${continent}, ${records.length ? "2,000 points" : "game files only"}`).toBeLessThan(BUDGET);
    }
  }
  // The game-file part alone is small: a fraction of the budget.
  expect(Math.max(sizes[0]!, sizes[2]!)).toBeLessThan(BUDGET / 5);
});

test("stored facts give the same answer with zero corpus reads", async () => {
  const { buildMapPins, encodeMapPins, forgetStoredMapPins, MAP_PINS_KEY } = await import("@/lib/map-pins-store");
  const { buildAggregates } = await import("@/lib/aggregate-set");
  const { encodeAggregates, forgetStoredAggregates } = await import("@/lib/aggregate-store");
  // An NPC, a vendor three installs agree on, both on Eastern Kingdoms, and an NPC in a held-back zone on Kalimdor.
  const vendor = ["install-secret-a", "install-secret-b", "install-secret-c"].map((installId) => ({
    kind: "vendor", installId, vendorNpcId: 8, items: [{ itemId: 159, priceCopper: 25 }], capturedAt: "2026-10-17T00:00:00Z",
  }));
  const corpus = {
    uploads: 3, dataAsOf: "2026-11-09",
    records: [...sightings(7, 1429, 40, 60, "Guard Marlow"), ...sightings(8, 1429, 30, 30, "Trader Ann"), ...vendor, ...sightings(9, 2482, 50, 50, "Held Warden")],
  };
  const queries = ["?continent=0", "?continent=0&spoilers=1", "?continent=1", "?continent=1&spoilers=1"];
  store.loadCorpus.mockResolvedValue(corpus);
  const before = await Promise.all(queries.map(async (q) => (await GET(req(q))).json()));
  // The answers hold what the check is for: the vendor pin, and the held-back NPC only with spoilers=1.
  expect(readPinSet(before[0])!.pins.map((p) => [p.name, p.kind])).toEqual(expect.arrayContaining([["Trader Ann", "vendor"], ["Guard Marlow", "npc"]]));
  expect(readPinSet(before[2])!.pins.map((p) => p.name)).not.toContain("Held Warden");
  expect(readPinSet(before[3])!.pins.map((p) => p.name)).toContain("Held Warden");
  store.loadCorpus.mockClear();
  forgetStoredMapPins();
  forgetStoredAggregates();
  for (const [key, value] of Object.entries({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "uploads" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = (input as Request).url;
    return new Response(url.endsWith("snapshots/aggregates.json")
      ? encodeAggregates(buildAggregates(corpus as unknown as import("@/lib/upload-store").Corpus), "now")
      : url.endsWith(MAP_PINS_KEY)
        ? encodeMapPins(buildMapPins(corpus), "now") : "{}" );
  }));
  expect(await Promise.all(queries.map(async (q) => (await GET(req(q))).json()))).toEqual(before);
  expect(store.loadCorpus).not.toHaveBeenCalled();
});
