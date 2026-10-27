import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { chunkOf, terrainRowId } from "../src/terrain-area.js";
import { assignmentRect, buildWorldMapData, thinLine, WorldMapData, WORLD_MAP_SCHEMA } from "../src/world-map-data.js";

// Synthetic rows in the shape of the client tables (column names from WoWDBDefs). The numbers are made up.
type Row = Record<string, unknown>;
const rows = (list: Row[]) => new Map(list.map((r) => [Number(r.ID), r]));
const uiMap = (ID: number, Name_lang: string, Type: number, ParentUiMapID: number): Row => ({ ID, Name_lang, Type, ParentUiMapID });
const assign = (ID: number, UiMapID: number, MapID: number, Region: number[], extra: Row = {}): Row =>
  ({ ID, UiMapID, MapID, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region, ...extra });
const map = (ID: number, MapName_lang: string, InstanceType: number, CorpseMapID: number, Corpse: number[]): Row =>
  ({ ID, MapName_lang, InstanceType, CorpseMapID, Corpse });

const tables: Record<string, ReturnType<typeof rows>> = {
  Map: rows([
    map(0, "Eastern Kingdoms", 0, 255, [0, 0]),
    map(1, "Kalimdor", 0, 255, [0, 0]),
    map(34, "Stormwind Stockade", 1, 0, [-8762.38, 848.01]),
    map(35, "<unused>StormwindPrison", 0, 0, [-8762.48, 848.05]),
    map(44, "<unused> Monastery", 1, 0, [2892.4, -811.2]),
    map(189, "Scarlet Monastery", 1, 0, [2892.24, -811.26]),
    map(409, "Molten Core", 2, 0, [-7510.56, -1036.7]),
    map(269, "Caverns of Time", 1, 0, [0, 0]),
    map(533, "Naxxramas", 2, 255, [0, 0]),
    map(489, "Warsong Gulch", 3, 0, [10, 10]),
    map(389, "Ragefire Chasm", 1, 1, [1816.76, -4423.37]),
  ]),
  UiMap: rows([
    uiMap(947, "Azeroth", 1, 0),
    uiMap(1415, "Eastern Kingdoms", 2, 947),
    uiMap(1414, "Kalimdor", 2, 947),
    uiMap(1463, "Eastern Kingdoms", 2, 0),
    uiMap(1429, "Elwynn Forest", 3, 1415),
    uiMap(1411, "Durotar", 3, 1414),
    uiMap(2548, "Riverglades", 3, 1415),
    uiMap(1460, "Warsong Gulch", 6, 1413),
    uiMap(1500, "Off continent", 3, 947),
  ]),
  UiMapAssignment: rows([
    assign(1, 1415, 0, [-16000, -19200, -1e6, 7467, 16000, 1e6]),
    assign(2, 1414, 1, [-11733, -19733, -1e6, 12800, 17067, 1e6]),
    assign(3, 1429, 0, [-10254.2, -1935, -1e6, -7939.6, 1535.4, 1e6]),
    assign(4, 1411, 1, [-1716.7, -7250, -1e6, 1808.3, -1962.5, 1e6]),
    assign(5, 2548, 0, [-9700, -6742, -1e6, -6467, -1892, 1e6]),
    assign(6, 1460, 489, [862, 896, -1e6, 1627, 2042, 1e6]),
    assign(7, 1500, 2991, [0, 0, -1e6, 10, 10, 1e6]),
    assign(8, 1463, 0, [-15980, -11880, -1e6, 5817, 9917, 1e6]),
  ]),
};
const source: WorldMapData["source"] = {
  name: "test", status: "found in game files, unconfirmed", licence: "Blizzard game data, not under our licence", licenceUrl: "u",
  product: "wow_classic_beta", buildId: 1, version: "1.0.0.1", buildConfig: "abc", definitions: null, extractedAt: "2026-10-17T00:00:00Z", tables: [],
};
const data = buildWorldMapData((t) => tables[t], source);

describe("map data from client tables", () => {
  test("a zone's rectangle: north is the larger x, west is the larger y", () => {
    expect(data.zones.find((z) => z.uiMapId === 1429)).toEqual({
      uiMapId: 1429, name: "Elwynn Forest", continentId: 0,
      bounds: { top: -7939.6, bottom: -10254.2, left: 1535.4, right: -1935 },
    });
    expect(data.zones.find((z) => z.uiMapId === 1411)).toMatchObject({ name: "Durotar", continentId: 1 });
  });

  test("continents are the world map's children, named by the Map table, not the duplicate views", () => {
    expect(data.continents.map((c) => [c.id, c.name])).toEqual([[0, "Eastern Kingdoms"], [1, "Kalimdor"]]);
  });

  test("zones that are not on a continent, battlegrounds and later ids are left out, and the hold-back is reported", () => {
    expect(data.zones.map((z) => z.uiMapId)).toEqual([1411, 1429]);
    expect(data.warnings).toEqual([
      "1 zone(s) with later UiMap ids are held back as possibly unreleased",
      "no flight tables in the snapshot: no flight masters or flight lines",
      "no terrain areas in the snapshot: entrances and flight masters are placed by zone rectangles, which overlap",
    ]);
    // The held-back zone is kept apart, with its rectangle, for the spoiler switch.
    expect(data.heldBackZones).toHaveLength(1);
    expect(data.heldBackZones[0]!.uiMapId).toBeGreaterThan(1458);
  });

  test("entrances are the instances' ghost-return spots; unused, positionless and off-continent maps are dropped", () => {
    expect(data.entrances.map((e) => e.name)).toEqual(["Stormwind Stockade", "Scarlet Monastery", "Ragefire Chasm", "Molten Core"]);
    expect(data.entrances[0]).toEqual({ mapId: 34, name: "Stormwind Stockade", raid: false, continentId: 0, worldX: -8762.4, worldY: 848 });
    expect(data.entrances.find((e) => e.name === "Molten Core")?.raid).toBe(true);
    expect(data.entrances.find((e) => e.name === "Ragefire Chasm")?.continentId).toBe(1);
  });

  test("a rectangle that covers only part of a map is not used as the whole map", () => {
    const base = { ID: 1, UiMapID: 1, MapID: 0, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: [-10, -10, -1, 10, 10, 1] };
    expect(assignmentRect(base)).toEqual({ top: 10, bottom: -10, left: 10, right: -10 });
    expect(assignmentRect({ ...base, UiMax: [0.5, 1] })).toBeNull();
    expect(assignmentRect({ ...base, Region: [1, 2, 3] })).toBeNull();
    expect(assignmentRect({ ...base, Region: [5, 5, 0, 5, 7, 0] })).toBeNull();
  });

  test("the first assignment by order index wins when a map has several", () => {
    const t: typeof tables = { ...tables, UiMapAssignment: rows([
      assign(10, 1429, 0, [-1, -1, 0, 1, 1, 0], { OrderIndex: 1 }),
      assign(11, 1429, 0, [-10, -10, 0, 10, 10, 0], { OrderIndex: 0 }),
      assign(12, 1415, 0, [-16000, -19200, 0, 7467, 16000, 0]),
    ]) };
    const d = buildWorldMapData((n) => t[n], source);
    expect(d.zones[0].bounds).toEqual({ top: 10, bottom: -10, left: 10, right: -10 });
  });

  test("a snapshot without the map tables is refused with a pointer to client-extract", () => {
    expect(() => buildWorldMapData(() => undefined, source)).toThrow(/client-extract/);
  });
});

describe("instance levels from MapDifficulty, ContentTuning and LFGDungeons", () => {
  const tuning = (ID: number, MinLevelSquish: number, MaxLevelSquish: number): Row => ({ ID, MinLevelSquish, MaxLevelSquish });
  const withLevels: typeof tables = {
    ...tables,
    ContentTuning: rows([tuning(1, 24, 24), tuning(2, 60, 60), tuning(3, 17, 24), tuning(4, 0, 0), tuning(5, 10, 12)]),
    // Stockade by MapID (two difficulty rows naming the same tuning), Scarlet Monastery has two different ones, Ragefire's tuning row is empty.
    MapDifficulty: rows([
      { ID: 1, MapID: 34, ContentTuningID: 3 }, { ID: 2, MapID: 34, ContentTuningID: 3 },
      { ID: 3, MapID: 189, ContentTuningID: 3 }, { ID: 4, MapID: 189, ContentTuningID: 5 },
      { ID: 5, MapID: 389, ContentTuningID: 4 }, { ID: 6, MapID: 409, ContentTuningID: 0 },
    ]),
    // No MapID in this build's LFGDungeons: Molten Core is found by its exact name; "Naxxramas" has no row at all.
    LFGDungeons: rows([{ ID: 1, Name_lang: "Molten Core", ContentTuningID: 2 }, { ID: 2, Name_lang: "Ragefire", ContentTuningID: 1 }]),
  };
  const d = buildWorldMapData((t) => withLevels[t], source);
  const level = (name: string) => { const e = d.entrances.find((x) => x.name === name)!; return [e.minLevel, e.maxLevel]; };

  test("a dungeon takes its range from the tuning row MapDifficulty names", () => {
    expect(level("Stormwind Stockade")).toEqual([17, 24]);
  });

  test("a raid with no tuning in MapDifficulty takes the LFGDungeons row with exactly its name", () => {
    expect(level("Molten Core")).toEqual([60, 60]);
  });

  test("an instance with no usable row, an empty range or two different ranges has no level, not a guess", () => {
    expect(level("Ragefire Chasm")).toEqual([undefined, undefined]);
    expect(level("Scarlet Monastery")).toEqual([undefined, undefined]);
    expect(d.entrances.find((e) => e.name === "Ragefire Chasm")).not.toHaveProperty("minLevel");
  });

  test("a snapshot without ContentTuning gives no levels and still builds", () => {
    const { ContentTuning: _t, ...rest } = withLevels;
    const none = buildWorldMapData((t) => rest[t], source);
    expect(none.entrances.every((e) => e.minLevel === undefined && e.maxLevel === undefined)).toBe(true);
  });
});

describe("the zone each entrance is in, from the ground under it", () => {
  // Each zone's whole-map assignment names the area it shows; the terrain chunk under a spot names its area.
  const ground = (continentId: number, worldX: number, worldY: number, AreaID: number): Row => {
    const { col, row } = chunkOf(worldX, worldY);
    return { ID: terrainRowId(continentId, col, row), ContinentID: continentId, AreaID };
  };
  const areaOf: Record<number, number> = { 1429: 12, 1411: 14, 2548: 16591 };
  const withAreas: typeof tables = {
    ...tables,
    UiMapAssignment: rows([...tables.UiMapAssignment!.values()].map((a) => ({ ...a, AreaID: areaOf[Number(a.UiMapID)] ?? 0 }))),
    AreaTable: rows([
      { ID: 12, AreaName_lang: "Elwynn Forest", ParentAreaID: 0 },
      { ID: 14, AreaName_lang: "Durotar", ParentAreaID: 0 },
      { ID: 16591, AreaName_lang: "Riverglades", ParentAreaID: 0 },
      { ID: 87, AreaName_lang: "Goldshire", ParentAreaID: 12 },
      { ID: 2000, AreaName_lang: "A cave", ParentAreaID: 87 },
      { ID: 3000, AreaName_lang: "Nowhere", ParentAreaID: 0 },
    ]),
    TerrainArea: rows([
      ground(0, -8762.4, 848, 2000), // Stockade: a sub-area of a sub-area of Elwynn
      ground(0, 2892.2, -811.3, 16591), // Scarlet Monastery: ground a held-back zone shows
      ground(1, 1816.8, -4423.4, 12), // Ragefire Chasm: Elwynn's area, but Elwynn is on the other continent
      ground(0, -7510.6, -1036.7, 3000), // Molten Core: an area no zone shows
    ]),
  };
  const d = buildWorldMapData((t) => withAreas[t], source);
  const zoneOf = (name: string) => d.entrances.find((e) => e.name === name)?.uiMapId;

  test("the ground's area, walked up its parents, gives the zone that shows it", () => {
    expect(zoneOf("Stormwind Stockade")).toBe(1429);
  });

  test("a held-back zone counts, so the spoiler switch can hide what lies in it", () => {
    expect(zoneOf("Scarlet Monastery")).toBe(2548);
  });

  test("an area no zone on the spot's continent shows leaves the zone to the rectangles, with a warning", () => {
    expect(zoneOf("Ragefire Chasm")).toBeUndefined();
    expect(zoneOf("Molten Core")).toBeUndefined();
    expect(d.warnings).toContain("2 entrance(s) or flight master(s) have no zone from the terrain; the zone rectangles place them");
  });

  // The ghost-return spot can stand over a border; the outdoor area named after the instance says where its door is.
  const named = (extra: Row[], mapRows: Row[] = []) => {
    const t: typeof tables = {
      ...withAreas,
      Map: rows([...tables.Map!.values(), ...mapRows]),
      AreaTable: rows([...withAreas.AreaTable!.values(), ...extra]),
    };
    return buildWorldMapData((n) => t[n], source);
  };
  const zoneIn = (d2: WorldMapData, name: string) => d2.entrances.find((e) => e.name === name)?.uiMapId;

  test("the outdoor area named after the instance decides over the ground under the ghost spot", () => {
    // The Stockade's ghost spot is on Elwynn's ground, but an area of continent 0 named "Stormwind Stockade" lies under the held-back zone.
    const d2 = named([{ ID: 5000, AreaName_lang: "Stormwind Stockade", ContinentID: 0, ParentAreaID: 16591 }]);
    expect(zoneIn(d2, "Stormwind Stockade")).toBe(2548);
  });

  test("the instance's own area name counts too, and a named area on another continent does not", () => {
    const d2 = named(
      [
        { ID: 5001, AreaName_lang: "The Old Prison", ContinentID: 0, ParentAreaID: 16591 },
        { ID: 5002, AreaName_lang: "The Old Prison", ContinentID: 34, ParentAreaID: 0 },
        { ID: 5003, AreaName_lang: "Stormwind Stockade", ContinentID: 1, ParentAreaID: 14 },
      ],
      [{ ...tables.Map!.get(34)!, AreaTableID: 5002 }],
    );
    expect(zoneIn(d2, "Stormwind Stockade")).toBe(2548);
  });

  test("named areas that lead to two zones, or to none, leave the zone to the ground", () => {
    const two = named([
      { ID: 5000, AreaName_lang: "Stormwind Stockade", ContinentID: 0, ParentAreaID: 16591 },
      { ID: 5001, AreaName_lang: "Stormwind Stockade", ContinentID: 0, ParentAreaID: 12 },
    ]);
    expect(zoneIn(two, "Stormwind Stockade")).toBe(1429);
    const none = named([{ ID: 5000, AreaName_lang: "Stormwind Stockade", ContinentID: 0, ParentAreaID: 0 }]);
    expect(zoneIn(none, "Stormwind Stockade")).toBe(1429);
  });
});

describe("flight masters and flight lines from the taxi tables", () => {
  const node = (ID: number, Name_lang: string, ContinentID: number, Pos: number[]): Row => ({ ID, Name_lang, ContinentID, Pos });
  const path = (ID: number, FromTaxiNode: number, ToTaxiNode: number): Row => ({ ID, FromTaxiNode, ToTaxiNode, Cost: 100 });
  const point = (ID: number, PathID: number, NodeIndex: number, x: number, y: number): Row => ({ ID, PathID, NodeIndex, Loc: [x, y, 50] });
  const taxi: typeof tables = {
    ...tables,
    TaxiNodes: rows([
      node(2, "Stormwind, Elwynn", 0, [-8832.77, 478.62, 109]),
      node(4, "Sentinel Hill, Westfall", 0, [-10628.89, 1036.68, 34]),
      node(5, "Generic, World target", 0, [-8644, 433, 59]),
      node(6, "Southshore Ferry, Hillsbrad", 0, [-700, -500, 1]),
      node(7, "Programmer Isle", 0, [16391, 16341, 69]),
      node(8, "Durotar Post", 30, [0, 0, 0]),
      node(9, "Unlinked, Elwynn", 0, [-9000, 400, 0]),
    ]),
    TaxiPath: rows([path(10, 4, 2), path(11, 2, 4), path(12, 2, 5), path(13, 6, 2), path(14, 8, 2)]),
    TaxiPathNode: rows([
      point(1, 10, 0, -10628, 1036), point(2, 10, 2, -9700.4, 700), point(3, 10, 1, -10100, 900.6), point(4, 10, 3, -8832, 478),
      point(5, 11, 0, -8832, 478), point(6, 11, 1, -10628, 1036),
      point(7, 12, 0, -8832, 478), point(8, 12, 1, -8644, 433),
    ]),
  };
  const flights = buildWorldMapData((t) => taxi[t], source);

  test("a flight master is a taxi node a flight starts or ends at; stand-ins, ferries, test rows and other maps are left out", () => {
    expect(flights.flightNodes.map((n) => n.name)).toEqual(["Stormwind, Elwynn", "Sentinel Hill, Westfall"]);
    expect(flights.flightNodes[0]).toEqual({ id: 2, name: "Stormwind, Elwynn", continentId: 0, worldX: -8832.8, worldY: 478.6 });
  });

  test("a pair of nodes has one line, from the lower path id, through its points in order", () => {
    expect(flights.flightPaths).toHaveLength(1);
    const line = flights.flightPaths[0]!;
    expect([line.from, line.to, line.continentId]).toEqual([4, 2, 0]);
    expect(line.points[0]).toEqual([-10628, 1036]);
    expect(line.points[line.points.length - 1]).toEqual([-8832, 478]);
  });

  test("a snapshot without the taxi tables has no flights and says so", () => {
    expect(data.flightNodes).toEqual([]);
    expect(data.flightPaths).toEqual([]);
  });

  test("thinning keeps the ends and the corners, and drops points on the line", () => {
    expect(thinLine([[0, 0], [10, 0], [20, 0], [30, 0]], 5)).toEqual([[0, 0], [30, 0]]);
    expect(thinLine([[0, 0], [10, 0], [20, 0], [20, 30]], 5)).toEqual([[0, 0], [20, 0], [20, 30]]);
    expect(thinLine([[1, 1], [2, 2]], 5)).toEqual([[1, 1], [2, 2]]);
  });
});

describe("the committed map data", () => {
  const committed = WorldMapData.parse(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "web", "src", "data", "game-data", "map.json"), "utf8")));

  test("is stamped with a build and labelled as game file data, not our licence", () => {
    expect(committed.schema).toBe(WORLD_MAP_SCHEMA);
    expect(committed.source).toMatchObject({ product: "wowf", status: "found in game files, unconfirmed", licence: "Blizzard game data, not under our licence" });
    expect(committed.source.buildId).toBeGreaterThan(70000);
    expect(committed.source.tables.map((t) => t.table).sort()).toEqual(["AreaTable", "ContentTuning", "LFGDungeons", "Map", "MapDifficulty", "TaxiNodes", "TaxiPath", "TaxiPathNode", "TerrainArea", "UiMap", "UiMapAssignment"]);
  });

  test("an entrance's level is both ends or neither, within the game's 1 to 60, and most instances have one", () => {
    for (const e of committed.entrances) {
      expect(e.minLevel === undefined, e.name).toBe(e.maxLevel === undefined);
      if (e.minLevel !== undefined) expect(e.minLevel >= 1 && e.minLevel <= e.maxLevel! && e.maxLevel! <= 60, e.name).toBe(true);
    }
    expect(committed.entrances.filter((e) => e.minLevel !== undefined).length).toBeGreaterThan(committed.entrances.length / 2);
  });

  test("every entrance and flight master has the zone its ground belongs to, and the zone is on its continent", () => {
    const zones = new Map([...committed.zones, ...committed.heldBackZones].map((z) => [z.uiMapId, z]));
    for (const spot of [...committed.entrances, ...committed.flightNodes]) {
      expect(spot.uiMapId, spot.name).toBeDefined();
      expect(zones.get(spot.uiMapId!)?.continentId, spot.name).toBe(spot.continentId);
    }
  });

  test("carries no third-party data: only the fields the page uses, and no unused-map placeholders", () => {
    expect(committed.entrances.length).toBeGreaterThan(15);
    expect(committed.entrances.some((e) => /unused/i.test(e.name))).toBe(false);
    expect(Object.keys(committed.zones[0]).sort()).toEqual(["bounds", "continentId", "name", "uiMapId"]);
  });

  test("flight masters and lines are there, on the continents, and every line joins two masters", () => {
    expect(committed.flightNodes.length).toBeGreaterThan(40);
    const ids = new Set(committed.flightNodes.map((n) => n.id));
    for (const p of committed.flightPaths) {
      expect(ids.has(p.from) && ids.has(p.to), `${p.from}-${p.to}`).toBe(true);
      expect(p.points.length).toBeGreaterThanOrEqual(2);
    }
    expect(committed.flightNodes.some((n) => /^(generic|transport|quest path)/i.test(n.name))).toBe(false);
  });

  test("every entrance and zone lies inside its continent", () => {
    const inside = (c: number, x: number, y: number) => {
      const b = committed.continents.find((k) => k.id === c)!.bounds;
      return x <= b.top && x >= b.bottom && y <= b.left && y >= b.right;
    };
    for (const e of committed.entrances) expect(inside(e.continentId, e.worldX, e.worldY), e.name).toBe(true);
    for (const z of committed.zones) {
      expect(inside(z.continentId, z.bounds.top, z.bounds.left), z.name).toBe(true);
      expect(inside(z.continentId, z.bounds.bottom, z.bounds.right), z.name).toBe(true);
    }
  });
});
