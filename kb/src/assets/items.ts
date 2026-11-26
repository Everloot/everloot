/**
 * Item icon ids and item tooltip facts from the client's item tables, in shards the site reads on demand.
 * Pure: it takes a table reader and writes nothing. Only what the tables give is recorded. What they do
 * not give (stat amounts and armor: the client works those out from tables we do not read) is left out,
 * and the site shows `[?]` for it.
 *
 * Tables, with column names from WoWDBDefs:
 * - ItemSparse: name (Display_lang), flavour text (Description_lang), OverallQualityID, ItemLevel,
 *   RequiredLevel, Bonding, InventoryType, ItemDelay (ms), MaxCount (1 is "Unique"), SellPrice (copper),
 *   and the stat kinds of the item (StatModifier_bonusStat). StatPercentEditor is a share of a budget
 *   the client computes, not an amount, so no amount is recorded.
 * - Item: IconFileDataID, ClassID and SubclassID.
 * - The lines the game prints from ItemSparse ids: the set (ItemSet, ItemSet.Name_lang), the Unique-Equipped
 *   category (LimitCategory, ItemLimitCategory), who may use the item (AllowableClass with ChrClasses,
 *   AllowableRace with ChrRaces.PlayableRaceBit) and what it requires (RequiredSkill and RequiredSkillRank with
 *   SkillLine, RequiredAbility with SpellName, MinFactionID and MinReputation with Faction).
 * - ItemXItemEffect and ItemEffect: the item's Use, Equip and Chance on hit spells, whose descriptions the caller
 *   resolves (assets/tooltip.ts), so a value the spell tables do not give stays `[?]`.
 * - ItemDamage*: a weapon's damage per second by item level and quality. In 1.60.1 ItemSparse has no
 *   MinDamage/MaxDamage; the client works a weapon's damage out from this value, the weapon speed and
 *   ItemSparse.DmgVariance. Those inputs are recorded as the tables give them (`w`), not the damage:
 *   which table goes with which weapon kind (weaponDamageTable), how the client combines the value with the
 *   swing time, and its rounding are in no file. The two readings the files allow are DAMAGE_READINGS; the
 *   site prints "N - M Damage" only under the one that the weapons in CHECKED_WEAPONS, read off the game's
 *   own tooltip, all agree with, and only for the tables those weapons came from (weapon-damage.ts).
 *
 * The numbers for quality, binding, slot, class and subclass are the client's own enumerations (the
 * WoWDev wiki documents them); the names for them are in item-names.ts of the web app.
 */
import type { Rows, TableReader } from "../talents/build-catalog.js";
import { RACE_ATLAS } from "./banners.js";
import { PLACEHOLDER } from "./tooltip.js";
import type { WeaponDamageInputs } from "./weapon-damage.js";

/** Items per shard file. Items a page shows tend to sit near each other, so a page reads few shards. */
export const ITEM_SHARD_SIZE = 512;
export const shardOf = (itemId: number): number => Math.floor(itemId / ITEM_SHARD_SIZE);

/** One item as the site reads it. Short keys: the file holds thousands. */
export interface ItemRecord {
  /** Name. */
  n: string;
  /** Quality, 0 poor to 7 heirloom. */
  q: number;
  /** Item level. */
  l: number;
  /** Required level; 0 when there is none. */
  r: number;
  /** Bonding enum. */
  b: number;
  /** Inventory type enum; 0 is not worn. */
  s: number;
  /** Item class and subclass, null when the Item table has no row. */
  c: number | null;
  sc: number | null;
  /** Weapon delay in milliseconds; 0 when none. */
  d: number;
  /** Stat kinds (ITEM_MOD enum), in the order of the item. Amounts are not recorded. */
  st: number[];
  /** Sell price in copper. */
  sp: number;
  /** MaxCount: 1 is Unique. */
  u: number;
  /** Flavour text; omitted when empty. */
  t?: string;
  /** Icon file data id, set only after the icon file was extracted. */
  i?: number;
  /** Weapon damage inputs; omitted when the item is not a weapon or the build has no row for it. */
  w?: WeaponDamageInputs;
  /** The item set: its id and the files' name for it; omitted when the item is in none. */
  is?: { id: number; n: string | null };
  /** The Unique-Equipped or Unique category line, shown in place of "Unique"; omitted when there is none. */
  lc?: string;
  /**
   * "Classes: …" and "Races: …"; "Requires …" (skill, spell, reputation); and the "Use: …", "Equip: …" and
   * "Chance on hit: …" lines, as the game prints them. Every run since 2026-10-22 writes them, empty when there
   * are none: absent means an older shard, where they are not known, not that there are none.
   */
  cr?: string[];
  rq?: string[];
  fx?: string[];
}

/** ITEM_FLAG2_CASTER_WEAPON, in the second Flags word. */
const CASTER_WEAPON = 0x200;

/**
 * The ItemDamage table a weapon's damage per second is read from, by inventory type and weapon subclass:
 * the retail client's choice for one-hand, two-hand and ammo, and the Ranged, Thrown and Wand tables 1.60.1
 * adds for those kinds. Null for anything else.
 */
export function weaponDamageTable(inventoryType: number, subclass: number | null, caster: boolean): string | null {
  switch (inventoryType) {
    case 13: case 21: case 22: return caster ? "ItemDamageOneHandCaster" : "ItemDamageOneHand";
    case 17: return caster ? "ItemDamageTwoHandCaster" : "ItemDamageTwoHand";
    case 15: case 26: return subclass === 19 ? "ItemDamageWand" : subclass === 2 || subclass === 3 || subclass === 18 ? "ItemDamageRanged" : null;
    case 25: return "ItemDamageThrown";
    case 24: return "ItemDamageAmmo";
    default: return null;
  }
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const list = (rows: Rows | undefined) => [...(rows?.values() ?? [])];

/** ItemLimitCategory.Flags bit 0: the limit counts what is equipped, not what is carried. */
const LIMIT_EQUIPPED = 0x1;
/** Reputation standings, the client's enumeration. */
const STANDING = ["Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
/** ItemEffect.TriggerType: the word the game puts before the spell's description. Learning (6) and the rest print none. */
const TRIGGER: Record<number, string> = { 0: "Use", 1: "Equip", 2: "Chance on hit", 5: "Use" };

/** AllowableRace is 64 bits, read as two 32-bit words, low word first; -1 in both is every race. */
function raceBit(mask: unknown, bit: number): boolean {
  if (typeof mask === "number") return mask === -1 || (bit < 32 && ((mask >>> bit) & 1) === 1);
  if (!Array.isArray(mask)) return true;
  return ((num(mask[bit >> 5]) >>> (bit & 31)) & 1) === 1;
}

/** A spell's description, resolved, or null when it has none. */
export type DescribeSpell = (spellId: number) => string | null;

/** What the lines are read from, built once per run. */
function lineTables(get: TableReader) {
  const byId = (table: string) => new Map(list(get(table)).map((r) => [num(r.ID), r]));
  // Only the races announced for WoW: Forever (assets/banners.ts) count; an item all of them may use gets no line.
  const announced = new Set(Object.values(RACE_ATLAS).map((a) => a.file));
  const races = list(get("ChrRaces"))
    .filter((r) => typeof r.PlayableRaceBit === "number" && r.PlayableRaceBit >= 0 && announced.has(String(r.ClientFileString)))
    .map((r) => ({ bit: num(r.PlayableRaceBit), name: text(r.Name_lang) }))
    .sort((a, b) => a.bit - b.bit);
  const classes = list(get("ChrClasses")).map((r) => ({ id: num(r.ID), name: text(r.Name_lang) })).sort((a, b) => a.id - b.id);
  const effects = byId("ItemEffect");
  const effectsOf = new Map<number, Record<string, unknown>[]>();
  for (const x of list(get("ItemXItemEffect"))) {
    const e = effects.get(num(x.ItemEffectID));
    if (e) effectsOf.set(num(x.ItemID), [...(effectsOf.get(num(x.ItemID)) ?? []), e]);
  }
  for (const rows of effectsOf.values()) rows.sort((a, b) => num(a.LegacySlotIndex) - num(b.LegacySlotIndex) || num(a.ID) - num(b.ID));
  return {
    sets: byId("ItemSet"), limits: byId("ItemLimitCategory"), skills: byId("SkillLine"), factions: byId("Faction"), spells: byId("SpellName"),
    races, classes, effectsOf, hasEffects: Boolean(get("ItemEffect") && get("ItemXItemEffect")),
  };
}
type LineTables = ReturnType<typeof lineTables>;

/** "Classes: Warrior, Paladin" and "Races: Human, Dwarf", only where a mask leaves someone out. */
function whoLines(row: Record<string, unknown>, at: LineTables): string[] {
  const out: string[] = [];
  const classMask = num(row.AllowableClass);
  const classes = at.classes.filter((c) => ((classMask >>> (c.id - 1)) & 1) === 1);
  if (classMask !== -1 && classMask !== 0 && classes.length < at.classes.length) out.push(`Classes: ${classes.map((c) => c.name ?? PLACEHOLDER).join(", ") || PLACEHOLDER}`);
  const races = at.races.filter((r) => raceBit(row.AllowableRace, r.bit));
  if (races.length < at.races.length) out.push(`Races: ${races.map((r) => r.name ?? PLACEHOLDER).join(", ") || PLACEHOLDER}`);
  return out;
}

/** "Requires Tailoring (150)", "Requires <spell>", "Requires Argent Dawn - Honored", and the PvP rank the files only number. */
function requireLines(row: Record<string, unknown>, at: LineTables): string[] {
  const out: string[] = [];
  const skill = num(row.RequiredSkill), rank = num(row.RequiredSkillRank);
  if (skill > 0) out.push(`Requires ${text(at.skills.get(skill)?.DisplayName_lang) ?? PLACEHOLDER}${rank > 0 ? ` (${rank})` : ""}`);
  const ability = num(row.RequiredAbility);
  if (ability > 0) out.push(`Requires ${text(at.spells.get(ability)?.Name_lang) ?? PLACEHOLDER}`);
  const faction = num(row.MinFactionID);
  if (faction > 0) out.push(`Requires ${text(at.factions.get(faction)?.Name_lang) ?? PLACEHOLDER} - ${STANDING[num(row.MinReputation)] ?? PLACEHOLDER}`);
  // The rank's name depends on the player's faction; the files hold only its number.
  if (num(row.RequiredPVPRank) > 0) out.push(`Requires PvP rank ${PLACEHOLDER}`);
  return out;
}

/** "Unique-Equipped: Hand of Justice (1)"; a category without a name keeps its kind, and its count past one. */
function limitLine(row: Record<string, unknown>, at: LineTables): string | null {
  const id = num(row.LimitCategory);
  if (id <= 0) return null;
  const limit = at.limits.get(id);
  if (!limit) return `Unique: ${PLACEHOLDER}`;
  const kind = num(limit.Flags) & LIMIT_EQUIPPED ? "Unique-Equipped" : "Unique";
  const name = text(limit.Name_lang), count = num(limit.Quantity);
  return name ? `${kind}: ${name} (${count})` : count > 1 ? `${kind} (${count})` : kind;
}

/** "Equip: …" and the rest, for the spells that have a description: one without prints nothing in the game either. */
function effectLines(itemId: number, at: LineTables, describe: DescribeSpell): string[] {
  const out: string[] = [];
  for (const e of at.effectsOf.get(itemId) ?? []) {
    const word = TRIGGER[num(e.TriggerType)];
    const description = word ? describe(num(e.SpellID)) : null;
    if (word && description) out.push(`${word}: ${description}`);
  }
  return out;
}

export interface ItemSet {
  records: Map<number, ItemRecord>;
  /** Icon file data id per item, from Item.IconFileDataID, for every record that has one. */
  iconOf: Map<number, number>;
  /**
   * Icon file data id per item the Item table lists with no named ItemSparse row: Forever's server sends those rows
   * while the game runs, so the files give the item's icon and nothing else. Kept apart from `records`.
   */
  iconOnly: Map<number, number>;
}

/** A shard entry for an item the files give only an icon for (`ItemSet.iconOnly`). */
export interface IconOnlyRecord { i: number }

/**
 * The item records, for every ItemSparse row (or only for `only`, when given) that has a name. Without `describe`
 * the Use and Equip lines are not read, and `fx` is left out.
 */
export function buildItemSet(get: TableReader, only?: ReadonlySet<number>, describe?: DescribeSpell): ItemSet {
  const sparse = get("ItemSparse"), item = get("Item");
  if (!sparse || !item) throw new Error("the snapshot has no ItemSparse and Item tables; run `client-extract --refresh` first");
  const records = new Map<number, ItemRecord>();
  const iconOf = new Map<number, number>();
  // Damage per second by table and item level: the Quality column, one value per quality.
  const damage = new Map<string, Map<number, unknown[]>>();
  const damageAt = (table: string, level: number): unknown[] | undefined => {
    if (!damage.has(table)) damage.set(table, new Map(list(get(table)).map((r) => [num(r.ItemLevel), Array.isArray(r.Quality) ? r.Quality : []])));
    return damage.get(table)!.get(level);
  };
  const at = lineTables(get);
  for (const row of list(sparse)) {
    const id = num(row.ID);
    const name = text(row.Display_lang);
    if (id <= 0 || !name || (only && !only.has(id))) continue;
    const base = item.get(id);
    const stats = (Array.isArray(row.StatModifier_bonusStat) ? row.StatModifier_bonusStat : []).map(num);
    const percents = Array.isArray(row.StatPercentEditor) ? row.StatPercentEditor.map(num) : [];
    // -1 is an empty slot. A stat kind with a zero share is a slot the client does not use either.
    const st = stats.filter((s, i) => s > 0 && (percents[i] ?? 0) !== 0);
    const flavour = text(row.Description_lang);
    const record: ItemRecord = {
      n: name, q: num(row.OverallQualityID), l: num(row.ItemLevel), r: num(row.RequiredLevel), b: num(row.Bonding), s: num(row.InventoryType),
      c: base ? num(base.ClassID) : null, sc: base ? num(base.SubclassID) : null,
      d: num(row.ItemDelay), st, sp: num(row.SellPrice), u: num(row.MaxCount),
    };
    if (flavour) record.t = flavour;
    const flags = Array.isArray(row.Flags) ? row.Flags.map(num) : [];
    const table = record.c === 2 || record.s === 24 ? weaponDamageTable(record.s, record.sc, ((flags[1] ?? 0) & CASTER_WEAPON) !== 0) : null;
    const dps = table ? damageAt(table, record.l)?.[record.q] : undefined;
    if (table && typeof dps === "number" && dps > 0) record.w = { t: table, dps, dv: num(row.DmgVariance), ds: num(row.DamageType) };
    const setId = num(row.ItemSet);
    if (setId > 0) record.is = { id: setId, n: text(at.sets.get(setId)?.Name_lang) };
    const limit = limitLine(row, at);
    if (limit) record.lc = limit;
    record.cr = whoLines(row, at);
    record.rq = requireLines(row, at);
    if (describe && at.hasEffects) record.fx = effectLines(id, at, describe);
    records.set(id, record);
    const icon = base ? num(base.IconFileDataID) : 0;
    if (icon > 0) iconOf.set(id, icon);
  }
  const iconOnly = new Map<number, number>();
  for (const row of list(item)) {
    const id = num(row.ID), icon = num(row.IconFileDataID);
    if (id > 0 && icon > 0 && !records.has(id) && (!only || only.has(id))) iconOnly.set(id, icon);
  }
  return { records, iconOf, iconOnly: new Map([...iconOnly].sort((a, b) => a[0] - b[0])) };
}

/**
 * Records grouped into shards, each as `{ "<item id>": record }`, ordered by id. `icons` adds `{ i }` entries for
 * items the files give only an icon for (an id that also has a record keeps the record).
 */
export function shardRecords(records: ReadonlyMap<number, ItemRecord>, icons: ReadonlyMap<number, number> = new Map()): Map<number, Record<string, ItemRecord | IconOnlyRecord>> {
  const out = new Map<number, Record<string, ItemRecord | IconOnlyRecord>>();
  const ids = [...new Set([...records.keys(), ...icons.keys()])].sort((a, b) => a - b);
  for (const id of ids) {
    const shard = shardOf(id);
    const into = out.get(shard) ?? {};
    into[String(id)] = records.get(id) ?? { i: icons.get(id)! };
    out.set(shard, into);
  }
  return out;
}

/** An allowlist file: a JSON array of ids, or one id per line. Anything else is an error, not an empty list. */
export function parseItemIds(raw: string): Set<number> {
  const trimmed = raw.trim();
  const ids = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as unknown[]).map((v) => Number(v))
    : trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => Number(l));
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new Error("the item list must hold positive whole numbers only");
  return new Set(ids);
}
