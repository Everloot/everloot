import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { AssetChecksums, AssetManifest, buildAssetsFromTables, FRAME_ELEMENTS, ItemIndex, type Converter } from "../src/client-assets.js";
import type { FileStatus, TableSource } from "../src/client-extract.js";
import type { Row, Rows } from "../src/talents/build-catalog.js";
import type { BuildStamp } from "../src/talents/catalog.js";

const build: BuildStamp = { product: "wow_classic_beta", buildId: 70450, version: "1.60.1.70450", buildConfig: "b".repeat(32), definitions: null, extractedAt: "2026-10-17T00:00:00.000Z" };
const t = (rows: Row[]): Rows => new Map(rows.map((r, i) => [typeof r.ID === "number" ? r.ID : i + 1, r]));

// One made-up class with one tree and three talents. Ids are invented, none are from a real build.
// Talent 1001 has an icon that reads fine, 1002's icon is encrypted, 1003's is not in the build.
const tables: Record<string, Rows> = {
  ChrClasses: t([{ ID: 1, Name_lang: "Warrior" }]),
  ChrSpecialization: t([{ ID: 77, ClassID: 1, OrderIndex: 0 }]),
  SkillLine: t([{ ID: 10, DisplayName_lang: "Arms" }]),
  SkillRaceClassInfo: t([{ ID: 1, SkillID: 10, ClassMask: 1 }]),
  SkillLineXTraitTree: t([{ ID: 1, SkillLineID: 10, TraitTreeID: 900 }]),
  TraitTree: t([{ ID: 900 }]),
  TraitNodeGroupDisplayInfo: t([{ ID: 1, TraitNodeGroupID: 500, SkillLineID: 10, OrderIndex: 0, TraitTreeID: 900 }]),
  TraitNodeGroupXTraitNode: t([1, 2, 3].map((n) => ({ TraitNodeGroupID: 500, TraitNodeID: n }))),
  TraitNode: t([
    { ID: 1, TraitTreeID: 900, PosX: 1000, PosY: 2000, Type: 0 },
    { ID: 2, TraitTreeID: 900, PosX: 1600, PosY: 2000, Type: 0 },
    { ID: 3, TraitTreeID: 900, PosX: 2200, PosY: 2000, Type: 0 },
  ]),
  TraitNodeXTraitNodeEntry: t([1, 2, 3].map((n) => ({ TraitNodeID: n, TraitNodeEntryID: 10 + n, Index: 0 }))),
  TraitNodeEntry: t([1, 2, 3].map((n) => ({ ID: 10 + n, TraitDefinitionID: 100 + n, MaxRanks: 1 }))),
  TraitDefinition: t([1, 2, 3].map((n) => ({ ID: 100 + n, SpellID: 1000 + n }))),
  SpellName: t([1, 2, 3].map((n) => ({ ID: 1000 + n, Name_lang: `Talent ${n}` }))),
  Spell: t([
    { ID: 1001, Description_lang: "Deals $s1 damage for $d." },
    { ID: 1002, Description_lang: "Does $s1 and $q9." },
    { ID: 1003, Description_lang: null },
  ]),
  SpellMisc: t([
    { ID: 1, SpellID: 1001, DifficultyID: 0, SpellIconFileDataID: 5001, DurationIndex: 7, Attributes: [0x40, 0] },
    { ID: 2, SpellID: 1002, DifficultyID: 0, SpellIconFileDataID: 5002, DurationIndex: 0, Attributes: [0, 0] },
    { ID: 3, SpellID: 1003, DifficultyID: 0, SpellIconFileDataID: 5003, DurationIndex: 0, Attributes: [0, 0] },
  ]),
  SpellEffect: t([
    { ID: 1, SpellID: 1001, DifficultyID: 0, EffectIndex: 0, EffectBasePoints: 25, EffectDieSides: 0 },
    { ID: 2, SpellID: 1002, DifficultyID: 0, EffectIndex: 0, EffectBasePoints: 4, EffectDieSides: 0 },
  ]),
  SpellDuration: t([{ ID: 7, Duration: 10000 }]),
  UiTextureAtlas: t([{ ID: 1, FileDataID: 9000 }]),
  UiTextureAtlasElement: t([{ ID: 1, Name: "talents-node-circle-green" }, { ID: 2, Name: "talents-background-warrior-arms" }]),
  UiTextureAtlasMember: t([
    { ID: 1, UiTextureAtlasID: 1, UiTextureAtlasElementID: 1, CommittedLeft: 0, CommittedTop: 0, CommittedRight: 10, CommittedBottom: 10 },
    { ID: 2, UiTextureAtlasID: 1, UiTextureAtlasElementID: 2, CommittedLeft: 10, CommittedTop: 0, CommittedRight: 30, CommittedBottom: 10 },
  ]),
};

const status: Record<number, FileStatus> = { 5001: "present", 5002: "encrypted", 5003: "absent", 9000: "present" };
const source = (reads: number[]): TableSource => ({
  async read() { return null; },
  fileStatus: (id) => status[id] ?? "absent",
  async readFile(id) { reads.push(id); return { cKey: "k", buffer: Buffer.from(`blp ${id}`), encryptedBlocks: 0 }; },
});

// Stands in for Pillow: writes a small file and reports a size.
const fakeConvert: Converter = async (jobs) => jobs.map((j) => {
  writeFileSync(j.dst, `webp of ${j.src}`);
  return { dst: j.dst, ok: true, width: j.crop ? j.crop[2] - j.crop[0] : 64, height: j.crop ? j.crop[3] - j.crop[1] : 64, error: null };
});

async function run(convert = fakeConvert) {
  const reads: number[] = [];
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  const result = await buildAssetsFromTables({ get: (n) => tables[n], build, outDir, source: source(reads), convert });
  return { ...result, reads, outDir };
}

test("icons, tooltips and frame pieces come out with counts, and encrypted or missing files are skipped", async () => {
  const { manifest, reads, dir } = await run();
  expect(AssetManifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")))).toEqual(manifest);
  expect(manifest.label).toBe("found in game files, unconfirmed");
  expect(manifest.build.buildId).toBe(70450);
  expect(manifest.counts).toMatchObject({ iconsExtracted: 1, iconsEncrypted: 1, iconsAbsent: 1, iconsFailed: 0, framesExtracted: 2 });
  // The encrypted and the absent icon were never downloaded: only the readable icon and the atlas were.
  expect(reads.sort()).toEqual([5001, 9000]);
  expect(manifest.spells["101"]).toMatchObject({ spellId: 1001, name: "Talent 1", icon: "5001.webp", passive: true, description: { text: "Deals 25 damage for 10 sec.", unresolved: [] } });
  expect(manifest.spells["102"]).toMatchObject({ icon: null, passive: false, description: { text: "Does 4 and [?].", unresolved: ["$q9"] } });
  expect(manifest.spells["103"]).toMatchObject({ icon: null, description: null });
  expect(manifest.counts).toMatchObject({ tooltipsResolved: 1, tooltipsUnresolved: 1, tooltipsEmpty: 1 });
  expect(manifest.backgrounds["warrior:Arms"]).toEqual({ element: "talents-background-warrior-arms", nearest: false });
  expect(manifest.frames["talents-node-circle-green"]).toEqual({ file: "frames/talents-node-circle-green.webp", width: 10, height: 10 });
  // Hashes are in checksums.json, for the upload script only, and cover exactly the files written.
  const sums = AssetChecksums.parse(JSON.parse(readFileSync(join(dir, "checksums.json"), "utf8")));
  expect(Object.keys(sums.files)).toEqual(["frames/talents-background-warrior-arms.webp", "frames/talents-node-circle-green.webp", "icons/5001.webp"]);
  expect(sums.files["icons/5001.webp"].sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(manifest)).not.toMatch(/sha256/);
  // Everything else the window wants is reported, not invented.
  expect(manifest.missingFrames).toContain("talents-arrow-line-yellow");
  expect(manifest.missingFrames).not.toContain("talents-node-circle-green");
  expect(FRAME_ELEMENTS.filter((e) => !manifest.missingFrames.includes(e))).toEqual(["talents-node-circle-green"]);
});

test("a build that serves nothing for a file leaves it out and says so", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  const src: TableSource = { async read() { return null; }, fileStatus: () => "present", async readFile() { return { cKey: "k", buffer: Buffer.alloc(1), encryptedBlocks: 2 } } };
  const { manifest, checksums } = await buildAssetsFromTables({ get: (n) => tables[n], build, outDir, source: src, convert: fakeConvert });
  expect(manifest.counts).toMatchObject({ iconsExtracted: 0, iconsEncrypted: 3, framesExtracted: 0 });
  expect(Object.keys(checksums.files)).toEqual([]);
});

test("a file the converter cannot read is counted as failed and has no entry", async () => {
  const { manifest } = await run(async (jobs) => jobs.map((j) => ({ dst: j.dst, ok: false, width: 0, height: 0, error: "bad" })));
  expect(manifest.counts.iconsFailed).toBe(1);
  expect(manifest.spells["101"].icon).toBeNull();
});

test("the output holds only the manifest and converted files, and the working copies are gone", async () => {
  const { dir } = await run();
  expect(existsSync(join(dir, "_work"))).toBe(false);
});

test("a talent-only snapshot gives no items or maps, and says so in the manifest", async () => {
  const { manifest, items, privateDir, dir } = await run();
  expect(items).toBeNull();
  expect(privateDir).toBeNull();
  expect(existsSync(`${dir}-private`)).toBe(false);
  expect(manifest.maps).toEqual({});
  expect(manifest.classes.warrior).toEqual({ classId: 1, name: "Warrior", icon: null, trees: [{ name: "Arms", icon: null }] });
});

// The rest of the site: a class and tree icon, two professions (one a child tier, left out), a raid
// buff spell, two items (one with an encrypted icon) and a zone map of two tiles. Ids are invented.
const region = (n: number, s: number, w: number, e: number) => [n, w, 0, s, e, 0];
const site: Record<string, Rows> = {
  ...tables,
  ChrClasses: t([{ ID: 1, Name_lang: "Warrior", Filename: "WARRIOR", IconFileDataID: 6001 }]),
  SkillLine: t([
    { ID: 10, DisplayName_lang: "Arms", SpellIconFileID: 6002 },
    { ID: 171, DisplayName_lang: "Alchemy", CategoryID: 11, ParentSkillLineID: 0, SpellIconFileID: 6003 },
    { ID: 2485, DisplayName_lang: "Classic Alchemy", CategoryID: 11, ParentSkillLineID: 171, SpellIconFileID: 6003 },
    { ID: 185, DisplayName_lang: "Cooking", CategoryID: 9, ParentSkillLineID: 0, SpellIconFileID: 0 },
  ]),
  SpellMisc: t([...tables.SpellMisc.values(), { ID: 4, SpellID: 6673, DifficultyID: 0, SpellIconFileDataID: 6004 }]),
  ItemSparse: t([
    { ID: 25, Display_lang: "Worn Shortsword", OverallQualityID: 1, ItemLevel: 2, InventoryType: 13 },
    { ID: 600, Display_lang: "Test Helm", OverallQualityID: 3, ItemLevel: 30, InventoryType: 1 },
  ]),
  Item: t([{ ID: 25, IconFileDataID: 6005, ClassID: 2, SubclassID: 7 }, { ID: 600, IconFileDataID: 6006, ClassID: 4, SubclassID: 4 }]),
  Map: t([{ ID: 0, MapName_lang: "Eastern Kingdoms" }]),
  UiMap: t([
    { ID: 13, Name_lang: "Eastern Kingdoms", Type: 2, ParentUiMapID: 947 },
    { ID: 1429, Name_lang: "Elwynn Forest", Type: 3, ParentUiMapID: 13 },
  ]),
  UiMapAssignment: t([
    { ID: 1, UiMapID: 13, MapID: 0, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: region(4000, -4000, 4000, -4000) },
    { ID: 2, UiMapID: 1429, MapID: 0, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: region(500, -500, 1000, 0) },
  ]),
  UiMapXMapArt: t([{ ID: 1, UiMapID: 1429, UiMapArtID: 51, PhaseID: 0 }]),
  UiMapArt: t([{ ID: 51, UiMapArtStyleID: 1 }]),
  UiMapArtStyleLayer: t([{ ID: 1, UiMapArtStyleID: 1, LayerIndex: 0, LayerWidth: 500, LayerHeight: 256, TileWidth: 256, TileHeight: 256 }]),
  UiMapArtTile: t([0, 1].map((col) => ({ UiMapArtID: 51, LayerIndex: 0, RowIndex: 0, ColIndex: col, FileDataID: 7000 + col }))),
};
const siteStatus: Record<number, FileStatus> = { ...status, 6001: "present", 6002: "present", 6003: "present", 6004: "present", 6005: "present", 6006: "encrypted", 7000: "present", 7001: "present" };

test("the site's other art: class, tree, profession, buff and item icons, item shards and a zone map", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  const jobs: Parameters<Converter>[0] = [];
  const convert: Converter = async (batch) => { jobs.push(...batch); return fakeConvert(batch); };
  const src: TableSource = { ...source([]), fileStatus: (id) => siteStatus[id] ?? "absent" };
  const { manifest, dir, privateDir, items, checksums } = await buildAssetsFromTables({ get: (n) => site[n], build, outDir, source: src, convert, buffSpells: [6673, 1] });
  expect(AssetManifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")))).toEqual(manifest);

  expect(manifest.classes.warrior).toEqual({ classId: 1, name: "Warrior", icon: "6001.webp", trees: [{ name: "Arms", icon: "6002.webp" }] });
  expect(manifest.professions).toEqual({
    alchemy: { skillLineId: 171, name: "Alchemy", icon: "6003.webp" },
    cooking: { skillLineId: 185, name: "Cooking", icon: null },
  });
  // A listed spell with no icon row is left out, not given one.
  expect(manifest.spellIcons).toEqual({ "6673": "6004.webp" });

  // Items go to the private folder only: the public folder and its manifest never name an item.
  expect(privateDir).toBe(`${dir}-private`);
  expect(existsSync(join(dir, "items"))).toBe(false);
  expect(readFileSync(join(dir, "manifest.json"), "utf8")).not.toMatch(/Worn Shortsword|Test Helm|items\//);
  expect(Object.keys(checksums.files).some((f) => f.startsWith("items"))).toBe(false);
  expect(ItemIndex.parse(JSON.parse(readFileSync(join(privateDir!, "items.json"), "utf8")))).toEqual(items);
  expect(items).toMatchObject({ shardSize: 512, count: 2, build: { version: "1.60.1.70450" } });
  // The record notes its icon only when the icon was extracted; the encrypted one has none.
  const shard0 = JSON.parse(readFileSync(join(privateDir!, "items", "0.json"), "utf8"));
  const shard1 = JSON.parse(readFileSync(join(privateDir!, "items", "1.json"), "utf8"));
  expect(shard0["25"]).toMatchObject({ n: "Worn Shortsword", i: 6005 });
  expect(shard1["600"].i).toBeUndefined();
  expect(items!.shards["0"]).toMatchObject({ file: "items/0.json", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  expect(manifest.counts).toMatchObject({ itemsRecorded: 2, itemsWithIcon: 1 });

  // The zone map: its two tiles stitched and cut to the picture, with the rectangle it covers, and a small copy. The continent had no art.
  expect(manifest.maps["1429"]).toMatchObject({
    file: "maps/1429.webp", kind: "zone", name: "Elwynn Forest", heldBack: false, rect: { left: 1000, top: 500, right: 0, bottom: -500 }, width: 500, height: 256,
    small: { file: "maps/1429-small.webp" },
  });
  expect(jobs.find((j) => j.dst.endsWith("1429-small.webp"))).toMatchObject({ max: 320, quality: 82 });
  expect(Object.keys(checksums.files).filter((f) => f.startsWith("maps/"))).toEqual(["maps/1429-small.webp", "maps/1429.webp"]);
  expect(manifest.skippedMaps).toEqual(["Eastern Kingdoms (13): no art in this build"]);
  const mapJob = jobs.find((j) => j.dst.endsWith("1429.webp"))!;
  expect(mapJob).toMatchObject({ tile: [256, 256], crop: [0, 0, 500, 256], quality: 82 });
  expect(mapJob.tiles!.map((x) => [x.row, x.col])).toEqual([[0, 0], [0, 1]]);
  // Icons are lossy and capped; frame pieces stay lossless.
  expect(jobs.find((j) => j.dst.endsWith("icons/6001.webp") || j.dst.endsWith("icons\\6001.webp"))).toMatchObject({ max: 128, quality: 90 });
  expect(jobs.find((j) => /talents-node-circle-green/.test(j.dst))?.quality).toBeUndefined();
});

test("database art: icons of the spells the relations point at and of pet families, by id", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  const withFamily: Record<string, Rows> = {
    ...site,
    CreatureFamily: t([{ ID: 1, Name_lang: "Wolf", IconFileID: 6007 }, { ID: 2, Name_lang: "Cat", IconFileID: 6008 }, { ID: 28, Name_lang: "Remote Control", IconFileID: 0 }]),
  };
  const src: TableSource = { ...source([]), fileStatus: (id) => ({ ...siteStatus, 6007: "present", 6008: "encrypted" } as Record<number, FileStatus>)[id] ?? "absent" };
  // 1001 is a talent's spell with a readable icon; 6673 a buff spell; 9999 has no SpellMisc row.
  const { manifest } = await buildAssetsFromTables({ get: (n) => withFamily[n], build, outDir, source: src, convert: fakeConvert, buffSpells: [6673], relationSpells: [1001, 1002, 9999] });
  // 1002's icon is encrypted, so it gets none; a spell with no icon row is left out.
  expect(manifest.spellIcons).toEqual({ "1001": "5001.webp", "6673": "6004.webp" });
  // The cat's icon is encrypted and Remote Control has none.
  expect(manifest.familyIcons).toEqual({ "1": "6007.webp" });
});

test("collection art: currency and companion pet icons by id, and the icon of each mount's spell", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  const withCollections: Record<string, Rows> = {
    ...site,
    CurrencyTypes: t([{ ID: 515, Name_lang: "Darkmoon Prize Ticket", InventoryIconFileID: 6007 }, { ID: 1792, Name_lang: "Honor Points", InventoryIconFileID: 0 }]),
    BattlePetSpecies: t([{ ID: 39, CreatureID: 2671, IconFileDataID: 6008 }, { ID: 40, CreatureID: 7385, IconFileDataID: 6009 }]),
    Mount: t([{ ID: 6, Name_lang: "Brown Horse", SourceSpellID: 1001 }]),
  };
  const src: TableSource = { ...source([]), fileStatus: (id) => ({ ...siteStatus, 6007: "present", 6008: "present", 6009: "encrypted" } as Record<number, FileStatus>)[id] ?? "absent" };
  const { manifest } = await buildAssetsFromTables({ get: (n) => withCollections[n], build, outDir, source: src, convert: fakeConvert });
  // Honor Points has no icon file and the second pet's is encrypted.
  expect(manifest.currencyIcons).toEqual({ "515": "6007.webp" });
  expect(manifest.petIcons).toEqual({ "39": "6008.webp" });
  // The mount's spell gets its icon with no relation or buff list asking for it.
  expect(manifest.spellIcons).toEqual({ "1001": "5001.webp" });
});

test("a map with an encrypted tile is skipped with the reason, never drawn with a hole", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  const src: TableSource = { ...source([]), fileStatus: (id) => (id === 7001 ? "encrypted" : siteStatus[id] ?? "absent") };
  const { manifest } = await buildAssetsFromTables({ get: (n) => site[n], build, outDir, source: src, convert: fakeConvert });
  expect(manifest.maps).toEqual({});
  expect(manifest.skippedMaps).toContain("Elwynn Forest (1429): tile file 7001 is encrypted");
  expect(manifest.counts.mapsSkipped).toBe(2);
});

// Banner art: a continent and a dungeon with loading screens (the dungeon's picture is encrypted), two
// races (one unannounced, left out), one faction emblem, the 1x logo only, and a buff spell's tooltip.
const banners: Record<string, Rows> = {
  ...site,
  Map: t([
    { ID: 0, MapName_lang: "Eastern Kingdoms", InstanceType: 0, LoadingScreenID: 4 },
    { ID: 36, MapName_lang: "Deadmines", InstanceType: 1, LoadingScreenID: 142, CorpseMapID: 0, Corpse: [-11000, 1500] },
    { ID: 2789, MapName_lang: "New Raid", InstanceType: 2, LoadingScreenID: 4, CorpseMapID: 0, Corpse: [100, 200] },
    { ID: 70, MapName_lang: "Uldaman", InstanceType: 1, LoadingScreenID: 144, CorpseMapID: 0, Corpse: [1, 1] },
  ]),
  LoadingScreens: t([{ ID: 4, MainImageFileDataID: 8000 }, { ID: 142, NarrowScreenFileDataID: 8001 }, { ID: 144, NarrowScreenFileDataID: 8002 }]),
  ChrRaces: t([{ ID: 1, ClientFileString: "Human", Name_lang: "Human" }, { ID: 10, ClientFileString: "BloodElf", Name_lang: "Blood Elf" }]),
  SpellName: t([...tables.SpellName.values(), { ID: 6673, Name_lang: "Battle Shout" }]),
  Spell: t([...tables.Spell.values(), { ID: 6673, Description_lang: "Raises attack power by $s1." }]),
  SpellEffect: t([...tables.SpellEffect.values(), { ID: 9, SpellID: 6673, DifficultyID: 0, EffectIndex: 0, EffectBasePoints: 20 }]),
  UiTextureAtlas: t([{ ID: 1, FileDataID: 9000 }, { ID: 2, FileDataID: 9100 }]),
  UiTextureAtlasElement: t([
    ...tables.UiTextureAtlasElement.values(),
    { ID: 20, Name: "raceicon128-human-female" }, { ID: 21, Name: "raceicon128-human-male" }, { ID: 22, Name: "raceicon128-bloodelf-male" },
    { ID: 23, Name: "AllianceEmblem" }, { ID: 24, Name: "logo-wow-forever" },
  ]),
  UiTextureAtlasMember: t([
    ...tables.UiTextureAtlasMember.values(),
    ...[20, 21, 22, 23].map((el, i) => ({ ID: 10 + i, UiTextureAtlasID: 2, UiTextureAtlasElementID: el, CommittedLeft: i * 128, CommittedTop: 0, CommittedRight: i * 128 + 128, CommittedBottom: 128 })),
    { ID: 20, UiTextureAtlasID: 2, UiTextureAtlasElementID: 24, CommittedLeft: 0, CommittedTop: 128, CommittedRight: 320, CommittedBottom: 448 },
  ]),
};
const bannerStatus: Record<number, FileStatus> = { ...siteStatus, 8000: "present", 8001: "encrypted", 8002: "present", 9100: "present" };
/** A classic loading screen's file: a BLP2 header saying 2048 x 2048. */
const classic = Buffer.alloc(148);
classic.write("BLP2", 0, "latin1");
classic.writeUInt32LE(2048, 12);
classic.writeUInt32LE(2048, 16);

test("banner art: loading screens per map, race and faction emblems, the game's logo and buff tooltips", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  const jobs: Parameters<Converter>[0] = [];
  const convert: Converter = async (batch) => { jobs.push(...batch); return fakeConvert(batch); };
  const plain = source([]);
  const src: TableSource = {
    ...plain, fileStatus: (id) => bannerStatus[id] ?? "absent",
    readFile: async (id) => (id === 8002 ? { cKey: "k", buffer: classic, encryptedBlocks: 0 } : plain.readFile!(id)),
  };
  const { manifest, dir, checksums } = await buildAssetsFromTables({ get: (n) => banners[n], build, outDir, source: src, convert, buffSpells: [6673] });
  expect(AssetManifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")))).toEqual(manifest);

  // Two maps share one picture, converted once; the later raid is held back; the encrypted picture is skipped.
  expect(manifest.loadingScreens["0"]).toMatchObject({ file: "loading/8000.webp", small: { file: "loading/8000-small.webp" }, kind: "continent", name: "Eastern Kingdoms", heldBack: false, loadingScreenId: 4 });
  expect(manifest.loadingScreens["2789"]).toMatchObject({ file: "loading/8000.webp", kind: "raid", heldBack: true });
  expect(manifest.loadingScreens["36"]).toBeUndefined();
  expect(manifest.skippedBanners).toContain("Deadmines (36): picture file 8001 is encrypted");
  // The newer picture loses its empty bands; the classic one is cut to the scene below its logo and stretched back to 4:3.
  expect(jobs.filter((j) => /loading/.test(j.dst)).map((j) => [j.dst.split(/[\\/]/).pop(), j.max, j.quality, j.trim, j.crop, j.scaleX])).toEqual([
    ["8000.webp", 1600, 80, true, null, null], ["8000-small.webp", 640, 80, true, null, null],
    ["8002.webp", 1600, 80, false, [0, 512, 2048, 1618], 4 / 3], ["8002-small.webp", 640, 80, false, [0, 512, 2048, 1618], 4 / 3],
  ]);
  expect(manifest.loadingScreens["70"]).toMatchObject({ file: "loading/8002.webp", kind: "dungeon", heldBack: false });

  // Only the announced race; its icons and the faction emblem are cut out of their atlas; the missing emblem is reported.
  expect(manifest.races).toEqual({
    human: { name: "Human", female: { file: "emblems/raceicon128-human-female.webp", width: 128, height: 128 }, male: { file: "emblems/raceicon128-human-male.webp", width: 128, height: 128 } },
  });
  expect(manifest.factions).toEqual({ alliance: { file: "emblems/AllianceEmblem.webp", width: 128, height: 128 } });
  expect(manifest.skippedBanners).toContain("HordeEmblem: not in this build's atlas tables");
  expect(JSON.stringify(manifest)).not.toMatch(/bloodelf|Blood Elf/i);

  // The sharper logo is not in the build, so the 1x piece is used, with the file it came from.
  expect(manifest.logo).toEqual({ file: "logo/logo-wow-forever.webp", width: 320, height: 320, element: "logo-wow-forever", fileDataId: 9100 });
  expect(jobs.find((j) => /logo-wow-forever/.test(j.dst))).toMatchObject({ crop: [0, 128, 320, 448], quality: 90 });
  expect(manifest.counts).toMatchObject({ loadingScreensExtracted: 3, loadingScreensSkipped: 1, emblemsExtracted: 3, logoExtracted: 1 });

  expect(manifest.spellTips["6673"]).toEqual({ name: "Battle Shout", description: { text: "Raises attack power by 20.", unresolved: [] } });
  expect(Object.keys(checksums.files).filter((f) => /^(loading|emblems|logo)\//.test(f))).toEqual([
    "emblems/AllianceEmblem.webp", "emblems/raceicon128-human-female.webp", "emblems/raceicon128-human-male.webp",
    "loading/8000-small.webp", "loading/8000.webp", "loading/8002-small.webp", "loading/8002.webp", "logo/logo-wow-forever.webp",
  ]);
});

test("a build without the logo has none, and nothing stands in for it", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  const { manifest, notes } = await buildAssetsFromTables({ get: (n) => site[n], build, outDir, source: { ...source([]), fileStatus: (id) => siteStatus[id] ?? "absent" }, convert: fakeConvert });
  expect(manifest.logo).toBeNull();
  expect(manifest.loadingScreens).toEqual({});
  expect(notes).toContain("logo: none in this build's files (no stand-in is used)");
});

test("it refuses a snapshot that lacks the atlas tables", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "everloot-assets-"));
  await expect(buildAssetsFromTables({ get: (n) => (n === "UiTextureAtlas" ? undefined : tables[n]), build, outDir, source: source([]), convert: fakeConvert }))
    .rejects.toThrow(/client-extract --refresh/);
});
