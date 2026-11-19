import { describe, expect, test } from "vitest";
import type { WorldMapData } from "@kb/world-map-data";
import type { WorldFacts } from "@kb/world-pages";
import { WORLD_MAP } from "./world-map";
import { hasContent, parseZoneSegment, placedEntrances, publicZones, zoneByMapId, zoneContents, zoneHref, zoneMapHref, zoneSlug } from "./zones";

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
    { mapId: 34, name: "Synthetic Stockade", raid: false, continentId: 0, worldX: -8762.4, worldY: 848 },
    { mapId: 389, name: "Synthetic Chasm", raid: false, continentId: 1, worldX: 1500, worldY: -4423.4 },
    { mapId: 99, name: "Synthetic Spire", raid: true, continentId: 1, worldX: 5000, worldY: -2000 },
  ],
  flightNodes: [],
  flightPaths: [],
  warnings: [],
};

const sighting = (installId: string, npcId: number, name: string, mapId: number, x: number, y: number) =>
  ({ installId, npcId, name, mapId, x, y, positionKind: "npc" as const });
const three = (npcId: number, name: string, mapId: number, x: number, y: number) =>
  ["a", "b", "c"].map((i) => sighting(`install-${i}`, npcId, name, mapId, x, y));
const quest = (installId: string, questId: number, giverNpcId: number, level = 5) =>
  ({ installId, questId, title: `Quest ${questId}`, level, giverNpcId, rewardItemIds: [] });
const vendor = (installId: string, vendorNpcId: number) => ({ installId, vendorNpcId, itemId: 159, priceCopper: 25 });

describe("zone addresses", () => {
  test("the segment is the map id and a name slug, and the id is what counts", () => {
    expect(zoneSlug(1411, "Durotar")).toBe("1411-durotar");
    expect(zoneSlug(1429, "Elwynn Forest")).toBe("1429-elwynn-forest");
    expect(zoneSlug(1453, "Stormwind City")).toBe("1453-stormwind-city");
    expect(zoneSlug(1411, "")).toBe("1411");
    expect(zoneHref(1411, "Durotar")).toBe("/database/zones/1411-durotar");
    expect(zoneMapHref(1411)).toBe("/map?zone=1411");
    expect(parseZoneSegment("1411-durotar")).toBe(1411);
    expect(parseZoneSegment("1411")).toBe(1411);
    expect(parseZoneSegment("durotar")).toBeNull();
    expect(parseZoneSegment("0-x")).toBeNull();
    expect(parseZoneSegment("1411-Durotar")).toBeNull();
  });

  test("a zone found only in the game files has no page", () => {
    expect(publicZones(data).map((z) => z.mapId)).toEqual([1411, 1429]);
    expect(zoneByMapId(2482, data)).toBeUndefined();
    expect(zoneByMapId(1411, data)).toMatchObject({ name: "Synthetic Dunes", continentName: "Kalimdor" });
  });
});

describe("zoneContents", () => {
  const empty: WorldFacts = { npcs: [], quests: [], vendors: [] };

  test("an NPC needs 3 installs on the zone's map; two are not enough", () => {
    const facts: WorldFacts = { ...empty, npcs: [...three(100, "Guard Orin", 1429, 40, 50), sighting("install-a", 101, "Lone Wolf", 1429, 10, 10), sighting("install-b", 101, "Lone Wolf", 1429, 10, 10)] };
    const forest = zoneContents(facts, data).get(1429)!;
    expect(forest.npcs).toEqual([{ npcId: 100, name: "Guard Orin", x: 40, y: 50, reporters: 3, vendor: false }]);
    expect(zoneContents(facts, data).get(1411)!.npcs).toEqual([]);
  });

  test("a vendor is an NPC whose goods 3 installs agree on", () => {
    const facts: WorldFacts = { ...empty, npcs: three(200, "Trader Vell", 1411, 20, 30), vendors: ["a", "b", "c"].map((i) => vendor(`install-${i}`, 200)) };
    expect(zoneContents(facts, data).get(1411)!.npcs[0]).toMatchObject({ npcId: 200, vendor: true });
  });

  test("a quest sits in the zone where its agreed giver stands, with its agreed level", () => {
    const facts: WorldFacts = { ...empty, npcs: three(100, "Guard Orin", 1429, 40, 50), quests: ["a", "b", "c"].map((i) => quest(`install-${i}`, 7, 100, 4)) };
    expect(zoneContents(facts, data).get(1429)!.quests).toEqual([{ questId: 7, title: "Quest 7", level: 4, giverNpcId: 100, turnInNpcId: null }]);
    expect(zoneContents(facts, data).get(1411)!.quests).toEqual([]);
    const twoOnly: WorldFacts = { ...facts, quests: ["a", "b"].map((i) => quest(`install-${i}`, 7, 100)) };
    expect(zoneContents(twoOnly, data).get(1429)!.quests).toEqual([]);
  });

  test("an entrance goes to the zone the files put it in, over the rectangles, and on held-back ground it is not placed", () => {
    const city = { uiMapId: 1453, name: "Synthetic City", continentId: 0, bounds: { top: -8700, bottom: -8900, left: 900, right: 700 } };
    const placed: WorldMapData = {
      ...data, zones: [...data.zones, city],
      entrances: data.entrances.map((e) => (e.mapId === 34 ? { ...e, uiMapId: 1429 } : e.mapId === 389 ? { ...e, uiMapId: 2482 } : e)),
    };
    // The Stockade lies in the city's smaller rectangle too, but its ground is the forest's.
    const contents = zoneContents(empty, placed);
    expect(contents.get(1429)!.entrances.map((e) => e.names[0])).toEqual(["Synthetic Stockade"]);
    expect(contents.get(1453)!.entrances).toEqual([]);
    expect([...contents.values()].flatMap((c) => c.entrances).map((e) => e.names[0])).not.toContain("Synthetic Chasm");
  });

  test("an entrance goes to the smallest released zone around it; one in a held-back zone is not placed", () => {
    const contents = zoneContents(empty, data);
    expect(contents.get(1429)!.entrances).toEqual([{ names: ["Synthetic Stockade"], instanceMapIds: [34], raid: false, x: 19.8, y: 35.5, files: true, confirmed: null, lastSeen: null, bosses: [] }]);
    expect(contents.get(1411)!.entrances.map((e) => e.names[0])).toEqual(["Synthetic Chasm"]);
    expect([...contents.values()].flatMap((c) => c.entrances).map((e) => e.names[0])).not.toContain("Synthetic Spire");
  });

  test("players confirm an entrance the files place, list its bosses, and place one the files lack; 2 installs do neither", () => {
    const ids = ["a", "b", "c"].map((i) => `install-${i}`);
    const entrance = (installId: string, instanceMapId: number, name: string) => ({ installId, instanceMapId, name, instanceType: "party" as const, mapId: 1429, x: 60, y: 40 });
    const instances = {
      entrances: [...ids.map((i) => entrance(i, 34, "Synthetic Stockade")), ...ids.map((i) => entrance(i, 35, "Synthetic Vault"))],
      encounters: ids.map((installId) => ({ installId, encounterId: 9, name: "Warden", instanceMapId: 34, success: true, npcIds: [77] })),
    };
    const sightings = ids.map((installId) => ({ installId, objectId: 500, mapId: 1429, x: 12, y: 34, name: "Old Chest" }));
    const here = zoneContents(empty, data, { instances, sightings, objectNames: new Map([[500, "Old Chest"]]) }).get(1429)!;
    expect(here.entrances).toEqual([
      { names: ["Synthetic Stockade"], instanceMapIds: [34], raid: false, x: 19.8, y: 35.5, files: true, confirmed: 3, lastSeen: null, bosses: [{ encounterId: 9, name: "Warden", kills: 3, npcIds: [77], reporters: 3, lastSeen: null }] },
      { names: ["Synthetic Vault"], instanceMapIds: [35], raid: false, x: 60, y: 40, files: false, confirmed: 3, lastSeen: null, bosses: [] },
    ]);
    expect(here.treasures).toEqual([{ objectId: 500, name: "Old Chest", x: 12, y: 34, reporters: 3, lastSeen: null }]);
    expect(hasContent(zoneContents(empty, { ...data, entrances: [] }, { sightings }).get(1429))).toBe(true);
    const two = zoneContents(empty, data, { instances: { entrances: instances.entrances.filter((e) => e.installId !== "install-c"), encounters: instances.encounters.slice(0, 2) }, sightings: sightings.slice(0, 2) }).get(1429)!;
    expect(two.entrances).toEqual([{ names: ["Synthetic Stockade"], instanceMapIds: [34], raid: false, x: 19.8, y: 35.5, files: true, confirmed: null, lastSeen: null, bosses: [] }]);
    expect(two.treasures).toEqual([]);
  });

  test("held-back zones are not in the result at all", () => {
    expect([...zoneContents(empty, data).keys()]).toEqual([1411, 1429]);
  });

  test("hasContent is false for a zone with nothing, true with an entrance", () => {
    const contents = zoneContents(empty, { ...data, entrances: [] });
    expect(hasContent(contents.get(1429))).toBe(false);
    expect(hasContent(zoneContents(empty, data).get(1429))).toBe(true);
    expect(hasContent(undefined)).toBe(false);
  });
});

describe("the committed map data: the zone each entrance is in", () => {
  // What the game files say, independent of the zone rectangles, read from build 1.60.1.70532. "named" is the outdoor
  // AreaTable area named after the instance on the entrance's continent; "ground" is the AreaTable area of the
  // terrain chunk under Map.Corpse (the ghost-return spot), used when no named area leads to a zone. Either is walked
  // up ParentAreaID to the zone area a UiMapAssignment names.
  const expected: Record<string, string> = {
    "Shadowfang Keep": "Silverpine Forest", // named: Shadowfang Keep > Silverpine Forest
    "Stormwind Stockade": "Stormwind City", // ground: Stormwind City
    "Deadmines": "Westfall", // ground: The Dagger Hills > Westfall
    "Wailing Caverns": "The Barrens", // ground: The Barrens
    "Razorfen Kraul": "The Barrens", // named: Razorfen Kraul > The Barrens
    "Blackfathom Deeps": "Ashenvale", // named: Blackfathom Deeps > Ashenvale (the ghost spot's ground is Darkshore)
    "Uldaman": "Badlands", // named: Uldaman > Badlands (the ghost spot's ground is Loch Modan)
    "Gnomeregan": "Dun Morogh", // named: Gnomeregan > Dun Morogh
    "Sunken Temple": "Swamp of Sorrows", // ground: Swamp of Sorrows (its named area has no parent)
    "Razorfen Downs": "The Barrens", // named: Razorfen Downs > The Barrens
    "Scarlet Monastery": "Tirisfal Glades", // ground: Tirisfal Glades
    "Zul'Farrak": "Tanaris", // named: Zul'Farrak > Tanaris
    "Blackrock Spire": "Burning Steppes", // ground: Blackrock Mountain > Burning Steppes
    "Blackrock Depths": "Searing Gorge", // ground: Searing Gorge
    "Onyxia's Lair": "Dustwallow Marsh", // ground: Wyrmbog > Dustwallow Marsh
    "Scholomance": "Western Plaguelands", // ground: Caer Darrow > Western Plaguelands
    "Zul'Gurub": "Stranglethorn Vale", // named: Zul'Gurub > Stranglethorn Vale
    "Stratholme": "Eastern Plaguelands", // named: Stratholme > Eastern Plaguelands
    "Maraudon": "Desolace", // ground: Valley of Spears > Desolace
    "Ragefire Chasm": "Orgrimmar", // ground: Orgrimmar
    "Molten Core": "Burning Steppes", // ground: Blackrock Mountain > Burning Steppes
    "Dire Maul": "Feralas", // named: Dire Maul > Feralas
    "Blackwing Lair": "Burning Steppes", // ground: Blackrock Mountain > Burning Steppes
    "Ruins of Ahn'Qiraj": "Silithus", // named: Ruins of Ahn'Qiraj > Silithus
    "Ahn'Qiraj Temple": "Silithus", // ground: The Scarab Wall > Silithus
  };

  test("every entrance lands in the zone the game puts it in, not the smallest rectangle around it", () => {
    const zoneOf = new Map(WORLD_MAP.zones.map((z) => [z.uiMapId, z.name]));
    const found = Object.fromEntries(placedEntrances(WORLD_MAP).flatMap((e) => e.names.map((n) => [n, e.zone ? zoneOf.get(e.zone.mapId) : null])));
    expect(found).toEqual(expected);
  });
});
