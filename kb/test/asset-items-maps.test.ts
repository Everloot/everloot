import { expect, test } from "vitest";
import { buildItemSet, parseItemIds, shardOf, shardRecords, weaponDamageTable, ITEM_SHARD_SIZE } from "../src/assets/items.js";
import { fitSize, planMapArt, stitchPlan } from "../src/assets/map-art.js";
import type { Row, Rows } from "../src/talents/build-catalog.js";

const t = (rows: Row[]): Rows => new Map(rows.map((r, i) => [typeof r.ID === "number" ? r.ID : i + 1, r]));

// Made-up items; the ids and values are invented.
const itemTables: Record<string, Rows> = {
  ItemSparse: t([
    { ID: 25, Display_lang: "Worn Shortsword", Description_lang: "", OverallQualityID: 1, ItemLevel: 2, RequiredLevel: 1, Bonding: 0, InventoryType: 13, ItemDelay: 1900, MaxCount: 0, SellPrice: 7, StatModifier_bonusStat: [-1, -1], StatPercentEditor: [0, 0] },
    { ID: 600, Display_lang: "Test Helm", Description_lang: "Shiny.", OverallQualityID: 3, ItemLevel: 30, RequiredLevel: 25, Bonding: 2, InventoryType: 1, ItemDelay: 0, MaxCount: 1, SellPrice: 1234, StatModifier_bonusStat: [7, 4, 5], StatPercentEditor: [5000, 3000, 0] },
    { ID: 601, Display_lang: "  ", OverallQualityID: 1 },
  ]),
  Item: t([
    { ID: 25, IconFileDataID: 135274, ClassID: 2, SubclassID: 7 },
    { ID: 600, IconFileDataID: 0, ClassID: 4, SubclassID: 4 },
  ]),
};

test("item records keep what the tables give, and only stat kinds with a share", () => {
  const { records, iconOf } = buildItemSet((n) => itemTables[n]);
  expect([...records.keys()]).toEqual([25, 600]);
  expect(records.get(25)).toEqual({ n: "Worn Shortsword", q: 1, l: 2, r: 1, b: 0, s: 13, c: 2, sc: 7, d: 1900, st: [], sp: 7, u: 0, cr: [], rq: [] });
  expect(records.get(600)).toMatchObject({ n: "Test Helm", q: 3, b: 2, s: 1, c: 4, sc: 4, st: [7, 4], u: 1, t: "Shiny." });
  // Only an item with an icon file has one; no icon is invented.
  expect([...iconOf]).toEqual([[25, 135274]]);
});

test("an item the Item table lists without a named ItemSparse row keeps its icon alone, in its shard", () => {
  // 700 has no ItemSparse row (the server sends it), 601 a blank name, 702 no icon: only the icons are recorded.
  const tables: Record<string, Rows> = {
    ItemSparse: itemTables.ItemSparse,
    Item: t([...itemTables.Item.values(), { ID: 601, IconFileDataID: 133000 }, { ID: 700, IconFileDataID: 135661, ClassID: 2, SubclassID: 15 }, { ID: 702, IconFileDataID: 0 }]),
  };
  const set = buildItemSet((n) => tables[n]);
  expect([...set.records.keys()]).toEqual([25, 600]);
  expect([...set.iconOnly]).toEqual([[601, 133000], [700, 135661]]);
  expect([...buildItemSet((n) => tables[n], new Set([700])).iconOnly]).toEqual([[700, 135661]]);
  const shards = shardRecords(set.records, new Map([[700, 135661]]));
  expect(shards.get(1)).toEqual({ 600: set.records.get(600), 700: { i: 135661 } });
});

test("a weapon records the damage inputs its table, level and quality give, and nothing is invented", () => {
  const sparse = (id: number, InventoryType: number, Flags: number[], extra: Record<string, unknown> = {}) =>
    ({ ID: id, Display_lang: `Weapon ${id}`, OverallQualityID: 2, ItemLevel: 20, InventoryType, ItemDelay: 2000, DmgVariance: 0.4, DamageType: 0, Flags, ...extra });
  const tables: Record<string, Rows> = {
    ItemSparse: t([
      sparse(1, 13, [0, 0]), sparse(2, 17, [0, 0x200]), sparse(3, 26, [0, 0], { DamageType: 5 }), sparse(4, 15, [0, 0]),
      sparse(5, 13, [0, 0], { ItemLevel: 99 }), sparse(6, 17, [0, 0]), sparse(7, 1, [0, 0], { ItemDelay: 0 }),
    ]),
    Item: t([
      { ID: 1, ClassID: 2, SubclassID: 7 }, { ID: 2, ClassID: 2, SubclassID: 10 }, { ID: 3, ClassID: 2, SubclassID: 19 },
      { ID: 4, ClassID: 2, SubclassID: 2 }, { ID: 5, ClassID: 2, SubclassID: 7 }, { ID: 6, ClassID: 2, SubclassID: 8 }, { ID: 7, ClassID: 4, SubclassID: 4 },
    ]),
    ItemDamageOneHand: t([{ ID: 1, ItemLevel: 20, Quality: [1, 2, 7.5, 4, 5, 6, 7] }]),
    ItemDamageTwoHandCaster: t([{ ID: 1, ItemLevel: 20, Quality: [1, 2, 8.25, 4, 5, 6, 7] }]),
    ItemDamageWand: t([{ ID: 1, ItemLevel: 20, Quality: [1, 2, 12, 4, 5, 6, 7] }]),
  };
  const { records } = buildItemSet((n) => tables[n]);
  expect(records.get(1)!.w).toEqual({ t: "ItemDamageOneHand", dps: 7.5, dv: 0.4, ds: 0 });
  expect(records.get(2)!.w).toEqual({ t: "ItemDamageTwoHandCaster", dps: 8.25, dv: 0.4, ds: 0 });
  expect(records.get(3)!.w).toEqual({ t: "ItemDamageWand", dps: 12, dv: 0.4, ds: 5 });
  // No ItemDamageRanged table, no row at level 99, no ItemDamageTwoHand table, not a weapon: no inputs.
  for (const id of [4, 5, 6, 7]) expect(records.get(id)!.w).toBeUndefined();
  expect(weaponDamageTable(21, 7, false)).toBe("ItemDamageOneHand");
  expect(weaponDamageTable(15, 18, false)).toBe("ItemDamageRanged");
  expect(weaponDamageTable(25, 16, false)).toBe("ItemDamageThrown");
  expect(weaponDamageTable(15, 20, false)).toBeNull();
  expect(weaponDamageTable(1, null, false)).toBeNull();
});

test("the set, the Unique category, who may use it, what it requires and its effects come from the files' own tables", () => {
  // Made-up rows; the ids, names and masks are invented, the column names are the build's.
  const tables: Record<string, Rows> = {
    ItemSparse: t([
      { ID: 1, Display_lang: "Synthetic Helm", ItemSet: 7, LimitCategory: 3, AllowableClass: 1, AllowableRace: [5, 0], RequiredSkill: 9, RequiredSkillRank: 150, MinFactionID: 4, MinReputation: 5 },
      { ID: 2, Display_lang: "Synthetic Ring", LimitCategory: 8, AllowableClass: -1, AllowableRace: [-1, -1], RequiredAbility: 77, RequiredPVPRank: 9 },
      { ID: 3, Display_lang: "Synthetic Cloak", ItemSet: 99, LimitCategory: 404, AllowableClass: 1 | 2, AllowableRace: [7, 1], RequiredSkill: 404, RequiredSkillRank: 1 },
    ]),
    Item: t([{ ID: 1, ClassID: 4, SubclassID: 4 }, { ID: 2, ClassID: 4, SubclassID: 0 }, { ID: 3, ClassID: 4, SubclassID: 1 }]),
    ItemSet: t([{ ID: 7, Name_lang: "Synthetic Battlegear" }, { ID: 99 }]),
    ItemLimitCategory: t([{ ID: 3, Name_lang: "Synthetic Signet", Quantity: 1, Flags: 1 }, { ID: 8, Quantity: 2, Flags: 0 }]),
    ChrClasses: t([{ ID: 1, Name_lang: "Warrior" }, { ID: 2, Name_lang: "Paladin" }, { ID: 3, Name_lang: "Hunter" }]),
    // Human and Dwarf on bits 0 and 2, Orc on 1; Skyborne on bit 32 (the high word). The unannounced row never counts.
    ChrRaces: t([
      { ID: 1, Name_lang: "Human", ClientFileString: "Human", PlayableRaceBit: 0 }, { ID: 2, Name_lang: "Orc", ClientFileString: "Orc", PlayableRaceBit: 1 },
      { ID: 3, Name_lang: "Dwarf", ClientFileString: "Dwarf", PlayableRaceBit: 2 }, { ID: 95, Name_lang: "High Order Skyborne", ClientFileString: "Skyborne", PlayableRaceBit: 32 },
      { ID: 9, Name_lang: "Goblin", ClientFileString: "Goblin", PlayableRaceBit: 8 },
    ]),
    SkillLine: t([{ ID: 9, DisplayName_lang: "Tailoring" }]),
    Faction: t([{ ID: 4, Name_lang: "Synthetic Guild" }]),
    SpellName: t([{ ID: 77, Name_lang: "Synthetic Training" }]),
    ItemEffect: t([
      { ID: 50, TriggerType: 1, SpellID: 500, LegacySlotIndex: 1 }, { ID: 51, TriggerType: 0, SpellID: 501, LegacySlotIndex: 0 },
      { ID: 52, TriggerType: 6, SpellID: 502, LegacySlotIndex: 2 }, { ID: 53, TriggerType: 2, SpellID: 503, LegacySlotIndex: 3 },
    ]),
    ItemXItemEffect: t([{ ID: 1, ItemID: 1, ItemEffectID: 50 }, { ID: 2, ItemID: 1, ItemEffectID: 51 }, { ID: 3, ItemID: 1, ItemEffectID: 52 }, { ID: 4, ItemID: 1, ItemEffectID: 53 }]),
  };
  const describe = (id: number) => ({ 500: "Synthetic equip effect.", 501: "Restores [?] health.", 502: "Teaches something." } as Record<number, string>)[id] ?? null;
  const { records } = buildItemSet((n) => tables[n], undefined, describe);
  expect(records.get(1)).toMatchObject({
    is: { id: 7, n: "Synthetic Battlegear" }, lc: "Unique-Equipped: Synthetic Signet (1)",
    cr: ["Classes: Warrior", "Races: Human, Dwarf"], rq: ["Requires Tailoring (150)", "Requires Synthetic Guild - Honored"],
    // In slot order; the learning spell prints nothing, nor does a spell without a description.
    fx: ["Use: Restores [?] health.", "Equip: Synthetic equip effect."],
  });
  // Every class and every announced race: no line. A nameless category keeps its kind and count; the PvP rank is only a number.
  expect(records.get(2)).toMatchObject({ lc: "Unique (2)", cr: [], rq: ["Requires Synthetic Training", "Requires PvP rank [?]"], fx: [] });
  expect(records.get(2)!.is).toBeUndefined();
  // A set, category or skill the tables do not have is marked, not dropped; the high word carries Skyborne.
  expect(records.get(3)).toMatchObject({ is: { id: 99, n: null }, lc: "Unique: [?]", cr: ["Classes: Warrior, Paladin"], rq: ["Requires [?] (1)"] });
  expect(records.get(3)!.cr).not.toContainEqual(expect.stringContaining("Races"));
  // Without a describer the effects are not read, so the record says nothing about them.
  expect(buildItemSet((n) => tables[n]).records.get(1)!.fx).toBeUndefined();
});

test("an allowlist limits the items, and a snapshot without item tables is refused", () => {
  expect([...buildItemSet((n) => itemTables[n], new Set([600])).records.keys()]).toEqual([600]);
  expect(() => buildItemSet(() => undefined)).toThrow(/client-extract --refresh/);
});

test("shards group items by id, and a page finds an item's shard from its id alone", () => {
  expect(shardOf(25)).toBe(0);
  expect(shardOf(ITEM_SHARD_SIZE)).toBe(1);
  const shards = shardRecords(buildItemSet((n) => itemTables[n]).records);
  expect([...shards.keys()]).toEqual([0, 1]);
  expect(Object.keys(shards.get(1)!)).toEqual(["600"]);
});

test("an item list is a JSON array or one id per line; anything else is an error", () => {
  expect([...parseItemIds("[25, 600]")]).toEqual([25, 600]);
  expect([...parseItemIds("25\r\n600\n")]).toEqual([25, 600]);
  expect(() => parseItemIds("25\nsword")).toThrow(/whole numbers/);
});

test("a map's tiles fill a grid that is cut to the picture; a hole is reported, a stray tile refused", () => {
  const layer = { width: 1002, height: 668, tileWidth: 256, tileHeight: 256 };
  const tiles = [0, 1, 2].flatMap((row) => [0, 1, 2, 3].map((col) => ({ row, col, fileId: 1000 + row * 4 + col })));
  expect(stitchPlan(layer, tiles)).toEqual({ cols: 4, rows: 3, canvas: { width: 1024, height: 768 }, crop: [0, 0, 1002, 668], missing: [] });
  expect(stitchPlan(layer, tiles.slice(1)).missing).toEqual([{ row: 0, col: 0 }]);
  expect(() => stitchPlan(layer, [...tiles, { row: 3, col: 0, fileId: 1 }])).toThrow(/outside/);
  expect(fitSize(1002, 668, 2048)).toEqual({ width: 1002, height: 668 });
  expect(fitSize(4008, 2672, 2048)).toEqual({ width: 2048, height: 1365 });
});

// A continent (UiMap 13) with one released zone (1429) and one held-back zone (2000), and a zone with no art.
const region = (n: number, s: number, w: number, e: number) => [n, w, 0, s, e, 0];
const mapTables: Record<string, Rows> = {
  Map: t([{ ID: 0, MapName_lang: "Eastern Kingdoms" }]),
  UiMap: t([
    { ID: 947, Name_lang: "Azeroth", Type: 1, ParentUiMapID: 0 },
    { ID: 13, Name_lang: "Eastern Kingdoms", Type: 2, ParentUiMapID: 947 },
    { ID: 1429, Name_lang: "Elwynn Forest", Type: 3, ParentUiMapID: 13 },
    { ID: 2000, Name_lang: "Secret Isle", Type: 3, ParentUiMapID: 13 },
    { ID: 1430, Name_lang: "No Art Vale", Type: 3, ParentUiMapID: 13 },
  ]),
  UiMapAssignment: t([
    { ID: 1, UiMapID: 13, MapID: 0, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: region(4000, -4000, 4000, -4000) },
    { ID: 2, UiMapID: 1429, MapID: 0, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: region(500, -500, 1000, 0) },
    { ID: 3, UiMapID: 2000, MapID: 0, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: region(3000, 2000, 3000, 2000) },
    { ID: 4, UiMapID: 1430, MapID: 0, OrderIndex: 0, UiMin: [0, 0], UiMax: [1, 1], Region: region(100, 0, 100, 0) },
  ]),
  UiMapXMapArt: t([
    { ID: 1, UiMapID: 13, UiMapArtID: 50, PhaseID: 0 },
    { ID: 2, UiMapID: 1429, UiMapArtID: 51, PhaseID: 0 },
    { ID: 3, UiMapID: 1429, UiMapArtID: 99, PhaseID: 7 },
    { ID: 4, UiMapID: 2000, UiMapArtID: 52, PhaseID: 0 },
  ]),
  UiMapArt: t([{ ID: 50, UiMapArtStyleID: 1 }, { ID: 51, UiMapArtStyleID: 1 }, { ID: 52, UiMapArtStyleID: 1 }, { ID: 99, UiMapArtStyleID: 1 }]),
  UiMapArtStyleLayer: t([
    { ID: 1, UiMapArtStyleID: 1, LayerIndex: 0, LayerWidth: 500, LayerHeight: 256, TileWidth: 256, TileHeight: 256 },
    { ID: 2, UiMapArtStyleID: 1, LayerIndex: 1, LayerWidth: 1000, LayerHeight: 512, TileWidth: 256, TileHeight: 256 },
  ]),
  UiMapArtTile: t([
    ...[50, 51, 52, 99].flatMap((art) => [0, 1].map((col) => ({ UiMapArtID: art, LayerIndex: 0, RowIndex: 0, ColIndex: col, FileDataID: art * 10 + col }))),
    { UiMapArtID: 51, LayerIndex: 1, RowIndex: 0, ColIndex: 0, FileDataID: 9999 },
  ]),
};

test("map art is planned per continent and zone from the art tables, phased art and sharper layers left out", () => {
  const { targets, skipped } = planMapArt((n) => mapTables[n]);
  expect(targets.map((m) => [m.uiMapId, m.kind, m.heldBack])).toEqual([[13, "continent", false], [1429, "zone", false], [2000, "zone", true]]);
  const elwynn = targets.find((m) => m.uiMapId === 1429)!;
  expect(elwynn.artId).toBe(51);
  expect(elwynn.tiles.map((x) => x.fileId)).toEqual([510, 511]);
  expect(elwynn.rect).toEqual({ left: 1000, top: 500, right: 0, bottom: -500 });
  expect(skipped).toEqual(["No Art Vale (1430): no art in this build"]);
});
