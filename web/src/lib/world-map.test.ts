import { describe, expect, test } from "vitest";
import type { MapBoundsRow } from "../../../kb/src/map-bounds";
import type { WorldMapData } from "../../../kb/src/world-map-data";
import { worldToZone, zoneAt, zoneTable } from "../../../kb/src/world-coords";
import { continentCandidates, continentFlights, continentMap, continentPins, MAP_RECORD_KINDS, observedFacts, pinLink, WORLD_MAP } from "./world-map";
import { PUBLIC_RECORD_KINDS } from "@everloot/protocol";

// SYNTHETIC data in the shape of the generated file; the numbers are made up.
const data: WorldMapData = {
  schema: "everloot.world-map/1",
  source: { name: "test", status: "found in game files, unconfirmed", licence: "l", licenceUrl: "u", product: "p", buildId: 1, version: "1.0.0.1", buildConfig: "c", definitions: null, extractedAt: "2026-10-17T00:00:00Z", tables: [] },
  continents: [
    { id: 0, name: "Eastern Kingdoms", bounds: { top: 7000, bottom: -16000, left: 16000, right: -19000 } },
    { id: 1, name: "Kalimdor", bounds: { top: 12000, bottom: -11000, left: 17000, right: -19000 } },
  ],
  zones: [
    { uiMapId: 1429, name: "Synthetic Forest", continentId: 0, bounds: { top: -7940, bottom: -10254, left: 1535, right: -1935 } },
    { uiMapId: 1411, name: "Synthetic Dunes", continentId: 1, bounds: { top: 1800, bottom: -1700, left: -2000, right: -7250 } },
  ],
  heldBackZones: [
    { uiMapId: 2482, name: "Synthetic Peak", continentId: 1, bounds: { top: 6000, bottom: 4000, left: -900, right: -4400 } },
  ],
  entrances: [
    { mapId: 34, name: "Synthetic Stockade", raid: false, continentId: 0, worldX: -8762.4, worldY: 848 },
    { mapId: 389, name: "Synthetic Chasm", raid: false, continentId: 1, worldX: 1816.8, worldY: -4423.4 },
  ],
  flightNodes: [
    { id: 2, name: "Synthetic Post", continentId: 0, worldX: -8840, worldY: 489 },
    { id: 4, name: "Synthetic Far Post", continentId: 0, worldX: -10000, worldY: 900 },
    { id: 5, name: "Synthetic Peak Post", continentId: 1, worldX: 5000, worldY: -2000 },
    { id: 6, name: "Synthetic Dunes Post", continentId: 1, worldX: 0, worldY: -3000 },
  ],
  flightPaths: [
    { from: 2, to: 4, continentId: 0, points: [[-8840, 489], [-10000, 900]] },
    { from: 6, to: 5, continentId: 1, points: [[0, -3000], [5000, -2000]] },
  ],
  warnings: [],
};

const report = (installId: string, change: Partial<MapBoundsRow> = {}): MapBoundsRow =>
  ({ installId, capturedAt: "2026-10-17T00:00:00Z", mapId: 1429, continentId: 0, left: 1535, top: -7940, right: -1935, bottom: -10254, ...change });

describe("continentMap", () => {
  test("every zone and entrance of a continent shows with no reports at all", () => {
    const map = continentMap(0, [], data);
    expect(map.name).toBe("Eastern Kingdoms");
    expect(map.zones).toHaveLength(1);
    expect(map.zones[0]).toMatchObject({ mapId: 1429, name: "Synthetic Forest", x: -1535, y: 7940, width: 3470, height: 2314 });
    expect(map.entrances.map((p) => p.names[0])).toEqual(["Synthetic Stockade"]);
    expect(map.confirmedZones).toBe(0);
    expect(map.disagreements).toEqual([]);
  });

  test("the other continent has its own zones and entrances", () => {
    const map = continentMap(1, [], data);
    expect(map.zones.map((z) => z.name)).toEqual(["Synthetic Dunes"]);
    expect(map.entrances.map((p) => p.names[0])).toEqual(["Synthetic Chasm"]);
  });

  test("the view box holds every zone and entrance", () => {
    const map = continentMap(0, [], data);
    const vb = map.viewBox!;
    for (const z of map.zones) {
      expect(z.x).toBeGreaterThanOrEqual(vb.x);
      expect(z.x + z.width).toBeLessThanOrEqual(vb.x + vb.width);
      expect(z.y + z.height).toBeLessThanOrEqual(vb.y + vb.height);
    }
    for (const p of map.entrances) expect(p.map.x).toBeGreaterThanOrEqual(vb.x);
  });

  test("3 installs that match the files confirm a zone; 3 that differ are listed; fewer are ignored", () => {
    expect(continentMap(0, [report("a"), report("b"), report("c")], data)).toMatchObject({ confirmedZones: 1, disagreements: [] });
    const differ = [report("a", { right: -1599 }), report("b", { right: -1599 }), report("c", { right: -1599 })];
    const map = continentMap(0, differ, data);
    expect(map.confirmedZones).toBe(0);
    expect(map.disagreements.map((d) => d.name)).toEqual(["Synthetic Forest"]);
    expect(continentMap(0, [report("a", { right: -1599 }), report("b", { right: -1599 })], data).disagreements).toEqual([]);
  });

  test("reports for a zone on the other continent do not show on this one, and no install id reaches the result", () => {
    const rows = [report("secret-install"), report("b"), report("c")];
    expect(continentMap(1, rows, data).confirmedZones).toBe(0);
    expect(JSON.stringify(continentMap(0, rows, data))).not.toContain("secret-install");
  });

  test("with nothing to place there is no view box", () => {
    expect(continentMap(0, [], { ...data, zones: [], entrances: [] }).viewBox).toBeNull();
  });
});

describe("the committed map data, loaded for the page", () => {
  test("Stormwind Stockade's entrance lies in Stormwind City, which lies inside Elwynn Forest, by the files' own numbers", () => {
    const stockade = WORLD_MAP.entrances.find((e) => e.name === "Stormwind Stockade")!;
    const at = { continentId: stockade.continentId, worldX: stockade.worldX, worldY: stockade.worldY };
    const zones = zoneTable(WORLD_MAP);
    expect(zoneAt(zones, at)?.name).toBe("Stormwind City");
    expect(worldToZone(zones, 1429, at)).not.toBeNull();
  });

  test("both continents have zones and entrances", () => {
    for (const id of [0, 1]) {
      const map = continentMap(id, []);
      expect(map.zones.length).toBeGreaterThan(10);
      expect(map.entrances.length).toBeGreaterThan(5);
      expect(map.viewBox).not.toBeNull();
    }
  });
});

describe("held-back zones", () => {
  test("are not in the data at all unless spoilers are on", () => {
    expect(continentMap(1, [], data).zones.map((z) => z.name)).toEqual(["Synthetic Dunes"]);
    const on = continentMap(1, [], data, true);
    expect(on.zones.map((z) => [z.name, z.heldBack])).toEqual([["Synthetic Dunes", false], ["Synthetic Peak", true]]);
  });

  test("turning spoilers on does not move the frame", () => {
    expect(continentMap(1, [], data, true).viewBox).toEqual(continentMap(1, [], data).viewBox);
  });

  test("the committed file holds the three zones back and shows them only on request", () => {
    expect(WORLD_MAP.heldBackZones.map((z) => z.name).sort()).toEqual(["Mount Hyjal", "Riverglades", "Shen'dralas"]);
    const names = (spoilers: boolean) => [0, 1].flatMap((id) => continentMap(id, [], WORLD_MAP, spoilers).zones.map((z) => z.name));
    for (const name of WORLD_MAP.heldBackZones.map((z) => z.name)) {
      expect(names(false)).not.toContain(name);
      expect(names(true)).toContain(name);
    }
  });

  test("a map link never points into one", () => {
    expect(pinLink(1429, 10, 20)).toBe("/map?zone=1429&x=10&y=20");
    expect(pinLink(2482, 10, 20)).toBeNull();
    expect(pinLink(999999, 10, 20)).toBeNull();
  });
});

describe("player-observed points", () => {
  const sighting = (installId: string, npcId: number, mapId: number, x = 40, y = 60) => ({
    kind: "npc_sighting", installId, npcId, name: "Guard", mapId, x, y, level: 5, reaction: "friendly", positionKind: "npc", capturedAt: "2026-10-17T00:00:00Z",
  });
  const vendor = (installId: string, vendorNpcId: number) => ({ kind: "vendor", installId, vendorNpcId, items: [{ itemId: 5, priceCopper: 10 }], capturedAt: "2026-10-17T00:00:00Z" });
  const three = (npcId: number, mapId: number) => ["a", "b", "c"].map((i) => sighting(i, npcId, mapId));

  test("a pin appears at 3 installs, not at 2, in the zone's place on the continent map", () => {
    expect(continentPins(0, observedFacts(three(7, 1429).slice(0, 2)), false, data)).toEqual([]);
    const [pin] = continentPins(0, observedFacts(three(7, 1429)), false, data);
    expect(pin).toMatchObject({ kind: "npc", npcId: 7, name: "Guard", zoneName: "Synthetic Forest", reporters: 3, zoneX: 40, zoneY: 60 });
    // 40% across a zone that runs from worldY 1535 to -1935, 60% down from worldX -7940 to -10254.
    expect(pin!.x).toBeCloseTo(-(1535 - 0.4 * 3470), 5);
    expect(pin!.y).toBeCloseTo(-(-7940 + 0.6 * -2314), 5);
  });

  test("a vendor is an NPC with 3 agreeing offers; with fewer it stays a plain NPC", () => {
    const sights = three(8, 1429);
    expect(continentPins(0, observedFacts([...sights, ...["a", "b", "c"].map((i) => vendor(i, 8))]), false, data)[0]!.kind).toBe("vendor");
    expect(continentPins(0, observedFacts([...sights, vendor("a", 8)]), false, data)[0]!.kind).toBe("npc");
  });

  test("pins are per continent, and a pin in a zone the file does not know is dropped", () => {
    const records = [...three(7, 1429), ...three(9, 1411), ...three(10, 5555)];
    expect(continentPins(0, observedFacts(records), false, data).map((p) => p.npcId)).toEqual([7]);
    expect(continentPins(1, observedFacts(records), false, data).map((p) => p.npcId)).toEqual([9]);
  });

  test("pins inside a held-back zone need spoilers", () => {
    const records = three(11, 2482);
    expect(continentPins(1, observedFacts(records), false, data)).toEqual([]);
    expect(continentPins(1, observedFacts(records), true, data)).toMatchObject([{ npcId: 11, heldBack: true }]);
  });

  test("player positions never become pins, and no install id leaves", () => {
    const player = three(12, 1429).map((r) => ({ ...r, positionKind: "player" }));
    expect(continentPins(0, observedFacts(player), false, data)).toEqual([]);
    expect(JSON.stringify(continentPins(0, observedFacts(three(7, 1429)), false, data))).not.toMatch(/"installId"|"a"/);
  });

  test("only allowlisted kinds are read, and the map's kinds are on the allowlist", () => {
    for (const kind of MAP_RECORD_KINDS) expect(PUBLIC_RECORD_KINDS).toContain(kind);
    expect(PUBLIC_RECORD_KINDS).not.toContain("addon_seen");
    const facts = observedFacts([...three(7, 1429), { kind: "gold_snapshot", installId: "a" }, null, "text"]);
    expect(facts.npcs).toHaveLength(3);
  });

  test("places seen by 1 or 2 installs are counted per zone and category; a third install makes a pin instead", () => {
    const records = [
      sighting("a", 20, 1429), sighting("b", 20, 1429), // two installs: a candidate
      sighting("a", 21, 1429), sighting("a", 21, 1429, 41, 61), // one install twice: still one candidate
      ...three(22, 1429), // a pin, not a candidate
      sighting("a", 23, 1429), ...["a", "b", "c"].map((i) => vendor(i, 23)), // an agreed vendor seen by one install
      sighting("a", 24, 1411), // the other continent
      { ...sighting("a", 25, 1429), positionKind: "player" }, // where the player stood: never a place
      sighting("a", 26, 5555), sighting("a", 27, 1429, 140, 60), // an unknown zone, a spot off the map
    ];
    expect(continentCandidates(0, observedFacts(records), false, data)).toEqual([
      { category: "npc", mapId: 1429, count: 2 },
      { category: "vendor", mapId: 1429, count: 1 },
    ]);
    expect(continentCandidates(1, observedFacts(records), false, data)).toEqual([{ category: "npc", mapId: 1411, count: 1 }]);
    // Only counts: no NPC, no spot, no install.
    expect(JSON.stringify(continentCandidates(0, observedFacts(records), false, data))).not.toMatch(/npcId|"x"|installId|"a"/);
  });

  test("an interaction position is read like the NPC's own: a candidate at one install, a pin at three, on the 0 to 100 scale", () => {
    const at = (installId: string) => ({ ...sighting(installId, 40, 1429), positionKind: "interaction", role: "questgiver", level: undefined, reaction: undefined });
    expect(continentCandidates(0, observedFacts([at("a")]), false, data)).toEqual([{ category: "npc", mapId: 1429, count: 1 }]);
    expect(continentPins(0, observedFacts(["a", "b", "c"].map(at)), false, data)).toMatchObject([{ npcId: 40, zoneX: 40, zoneY: 60, reporters: 3 }]);
  });

  test("a held-back zone's candidates count only with spoilers on", () => {
    const records = [sighting("a", 30, 2482)];
    expect(continentCandidates(1, observedFacts(records), false, data)).toEqual([]);
    expect(continentCandidates(1, observedFacts(records), true, data)).toEqual([{ category: "npc", mapId: 2482, count: 1 }]);
  });
});
describe("flights on the map", () => {
  test("masters and lines are those of the continent asked for", () => {
    const zero = continentFlights(0, false, data);
    expect(zero.masters.map((m) => m.name)).toEqual(["Synthetic Post", "Synthetic Far Post"]);
    expect(zero.lines.map((l) => [l.from, l.to])).toEqual([["f2", "f4"]]);
    expect(zero.lines[0]!.points[0]).toEqual([-489, 8840]);
  });

  test("a master in a held-back zone, and a line that ends at one, wait for the spoiler switch", () => {
    const off = continentFlights(1, false, data);
    expect(off.masters.map((m) => m.name)).toEqual(["Synthetic Dunes Post"]);
    expect(off.lines).toEqual([]);
    const on = continentFlights(1, true, data);
    expect(on.masters.map((m) => [m.name, m.heldBack])).toEqual([["Synthetic Peak Post", true], ["Synthetic Dunes Post", false]]);
    expect(on.lines).toHaveLength(1);
  });

  test("the real file has flight masters on both continents", () => {
    expect(continentFlights(0).masters.length).toBeGreaterThan(10);
    expect(continentFlights(1).masters.length).toBeGreaterThan(10);
  });

  test("with spoilers off, no flight master or line of a held-back zone is in the real file's answer", () => {
    for (const c of [0, 1]) {
      const names = continentFlights(c).masters.map((m) => m.name).join("|");
      for (const z of WORLD_MAP.heldBackZones) expect(names).not.toContain(z.name);
    }
    expect(continentFlights(1, true).masters.some((m) => /Hyjal/.test(m.name))).toBe(true);
  });

  test("the real file holds back exactly the masters on held-back ground, not ones under a held-back rectangle", () => {
    const held = [0, 1].flatMap((c) => continentFlights(c, true).masters.filter((m) => m.heldBack).map((m) => m.name)).sort();
    // Talonbranch Glade stands on Felwood's ground, inside Mount Hyjal's rectangle: it is not a spoiler.
    expect(held).toEqual(["Farholde Keep, Riverglades", "Rog'mar, Riverglades", "Summit of Eternity, Mount Hyjal", "Tainted Foothills, Mount Hyjal"]);
    expect(continentFlights(1).masters.map((m) => m.name)).toContain("Talonbranch Glade, Felwood");
  });
});
