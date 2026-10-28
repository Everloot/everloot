// Words for the numbers in an item record (kb/src/assets/items.ts): quality, binding, slot, armour and
// weapon kind, stat kind. These are the client's own enumerations, as the WoWDev wiki documents them.
// A number this file does not know is printed as unknown, never guessed; a stat kind it does not know is left out.
import { ITEM_FACTS } from "@everloot/protocol";
import { tokens } from "@/design/tokens";
import { formatCopper } from "../../../kb/src/market";
import type { ItemRecord } from "../../../kb/src/assets/items";
import { checkedDamageRange, CHECKED_WEAPONS, type CheckedDamageRange, type CheckedWeapon } from "../../../kb/src/assets/weapon-damage";
import type { ItemFactName, ItemFactState } from "../../../kb/src/item-facts";
import { PLACEHOLDER } from "./placeholder";

export { PLACEHOLDER };

export const QUALITY_NAMES = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"] as const;

/** Item name colour on the always-dark tooltip: the dark theme's quality colours, then the game's for 6 and 7. */
export function qualityColor(q: number): string {
  const named = ["poor", "common", "uncommon", "rare", "epic", "legendary"] as const;
  if (q >= 0 && q < named.length) return tokens.dark[`q-${named[q]}`];
  return q === 6 ? "#E6CC80" : q === 7 ? "#00CCFF" : tokens.dark["q-common"];
}

const BINDING: Record<number, string> = { 1: "Binds when picked up", 2: "Binds when equipped", 3: "Binds when used", 4: "Quest Item" };

const SLOT: Record<number, string> = {
  1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands",
  11: "Finger", 12: "Trinket", 13: "One-Hand", 14: "Off Hand", 15: "Ranged", 16: "Back", 17: "Two-Hand", 18: "Bag", 19: "Tabard",
  20: "Chest", 21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand", 24: "Projectile", 25: "Thrown", 26: "Ranged", 28: "Relic",
};

const WEAPON: Record<number, string> = {
  0: "Axe", 1: "Axe", 2: "Bow", 3: "Gun", 4: "Mace", 5: "Mace", 6: "Polearm", 7: "Sword", 8: "Sword", 10: "Staff",
  13: "Fist Weapon", 14: "Miscellaneous", 15: "Dagger", 16: "Thrown", 18: "Crossbow", 19: "Wand", 20: "Fishing Pole",
};
const ARMOR: Record<number, string> = { 1: "Cloth", 2: "Leather", 3: "Mail", 4: "Plate", 6: "Shield", 7: "Libram", 8: "Idol", 9: "Totem" };
/** Armor subclasses that carry an armor value (cloth to plate, shields), and the slots that never do (shirt, tabard). */
const ARMORED = new Set([1, 2, 3, 4, 6]);
const NO_ARMOR_SLOT = new Set([4, 19]);

/** ItemSparse.DamageType, the damage school; physical damage prints no school word. */
const SCHOOL: Record<number, string> = { 0: "", 1: "Holy ", 2: "Fire ", 3: "Nature ", 4: "Frost ", 5: "Shadow ", 6: "Arcane " };

const STAT: Record<number, string> = {
  1: "Health", 3: "Agility", 4: "Strength", 5: "Intellect", 6: "Spirit", 7: "Stamina", 12: "Defense Rating", 13: "Dodge Rating",
  14: "Parry Rating", 15: "Block Rating", 31: "Hit Rating", 32: "Critical Strike Rating", 35: "Resilience Rating", 36: "Haste Rating",
  37: "Expertise Rating", 38: "Attack Power", 43: "Mana Regeneration", 45: "Spell Power",
};

/** Item class 2 is weapons, 4 armour; other classes carry no kind on the slot line. */
function kind(c: number | null, sc: number | null): string | null {
  if (c === 2 && sc !== null) return WEAPON[sc] ?? null;
  if (c === 4 && sc !== null && sc > 0) return ARMOR[sc] ?? null;
  return null;
}

export interface ItemTipText {
  name: string;
  quality: string;
  /** The tooltip's lines under the name, in the game's order. */
  lines: string[];
  /** True when a line holds the placeholder for a value the tables do not give (damage, armor, stat amounts). */
  partial: boolean;
  /**
   * Why each kind of placeholder is there, in plain words: one line per kind the tooltip holds. A damage range the
   * files give is printed only once checked in the game, and then a line here says so.
   */
  why: string[];
}

/** What a placeholder stands for, by kind. A reason says what the files lack, never only that a value is unknown. */
export const WHY = {
  stats: `${PLACEHOLDER} stat amounts: this build's item tables name the stats but hold no amounts; the game works them out from tables we do not read.`,
  armor: `${PLACEHOLDER} armor: this build's item tables hold no armor value; the game works it out from tables we do not read.`,
  damage: `${PLACEHOLDER} damage: the game works it out from its weapon damage tables, the weapon speed and its own rounding. No range is shown until one is checked against the game's own tooltip.`,
  effect: `${PLACEHOLDER} in a Use, Equip or Chance on hit line: a value the spell tables we read do not give.`,
  restriction: `${PLACEHOLDER} in a restriction: the game files give the requirement but not its name.`,
  set: `${PLACEHOLDER} set: the game files list the item in a set but give the set no name.`,
  older: `${PLACEHOLDER} restrictions, set and Use and Equip lines: the item file the site reads was written before these were read from the game files.`,
} as const;

/** Where a printed range came from: the game files, and the weapons from its table that were checked in the game, and when. */
export function damageSource(range: CheckedDamageRange, line: string): string {
  const days = [...new Set(range.checked.map((c) => c.seen))].sort();
  const builds = [...new Set(range.checked.map((c) => c.build))].sort();
  const weapons = `${range.checked.length} ${range.checked.length === 1 ? "weapon" : "weapons"}`;
  return `${line}: worked out from the game files (${range.table}, the weapon speed and its spread), `
    + `the way ${weapons} from that table read off the game's own tooltip on ${days.join(", ")} agree, build ${builds.join(", ")}.`;
}

/** The tooltip's lines and then the reasons for its placeholders, as every item card shows them. */
export const tipLines = (t: Pick<ItemTipText, "lines" | "why">): string[] => [...t.lines, ...t.why];

/**
 * The tooltip of an item as the game lays it out, from what the record holds. Armor and stat amounts are not in the
 * tables, and a damage range is not confirmed until a weapon from its table is in `checked`: `[?]`, with the reason
 * under the lines. A record from before 2026-10-22 has no restriction, set or Use and Equip lines, and gets `[?]` for those.
 */
export function itemTipText(r: ItemRecord, checked: readonly CheckedWeapon[] = CHECKED_WEAPONS): ItemTipText {
  const lines: string[] = [];
  const why = new Set<string>();
  if (BINDING[r.b]) lines.push(BINDING[r.b]);
  if (r.lc) lines.push(r.lc);
  else if (r.u === 1) lines.push("Unique");
  const slot = SLOT[r.s];
  const k = kind(r.c, r.sc);
  if (slot || k) lines.push([slot, k].filter(Boolean).join(" · "));
  // A weapon's damage is not in the 1.60.1 item tables (the client works it out from ItemDamage*), so its
  // damage line carries the placeholder until the range the files give is confirmed against the game's own
  // tooltip (CHECKED_WEAPONS); the per-second line is a player-reported number, never the files'. The speed sits
  // beside the damage, as in the game.
  const weapon = r.c === 2 && r.d > 0;
  const speed = r.d > 0 ? `Speed ${(r.d / 1000).toFixed(2)}` : null;
  const school = r.w ? SCHOOL[r.w.ds] : undefined;
  const range = weapon && school !== undefined ? checkedDamageRange(r, checked) : null;
  const damage = range ? `${range.min} - ${range.max} ${school}Damage` : `${PLACEHOLDER} - ${PLACEHOLDER} Damage`;
  if (weapon) lines.push(`${damage} · ${speed}`, `(${PLACEHOLDER} damage per second)`);
  else if (speed) lines.push(speed);
  // Cloth, leather, mail, plate and shields always carry armor in the game; its amount is not in the tables either.
  const armor = r.c === 4 && r.sc !== null && ARMORED.has(r.sc) && !NO_ARMOR_SLOT.has(r.s);
  if (armor) lines.push(`${PLACEHOLDER} Armor`);
  // A stat kind this file has no word for is left out rather than printed as "unknown stat 51".
  const stats = r.st.filter((s) => STAT[s]);
  for (const s of stats) lines.push(`+${PLACEHOLDER} ${STAT[s]}`);
  if (stats.length) why.add(WHY.stats);
  if (armor) why.add(WHY.armor);
  if (weapon && !range) why.add(WHY.damage);
  const known = r.cr !== undefined && r.rq !== undefined && r.fx !== undefined;
  // Classes and races, then the level, then the skill, spell and reputation, then the effects and the set, as the game orders them.
  lines.push(...(r.cr ?? []));
  if (r.r > 1) lines.push(`Requires Level ${r.r}`);
  lines.push(...(r.rq ?? []));
  if ([r.lc ?? "", ...(r.cr ?? []), ...(r.rq ?? [])].some((l) => l.includes(PLACEHOLDER))) why.add(WHY.restriction);
  if (r.l > 0) lines.push(`Item Level ${r.l}`);
  lines.push(...(r.fx ?? []));
  if (r.fx?.some((l) => l.includes(PLACEHOLDER))) why.add(WHY.effect);
  if (r.is) lines.push(`Set: ${r.is.n ?? PLACEHOLDER}`);
  if (r.is && !r.is.n) why.add(WHY.set);
  if (!known) {
    lines.push(`Restrictions: ${PLACEHOLDER}`, `Set: ${PLACEHOLDER}`, `Equip and Use: ${PLACEHOLDER}`);
    why.add(WHY.older);
  }
  if (r.t) lines.push(`"${r.t}"`);
  if (r.sp > 0) lines.push(`Sell Price: ${formatCopper(r.sp)}`);
  if (range) why.add(damageSource(range, damage));
  return { name: r.n, quality: QUALITY_NAMES[r.q] ?? `quality ${r.q}`, lines, partial: lines.some((l) => l.includes(PLACEHOLDER)), why: [...why] };
}

/* ---------- The numbers players' tooltips showed (kb/src/item-facts.ts) ---------- */

/** The word on each tooltip line a player can report, as the game prints it; the stats match `STAT`. */
export const FACT_WORD: Record<ItemFactName, string> = {
  armor: "Armor", block: "Block", damage_per_second: "damage per second", health: "Health", mana: "Mana",
  agility: "Agility", strength: "Strength", intellect: "Intellect", spirit: "Spirit", stamina: "Stamina",
  defense_rating: "Defense Rating", dodge_rating: "Dodge Rating", parry_rating: "Parry Rating", block_rating: "Block Rating",
  hit_rating: "Hit Rating", crit_rating: "Critical Strike Rating", haste_rating: "Haste Rating", expertise_rating: "Expertise Rating",
  resilience_rating: "Resilience Rating", attack_power: "Attack Power", mana_regeneration: "Mana Regeneration", spell_power: "Spell Power",
  holy_resistance: "Holy Resistance", fire_resistance: "Fire Resistance", nature_resistance: "Nature Resistance",
  frost_resistance: "Frost Resistance", shadow_resistance: "Shadow Resistance", arcane_resistance: "Arcane Resistance",
};

/** A fact's tooltip line with its number, or with the placeholder (null), exactly as `itemTipText` prints it. */
export function factLine(fact: ItemFactName, value: number | null): string {
  const n = value === null ? PLACEHOLDER : fact === "damage_per_second" ? value.toFixed(1) : String(value);
  if (fact === "damage_per_second") return `(${n} damage per second)`;
  if (fact === "armor" || fact === "block") return `${n} ${FACT_WORD[fact]}`;
  return `${value !== null && value < 0 ? "" : "+"}${n} ${FACT_WORD[fact]}`;
}

const NUMBER = String.raw`(?:\[\?\]|-?\d+(?:\.\d)?)`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FACT_LINE = ITEM_FACTS.map((fact) => ({
  fact,
  re: fact === "damage_per_second" ? new RegExp(`^\\(${NUMBER} damage per second\\)$`)
    : fact === "armor" || fact === "block" ? new RegExp(`^${NUMBER} ${FACT_WORD[fact]}$`)
    : new RegExp(`^\\+?${NUMBER} ${escape(FACT_WORD[fact])}$`),
}));
const rank = (fact: ItemFactName) => ITEM_FACTS.indexOf(fact);
const factOf = (line: string) => FACT_LINE.find((f) => f.re.test(line))?.fact ?? null;
/** The first line the game prints below the armour, stats and resistances. */
const BELOW_STATS = /^(Classes: |Races: |Requires |Item Level |Use: |Equip: |Chance on hit: |Set: |Restrictions: |Equip and Use: |"|Sell Price: )/;

/** Where a line the files did not print goes: after the facts that come before it in the game, else before the rest. */
function slotFor(lines: readonly string[], fact: ItemFactName): number {
  let after = -1;
  lines.forEach((line, i) => { const f = factOf(line); if (f && rank(f) < rank(fact)) after = i + 1; });
  if (after >= 0) return after;
  const before = lines.findIndex((line) => { const f = factOf(line); return (f && rank(f) > rank(fact)) || BELOW_STATS.test(line); });
  return before >= 0 ? before : lines.length;
}

const installs = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "install" : "installs"}`;

/**
 * The tooltip with the numbers 3 installs agree on in place of their placeholders, a line the files did not print
 * added where the game prints it, and one line per number saying how many installs reported it, from which build,
 * and when. A contested line keeps its placeholder and says why. The reasons for the stat and armour placeholders go
 * once no such placeholder is left.
 */
export function withReported<T extends Pick<ItemTipText, "lines" | "why" | "partial">>(tip: T, state: Pick<ItemFactState, "shown" | "contested">): T {
  if (!state.shown.length && !state.contested.length) return tip;
  const lines = [...tip.lines];
  const evidence: string[] = [];
  for (const f of state.shown) {
    const text = factLine(f.fact, f.value);
    const at = lines.indexOf(factLine(f.fact, null));
    if (at >= 0) lines[at] = text;
    else lines.splice(slotFor(lines, f.fact), 0, text);
    const seen = f.lastSeen ? f.lastSeen.slice(0, 10) : PLACEHOLDER;
    evidence.push(`${text.replace(/^\((.*)\)$/, "$1")}: reported by ${installs(f.reporters)}, last seen ${seen}, build ${f.build}.`);
  }
  const why = tip.why.filter((w) =>
    !(w === WHY.stats && !lines.some((l) => l.startsWith(`+${PLACEHOLDER} `))) && !(w === WHY.armor && !lines.includes(factLine("armor", null))));
  const disputed = state.contested.filter((fact) => lines.includes(factLine(fact, null))).map((fact) => FACT_WORD[fact]);
  if (disputed.length) why.push(`${PLACEHOLDER} ${disputed.join(", ")}: installs disagree on the number, so none is shown until 3 agree on one.`);
  return { ...tip, lines, why: [...why, ...evidence], partial: lines.some((l) => l.includes(PLACEHOLDER)) };
}
