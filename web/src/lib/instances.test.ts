import { describe, expect, test, vi } from "vitest";
import type { WorldMapData } from "../../../kb/src/world-map-data";
import type { EncounterRow, InstanceEntranceRow } from "../../../kb/src/instances";

// The loaders read storage; these tests hand the readers their facts directly.
vi.mock("./rollup-compute", () => ({ loadInstanceFacts: vi.fn(), loadItemFacts: vi.fn() }));

import { bossLine, compareInstances, difficultyLabel, entranceLinks, instanceHref, instanceRows, levelLabel, parseInstanceSegment } from "./instances";
import { continentPinSet, continentTreasureCandidates } from "./world-map";
import { zoneContents, type ZoneSightings } from "./zones";

// SYNTHETIC data in the shape of the generated file; the numbers and names are made up.
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
    { mapId: 34, name: "Synthetic Stockade", raid: false, continentId: 0, worldX: -8762.4, worldY: 848, minLevel: 17, maxLevel: 24 },
    { mapId: 389, name: "Synthetic Chasm", raid: false, continentId: 1, worldX: 1500, worldY: -4423.4 },
    { mapId: 99, name: "Synthetic Spire", raid: true, continentId: 1, worldX: 5000, worldY: -2000 },
  ],
  flightNodes: [],
  flightPaths: [],
  warnings: [],
};

const asOf = new Date("2026-10-21T12:00:00Z");
const ids = ["install-a", "install-b", "install-c"];
const entrance = (installId: string, instanceMapId: number, capturedAt: string): InstanceEntranceRow =>
  ({ installId, instanceMapId, name: "Synthetic Stockade", instanceType: "party", mapId: 1429, x: 20, y: 36, capturedAt, difficulty: 1 });
const kill = (installId: string, encounterId: number, name: string, capturedAt: string): EncounterRow =>
  ({ installId, encounterId, name, instanceMapId: 34, success: true, npcIds: [encounterId * 10], capturedAt });

/** The Stockade: 3 installs zoned in from one place, and two bosses 3 installs report. The Chasm: nobody yet. */
const seen: ZoneSightings = {
  asOf,
  instances: {
    entrances: ids.map((i, n) => entrance(i, 34, `2026-10-1${7 + n}T10:00:00Z`)),
    encounters: [
      ...ids.map((i) => kill(i, 1, "Warden", "2026-10-18T11:00:00Z")),
      ...ids.map((i, n) => kill(i, 2, "Hogger", `2026-10-2${n}T11:00:00Z`)),
      kill("install-a", 2, "Hogger", "2026-10-20T12:00:00Z"),
    ],
  },
};

describe("instance rows", () => {
  test("an instance with a confirmed entrance and two bosses: installs, kills and the dates, one row", () => {
    const rows = instanceRows(seen, data);
    const stockade = rows.get(34)!;
    expect(stockade).toEqual({
      instanceMapId: 34, name: "Synthetic Stockade", raid: false, difficulty: 1, level: { min: 17, max: 24 },
      files: [{ mapId: 1429, zoneName: "Synthetic Forest", x: 19.8, y: 35.5 }],
      confirmed: [{ mapId: 1429, zoneName: "Synthetic Forest", x: 20, y: 36, installs: 3, lastSeen: "2026-10-19T10:00:00.000Z" }],
      reported: 0,
      bosses: [
        { encounterId: 1, name: "Warden", kills: 3, npcIds: [10], reporters: 3, lastSeen: "2026-10-18T11:00:00.000Z" },
        { encounterId: 2, name: "Hogger", kills: 4, npcIds: [20], reporters: 3, lastSeen: "2026-10-21T11:00:00.000Z" },
      ],
    });
    expect(bossLine(stockade.bosses[1]!)).toBe("Hogger (4 kills) from 3 installs, last seen 2026-10-21");
  });

  test("an instance with an entrance nobody confirmed lists the files' entrance and no confirmed one", () => {
    const chasm = instanceRows(seen, data).get(389)!;
    expect(chasm).toMatchObject({ name: "Synthetic Chasm", files: [{ mapId: 1411, zoneName: "Synthetic Dunes" }], confirmed: [], reported: 0, bosses: [], difficulty: null });
    // Two installs zoned in: a count, never a place.
    const two = { ...seen, instances: { entrances: ids.slice(0, 2).map((i) => ({ ...entrance(i, 389, "2026-10-18T10:00:00Z"), mapId: 1411 })), encounters: [] } };
    expect(instanceRows(two, data).get(389)).toMatchObject({ confirmed: [], reported: 2 });
  });

  test("an instance entered only from a held-back zone has no row", () => {
    expect(instanceRows(seen, data).has(99)).toBe(false);
  });

  test("the files' zone decides: an entrance inside a released rectangle but on held-back ground has no row", () => {
    const held = { ...data, entrances: data.entrances.map((e) => (e.mapId === 389 ? { ...e, uiMapId: 2482 } : e)) };
    expect(instanceRows(seen, held).has(389)).toBe(false);
    expect(instanceRows(seen, held).has(34)).toBe(true);
  });

  test("the zone page's row and the instance page agree on the entrance and its bosses", () => {
    const row = zoneContents({ npcs: [], quests: [], vendors: [] }, data, seen).get(1429)!.entrances[0]!;
    expect(row).toMatchObject({ names: ["Synthetic Stockade"], instanceMapIds: [34], confirmed: 3, lastSeen: "2026-10-19T10:00:00.000Z" });
    expect(row.bosses).toEqual(instanceRows(seen, data).get(34)!.bosses);
    expect(entranceLinks(row, data)).toEqual([{ name: "Synthetic Stockade", id: 34 }]);
  });

  test("the level comes from the files' range; an instance with no range in the files has none, never a guess", () => {
    const rows = instanceRows(seen, data);
    expect(rows.get(34)!.level).toEqual({ min: 17, max: 24 });
    expect(rows.get(389)!.level).toBeNull();
    expect(levelLabel(rows.get(34)!.level)).toBe("17–24");
    expect(levelLabel({ min: 60, max: 60 })).toBe("60");
    expect(levelLabel(rows.get(389)!.level)).toBeNull();
  });

  test("the list runs from the lowest level up, instances with no level last, then by name", () => {
    const base = instanceRows(seen, data).get(34)!;
    const mk = (id: number, name: string, level: { min: number; max: number } | null) => ({ ...base, instanceMapId: id, name, level });
    const sorted = [mk(1, "Zed", null), mk(2, "Raid", { min: 60, max: 60 }), mk(3, "Beta", { min: 17, max: 24 }), mk(4, "Alpha", null), mk(5, "Early", { min: 13, max: 13 })].sort(compareInstances);
    expect(sorted.map((r) => r.name)).toEqual(["Early", "Beta", "Raid", "Alpha", "Zed"]);
  });

  test("a difficulty id prints by the game's name for it, and an id the list lacks as its number", () => {
    expect([1, 2, 9, 148, 174, 194].map(difficultyLabel)).toEqual(["Normal", "Heroic", "40 Player", "20 Player", "Heroic", "25 Player (Heroic)"]);
    expect(difficultyLabel(9999)).toBe("Difficulty 9999");
  });

  test("an instance's address is its id and a slug, and the id is what counts", () => {
    expect(instanceHref(34, "Synthetic Stockade")).toBe("/database/instances/34-synthetic-stockade");
    expect(instanceHref(77, null)).toBe("/database/instances/77");
    expect(parseInstanceSegment("34-synthetic-stockade")).toBe(34);
    expect(parseInstanceSegment("34")).toBe(34);
    expect(parseInstanceSegment("stockade")).toBeNull();
  });
});

describe("markers on the map", () => {
  const chest = (installId: string, x: number, capturedAt = "2026-10-19T09:00:00Z") => ({ installId, objectId: 500, mapId: 1429, x, y: 34, name: "Old Chest", capturedAt });
  const objectNames = new Map([[500, "Old Chest"]]);

  test("a treasure pin three installs agree on is drawn where the zone page lists it", () => {
    const sightings = { ...seen, sightings: ids.map((i) => chest(i, 12)), objectNames };
    const set = continentPinSet(0, { npcs: [], quests: [], vendors: [] }, false, data, sightings);
    expect(set.treasures).toEqual([expect.objectContaining({ objectId: 500, name: "Old Chest", mapId: 1429, zoneName: "Synthetic Forest", zoneX: 12, zoneY: 34, reporters: 3, lastSeen: "2026-10-19T09:00:00.000Z" })]);
    const listed = zoneContents({ npcs: [], quests: [], vendors: [] }, data, sightings).get(1429)!.treasures;
    expect(listed).toEqual([{ objectId: 500, name: "Old Chest", x: set.treasures[0]!.zoneX, y: set.treasures[0]!.zoneY, reporters: 3, lastSeen: "2026-10-19T09:00:00.000Z" }]);
    expect(continentPinSet(1, { npcs: [], quests: [], vendors: [] }, false, data, sightings).treasures).toEqual([]);
  });

  test("a treasure's last seen leaves out a clock set ahead of the corpus", () => {
    const sightings = { ...seen, sightings: [...ids.slice(0, 2).map((i) => chest(i, 12)), chest("install-c", 12, "2031-01-01T00:00:00Z")], objectNames };
    expect(continentPinSet(0, { npcs: [], quests: [], vendors: [] }, false, data, sightings).treasures[0]).toMatchObject({ reporters: 3, lastSeen: "2026-10-19T09:00:00.000Z" });
  });

  test("a treasure two installs report is not drawn, only counted", () => {
    const sightings = { ...seen, sightings: ids.slice(0, 2).map((i) => chest(i, 12)), objectNames };
    expect(continentPinSet(0, { npcs: [], quests: [], vendors: [] }, false, data, sightings).treasures).toEqual([]);
    expect(continentTreasureCandidates(0, sightings, data)).toEqual([{ category: "chest", mapId: 1429, count: 1 }]);
  });

  test("an entrance the files place carries what players confirmed; nobody's confirmation changes nothing", () => {
    const confirmed = continentPinSet(0, { npcs: [], quests: [], vendors: [] }, false, data, seen).entrances;
    expect(confirmed).toEqual([expect.objectContaining({ names: ["Synthetic Stockade"], instanceMapIds: [34], confirmed: 3, lastSeen: "2026-10-19T10:00:00.000Z" })]);
    const plain = continentPinSet(0, { npcs: [], quests: [], vendors: [] }, false, data).entrances;
    expect(plain).toEqual([{ id: "-8762.4-848", names: ["Synthetic Stockade"], raid: false, x: -848, y: 8762.4, worldX: -8762.4, worldY: 848, instanceMapIds: [34] }]);
  });

  test("an entrance only players place is drawn once 3 agree, in its released zone", () => {
    const vault = { ...seen, instances: { entrances: ids.map((i) => ({ ...entrance(i, 35, "2026-10-18T10:00:00Z"), name: "Synthetic Vault", x: 60, y: 40 })), encounters: [] } };
    const entrances = continentPinSet(0, { npcs: [], quests: [], vendors: [] }, false, data, vault).entrances;
    expect(entrances.find((e) => e.files === false)).toMatchObject({ id: "p35-1429", names: ["Synthetic Vault"], confirmed: 3 });
  });
});
