/**
 * What a client snapshot holds, table by table: rows, encrypted blocks, why a table was not read, and
 * whether each column the database pages rely on exists in this build and carries values. Column names
 * are the WoWDBDefs ones; a name the build's layout does not have is reported, never guessed.
 * Reads only the snapshot and its manifest.
 */
import { CLIENT_TABLES, readClientManifest, readClientMeta, readClientRows, type ClientBuildMeta } from "./client-snapshot.js";

/** The columns later steps read, per table (relation edges, item taxonomy, objects, the icon manifest). */
export const NEEDED_FIELDS: Partial<Record<keyof typeof CLIENT_TABLES, readonly string[]>> = {
  ItemSparse: ["Display_lang", "OverallQualityID"],
  Item: ["ClassID", "SubclassID", "InventoryType", "IconFileDataID"],
  SpellName: ["Name_lang"],
  SpellMisc: ["SpellID", "SpellIconFileDataID"],
  SpellEffect: ["SpellID", "Effect", "EffectItemType"],
  ItemClass: ["ClassID", "ClassName_lang"],
  ItemSubClass: ["ClassID", "SubClassID", "DisplayName_lang", "VerboseName_lang"],
  ItemSet: ["Name_lang", "ItemID"],
  SkillLineAbility: ["SkillLine", "Spell"],
  SpellItemEnchantment: ["Name_lang"],
  SpellReagents: ["SpellID", "Reagent", "ReagentCount"],
  AreaTable: ["AreaName_lang", "ContinentID", "ParentAreaID"],
  ChrRaces: ["Name_lang"],
  Faction: ["Name_lang"],
  CharTitles: ["Name_lang"],
  Languages: ["Name_lang"],
  CurrencyTypes: ["Name_lang"],
  CreatureFamily: ["Name_lang", "IconFileID"],
  CreatureType: ["Name_lang"],
  Holidays: ["HolidayNameID"],
  HolidayNames: ["Name_lang"],
  HolidayDescriptions: ["Description_lang"],
  QuestInfo: ["InfoName_lang", "Type"],
  QuestSort: ["SortName_lang", "UiOrderIndex"],
  Toy: ["ItemID"],
  BattlePetSpecies: ["CreatureID"],
  Creature: ["Name_lang", "Classification", "CreatureType", "CreatureFamily"],
  GameObjects: ["Name_lang", "TypeID", "OwnerID", "Pos"],
  GameObjectDisplayInfo: ["FileDataID"],
  GameObjectArtKit: ["AttachModelFileID"],
  QuestV2: ["UniqueBitFlag"],
  LFGDungeons: ["Name_lang", "TypeID", "MapID", "DifficultyID"],
  DungeonEncounter: ["Name_lang", "MapID", "DifficultyID"],
  MapDifficulty: ["MapID", "DifficultyID", "MaxPlayers", "ContentTuningID"],
  ContentTuning: ["MinLevelSquish", "MaxLevelSquish"],
  AreaGroupMember: ["AreaID", "AreaGroupID"],
  ItemExtendedCost: ["Money", "ItemID", "ItemCount", "CurrencyID", "CurrencyCount"],
  ItemLimitCategory: ["Name_lang", "Quantity"],
  ItemBagFamily: ["Name_lang"],
  ItemNameDescription: ["Description_lang", "Color"],
  ItemEffect: ["SpellID"],
  ItemXItemEffect: ["ItemID", "ItemEffectID"],
  SpellCastTimes: ["Base", "Minimum"],
  SpellCooldowns: ["SpellID", "RecoveryTime", "CategoryRecoveryTime", "StartRecoveryTime"],
  SpellRange: ["DisplayName_lang", "RangeMin", "RangeMax"],
  SpellLevels: ["SpellID", "BaseLevel", "SpellLevel", "MaxLevel"],
  Mount: ["Name_lang", "SourceSpellID", "MountTypeID"],
  MountXDisplay: ["MountID", "CreatureDisplayInfoID"],
  Profession: ["SkillLineID"],
  ItemAppearance: ["ItemDisplayInfoID", "DefaultIconFileDataID"],
  ItemDisplayInfo: ["ModelResourcesID", "ModelMaterialResourcesID", "ItemVisual"],
  ItemModifiedAppearance: ["ItemID", "ItemAppearanceID", "OrderIndex"],
  ItemXBonusTree: ["ItemID", "ItemBonusTreeID"],
  ItemBonus: ["Value", "ParentItemBonusListID", "Type"],
  ItemBonusTreeNode: ["ParentItemBonusTreeID", "ChildItemBonusTreeID", "ChildItemBonusListID", "ItemContext"],
  ItemDisenchantLoot: ["Class", "Subclass", "Quality"],
  ItemSearchName: ["Display_lang", "OverallQualityID", "RequiredLevel", "ItemLevel"],
  ItemSetSpell: ["ItemSetID", "SpellID", "Threshold"],
  TransmogSet: ["Name_lang"],
  TransmogSetItem: ["TransmogSetID", "ItemModifiedAppearanceID"],
  QuestLine: ["Name_lang", "QuestID"],
  QuestLineXQuest: ["QuestLineID", "QuestID", "OrderIndex"],
  QuestPOIBlob: ["MapID", "QuestID", "NumPoints"],
  QuestPOIPoint: ["QuestPOIBlobID", "X", "Y"],
  FactionTemplate: ["Faction", "FactionGroup"],
  WorldMapOverlay: ["UiMapArtID", "OffsetX", "OffsetY", "AreaID"],
  WorldMapOverlayTile: ["RowIndex", "ColIndex", "FileDataID", "WorldMapOverlayID"],
  WMOAreaTable: ["WMOID", "AreaTableID", "ZoneMusic"],
  ZoneIntroMusicTable: ["Name", "SoundID"],
  ZoneMusic: ["SetName", "Sounds"],
  ZoneLight: ["MapID", "LightID"],
  ZoneLightPoint: ["ZoneLightID", "Pos"],
  AreaPOI: ["Name_lang", "Pos", "ContinentID", "AreaID"],
  Achievement: ["Title_lang", "Category", "Points", "IconFileID", "Flags"],
  Achievement_Category: ["Name_lang", "Parent"],
  CurrencyCategory: ["Name_lang"],
  TaxiNodes: ["Name_lang", "Pos", "ContinentID"],
  TaxiPath: ["FromTaxiNode", "ToTaxiNode", "Cost"],
  TaxiPathNode: ["PathID", "NodeIndex", "Loc", "ContinentID"],
  CreatureDifficulty: ["CreatureID", "MinLevel", "MaxLevel"],
  CreatureXDisplayInfo: ["CreatureID", "CreatureDisplayInfoID"],
  ChrClassesXPowerTypes: ["PowerType", "ClassID"],
  ChrRaceRacialAbility: ["ChrRacesID", "Name_lang", "Icon"],
  PetLoyalty: ["Name_lang"],
  MountCapability: ["ReqRidingSkill", "ReqSpellKnownID"],
  CreatureDisplayInfo: ["ModelID", "TextureVariationFileDataID", "ExtendedDisplayInfoID"],
  CreatureModelData: ["FileDataID"],
  CreatureDisplayInfoExtra: ["DisplayRaceID", "BakeMaterialResourcesID"],
  ChrCustomizationChoice: ["ChrCustomizationOptionID", "SoundKitID"],
  ChrCustomizationOption: ["Name_lang", "ChrCustomizationCategoryID", "ChrModelID"],
  ChrCustomizationCategory: ["CategoryName_lang"],
  ChrModel: ["DisplayID", "SkeletonFileDataID", "Sex"],
  ChrRaceXChrModel: ["ChrRacesID", "ChrModelID", "Sex"],
  CharacterLoadout: ["ChrClassID", "Purpose"],
  CharacterLoadoutItem: ["CharacterLoadoutID", "ItemID"],
  SoundKit: ["SoundType", "VolumeFloat"],
  SoundKitEntry: ["SoundKitID", "FileDataID"],
  SoundKitChild: ["SoundKitID", "ParentSoundKitID"],
  // W4 (docs/2026-10-18-client-data-placement.md): the live-support tables, pinned before their consumers land.
  BankBagSlotPrices: ["Cost"],
  BankTab: ["Cost", "BankType", "OrderIndex"],
  StableSlotPrices: ["Cost"],
  CharBaseInfo: ["RaceID", "ClassID"],
  CharBaseSection: ["LayoutResType", "VariationEnum"],
  CharHairGeosets: ["RaceID", "SexID", "GeosetID", "VariationType"],
  CharComponentTextureLayouts: ["Width", "Height"],
  CharComponentTextureSections: ["CharComponentTextureLayoutID", "SectionType", "X", "Y", "Width", "Height"],
  CharStartKit: ["ChrRacesID", "ChrClassesID"],
  ComponentTextureFileData: ["GenderIndex", "ClassID", "RaceID"],
  ComponentModelFileData: ["GenderIndex", "ClassID", "RaceID", "PositionIndex"],
  GuildEmblem: ["EmblemID", "TextureFileDataID"],
  GuildTabardBackground: ["Tier", "Component", "FileDataID", "Color"],
  GuildTabardBorder: ["BorderID", "Tier", "Component", "FileDataID", "Color"],
  GuildTabardEmblem: ["Component", "Color", "FileDataID", "EmblemID"],
  GuildShirtBackground: ["Component", "FileDataID", "ShirtID", "Color"],
  GuildShirtBorder: ["Tier", "Component", "ShirtID", "FileDataID", "Color"],
  GuildColorBackground: ["Red", "Green", "Blue"],
  GuildColorBorder: ["Red", "Green", "Blue"],
  GuildColorEmblem: ["Red", "Green", "Blue"],
  BarberShopStyle: ["DisplayName_lang", "Type", "Cost_Modifier", "Race", "Sex"],
  LevelExperience: ["Level", "Experience"],
  Exhaustion: ["Xp", "Factor", "OutdoorHours", "InnHours", "Threshold"],
  DurabilityCosts: ["WeaponSubClassCost", "ArmorSubClassCost"],
  DurabilityQuality: ["Data"],
  MailTemplate: ["Body_lang"],
  AuctionHouse: ["Name_lang", "FactionID", "DepositRate", "ConsignmentRate"],
  Emotes: ["EmoteSlashCommand", "AnimID", "EmoteFlags", "EventSoundID", "SpellVisualKitID", "ClassMask", "RaceMasks"],
  EmotesText: ["Name", "EmoteID"],
  EmotesTextSound: ["RaceID", "ClassID", "SexID", "SoundID", "EmotesTextID"],
  EmotesTextData: ["Text_lang", "EmotesTextID"],
  Lock: ["Flags", "Skill", "Type", "Action"],
  LockType: ["Name_lang", "ResourceName_lang", "Verb_lang", "EnumID", "TrackingIcon"],
  SummonProperties: ["Control", "Faction", "Title", "Slot", "Flags"],
  TotemCategory: ["Name_lang", "TotemCategoryType", "TotemCategoryMask"],
  PowerDisplay: ["GlobalStringBaseTag", "ActualType", "Red", "Green", "Blue"],
  ObjectEffect: ["Offset", "ObjectEffectGroupID", "TriggerType", "EventType", "EffectRecType", "EffectRecID", "Attachment", "ObjectEffectModifierID"],
  ObjectEffectPackageElem: ["ObjectEffectPackageID", "ObjectEffectGroupID", "StateType"],
  ParticleColor: ["Start", "MID", "End"],
  NameGen: ["Name", "RaceID", "Sex", "NameType"],
  Resistances: ["Name_lang", "Flags", "FizzleSoundID"],
  RaceStat: ["ChrRacesID"],
};

export interface FieldCoverage { name: string; present: boolean; filled: number }

export interface TableCoverage {
  table: string;
  fileDataID: number;
  /** read; absent (the build does not ship it); failed (it could not be read); not extracted (older snapshot). */
  status: "read" | "absent" | "failed" | "not extracted";
  reason: string | null;
  rows: number;
  encryptedBlocks: number;
  fields: FieldCoverage[];
}

export interface CoverageReport { build: ClientBuildMeta; tables: TableCoverage[] }

/** A value counts as filled when it says something: not 0, not "", or an array with one such value. */
function filled(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(filled);
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "" && v !== "0";
  return v !== null && v !== undefined;
}

export function clientCoverage(snapshotPath: string): CoverageReport {
  const build = readClientMeta(snapshotPath);
  const manifest = readClientManifest(snapshotPath);
  const read = new Map((manifest?.tables ?? []).map((t) => [t.table, t]));
  const missing = new Map((manifest?.missing ?? []).map((m) => [m.table, m.reason]));
  const tables = Object.entries(CLIENT_TABLES).map(([table, fileDataID]): TableCoverage => {
    const wanted = NEEDED_FIELDS[table as keyof typeof CLIENT_TABLES] ?? [];
    const entry = read.get(table);
    if (!entry) {
      const reason = missing.get(table) ?? null;
      const status = reason === null ? "not extracted" : reason === "not in this build" ? "absent" : "failed";
      return { table, fileDataID, status, reason, rows: 0, encryptedBlocks: 0, fields: wanted.map((name) => ({ name, present: false, filled: 0 })) };
    }
    const rows = [...readClientRows(snapshotPath, table).values()];
    const columns = new Set(rows.flatMap((r) => Object.keys(r)));
    return {
      table, fileDataID, status: "read", reason: null, rows: entry.rows, encryptedBlocks: entry.encryptedBlocks,
      fields: wanted.map((name) => ({ name, present: columns.has(name), filled: rows.filter((r) => filled(r[name])).length })),
    };
  });
  return { build, tables };
}

export function formatCoverage(report: CoverageReport): string {
  const b = report.build;
  const lines = [
    `Client tables in ${b.product} ${b.version} (build config ${b.buildConfig.slice(0, 8)}, WoWDBDefs ${b.definitions ?? "unknown"}), extracted ${b.extractedAt}.`,
    "Filled: rows where the column is not 0 or empty.",
    "",
    "| Table | File data id | Status | Rows | Encrypted blocks | Fields (rows filled) |",
    "|---|---|---|---|---|---|",
  ];
  for (const t of report.tables) {
    const status = t.status === "read" ? "read" : t.status === "failed" ? `failed: ${t.reason}` : t.status === "absent" ? "not in this build" : "not extracted";
    const fields = t.status === "read" ? t.fields.map((f) => (f.present ? `${f.name} ${f.filled}` : `**${f.name} missing**`)).join(", ") : "";
    lines.push(`| ${t.table} | ${t.fileDataID} | ${status} | ${t.rows} | ${t.encryptedBlocks} | ${fields} |`);
  }
  return `${lines.join("\n")}\n`;
}
