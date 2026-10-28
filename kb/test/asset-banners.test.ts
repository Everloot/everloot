import { expect, test } from "vitest";
import { atlasPieces, blpSize, narrowCrop, ORIGINAL_MAP_MAX, planLoadingScreens, POI_ELEMENTS, racesInBuild } from "../src/assets/banners.js";
import type { Row, Rows } from "../src/talents/build-catalog.js";

const t = (rows: Row[]): Rows => new Map(rows.map((r, i) => [typeof r.ID === "number" ? r.ID : i + 1, r]));
const region = (n: number, s: number, w: number, e: number) => [n, w, 0, s, e, 0];

// A continent, an original dungeon, a later raid, an instance with no entrance, an unused map and a
// dungeon whose loading screen has no picture. Ids and file ids are invented.
const tables: Record<string, Rows> = {
  UiMap: t([{ ID: 13, Name_lang: "Eastern Kingdoms", Type: 2, ParentUiMapID: 947 }]),
  UiMapAssignment: t([{ ID: 1, UiMapID: 13, MapID: 0, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: region(4000, -4000, 4000, -4000) }]),
  Map: t([
    { ID: 0, MapName_lang: "Eastern Kingdoms", InstanceType: 0, LoadingScreenID: 4 },
    { ID: 36, MapName_lang: "Deadmines", InstanceType: 1, LoadingScreenID: 142, CorpseMapID: 0, Corpse: [-11000, 1500] },
    { ID: 2789, MapName_lang: "New Raid", InstanceType: 2, LoadingScreenID: 632, CorpseMapID: 0, Corpse: [100, 200] },
    { ID: 13, MapName_lang: "Test Dungeon", InstanceType: 1, LoadingScreenID: 61, CorpseMapID: 0, Corpse: [0, 0] },
    { ID: 35, MapName_lang: "<unused>StormwindPrison", InstanceType: 0, LoadingScreenID: 23 },
    { ID: 70, MapName_lang: "Uldaman", InstanceType: 1, LoadingScreenID: 144, CorpseMapID: 0, Corpse: [1, 1] },
  ]),
  LoadingScreens: t([
    { ID: 4, MainImageFileDataID: 7963776, NarrowScreenFileDataID: 0 },
    { ID: 142, MainImageFileDataID: 0, WideScreen169FileDataID: 0, WideScreenFileDataID: 500, NarrowScreenFileDataID: 400 },
    { ID: 632, MainImageFileDataID: 0, NarrowScreenFileDataID: 632000 },
    { ID: 144, MainImageFileDataID: 0, NarrowScreenFileDataID: 0 },
  ]),
  ChrRaces: t([
    { ID: 1, ClientFileString: "Human", Name_lang: "Human" },
    { ID: 5, ClientFileString: "Scourge", Name_lang: "Undead" },
    { ID: 95, ClientFileString: "Skyborne", Name_lang: "High Order Skyborne" },
    { ID: 10, ClientFileString: "BloodElf", Name_lang: "Blood Elf" },
  ]),
  UiTextureAtlas: t([{ ID: 1, FileDataID: 7312237 }, { ID: 2, FileDataID: 0 }]),
  UiTextureAtlasElement: t([{ ID: 10, Name: "logo-wow-forever-2x" }, { ID: 11, Name: "AllianceEmblem" }, { ID: 12, Name: "no-member" }, { ID: 13, Name: "no-file" }]),
  UiTextureAtlasMember: t([
    { ID: 1, UiTextureAtlasID: 1, UiTextureAtlasElementID: 10, CommittedLeft: 643, CommittedTop: 1, CommittedRight: 1283, CommittedBottom: 641 },
    { ID: 2, UiTextureAtlasID: 1, UiTextureAtlasElementID: 11, CommittedLeft: 1, CommittedTop: 1, CommittedRight: 111, CommittedBottom: 111 },
    { ID: 3, UiTextureAtlasID: 2, UiTextureAtlasElementID: 13, CommittedLeft: 0, CommittedTop: 0, CommittedRight: 1, CommittedBottom: 1 },
  ]),
};
const get = (n: string) => tables[n];

test("loading screens: continents and entered instances, widest picture first, later maps held back", () => {
  const { targets, skipped } = planLoadingScreens(get);
  // The newer single picture, else the classic 4:3 one; the widescreen columns are not read.
  expect(targets).toEqual([
    { mapId: 0, name: "Eastern Kingdoms", kind: "continent", heldBack: false, loadingScreenId: 4, fileId: 7963776, shape: "main" },
    { mapId: 36, name: "Deadmines", kind: "dungeon", heldBack: false, loadingScreenId: 142, fileId: 400, shape: "narrow" },
    { mapId: 2789, name: "New Raid", kind: "raid", heldBack: true, loadingScreenId: 632, fileId: 632000, shape: "narrow" },
  ]);
  expect(2789 > ORIGINAL_MAP_MAX && 36 <= ORIGINAL_MAP_MAX).toBe(true);
  // An instance with no entrance and an unused map are left out quietly; a loading screen without a picture is reported.
  expect(skipped).toEqual(["Uldaman (70): no loading screen picture in this build"]);
});

test("a classic picture keeps the scene inside its frame, below the logo, stretched back to 4:3", () => {
  expect(narrowCrop(2048, 2048)).toEqual({ crop: [0, 512, 2048, 1618], scaleX: 4 / 3 });
  // The size comes from the BLP2 header; anything else has none.
  const header = Buffer.alloc(148);
  header.write("BLP2", 0, "latin1");
  header.writeUInt32LE(2048, 12);
  header.writeUInt32LE(1024, 16);
  expect(blpSize(header)).toEqual({ width: 2048, height: 1024 });
  expect(blpSize(Buffer.from("not a blp file at all"))).toBeNull();
});

test("loading screens need their tables", () => {
  expect(() => planLoadingScreens((n) => (n === "LoadingScreens" ? undefined : get(n)))).toThrow(/client-extract --refresh/);
});

test("atlas pieces come with their file and rectangle; an element without a member or file is left out", () => {
  const pieces = atlasPieces(get, ["logo-wow-forever-2x", "AllianceEmblem", "no-member", "no-file", "not-there"]);
  expect([...pieces.keys()]).toEqual(["logo-wow-forever-2x", "AllianceEmblem"]);
  expect(pieces.get("logo-wow-forever-2x")).toEqual({ element: "logo-wow-forever-2x", fileId: 7312237, crop: [643, 1, 1283, 641] });
});

test("only the announced races the build has are extracted, matched by the client's file string", () => {
  expect(racesInBuild(get)).toEqual(["Human", "Undead", "Skyborne"]);
});

test("the map legend's icons name a legend category each, with at least one atlas element to try", () => {
  const categories = ["flight", "path", "dungeon", "raid", "zone", "vendor", "trainer", "quest", "service", "npc", "herb", "ore", "chest"];
  for (const [category, elements] of Object.entries(POI_ELEMENTS)) {
    expect(categories, category).toContain(category);
    expect(elements.length, category).toBeGreaterThan(0);
  }
  // Zones and flight paths are shapes on the map, never icons.
  expect(POI_ELEMENTS.zone).toBeUndefined();
  expect(POI_ELEMENTS.path).toBeUndefined();
  // A build without a piece gives nothing for its category; the site keeps its glyph.
  expect(atlasPieces((name) => tables[name], POI_ELEMENTS.dungeon!).size).toBe(0);
});
