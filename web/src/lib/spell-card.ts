import type { ClientSpell, ClientSpells } from "@kb/client-spells";
import { CLIENT_SPELLS } from "@/data/game-data/client-spells";
import { CLIENT_CLASS_SPELLS } from "@/data/game-data/client-class-spells";
import { CLIENT_ITEM_SETS } from "@/data/game-data/client-item-sets";
import { mountEntries, petEntries, type MountEntry } from "@/lib/collectibles";
import type { ClientPet } from "@kb/client-collections";
import type { ClassSlug } from "@/lib/class-context";

/**
 * A spell page's tooltip and facts from the committed spell numbers (data/game-data/client-spells.json): the lines the
 * game's spell tooltip prints under the name (cost and range, cast time and cooldown), the school, the rank chain the
 * skill lines give, and what uses the spell (items, item sets, mounts, companion pets, classes). Only what the files
 * hold: a field they leave out gives no line, never a guess.
 */

export const SPELLS_BUILD = CLIENT_SPELLS.build.version;

export const spellNumbers = (id: number, table: ClientSpells = CLIENT_SPELLS): ClientSpell | undefined => table.spells[String(id)];

/** SpellMisc.SchoolMask bits in the game's order, the same order as ItemSparse.DamageType. */
const SCHOOLS = ["Physical", "Holy", "Fire", "Nature", "Frost", "Shadow", "Arcane"] as const;

export function schoolNames(mask: number | undefined): string[] {
  if (!mask) return [];
  return SCHOOLS.filter((_, bit) => mask & (1 << bit));
}

/** Seconds the way the game's tooltip prints them: "1.5 sec", "2 min", "1 hour". */
export function timeText(ms: number): string {
  const s = ms / 1000;
  const round = (n: number) => String(Math.round(n * 100) / 100);
  if (s >= 3600) return `${round(s / 3600)} ${s / 3600 === 1 ? "hour" : "hours"}`;
  if (s >= 60) return `${round(s / 60)} min`;
  return `${round(s)} sec`;
}

/** A power tag from the files (MANA, COMBO_POINTS) as a word: Mana, Combo Points. */
const powerWord = (tag: string) => tag.toLowerCase().split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

export function costText([type, amount, pct]: [number, number, number], table: ClientSpells = CLIENT_SPELLS): string {
  const word = table.powerTypes[String(type)];
  if (pct > 0) return word ? `${pct}% of base ${word.toLowerCase().replace(/_/g, " ")}` : `${pct}% of base power`;
  return `${amount} ${word ? powerWord(word) : `power ${type}`}`;
}

export function rangeText(range: ClientSpell["range"]): string | null {
  if (!range) return null;
  const [min, max, melee] = range;
  if (melee) return "Melee Range";
  return min > 0 ? `${min}-${max} yd range` : `${max} yd range`;
}

export function castText(s: ClientSpell): string | null {
  if (s.passive) return null;
  if (s.channeled) return "Channeled";
  return s.castMs ? `${timeText(s.castMs)} cast` : "Instant";
}

export function durationText(ms: number | undefined): string | null {
  if (!ms) return null;
  return ms < 0 ? "Until cancelled" : timeText(ms);
}

/**
 * The tooltip lines under the name, as the game lays them out: cost on the left and range on the right, then cast time
 * and cooldown; "Passive" for a passive spell. A pair with one side only keeps its side.
 */
export function tooltipRows(s: ClientSpell, table: ClientSpells = CLIENT_SPELLS): { left: string | null; right: string | null }[] {
  const rows = [
    { left: s.costs?.length ? s.costs.map((c) => costText(c, table)).join(", ") : null, right: rangeText(s.range) },
    { left: castText(s), right: s.cooldownMs ? `${timeText(s.cooldownMs)} cooldown` : null },
  ];
  return [...(s.passive ? [{ left: "Passive", right: null }] : []), ...rows.filter((r) => r.left || r.right)];
}

/** One effect's value the way the talent tooltips resolve it: with dice base+1 to base+sides, with a variance a spread. */
export function effectValue([, base, dieSides, , , , variance]: NonNullable<ClientSpell["effects"]>[number]): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  if (variance > 0) {
    const [lo, hi] = [Math.round(base * (1 - variance / 2)), Math.round(base * (1 + variance / 2))];
    return lo === hi ? n(lo) : `${n(lo)} to ${n(hi)}`;
  }
  if (dieSides > 1) return `${n(base + 1)} to ${n(base + dieSides)}`;
  return n(base + (dieSides === 1 ? 1 : 0));
}

/** The files' dispel type and mechanic names for a spell, the mechanic with a capital as a fact label. */
export function dispelName(s: ClientSpell, table: ClientSpells = CLIENT_SPELLS): string | null {
  return s.dispel ? table.dispelTypes[String(s.dispel)] ?? null : null;
}
export function mechanicName(s: ClientSpell, table: ClientSpells = CLIENT_SPELLS): string | null {
  const word = s.mechanic ? table.mechanics[String(s.mechanic)] : undefined;
  return word ? word[0]!.toUpperCase() + word.slice(1) : null;
}

/**
 * The spell's ranks, lowest first, from the skill lines' "replaces" links (SkillLineAbility.SupercedesSpell): back to
 * the first rank, then forward. Where one spell is replaced by two, the lower id carries the chain on. A spell no rank
 * link touches gives an empty list.
 */
export function spellRanks(id: number, table: ClientSpells = CLIENT_SPELLS): number[] {
  let next = nextRanks.get(table);
  if (!next) {
    next = new Map<number, number>();
    for (const [key, s] of Object.entries(table.spells)) {
      if (!s.supersedes) continue;
      const cur = next.get(s.supersedes);
      if (cur === undefined || Number(key) < cur) next.set(s.supersedes, Number(key));
    }
    nextRanks.set(table, next);
  }
  if (!table.spells[String(id)]?.supersedes && !next.has(id)) return [];
  let first = id;
  const seen = new Set([first]);
  for (let prev = table.spells[String(first)]?.supersedes; prev && !seen.has(prev); prev = table.spells[String(first)]?.supersedes) {
    first = prev;
    seen.add(prev);
  }
  const chain = [first];
  for (let n = next.get(first); n !== undefined && !chain.includes(n); n = next.get(n)) chain.push(n);
  return chain;
}

/** Each table's "replaced by" links, built once: search asks for a rank per suggested spell, per keystroke. */
const nextRanks = new WeakMap<ClientSpells, Map<number, number>>();

/** The spell's rank in its chain (1 for the first), as its page prints it; undefined for a spell with no ranks. */
export function spellRank(id: number, table: ClientSpells = CLIENT_SPELLS): number | undefined {
  const chain = spellRanks(id, table);
  return chain.length > 1 ? chain.indexOf(id) + 1 : undefined;
}

export const ITEM_TRIGGER = { 0: "Use", 1: "Equip", 2: "Chance on hit" } as Record<number, string>;

export interface SpellUses {
  items: { item: number; trigger: number }[];
  sets: { set: number; pieces: number }[];
  mounts: MountEntry[];
  pets: ClientPet[];
  classes: ClassSlug[];
}

/** What uses the spell in the committed files: items whose Use, Equip or Chance on hit line casts it, set bonuses, mounts, companion pets and the classes whose skill lines list it. */
export function spellUses(id: number, table: ClientSpells = CLIENT_SPELLS): SpellUses {
  return {
    items: (table.spells[String(id)]?.items ?? []).map(([item, trigger]) => ({ item, trigger })),
    sets: CLIENT_ITEM_SETS.sets.flatMap((s) => s.bonuses.filter(([, spell]) => spell === id).map(([pieces]) => ({ set: s.id, pieces }))),
    mounts: (mountEntries() ?? []).filter((m) => m.spellId === id),
    pets: (petEntries() ?? []).filter((p) => p.spellId === id),
    classes: Object.entries(CLIENT_CLASS_SPELLS.classes).filter(([, c]) => c.spells.includes(id)).map(([slug]) => slug as ClassSlug),
  };
}
