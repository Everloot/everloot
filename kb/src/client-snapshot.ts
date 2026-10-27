/**
 * One immutable SQLite snapshot per game build: the raw rows of the client tables we read, a few
 * normalized fields for items and spells, and a manifest beside it with provenance and a sha256.
 * Game file data is Blizzard's; it never goes into the CC BY-SA knowledge release.
 */
import Database from "better-sqlite3";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { sha256File } from "./snapshot.js";

/**
 * File data ids of the tables read so far (stable across builds). The ids come from the `db2FileDataID`
 * field of the WoWDBDefs manifest, not from a listfile. A table a build does not ship is recorded as
 * missing; that is normal (Classic Era has almost no Trait tables).
 */
export const CLIENT_TABLES = {
  ItemSparse: 1572924, Item: 841626, SpellName: 1990283, Spell: 1140089,
  // Weapon damage per second by item level, one column per quality and one table per weapon kind. ItemSparse
  // in 1.60.1 has no MinDamage/MaxDamage, so the client works a weapon's damage out from these and DmgVariance.
  ItemDamageOneHand: 1277743, ItemDamageOneHandCaster: 1277739, ItemDamageTwoHand: 1277738,
  ItemDamageTwoHandCaster: 1277742, ItemDamageRanged: 6156256, ItemDamageThrown: 6156257, ItemDamageWand: 6156258,
  ItemDamageAmmo: 1277740,
  // Talents: the trait system, and what ties a tree to a class and its three talent groups.
  TraitTree: 4420305, TraitNode: 4420297, TraitNodeEntry: 4420298, TraitDefinition: 4420327, TraitEdge: 4420308,
  TraitCond: 4543085, TraitNodeGroup: 4420300, TraitNodeGroupXTraitNode: 4420302, TraitNodeXTraitNodeEntry: 4420304,
  TraitNodeXTraitCond: 4543092, TraitNodeGroupXTraitCond: 4543090, TraitNodeEntryXTraitCond: 4543088,
  TraitSubTree: 5534447, TraitSystem: 4635649, TraitTreeLoadout: 4669507, TraitNodeGroupDisplayInfo: 7935808,
  TraitCurrency: 4524216, TraitCurrencySource: 4539393, TraitCost: 4420295, TraitTreeXTraitCost: 4420306,
  TraitTreeXTraitCurrency: 4524218, TraitNodeXTraitCost: 4420303, TraitNodeGroupXTraitCost: 4420301,
  TraitNodeEntryXTraitCost: 4420299,
  SkillLineXTraitTree: 4505477, SkillLine: 1240935, SkillRaceClassInfo: 1240406,
  ChrSpecialization: 1343390, ChrClasses: 1361031,
  // Spell effects: aura type, targets and radius, for the raid buff table.
  SpellEffect: 1140088, SpellRadius: 1134584,
  // Tooltips and icons for the talent catalog: icon file id and duration of each spell.
  SpellMisc: 1003144, SpellDuration: 1137828,
  // Proc chance and charges, for the $h and $n tooltip variables.
  SpellAuraOptions: 1139952,
  // Interface art: which texture file and rectangle each named piece of the talent frame is
  // (atlas element name, member rectangle, atlas file). Read as table rows, no listfile.
  UiTextureAtlas: 897470, UiTextureAtlasElement: 1989276, UiTextureAtlasMember: 897532,
  // Maps: zone rectangles in world coordinates (UiMap names the maps, UiMapAssignment places them on a
  // continent) and, in Map, the continents and the instances with their entrance position.
  Map: 1349477, UiMap: 1957206, UiMapAssignment: 1957219,
  // ContentTuning gives the level range of an instance: MapDifficulty names its tuning row (the dungeon and raid list).
  ContentTuning: 1962930,
  // Map art: which tile files make up each map's picture (UiMapXMapArt names the art of a UiMap, UiMapArtTile
  // lists its tiles by row and column, UiMapArtStyleLayer gives the tile and layer sizes).
  UiMapArt: 1957202, UiMapArtTile: 1957210, UiMapArtStyleLayer: 1957208, UiMapXMapArt: 1957217,
  // Coverage (docs/2026-10-18-database-taxonomy-research.md): item categories and sets, how spells
  // make and use items, zones, races, factions and the other entity lists a game database carries.
  // Ids from the WoWDBDefs manifest at b9a63096cdd9; every one has a 1.60.1 layout there.
  ItemClass: 1140189, ItemSubClass: 1261604, ItemSet: 1343609,
  SkillLineAbility: 1266278, SpellItemEnchantment: 1362771, SpellReagents: 841946,
  AreaTable: 1353545, ChrRaces: 1305311, Faction: 1361972, CharTitles: 1349054, Languages: 1135325,
  CurrencyTypes: 1095531, CreatureFamily: 1351351, CreatureType: 1131315, Holidays: 996357,
  Toy: 988200, BattlePetSpecies: 841622,
  // W0 (docs/2026-10-18-client-data-placement.md): the holiday calendar's names and dates, the quest
  // taxonomy the quest pages sort by, and the display model of chests, herbs and ore.
  HolidayNames: 996359, HolidayDescriptions: 996360, HolidayXTimeEvent: 6905813,
  QuestInfo: 1120960, QuestSort: 1134585,
  GameObjectDisplayInfo: 1266277, GameObjectArtKit: 1266737,
  // W1 (docs/2026-10-18-client-data-placement.md): group content and its journal, item meta (costs,
  // limits, families, effects), the spell math behind tooltips and cooldowns, mounts, and the old
  // profession specialisation tables.
  LFGDungeons: 1361033, JournalInstance: 1237438, JournalEncounter: 1240336, JournalTier: 1349056,
  DungeonEncounter: 1347279, MapDifficulty: 1367868, AreaGroupMember: 1093406,
  ItemExtendedCost: 801681, ItemCurrencyCost: 801670, ItemLimitCategory: 1237440, ItemBagFamily: 1278179,
  ItemNameDescription: 1332559, ItemEffect: 969941, ItemXItemEffect: 3177687,
  SpellCastTimes: 1134089, SpellCooldowns: 1139924, SpellRange: 1146820, SpellLevels: 1140079,
  Mount: 921760, MountXDisplay: 1576117, MountType: 1114674, MountTypeXCapability: 1114715,
  MountXSpellVisualKitPicker: 3989477,
  Profession: 4508544, ProfessionEffect: 4505297, ProfessionEffectType: 4556715, ProfessionTrait: 4505298,
  ProfessionTraitXEffect: 4505494, ProfessionTraitXLabel: 4505299,
  // W2 (docs/2026-10-18-client-data-placement.md): the item appearance and transmog cluster behind
  // item pages and tooltips, quest POI points and lines, battle pets and heirlooms, factions, the map
  // overlays and zone ambience, achievements, currencies, taxi routes, creature difficulty and
  // display links, class and race facts, and the lore archive texts (pages-only review pass).
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
  // W3 (docs/2026-10-18-client-data-placement.md): the character customization and model pipeline,
  // the creature display chain, animation kits and liquids, the sound kit cluster, and the last three
  // trait tables. Read for the local reservoir; each consumer still waits for its feature (model
  // viewer, dressing room, sound surfacing) and none of it is published.
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
  LiquidMaterial: 1132538, LiquidObject: 1308058, LiquidTypeXFFTTile: 7489861, LiquidTypeXTexture: 2261065,
  // LiquidType (1371380) stays unread: its pinned WoWDBDefs layout marks Texture as a string without a
  // string definition, so extraction fails on it ("Missing string for string column Texture"). Revisit
  // when the pinned definitions fix the layout.
  ModelAnimCloakDampening: 1465904, ModelFileData: 1337833,
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
  // W4 (docs/2026-10-18-client-data-placement.md): the live-support tables a realm uses today — banks,
  // stable and tabard slots, character creation pieces, guild tabards and emblems, the barber shop,
  // progression curves, mail and the auction house, emotes, world-object behaviour (locks, summons,
  // totems, power displays, object effects) and the creation helpers (declined words, name sets,
  // resistances, race base stats). Read for the local reservoir; consumers land with their features.
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
  // W5 (docs/2026-10-18-client-data-placement.md): achievement criteria the client carries by id —
  // Criteria and ModifierTree define each criterion and its condition, CriteriaTree orders and names
  // them — so achievement pages can show criteria from the files before players report them.
  // Talent and TalentTab are the classic client's talent trees; NumTalentsAtLevel the points per
  // level. The rest of the classic talent family reads empty today (Specialization* and SpecSetMember
  // are retail specialization plumbing) but sits in the same topic, so the snapshot stops asking.
  // Difficulty names the difficulty rows DungeonEncounter and MapDifficulty point at;
  // PowerType names the power types classes and spells spend.
  Criteria: 1263817, CriteriaTree: 1263818, CriteriaTreeXEffect: 1345969, ModifierTree: 1267645,
  Talent: 1369062, TalentTab: 2178102, NumTalentsAtLevel: 1953326, MinorTalent: 1347274,
  TalentTreePrimarySpells: 5581887, SpecSetMember: 2057624, SpecializationSpells: 1240335,
  SpecializationSpellsDisplay: 2067238,
  Difficulty: 1352127, PowerType: 1266022,
  // W6 (spell tooltip math + item stat scalars): the rest of the classic spell-math set —
  // SpellPower carries the mana costs, SpellCategories the dispel/mechanic/defense columns,
  // SpellClassOptions the class masks, SpellAuraNames/SpellDispelType/SpellMechanic/SpellDiminish
  // give aura, dispel and crowd-control names, SpellEquippedItems/SpellFocusObject/SpellTotems/
  // SpellShapeshift* the cast requirements, SpellTargetRestrictions targets, SpellInterrupts what
  // breaks casts, SpellLearnSpell teaches, SpellLabel links collections, SpellProcsPerMinute and
  // SpellProceduralEffect carry proc behavior. SpellPowerDifficulty, SpellScaling,
  // SpellReagentsCurrency and SpellEffectAutoDescription stay unread (absent or empty in this build).
  // RandPropPoints/ArmorLocation are the classic item stat scalars.
  SpellPower: 982806, SpellCategories: 1139939, SpellClassOptions: 979663, SpellAuraNames: 3055890,
  SpellDispelType: 1137829, SpellMechanic: 1014438, SpellDiminish: 3055891, SpellEquippedItems: 1140011,
  SpellTargetRestrictions: 1139993, SpellInterrupts: 1139906, SpellFocusObject: 1280620,
  SpellTotems: 1002162, SpellShapeshift: 1139929, SpellShapeshiftForm: 1280618,
  SpellLearnSpell: 1001907, SpellLabel: 1347275, SpellProcsPerMinute: 1133526,
  SpellProceduralEffect: 1140477,
  RandPropPoints: 1310245, ArmorLocation: 1284818,
  // Partial on the client: most of what these describe (spawns, quest text) lives on the server.
  Creature: 841631, GameObjects: 841620, QuestV2: 1139443,
  // Loading screens (Map.LoadingScreenID names a row; the row names its picture files), for the page
  // banners. ChrRaces above also gives the race names for the race emblems.
  LoadingScreens: 1266541,
} as const;
export type ClientTableName = keyof typeof CLIENT_TABLES;

export interface ExtractedTable {
  table: string;
  fileDataID: number;
  /** Content key the table was read from; null when not recorded. */
  cKey: string | null;
  /** Blocks left out because they are encrypted (no keys are ever used). */
  encryptedBlocks: number;
  rows: Map<number, Record<string, unknown>>;
}

export interface ClientBuildMeta {
  product: string;
  buildConfig: string;
  buildId: number;
  version: string;
  extractedAt: string;
  /** Extraction library and version, e.g. "@rhyster/wow-casc-dbc@2.16.15". */
  library: string;
  /** WoWDBDefs commit the table definitions came from; null when unknown. */
  definitions: string | null;
}

export interface ClientManifest extends ClientBuildMeta {
  tables: { table: string; fileDataID: number; cKey: string | null; rows: number; encryptedBlocks: number }[];
  /** Tables that were asked for and not read, with the reason. Absent in snapshots written before 2026-10-18. */
  missing?: { table: string; reason: string }[];
  sha256: string;
}

export interface ClientItem {
  id: number; name: string | null; quality: number | null; itemLevel: number | null;
  requiredLevel: number | null; classId: number | null; subclassId: number | null; inventoryType: number | null;
}

export interface ClientSpell { id: number; name: string | null; description: string | null; auraDescription: string | null }

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE client_rows (tbl TEXT NOT NULL, id INTEGER NOT NULL, raw TEXT NOT NULL, PRIMARY KEY (tbl, id));
CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, quality INTEGER, item_level INTEGER, required_level INTEGER,
  class_id INTEGER, subclass_id INTEGER, inventory_type INTEGER);
CREATE TABLE spells (id INTEGER PRIMARY KEY, name TEXT, description TEXT, aura_description TEXT);
`;

/** JSON with 64-bit integers kept exactly, as strings. */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function normalizeItem(id: number, sparse?: Record<string, unknown>, item?: Record<string, unknown>): ClientItem {
  return {
    id,
    name: str(sparse?.Display_lang), quality: num(sparse?.OverallQualityID), itemLevel: num(sparse?.ItemLevel),
    requiredLevel: num(sparse?.RequiredLevel), classId: num(item?.ClassID), subclassId: num(item?.SubclassID),
    inventoryType: num(item?.InventoryType),
  };
}

export function normalizeSpell(id: number, name?: Record<string, unknown>, spell?: Record<string, unknown>): ClientSpell {
  return { id, name: str(name?.Name_lang), description: str(spell?.Description_lang), auraDescription: str(spell?.AuraDescription_lang) };
}

/**
 * `<product>-<buildId>-<first 8 of BuildConfig>.sqlite`. Blizzard sometimes ships two builds under one
 * build number, and a build is keyed on its BuildConfig, so the name carries part of it.
 */
export function clientSnapshotName(build: { product: string; buildId: number; buildConfig: string }): string {
  return `${build.product}-${build.buildId}-${build.buildConfig.slice(0, 8)}.sqlite`;
}

/** Write the snapshot and its manifest. The file is built beside the target and renamed into place. */
export function writeClientSnapshot(path: string, meta: ClientBuildMeta, tables: ExtractedTable[], missing: { table: string; reason: string }[] = []): ClientManifest {
  const partial = `${path}.partial`;
  rmSync(partial, { force: true });
  const db = new Database(partial);
  try {
    db.exec(SCHEMA);
    const putMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(meta)) putMeta.run(k, String(v ?? ""));
    const putRow = db.prepare("INSERT INTO client_rows (tbl, id, raw) VALUES (?, ?, ?)");
    const byName = new Map(tables.map((t) => [t.table, t]));
    db.transaction(() => {
      for (const t of tables) for (const [id, raw] of t.rows) putRow.run(t.table, id, toJson(raw));
      const sparse = byName.get("ItemSparse")?.rows;
      const item = byName.get("Item")?.rows;
      const putItem = db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const id of new Set([...(sparse?.keys() ?? []), ...(item?.keys() ?? [])])) {
        const n = normalizeItem(id, sparse?.get(id), item?.get(id));
        putItem.run(n.id, n.name, n.quality, n.itemLevel, n.requiredLevel, n.classId, n.subclassId, n.inventoryType);
      }
      const names = byName.get("SpellName")?.rows;
      const spells = byName.get("Spell")?.rows;
      const putSpell = db.prepare("INSERT INTO spells VALUES (?, ?, ?, ?)");
      for (const id of new Set([...(names?.keys() ?? []), ...(spells?.keys() ?? [])])) {
        const n = normalizeSpell(id, names?.get(id), spells?.get(id));
        putSpell.run(n.id, n.name, n.description, n.auraDescription);
      }
    })();
  } finally {
    db.close();
  }
  renameSync(partial, path);
  const manifest: ClientManifest = {
    ...meta,
    tables: tables.map((t) => ({ table: t.table, fileDataID: t.fileDataID, cKey: t.cKey, rows: t.rows.size, encryptedBlocks: t.encryptedBlocks })),
    missing,
    sha256: sha256File(path),
  };
  writeFileSync(`${path}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function open(path: string): Database.Database {
  return new Database(path, { readonly: true, fileMustExist: true });
}

export function readClientMeta(path: string): ClientBuildMeta {
  const db = open(path);
  try {
    const m = Object.fromEntries((db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    return {
      product: m.product, buildConfig: m.buildConfig, buildId: Number(m.buildId), version: m.version,
      extractedAt: m.extractedAt, library: m.library, definitions: m.definitions || null,
    };
  } finally {
    db.close();
  }
}

/** The manifest written beside a snapshot (it holds the per-table encrypted block counts); null when absent. */
export function readClientManifest(path: string): ClientManifest | null {
  try {
    return JSON.parse(readFileSync(`${path}.manifest.json`, "utf8")) as ClientManifest;
  } catch {
    return null;
  }
}

export function readClientTables(path: string): string[] {
  const db = open(path);
  try {
    return (db.prepare("SELECT DISTINCT tbl FROM client_rows ORDER BY tbl").all() as { tbl: string }[]).map((r) => r.tbl);
  } finally {
    db.close();
  }
}

export function readClientRows(path: string, table: string): Map<number, Record<string, unknown>> {
  const db = open(path);
  try {
    const rows = db.prepare("SELECT id, raw FROM client_rows WHERE tbl = ? ORDER BY id").all(table) as { id: number; raw: string }[];
    return new Map(rows.map((r) => [r.id, JSON.parse(r.raw) as Record<string, unknown>]));
  } finally {
    db.close();
  }
}

export function readClientItems(path: string): ClientItem[] {
  const db = open(path);
  try {
    return db.prepare(`SELECT id, name, quality, item_level AS itemLevel, required_level AS requiredLevel,
      class_id AS classId, subclass_id AS subclassId, inventory_type AS inventoryType FROM items ORDER BY id`).all() as ClientItem[];
  } finally {
    db.close();
  }
}
