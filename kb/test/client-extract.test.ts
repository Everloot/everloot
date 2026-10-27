import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { CASC_LIBRARY, extractTables, iconIds, openCdn, pinDefinitions, pinnedFetch, probeFiles, type TableSource } from "../src/client-extract.js";
import { CLIENT_TABLES } from "../src/client-snapshot.js";

// A stand-in for the CDN library, so openCdn can be checked without the network. Every key-loading
// method throws: openCdn must never call one.
const lib = vi.hoisted(() => {
  const noKeys = () => { throw new Error("decryption keys must never be loaded"); };
  const blocks = [
    { offset: 0, size: 64, blockIndex: 3, keyName: "FA505078126ACB3E" },
    { offset: 64, size: 64, blockIndex: 4, keyName: "FA505078126ACB3E" },
  ];
  const fetched: { cKey: string; allowMissingKey: unknown }[] = [];
  const readers: { buffer: unknown; blocks: unknown }[] = [];
  class CASCClient {
    static LocaleFlags = { enUS: 2, deDE: 32 };
    static async getProductVersion(region: string, product: string) {
      return { Region: region, BuildConfig: "84bea4233331e390fda8724c6f91ffa5", CDNConfig: "", BuildId: "70450", VersionsName: "1.60.1.70450", ProductConfig: "", product };
    }
    keys = { set: noKeys };
    async init() {}
    loadRemoteTACTKeys = noKeys;
    loadTACTKeys = noKeys;
    loadBroadcastTACTKeys = noKeys;
    loadRemoteListFile = noKeys;
    getContentKeysByFileDataID(fileDataID: number) {
      return [{ cKey: `de${fileDataID}`, localeFlags: 32 }, { cKey: `en${fileDataID}`, localeFlags: 2 }];
    }
    async getFileByContentKey(cKey: string, allowMissingKey: unknown) {
      fetched.push({ cKey, allowMissingKey });
      return { type: "partial", buffer: Buffer.from(cKey), blocks };
    }
  }
  class WDCReader {
    constructor(buffer: unknown, blocksArg: unknown) { readers.push({ buffer, blocks: blocksArg }); }
  }
  const DBDParser = {
    async parse() {
      return { getAllIDs: () => [19019], getRowData: (id: number) => ({ ID: id }) };
    },
  };
  return { CASCClient, WDCReader, DBDParser, blocks, fetched, readers };
});
vi.mock("@rhyster/wow-casc-dbc", () => ({ CASCClient: lib.CASCClient, WDCReader: lib.WDCReader, DBDParser: lib.DBDParser }));

const fake = (present: Record<number, { rows: [number, Record<string, unknown>][]; encryptedBlocks?: number }>): TableSource => ({
  async read(fileDataID) {
    const t = present[fileDataID];
    return t ? { cKey: `k${fileDataID}`, encryptedBlocks: t.encryptedBlocks ?? 0, rows: new Map(t.rows) } : null;
  },
});

test("reads each known table by file id, keeping its content key and skipped encrypted blocks", async () => {
  const source = fake({
    [CLIENT_TABLES.ItemSparse]: { rows: [[19019, { ID: 19019 }]], encryptedBlocks: 31 },
    [CLIENT_TABLES.Item]: { rows: [[19019, { ID: 19019 }]] },
    [CLIENT_TABLES.SpellName]: { rows: [[133, { ID: 133 }]], encryptedBlocks: 14 },
    [CLIENT_TABLES.Spell]: { rows: [[133, { ID: 133 }]] },
  });
  const { tables, missing } = await extractTables(source);
  expect(missing.every((m) => m.reason === "not in this build")).toBe(true);
  expect(tables.map((t) => [t.table, t.fileDataID, t.cKey, t.rows.size, t.encryptedBlocks])).toEqual([
    ["ItemSparse", 1572924, "k1572924", 1, 31],
    ["Item", 841626, "k841626", 1, 0],
    ["SpellName", 1990283, "k1990283", 1, 14],
    ["Spell", 1140089, "k1140089", 1, 0],
  ]);
});

test("the talent and spell effect tables are read by the file data ids WoWDBDefs lists for them", () => {
  expect(CLIENT_TABLES).toMatchObject({
    TraitTree: 4420305, TraitNode: 4420297, TraitNodeEntry: 4420298, TraitDefinition: 4420327, TraitEdge: 4420308,
    TraitCond: 4543085, TraitNodeGroup: 4420300, SkillLineXTraitTree: 4505477, ChrSpecialization: 1343390,
    ChrClasses: 1361031, SpellEffect: 1140088,
  });
});

test("the coverage tables are read by the file data ids the WoWDBDefs manifest lists for them", () => {
  // manifest.json at WoWDBDefs b9a63096cdd9, field db2FileDataID.
  expect(CLIENT_TABLES).toMatchObject({
    ItemClass: 1140189, ItemSubClass: 1261604, ItemSet: 1343609, SkillLineAbility: 1266278,
    SpellItemEnchantment: 1362771, SpellReagents: 841946, AreaTable: 1353545, ChrRaces: 1305311,
    Faction: 1361972, CharTitles: 1349054, Languages: 1135325, CurrencyTypes: 1095531,
    CreatureFamily: 1351351, CreatureType: 1131315, Holidays: 996357, Toy: 988200,
    BattlePetSpecies: 841622, Creature: 841631, GameObjects: 841620, QuestV2: 1139443,
  });
});

test("the instance level range table is read by the file data id the WoWDBDefs manifest lists for it", () => {
  // manifest.json at WoWDBDefs b9a63096cdd9, field db2FileDataID.
  expect(CLIENT_TABLES).toMatchObject({ ContentTuning: 1962930 });
});

test("the W0 tables are read by the file data ids the WoWDBDefs manifest lists for them", () => {
  // manifest.json at WoWDBDefs b9a63096cdd9, field db2FileDataID.
  expect(CLIENT_TABLES).toMatchObject({
    HolidayNames: 996359, HolidayDescriptions: 996360, HolidayXTimeEvent: 6905813,
    QuestInfo: 1120960, QuestSort: 1134585,
    GameObjectDisplayInfo: 1266277, GameObjectArtKit: 1266737,
  });
});

test("the W1 tables are read by the file data ids the WoWDBDefs manifest lists for them", () => {
  // manifest.json at WoWDBDefs b9a63096cdd9, field db2FileDataID.
  expect(CLIENT_TABLES).toMatchObject({
    LFGDungeons: 1361033, JournalInstance: 1237438, JournalEncounter: 1240336, JournalTier: 1349056,
    DungeonEncounter: 1347279, MapDifficulty: 1367868, AreaGroupMember: 1093406,
    ItemExtendedCost: 801681, ItemCurrencyCost: 801670, ItemLimitCategory: 1237440, ItemBagFamily: 1278179,
    ItemNameDescription: 1332559, ItemEffect: 969941, ItemXItemEffect: 3177687,
    SpellCastTimes: 1134089, SpellCooldowns: 1139924, SpellRange: 1146820, SpellLevels: 1140079,
    Mount: 921760, MountXDisplay: 1576117, MountType: 1114674, MountTypeXCapability: 1114715,
    MountXSpellVisualKitPicker: 3989477,
    Profession: 4508544, ProfessionEffect: 4505297, ProfessionEffectType: 4556715, ProfessionTrait: 4505298,
    ProfessionTraitXEffect: 4505494, ProfessionTraitXLabel: 4505299,
  });
});

test("the W2 tables are read by the file data ids the WoWDBDefs manifest lists for them", () => {
  // manifest.json at WoWDBDefs b9a63096cdd9, field db2FileDataID.
  expect(CLIENT_TABLES).toMatchObject({
    ItemAppearance: 982462, ItemAppearanceXUiCamera: 1248126, ItemDisplayInfo: 1266429,
    ItemDisplayInfoMaterialRes: 1280614, ItemModifiedAppearance: 982457, ItemModifiedAppearanceExtra: 1278399,
    ItemRangedDisplayInfo: 1270315, ItemVisuals: 1343605, ItemVisualsXEffect: 3043873,
    ItemXBonusTree: 987133, ItemBonus: 959070, ItemBonusTreeNode: 987134, ItemDisenchantLoot: 1134087,
    ItemSearchName: 1273408, ItemSetSpell: 1314689, ItemChildEquipment: 1247926,
    TransmogSet: 1376213, TransmogSetGroup: 1576116, TransmogSetItem: 1376212, TransmogIllusion: 3580450,
    QuestLine: 973430, QuestLineXQuest: 973441, QuestPOIBlob: 1251882, QuestPOIPoint: 1251883,
    QuestMoneyReward: 1139047, QuestXP: 1139378, QuestFactionReward: 1282622,
    BattlePetAbility: 841610, BattlePetAbilityEffect: 801575, BattlePetAbilityState: 801576,
    BattlePetAbilityTurn: 801577, BattlePetBreedQuality: 801578, BattlePetBreedState: 801579,
    BattlePetEffectProperties: 801580, BattlePetSpeciesState: 801581, BattlePetSpeciesXAbility: 801582,
    BattlePetState: 801583, BattlePetVisual: 801584, Heirloom: 1097696, PetLoyalty: 2179604,
    MountCapability: 1114709,
    FactionGroup: 1343595, FactionTemplate: 1361579,
    WorldMapOverlay: 1134579, WorldMapOverlayTile: 1957212, WMOAreaTable: 1355528,
    ZoneIntroMusicTable: 1310251, ZoneMusic: 1310254, ZoneLight: 1310253, ZoneLightPoint: 1310256,
    AreaPOI: 1000630, AreaPOIState: 1000631,
    Achievement: 1260179, Achievement_Category: 1324299,
    CurrencyCategory: 1125667, CurrencyContainer: 1934603,
    TaxiNodes: 1068100, TaxiPath: 1067802, TaxiPathNode: 1000437,
    CreatureDifficulty: 879282, CreatureImmunities: 1131322, CreatureMovementInfo: 1125666,
    CreatureSoundData: 1344466, CreatureXDisplayInfo: 1864302,
    ChrClassesXPowerTypes: 1121420, ChrRaceRacialAbility: 3507821,
    LoreText: 3311370, LoreTextPublic: 3479846, ZoneStory: 1797864,
  });
});

test("the W3 tables are read by the file data ids the WoWDBDefs manifest lists for them", () => {
  // manifest.json at WoWDBDefs b9a63096cdd9, field db2FileDataID.
  expect(CLIENT_TABLES).toMatchObject({
    ChrCustomization: 1611874, ChrCustomizationBoneSet: 3460181, ChrCustomizationCategory: 3526439,
    ChrCustomizationChoice: 3450554, ChrCustomizationCondModel: 3460182, ChrCustomizationConversion: 3463337,
    ChrCustomizationDisplayInfo: 3593032, ChrCustomizationElement: 3512765, ChrCustomizationGeoset: 3456171,
    ChrCustomizationGlyphPet: 5347591, ChrCustomizationMaterial: 3459652, ChrCustomizationOption: 3384247,
    ChrCustomizationReq: 3450453, ChrCustomizationReqChoice: 3580359, ChrCustomizationSkinnedModel: 3460183,
    ChrCustomizationVisReq: 4724136, ChrCustomizationVoice: 4672833,
    ChrModel: 3384313, ChrModelMaterial: 3566562, ChrModelTextureLayer: 3548976,
    ChrModelAltVariant: 8068383, ChrModelAltVariantChoice: 8068384, ChrModelAltVariantOption: 8068385,
    ChrRacesCreateScreenIcon: 4566929, ChrRaceXChrModel: 3490304, ChrClassUIChrModelInfo: 3754770,
    ChrClassUIDisplay: 1316515, ChrClassRaceSex: 1306188, ChrClassTitle: 1267497,
    ChrSelectBackgroundCDI: 4195187, CharacterFacialHairStyles: 1369752,
    CharacterLoadout: 1344281, CharacterLoadoutItem: 1302846, CharacterLoadoutPet: 3724843,
    CreatureDisplayInfo: 1108759, CreatureDisplayInfoCond: 1332686, CreatureDisplayInfoCondXChoice: 3670439,
    CreatureDisplayInfoEvt: 1586882, CreatureDisplayInfoExtra: 1264997, CreatureDisplayInfoGeosetData: 1720141,
    CreatureDisplayInfoOption: 3692043, CreatureDisplayInfoTrn: 1146698, CreatureDisplayXUIModelScene: 5551196,
    CreatureModelData: 1365368, HelmetAnimScaling: 1348283, HelmetGeosetData: 2821752,
    AnimationData: 1375431, AnimKit: 1304323, AnimKitBoneSet: 1375433, AnimKitBoneSetAlias: 1266937,
    AnimKitConfig: 1300872, AnimKitConfigBoneSet: 1300873, AnimKitPriority: 1266540,
    AnimKitReplacement: 1559807, AnimKitSegment: 1304324, AnimReplacement: 1301100, AnimReplacementSet: 1284817,
    BoneWindModifierModel: 1467254, BoneWindModifiers: 1416756,
    CameraEffect: 1117695, CameraEffectEntry: 1117696, CameraMode: 1343308,
    LiquidMaterial: 1132538, LiquidObject: 1308058, LiquidTypeXFFTTile: 7489861, LiquidTypeXTexture: 2261065, ModelAnimCloakDampening: 1465904, ModelFileData: 1337833,
    ModelProperties: 2060639, ModelRibbonQuality: 1399953,
    ModelSound: 5393273, ModelSoundAnimEntry: 5393274, ModelSoundEntry: 5393275, ModelSoundOverride: 5393276,
    ModelSoundSettings: 5682517, ModelSoundTagEntry: 5393277,
    AnimaCable: 3286805, AnimaCylinder: 3286804, AnimaMaterial: 3153990,
    SoundKit: 1237434, SoundKitAdvanced: 1237436, SoundKitChild: 1307289, SoundKitEntry: 1237435,
    SoundKitFallback: 1307288, SoundAmbience: 1310628, SoundAmbienceFlavor: 1267065, SoundBus: 1310246,
    SoundBusOverride: 1598732, SoundEmitterPillPoints: 1092317, SoundEmitters: 1092316,
    SoundEnvelope: 1693131, SoundFilter: 1271601, SoundFilterElem: 1267066, SoundMixGroup: 4618887,
    SoundOverride: 1266542, SoundParameter: 3405441, SoundProviderPreferences: 1279417,
    SoundWaterfallEmitter: 4756178, MusicOverride: 5161908,
    TraitCondAccountElement: 5890759, TraitDefinitionEffectPoints: 4536895, TraitTreeLoadoutEntry: 4669509,
  });
});

test("the W4 tables are read by the file data ids the WoWDBDefs manifest lists for them", () => {
  // manifest.json at WoWDBDefs b9a63096cdd9, field db2FileDataID.
  expect(CLIENT_TABLES).toMatchObject({
    BankBagSlotPrices: 1284819, BankTab: 5242411, StableSlotPrices: 2179613,
    CharBaseInfo: 1343386, CharBaseSection: 1375798, CharHairGeosets: 1256914,
    CharComponentTextureLayouts: 1360262, CharComponentTextureSections: 1360263,
    CharStartKit: 3055696, ComponentTextureFileData: 1278239, ComponentModelFileData: 1349053,
    GuildEmblem: 2734754, GuildTabardBackground: 2909769, GuildTabardBorder: 2920485, GuildTabardEmblem: 2910470,
    GuildShirtBackground: 2921008, GuildShirtBorder: 2921475,
    GuildColorBackground: 1286526, GuildColorBorder: 1286527, GuildColorEmblem: 1286525,
    BarberShopStyle: 1237437, LevelExperience: 7880197, Exhaustion: 1343313,
    DurabilityCosts: 1283019, DurabilityQuality: 1130268,
    MailTemplate: 1240344, AuctionHouse: 1237439,
    Emotes: 1343602, EmotesText: 1347273, EmotesTextSound: 1286524, EmotesTextData: 1283024,
    Lock: 1343608, LockType: 1284823, SummonProperties: 1345276, TotemCategory: 1134586,
    PowerDisplay: 1332557,
    ObjectEffect: 1090577, ObjectEffectGroup: 1090581, ObjectEffectModifier: 1090575,
    ObjectEffectPackage: 1090574, ObjectEffectPackageElem: 1090578,
    ParticleColor: 1284820, DeclinedWord: 1279100, DeclinedWordCases: 1279099, NameGen: 1122117,
    Resistances: 1135072, RaceStat: 7722633,
  });
});

test("the W5 tables are read by the file data ids the WoWDBDefs manifest lists for them", () => {
  // manifest.json at WoWDBDefs 05e242b6acdc (verified against the live wowf 70630 build, rows for
  // Criteria 3297, CriteriaTree 6771, ModifierTree 2845, Talent 432, TalentTab 27, NumTalentsAtLevel
  // 80, Difficulty 22, PowerType 6; CriteriaTreeXEffect is present with 0 rows).
  expect(CLIENT_TABLES).toMatchObject({
    Criteria: 1263817, CriteriaTree: 1263818, CriteriaTreeXEffect: 1345969, ModifierTree: 1267645,
    Talent: 1369062, TalentTab: 2178102, NumTalentsAtLevel: 1953326, MinorTalent: 1347274,
    TalentTreePrimarySpells: 5581887, SpecSetMember: 2057624, SpecializationSpells: 1240335,
    SpecializationSpellsDisplay: 2067238,
    Difficulty: 1352127, PowerType: 1266022,
  });
});

test("a table the build does not have is reported as missing, not invented", async () => {
  const { tables, missing } = await extractTables(fake({ [CLIENT_TABLES.Item]: { rows: [[1, { ID: 1 }]] } }));
  expect(tables.map((t) => t.table)).toEqual(["Item"]);
  expect(missing).toEqual(
    Object.keys(CLIENT_TABLES).filter((t) => t !== "Item").map((table) => ({ table, reason: "not in this build" })),
  );
});

test("a table that cannot be read is reported with the reason, and the other tables are still extracted", async () => {
  const source: TableSource = {
    async read(fileDataID) {
      if (fileDataID === CLIENT_TABLES.SpellName) throw new Error("No valid definition found for layout 1C2B3A4D");
      return { cKey: `k${fileDataID}`, encryptedBlocks: 0, rows: new Map([[1, { ID: 1 }]]) };
    },
  };
  const { tables, missing } = await extractTables(source);
  expect(tables.map((t) => t.table)).toEqual(Object.keys(CLIENT_TABLES).filter((t) => t !== "SpellName"));
  expect(missing).toEqual([{ table: "SpellName", reason: "No valid definition found for layout 1C2B3A4D" }]);
});

test("openCdn reads the enUS file with encrypted blocks allowed, hands those blocks to the table reader and counts them", async () => {
  const { build, source } = await openCdn("wow_classic_beta");
  expect(build).toEqual({ product: "wow_classic_beta", buildConfig: "84bea4233331e390fda8724c6f91ffa5", buildId: 70450, version: "1.60.1.70450" });
  const read = await source.read(CLIENT_TABLES.ItemSparse);
  expect(lib.fetched).toEqual([{ cKey: `en${CLIENT_TABLES.ItemSparse}`, allowMissingKey: true }]);
  expect(lib.readers).toHaveLength(1);
  expect(lib.readers[0].blocks).toBe(lib.blocks);
  expect(read).toEqual({ cKey: `en${CLIENT_TABLES.ItemSparse}`, encryptedBlocks: 2, rows: new Map([[19019, { ID: 19019 }]]) });
});

test("no code in kb loads decryption keys or the unlicensed listfile", () => {
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(name)) files.push(p);
    }
  };
  walk(src);
  // The key loaders, writing into a client's key map, and the block reader that takes keys directly.
  const forbidden = /\b(loadRemoteTACTKeys|loadTACTKeys|loadBroadcastTACTKeys|loadRemoteListFile|BLTEReader)\b|\.keys\s*\.\s*set\b/;
  expect(files.filter((f) => forbidden.test(readFileSync(f, "utf8")))).toEqual([]);
  expect(forbidden.test("client.keys.set(name, key)")).toBe(true);
  expect(forbidden.test("new BLTEReader(blte, eKey, keys)")).toBe(true);
});

test("the library recorded in each manifest is the version kb depends on", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(CASC_LIBRARY).toBe(`@rhyster/wow-casc-dbc@${pkg.dependencies["@rhyster/wow-casc-dbc"]}`);
});

test("icon file ids are looked up in the root listing and recorded as a table; nothing is downloaded", () => {
  const source: TableSource = {
    async read() { throw new Error("must not read content"); },
    fileStatus: (id) => (id === 1 ? "present" : id === 2 ? "encrypted" : "absent"),
  };
  const spellMisc = { table: "SpellMisc", fileDataID: 1, cKey: null, encryptedBlocks: 0, rows: new Map([[1, { SpellIconFileDataID: 1 }], [2, { SpellIconFileDataID: 2 }], [3, { SpellIconFileDataID: 3 }], [4, { SpellIconFileDataID: 0 }], [5, { SpellIconFileDataID: 1 }]]) };
  const ids = iconIds([spellMisc]);
  expect(ids).toEqual([1, 2, 3, 1]);
  const table = probeFiles(source, ids)!;
  expect(table.table).toBe("FileStatus");
  expect([...table.rows.values()]).toEqual([{ ID: 1, Status: "present" }, { ID: 2, Status: "encrypted" }, { ID: 3, Status: "absent" }]);
  expect(probeFiles({ read: async () => null }, ids)).toBeNull();
});

test("WoWDBDefs files are fetched at the pinned commit; other URLs pass through untouched", async () => {
  const seen: string[] = [];
  const real = (async (input: unknown) => { seen.push(String(input)); return new Response("{}"); }) as typeof fetch;
  const pinned = pinnedFetch(real, "a".repeat(40));
  await pinned("https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/manifest.json");
  await pinned("https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/definitions/TraitNode.dbd");
  await pinned("https://example.com/WoWDBDefs/master/x");
  expect(seen).toEqual([
    `https://raw.githubusercontent.com/wowdev/WoWDBDefs/${"a".repeat(40)}/manifest.json`,
    `https://raw.githubusercontent.com/wowdev/WoWDBDefs/${"a".repeat(40)}/definitions/TraitNode.dbd`,
    "https://example.com/WoWDBDefs/master/x",
  ]);
});

test("pinDefinitions returns null, and changes nothing, when the commit cannot be resolved", async () => {
  const before = globalThis.fetch;
  expect(await pinDefinitions((async () => new Response("no", { status: 403 })) as typeof fetch)).toBeNull();
  expect(await pinDefinitions((async () => { throw new Error("offline"); }) as typeof fetch)).toBeNull();
  expect(globalThis.fetch).toBe(before);
});
