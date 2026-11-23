import { afterEach, describe, expect, test } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { createMcpHttpHandler } from "../src/mcp-http-server.js";
import type { CorpusLoader } from "../src/mcp-server.js";
import { distanceYards, handleWorldMapNear, mapFactsFromRecords, NEAR_MAX_LIMIT, nearResult, observedPins } from "../src/world-map-near.js";
import { agreedNpcFacts, worldFactsFromRecords } from "../src/world-pages.js";
import type { WorldMapData } from "../src/world-map-data.js";

// SYNTHETIC map data; the numbers are made up. Zone 1429 spans worldX -7940..-10254 and worldY 1535..-1935,
// so its centre (50, 50) is worldX -9097, worldY -200.
const data: WorldMapData = {
  schema: "everloot.world-map/1",
  source: { name: "test", status: "found in game files, unconfirmed", licence: "l", licenceUrl: "u", product: "p", buildId: 1, version: "1.0.0.1", buildConfig: "c", definitions: null, extractedAt: "2026-10-17T00:00:00Z", tables: [] },
  continents: [{ id: 0, name: "Eastern Kingdoms", bounds: { top: 7000, bottom: -16000, left: 16000, right: -19000 } }],
  zones: [{ uiMapId: 1429, name: "Synthetic Forest", continentId: 0, bounds: { top: -7940, bottom: -10254, left: 1535, right: -1935 } }],
  heldBackZones: [{ uiMapId: 2548, name: "Synthetic Glades", continentId: 0, bounds: { top: -6467, bottom: -9700, left: -1892, right: -6742 } }],
  entrances: [
    { mapId: 34, name: "Synthetic Stockade", raid: false, continentId: 0, worldX: -9067, worldY: -160 },
    { mapId: 35, name: "Synthetic Keep", raid: true, continentId: 0, worldX: -9097 + 400, worldY: -200 },
    { mapId: 36, name: "Faraway Hold", raid: false, continentId: 0, worldX: 6000, worldY: 9000 },
  ],
  flightNodes: [], flightPaths: [],
  warnings: [],
};

const when = "2026-10-17T00:00:00Z";
const sighting = (installId: string, npcId: number, mapId: number, x: number, y: number, name = `Guard ${npcId}`) => ({
  kind: "npc_sighting", installId, npcId, name, mapId, x, y, level: 5, reaction: "friendly", positionKind: "npc", capturedAt: when,
});
const three = (npcId: number, mapId: number, x: number, y: number, name?: string) => ["i1", "i2", "i3"].map((i) => sighting(i, npcId, mapId, x, y, name));
const vendor = (installId: string, vendorNpcId: number) => ({ kind: "vendor", installId, vendorNpcId, items: [{ itemId: 5, priceCopper: 10 }], capturedAt: when });
const facts = (records: unknown[]) => worldFactsFromRecords(records);

const corpus = [
  ...three(1, 1429, 50, 50, "Centre Guard"),
  ...three(2, 1429, 51, 50, "East Smith"),
  ...three(3, 1429, 50, 52, "Clerk"),
  ...["i1", "i2", "i3"].map((i) => vendor(i, 3)),
  ...three(4, 2548, 50, 50, "Spoiler NPC"),
  ...["i1", "i2"].map((i) => sighting(i, 5, 1429, 50, 50, "Two installs only")),
];

describe("distance", () => {
  test("is a straight line in yards, and infinite across continents", () => {
    expect(distanceYards({ continentId: 0, worldX: 0, worldY: 0 }, { continentId: 0, worldX: 3, worldY: 4 })).toBe(5);
    expect(distanceYards({ continentId: 0, worldX: 1, worldY: 1 }, { continentId: 1, worldX: 1, worldY: 1 })).toBe(Infinity);
  });
});

describe("observed pins", () => {
  test("need 3 installs, and a vendor is told apart from a plain NPC", () => {
    const pins = observedPins(facts(corpus), data);
    expect(pins.map((p) => [p.npcId, p.kind, p.spoiler])).toEqual([[1, "npc", false], [2, "npc", false], [3, "vendor", false], [4, "npc", true]]);
  });

  test("are the same from the agreed NPC table, with no sightings beside it", () => {
    const raw = facts(corpus);
    expect(observedPins({ ...raw, npcs: [], agreedNpcs: agreedNpcFacts(raw) }, data)).toEqual(observedPins(raw, data));
  });
});

describe("handleWorldMapNear", () => {
  const near = (args: Parameters<typeof handleWorldMapNear>[0]) => handleWorldMapNear(args, data, facts(corpus));

  test("lists entrances, NPCs and vendors nearest first with distances in yards", () => {
    const text = near({ zone: "Synthetic Forest", x: 50, y: 50 });
    // Stockade is 30 yards north and 40 east of the centre: 50 yards.
    expect(text).toMatch(/Synthetic Stockade \(dungeon\) in Synthetic Forest\s+50 yards/);
    expect(text).toMatch(/Synthetic Keep \(raid\).*400 yards/);
    expect(text).not.toContain("Faraway Hold");
    // The centre NPC is 0 yards away, the next is 1% of 3470 yards of width (34.7 yards) west.
    expect(text).toMatch(/Centre Guard \(NPC 1\) in Synthetic Forest at 50, 50\s+0 yards\s+3 reporters/);
    expect(text).toMatch(/East Smith \(NPC 2\).*34\.7 yards/);
    expect(text.indexOf("Centre Guard")).toBeLessThan(text.indexOf("East Smith"));
    expect(text).toMatch(/Vendors[^\n]*\n\s+Clerk \(NPC 3\)/);
    expect(text).toContain("found in game files, unconfirmed");
  });

  test("an entrance 3 installs zoned in from is confirmed in place, and a treasure 3 installs saw is listed; 2 are not enough", () => {
    const entered = (installId: string) => ({ kind: "instance_entrance", installId, instanceMapId: 34, name: "Synthetic Stockade", instanceType: "party", mapId: 1429, x: 51, y: 49, capturedAt: when });
    const chest = (installId: string, objectId: number) => ({ kind: "object_sighting", installId, objectId, name: `Chest ${objectId}`, mapId: 1429, x: 50.5, y: 50, capturedAt: when });
    const records = [...corpus, ...["i1", "i2", "i3"].map(entered), ...["i1", "i2", "i3"].map((i) => chest(i, 77)), ...["i1", "i2"].map((i) => chest(i, 78))];
    const result = nearResult({ zone: "Synthetic Forest", x: 50, y: 50 }, data, mapFactsFromRecords(records));
    expect(result.ok && result.entrances.map((e) => [e.names[0], e.confirmed])).toEqual([["Synthetic Stockade", 3], ["Synthetic Keep", undefined]]);
    expect(result.ok && result.treasures).toEqual([{ objectId: 77, name: "Chest 77", mapId: 1429, zoneName: "Synthetic Forest", x: 50.5, y: 50, yards: 17.3, reporters: 3 }]);
    const text = handleWorldMapNear({ zone: "Synthetic Forest", x: 50, y: 50 }, data, mapFactsFromRecords(records));
    expect(text).toMatch(/Synthetic Stockade \(dungeon\).*confirmed by 3 installs/);
    expect(text).toMatch(/Treasures[^\n]*\n\s+Chest 77 \(object 77\)/);
    expect(text).not.toContain("Chest 78");
    const two = nearResult({ zone: "Synthetic Forest", x: 50, y: 50 }, data, mapFactsFromRecords([...corpus, ...["i1", "i2"].map(entered)]));
    expect(two.ok && two.entrances[0]?.confirmed).toBeUndefined();
  });

  test("an entrance's zone is the one the game files give it, and one in a held-back zone is left out", () => {
    // The Stockade lies inside Synthetic Forest's rectangle, but the files put it in the held-back zone.
    const placed = { ...data, entrances: [{ ...data.entrances[0]!, uiMapId: 2548 }, { ...data.entrances[1]!, uiMapId: 1429 }] };
    const result = nearResult({ zone: "Synthetic Forest", x: 50, y: 50 }, placed, facts(corpus));
    expect(result.ok && result.entrances.map((e) => [e.names[0], e.zone])).toEqual([["Synthetic Keep", "Synthetic Forest"]]);
  });

  test("a zone can be named by its map id", () => {
    expect(near({ zone: "1429", x: 50, y: 50 })).toContain("Near Synthetic Forest at 50, 50");
  });

  test("an NPC id starts from where that NPC stands and leaves it out of its own results", () => {
    const text = near({ npcId: 1 });
    expect(text).toContain("Near Centre Guard in Synthetic Forest at 50, 50");
    expect(text).not.toContain("Centre Guard (NPC 1)");
    expect(text).toContain("East Smith (NPC 2)");
  });

  test("the radius limits what is listed", () => {
    const text = near({ zone: "Synthetic Forest", x: 50, y: 50, radius: 40 });
    expect(text).not.toContain("Synthetic Stockade");
    expect(text).not.toContain("Synthetic Keep");
    expect(text).toContain("East Smith");
  });

  test("held-back zones, pins in them, and pins with 2 installs are never offered", () => {
    const text = near({ zone: "Synthetic Forest", x: 50, y: 50, radius: 5000 });
    expect(text).not.toContain("Spoiler NPC");
    expect(text).not.toContain("Two installs only");
    expect(near({ zone: "Synthetic Glades", x: 50, y: 50 })).toMatch(/No zone/);
    expect(near({ zone: "2548", x: 50, y: 50 })).toMatch(/No zone/);
    expect(near({ npcId: 4 })).toMatch(/no agreed position/);
    expect(near({ npcId: 5 })).toMatch(/no agreed position/);
  });

  test("input is checked", () => {
    expect(near({})).toMatch(/Give a zone/);
    expect(near({ zone: "Synthetic Forest", x: 1, y: 1, npcId: 1 })).toMatch(/not both/);
    expect(near({ zone: "Synthetic Forest" })).toMatch(/x and y are needed/);
    expect(near({ zone: "Synthetic Forest", x: 101, y: 5 })).toMatch(/x and y are needed/);
    expect(near({ zone: "Synthetic Forest", x: NaN, y: 5 })).toMatch(/x and y are needed/);
    expect(near({ zone: "Nowhere", x: 5, y: 5 })).toMatch(/No zone "Nowhere"/);
    expect(near({ zone: "   ", x: 5, y: 5 })).toMatch(/Name a zone/);
    expect(near({ zone: "z".repeat(81), x: 5, y: 5 })).toMatch(/Name a zone/);
    expect(near({ npcId: 0 })).toMatch(/Name an npc id/);
    expect(near({ npcId: 99 })).toMatch(/no agreed position/);
    expect(near({ zone: "Synthetic Forest", x: 5, y: 5, radius: 0 })).toMatch(/Radius/);
    expect(near({ zone: "Synthetic Forest", x: 5, y: 5, radius: 5001 })).toMatch(/Radius/);
    expect(near({ zone: "Synthetic Forest", x: 5, y: 5, limit: 0 })).toMatch(/Limit/);
    expect(near({ zone: "Synthetic Forest", x: 5, y: 5, limit: 1.5 })).toMatch(/Limit/);
  });

  test("a long name is cut and a crowded map is capped by the limit", () => {
    const crowd = Array.from({ length: 60 }, (_, i) => three(100 + i, 1429, 50, 50, `N${i} ${"x".repeat(300)}`)).flat();
    const text = handleWorldMapNear({ zone: "Synthetic Forest", x: 50, y: 50, limit: NEAR_MAX_LIMIT }, data, facts(crowd));
    expect(text.split("\n").filter((l) => l.includes("(NPC "))).toHaveLength(NEAR_MAX_LIMIT);
    expect(text.length).toBeLessThan(6000);
    expect(text).not.toContain("x".repeat(100));
    const one = handleWorldMapNear({ zone: "Synthetic Forest", x: 50, y: 50 }, data, facts(crowd));
    expect(one.split("\n").filter((l) => l.includes("(NPC "))).toHaveLength(5);
  });

  test("no install id reaches the answer", () => {
    expect(near({ zone: "Synthetic Forest", x: 50, y: 50 })).not.toContain("i1");
  });
});

describe("the MCP tool", () => {
  const databases: DB[] = [];
  afterEach(() => { for (const db of databases.splice(0)) db.close(); });

  const handler = (loader?: CorpusLoader) => {
    const db = openDb(":memory:");
    databases.push(db);
    return createMcpHttpHandler({ db, bearerToken: null, maxRequestBodyBytes: 4096, rateLimitPerMinute: 50, allowedOrigins: [], corpus: loader });
  };
  const call = (method: string, params?: unknown) => new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const run = async (args: unknown, loader: CorpusLoader | undefined = async () => ({ records: corpus, dataAsOf: "2026-10-17T00:00:00.000Z" })) =>
    (await (await handler(loader)(call("tools/call", { name: "world_map_near", arguments: args }))).json()).result as { isError?: boolean; content: { text: string }[] };

  test("is registered read-only, after vendor_page", async () => {
    const tools = (await (await handler()(call("tools/list", {}))).json()).result.tools as { name: string; annotations: { readOnlyHint: boolean; openWorldHint: boolean } }[];
    const names = tools.map((t) => t.name);
    expect(names.indexOf("world_map_near")).toBe(names.indexOf("vendor_page") + 1);
    const tool = tools.find((t) => t.name === "world_map_near")!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  test("answers from the corpus loader with the data age, using the real map file", async () => {
    const result = await run({ zone: "Elwynn Forest", x: 50, y: 50, radius: 5000 });
    const text = result.content[0]!.text;
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Near Elwynn Forest at 50, 50");
    expect(text).toContain("Data as of 2026-10-17");
    expect(text).toContain("Stormwind Stockade");
  });

  test("a spot given by NPC id works through the tool", async () => {
    const synthetic = await run({ npcId: 1 });
    expect(synthetic.content[0]!.text).toContain("Near Centre Guard in Elwynn Forest at 50, 50");
  });

  test("the schema refuses bad input before the handler runs", async () => {
    for (const args of [
      { zone: "Elwynn Forest", x: 101, y: 5 },
      { zone: "Elwynn Forest", x: -1, y: 5 },
      { zone: "Elwynn Forest", x: 5, y: 5, limit: 21 },
      { zone: "Elwynn Forest", x: 5, y: 5, limit: 0 },
      { zone: "Elwynn Forest", x: 5, y: 5, radius: 5001 },
      { zone: "Elwynn Forest", x: 5, y: 5, radius: -3 },
      { zone: "z".repeat(81), x: 5, y: 5 },
      { npcId: -4 },
      { npcId: 1.5 },
      { zone: 1429, x: 5, y: 5 },
    ]) {
      const result = await run(args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
  });

  test("an unreadable corpus is reported, not shown as empty", async () => {
    const result = await run({ zone: "Elwynn Forest", x: 5, y: 5 }, async () => null);
    expect(result.content[0]!.text).toMatch(/unavailable/i);
  });
});
