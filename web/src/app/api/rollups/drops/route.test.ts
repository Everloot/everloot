import { afterEach, beforeEach, expect, test, vi } from "vitest";

const store = vi.hoisted(() => ({ loadCorpus: vi.fn(), api: vi.fn(), computeRollups: vi.fn() }));
vi.mock("@/lib/upload-store", () => ({ uploadStore: { loadCorpus: store.loadCorpus } }));
vi.mock("@/lib/intake-quota", () => ({ intakeQuota: { api: store.api } }));

import { GET } from "./route";
import { ANON_PAGE } from "@/lib/data-guard";
import { dropsResponse } from "@everloot/protocol";

const req = (query = "") => new Request(`https://everloot.app/api/rollups/drops${query}`);

beforeEach(() => {
  store.api.mockReset().mockResolvedValue({ allowed: true, retryAfter: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock("@/lib/rollup-compute"); });

test("the drop API reports when its data was current, not only when it answered", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-09T10:00:00.000Z" });
  const body = await (await GET(req())).json();
  expect(body.dataAsOf).toBe("2026-10-09T10:00:00.000Z");
  expect(body.stats.dataAsOf).toBe("2026-10-09T10:00:00.000Z");
});

test("an unreadable store has no data time", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], unreachable: true });
  const body = await (await GET(req())).json();
  expect(body.unreachable).toBe(true);
  expect(body.dataAsOf).toBeNull();
});

test("rates and measured zeros show every tier, with independent name tiers and no install ids", async () => {
  const records = [1, 2, 3].flatMap((n) => Array.from({ length: n }, (_, i) => ({
    kind: "loot", sourceEvidence: "loot-api", installId: `fixture-tier-${i}`, sourceObjectId: 7200 + n,
    sourceObjectName: "Fixture Source", items: n === 2 ? [] : [{ itemId: 8001, count: 1 }],
  })));
  store.loadCorpus.mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-11-19T03:00:00.000Z" });
  const body = await (await GET(req())).json();
  expect(body.rates.find((r: { reporters: number }) => r.reporters === 1)).toMatchObject({ tier: "reported", public: false, sourceName: "Fixture Source", sourceNameTier: "reported" });
  expect(body.rates.find((r: { reporters: number }) => r.reporters === 3)).toMatchObject({ tier: "confirmed", public: true });
  expect(body.measuredZeros).toEqual([expect.objectContaining({ reporters: 2, tier: "verified", public: false, sourceNameTier: "verified" })]);
  expect(body.queued).toBe(0);
  expect(JSON.stringify(body)).not.toMatch(/fixture-tier|installId/);
  expect(dropsResponse.parse(body).rates).toEqual(body.rates);
});

test("every answer carries the licence and credit line, in the body and the headers", async () => {
  store.loadCorpus.mockResolvedValue({ uploads: 0, records: [], dataAsOf: "2026-10-09T10:00:00.000Z" });
  const res = await GET(req());
  expect((await res.json()).attribution).toMatchObject({ licence: "CC BY-SA 4.0", source: "https://everloot.app/database/drops" });
  expect(res.headers.get("x-everloot-credit")).toBe("Data from Everloot (https://everloot.app), CC BY-SA 4.0.");
  expect(store.api).not.toHaveBeenCalled();
});

test("public rates keep upload names from loot, minimap objects and targeted NPC sightings", async () => {
  const loot = (installId: string, sourceObjectId: number, sourceObjectName?: string) => ({
    kind: "loot", installId, sourceObjectId, sourceEvidence: "loot-api",
    items: [{ itemId: 8001, count: 1 }], ...(sourceObjectName ? { sourceObjectName } : {}),
  });
  const records = ["fixture-a", "fixture-b", "fixture-c"].flatMap((installId) => [
    loot(installId, 7001, "Fixture Chest"), loot(installId, 7002), loot(installId, 7003),
    { ...loot(installId, 7004), sourceObjectId: undefined, sourceNpcId: 7004 },
    { kind: "object_sighting", installId, objectId: 7003, name: "Fixture Treasure", mapId: 1, x: 20, y: 30 },
    { kind: "npc_sighting", installId, npcId: 7004, name: "Fixture Creature", positionKind: "player", mapId: 1, x: 20, y: 30 },
  ]);
  store.loadCorpus.mockResolvedValue({ uploads: 3, records, dataAsOf: "2026-11-19T00:00:00.000Z" });
  const body = await (await GET(req())).json();
  expect(body.rates).toHaveLength(4);
  expect(body.rates.find((r: { sourceObjectId: number }) => r.sourceObjectId === 7001)).toHaveProperty("sourceName", "Fixture Chest");
  expect(body.rates.find((r: { sourceObjectId: number }) => r.sourceObjectId === 7002)).not.toHaveProperty("sourceName");
  expect(body.rates.find((r: { sourceObjectId: number }) => r.sourceObjectId === 7003)).toHaveProperty("sourceName", "Fixture Treasure");
  expect(body.rates.find((r: { sourceNpcId: number }) => r.sourceNpcId === 7004)).toHaveProperty("sourceName", "Fixture Creature");
});

test.each(["npc", "object"] as const)("public %s drop labels use exact, unanimous upload names from one install", async (kind) => {
  const installs = ["fixture-a", "fixture-b", "fixture-c"];
  const labels = [["Fixture Solo"], ["Fixture Pair", "Fixture Pair"], ["Fixture East", "Fixture West"],
    ["Fixture Case", "fixture case"], ["Fixture Pair", "Fixture Pair", "Fixture Other"], ["Fixture Repeat"]];
  const records: unknown[] = labels.flatMap((names, i) => {
    const id = 7101 + i;
    return [
      ...installs.map((installId) => ({ kind: "loot", installId, sourceEvidence: "loot-api",
        ...(kind === "npc" ? { sourceNpcId: id } : { sourceObjectId: id }), items: [{ itemId: 8001, count: 1 }] })),
      ...names.map((name, n) => ({ installId: installs[n], name, mapId: 1, x: 20, y: 30,
        ...(kind === "npc" ? { kind: "npc_sighting", npcId: id, positionKind: "player" } : { kind: "object_sighting", objectId: id }) })),
    ];
  });
  // Repeating one install's name never supplies the second install.
  records.push(records[records.length - 1]);
  for (const installId of installs.slice(0, 2)) {
    records.push(
      { kind: "loot", installId, sourceEvidence: "loot-api", items: [{ itemId: 8001, count: 1 }],
        ...(kind === "npc" ? { sourceNpcId: 7199 } : { sourceObjectId: 7199 }) },
      { installId, name: "Fixture Queued", mapId: 1, x: 20, y: 30,
        ...(kind === "npc" ? { kind: "npc_sighting", npcId: 7199 } : { kind: "object_sighting", objectId: 7199 }) },
    );
  }
  store.loadCorpus.mockResolvedValue({ uploads: 3, records, dataAsOf: kind === "npc" ? "2026-11-19T01:00:00.000Z" : "2026-11-19T02:00:00.000Z" });
  const body = await (await GET(req())).json();
  expect(body.rates).toHaveLength(7);
  expect(body.queued).toBe(0);
  const nameOf = (id: number) => body.rates.find((r: { sourceNpcId?: number; sourceObjectId?: number }) =>
    (kind === "npc" ? r.sourceNpcId : r.sourceObjectId) === id).sourceName;
  expect(nameOf(7101)).toBe("Fixture Solo");
  expect(body.rates.find((r: { sourceNpcId?: number; sourceObjectId?: number }) => (r.sourceNpcId ?? r.sourceObjectId) === 7101)).toMatchObject({ tier: "confirmed", sourceNameTier: "reported" });
  expect(nameOf(7102)).toBe("Fixture Pair");
  expect(nameOf(7103)).toBeUndefined();
  expect(nameOf(7104)).toBeUndefined();
  expect(nameOf(7105)).toBeUndefined();
  expect(nameOf(7106)).toBe("Fixture Repeat");
});

test("guard on: the drop list is paged for anonymous callers and limited per IP", async () => {
  vi.stubEnv("EVERLOOT_DATA_GUARD", "1");
  vi.resetModules();
  const rate = (i: number) => ({ itemId: i + 1, reporters: 3, public: true });
  vi.doMock("@/lib/rollup-compute", () => ({
    computeRollups: async () => ({
      rates: Array.from({ length: 400 }, (_, i) => rate(i)),
      measuredZeros: Array.from({ length: 400 }, (_, i) => ({ sourceNpcId: 1000 + i, kills: 3, reporters: 3, public: true })),
      stats: { unreachable: false, dataAsOf: null },
    }),
  }));
  const { GET: paged } = await import("./route");
  const body = await (await paged(req())).json();
  // Rates and measured zeros share one page: together never more than the cap.
  expect(body.rates).toHaveLength(400);
  expect(body.measuredZeros).toHaveLength(ANON_PAGE - 400);
  expect(body).toMatchObject({ total: 800, totalRates: 400, totalMeasuredZeros: 400, offset: 0, limit: ANON_PAGE });
  expect(body.next).toBe(`https://everloot.app/api/rollups/drops?offset=${ANON_PAGE}&limit=${ANON_PAGE}`);
  const rest = await (await paged(req(`?offset=${ANON_PAGE}`))).json();
  expect(rest.rates).toHaveLength(0);
  expect(rest.measuredZeros).toHaveLength(800 - ANON_PAGE);
  expect(rest.measuredZeros[0].sourceNpcId).toBe(1000 + ANON_PAGE - 400);
  expect(rest.next).toBeNull();
  store.api.mockResolvedValue({ allowed: false, retryAfter: 60 });
  expect((await paged(req())).status).toBe(429);
});

test("the body is the protocol's dropsResponse", async () => {
  const body = await (await GET(req())).json();
  expect(() => dropsResponse.parse(body)).not.toThrow();
});

test("each rate names its source when the site knows the name, so the price file can name sources a player never met", async () => {
  vi.resetModules();
  vi.doMock("@/lib/rollup-compute", () => ({
    computeRollups: async () => ({
      rates: [
        { sourceNpcId: 3114, itemId: 2589, kills: 8, drops: 2, rate: 0.25, reporters: 3, public: true },
        { sourceObjectId: 106318, itemId: 118, kills: 6, drops: 4, rate: 4 / 6, reporters: 3, public: true },
        { sourceObjectId: 693674, itemId: 286012, kills: 3, drops: 3, rate: 1, reporters: 3, public: true },
      ],
      measuredZeros: [],
      stats: { uploads: 3, lootWindows: 17, records: 40, unreachable: false, dataAsOf: null },
    }),
  }));
  vi.doMock("@/lib/names", () => ({
    loadDropSourceNames: async () => ({ npcs: new Map([[3114, { name: "Fixture Creature", tier: "confirmed" }]]), objects: new Map([[106318, { name: "Fixture Chest", tier: "confirmed" }]]), items: new Map(), quests: new Map() }),
  }));
  const { GET: named } = await import("./route");
  const body = await (await named(req())).json();
  expect(body.rates.map((r: { sourceName?: string }) => r.sourceName)).toEqual(["Fixture Creature", "Fixture Chest", undefined]);
  expect(() => dropsResponse.parse(body)).not.toThrow();
  expect(dropsResponse.parse(body).rates[0]).toHaveProperty("sourceName", "Fixture Creature");
  vi.doUnmock("@/lib/names");
});

test("public rates carry likely ranges and settling without changing counts, including partial tiers", async () => {
  vi.resetModules();
  const small = { sourceNpcId: 3114, itemId: 2589, kills: 3, drops: 3, rate: 1, reporters: 3, public: true };
  const large = { sourceObjectId: 106318, itemId: 118, kills: 1000, drops: 400, rate: 0.4, reporters: 5, public: true };
  vi.doMock("@/lib/rollup-compute", () => ({
    computeRollups: async () => ({
      rates: [small, large, { ...small, sourceNpcId: 999, reporters: 2, public: false }], measuredZeros: [],
      stats: { uploads: 5, lootWindows: 1006, records: 1006, unreachable: false, dataAsOf: "2026-11-13T00:00:00.000Z" },
    }),
  }));
  vi.doMock("@/lib/names", () => ({ loadDropSourceNames: async () => ({ npcs: new Map([[3114, { name: "Fixture Creature", tier: "confirmed" }]]), objects: new Map() }) }));
  try {
    const { GET: ranges } = await import("./route");
    const body = await (await ranges(req())).json();
    expect(body.rates).toHaveLength(3);
    expect(body.rates[0]).toMatchObject({ ...small, sourceName: "Fixture Creature", settled: false });
    expect(body.rates[0].rateLow).toBeCloseTo(0.438503, 5);
    expect(body.rates[0].rateHigh).toBeCloseTo(1, 5);
    expect(body.rates[1]).toMatchObject({ ...large, settled: true });
    expect(body.rates[1].rateLow).toBeCloseTo(0.370075, 5);
    expect(body.rates[1].rateHigh).toBeCloseTo(0.430691, 5);
    expect(body.queued).toBe(0);
    // Older bulk files share this row schema: the added metadata must stay additive.
    expect(dropsResponse.shape.rates.element.parse(small)).toEqual(small);
    expect(dropsResponse.parse(body).rates).toEqual(body.rates);
  } finally { vi.doUnmock("@/lib/names"); }
});

test("public drop responses keep exactly the existing keys", async () => {
  vi.resetModules();
  const internal = { units: 99, averageCopper: 123, futureInternal: true };
  const rate = { sourceNpcId: 7, itemId: 2589, kills: 3, drops: 3, rate: 1, reporters: 3, public: true, ...internal };
  vi.doMock("@/lib/rollup-compute", () => ({ computeRollups: async () => ({
    rates: [rate, { ...rate, sourceNpcId: undefined, sourceObjectId: 9 }],
    measuredZeros: [{ sourceNpcId: 8, kills: 3, reporters: 3, public: true, ...internal }],
    sources: [{ sourceNpcId: 7, averageCopper: 123 }],
    stats: { uploads: 3, lootWindows: 9, records: 9, unreachable: false, dataAsOf: null },
  }) }));
  vi.doMock("@/lib/names", () => ({ loadDropSourceNames: async () => ({ npcs: new Map([[7, { name: "Fixture Creature", tier: "confirmed" }]]), objects: new Map() }) }));
  try {
    const { GET: projected } = await import("./route");
    const body = await (await projected(req())).json();
    expect(Object.keys(body).sort()).toEqual(["attribution", "dataAsOf", "generatedAt", "limit", "measuredZeros", "next", "offset", "queued", "rates", "stats", "total", "totalMeasuredZeros", "totalRates", "unreachable"]);
    expect(Object.keys(body.rates[0]).sort()).toEqual(["drops", "itemId", "kills", "public", "rate", "rateHigh", "rateLow", "reporters", "settled", "sourceName", "sourceNameTier", "sourceNpcId", "tier"]);
    expect(Object.keys(body.rates[1]).sort()).toEqual(["drops", "itemId", "kills", "public", "rate", "rateHigh", "rateLow", "reporters", "settled", "sourceObjectId", "tier"]);
    expect(Object.keys(body.measuredZeros[0]).sort()).toEqual(["kills", "public", "reporters", "sourceNpcId", "tier"]);
    expect(JSON.stringify(body)).not.toMatch(/units|copper|futureInternal/i);
  } finally { vi.doUnmock("@/lib/names"); }
});
