import { describePlayer } from "@/app/players/player-view";
import { CLASSES } from "@/design/tokens";
import { characterPath } from "@/lib/player-pages";
import { savedBuildsOn } from "@/lib/saved-builds";

/**
 * The character showcase (docs/design/2026-11-01-character-showcase-plan.md): one character's page, published by
 * the player who linked it, from that player's own addon uploads. This file turns plain inputs into what the page
 * and its share card draw; it reads nothing itself. Until the link and sync slices land, only the sample at
 * /showcase/character feeds it (data/showcase.ts).
 */

/** The owner's switch for the showcase pages and their cards. Off, every one of them is a 404. */
export function showcaseOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_SHOWCASE === "1";
}

/**
 * Planned builds on the showcase pages (slice S4): an owner attaches one of their build labels to a link, and the
 * page lists that label's shared builds. Its own switch, because it needs 20261102120000_build_label_links.sql while
 * the pages do not, and it needs the pages and saved builds on as well. Off, nothing reads or writes a label's link.
 */
export function showcaseBuildsOn(env: Record<string, string | undefined> = process.env): boolean {
  return showcaseOn(env) && savedBuildsOn(env) && env.EVERLOOT_SHOWCASE_BUILDS === "1";
}

/**
 * A linked character's public page: the character's one page, the same address a sighting links to. The page
 * keeps the two apart: the showcase draws only from the link row, never from a sighting.
 */
export { characterPath };

/** A section older than this says it may be out of date. */
export const STALE_DAYS = 14;

/**
 * Where a section stands. `shown`: synced and switched on, with its own date. `empty`: nothing synced yet.
 * `private`: the owner switched it off. `unsupported`: the game does not report it to addons, so there is no value,
 * never a zero.
 */
export type SectionState = "shown" | "empty" | "private" | "unsupported";
export type Section<T> = { state: "shown"; asOf: string; data: T } | { state: Exclude<SectionState, "shown"> };

/**
 * The equipment slots in the game's own order: the character window's left column, its right column, then the
 * weapons row. A slot with no row is drawn empty, never left out.
 */
export const GEAR_SLOTS = {
  head: "Head", neck: "Neck", shoulders: "Shoulders", back: "Back", chest: "Chest", shirt: "Shirt", tabard: "Tabard", wrists: "Wrists",
  hands: "Hands", waist: "Waist", legs: "Legs", feet: "Feet", finger1: "Finger 1", finger2: "Finger 2", trinket1: "Trinket 1", trinket2: "Trinket 2",
  mainHand: "Main hand", offHand: "Off hand", ranged: "Ranged or relic",
} as const;
export type GearSlot = keyof typeof GEAR_SLOTS;
export const PAPER_DOLL: { left: GearSlot[]; right: GearSlot[]; weapons: GearSlot[] } = {
  left: ["head", "neck", "shoulders", "back", "chest", "shirt", "tabard", "wrists"],
  right: ["hands", "waist", "legs", "feet", "finger1", "finger2", "trinket1", "trinket2"],
  weapons: ["mainHand", "offHand", "ranged"],
};

export interface GearRow {
  slot: GearSlot;
  itemId: number;
  /** Null until the item rules allow a name (3 installs, or the item name rule): shown as "Item <id>". */
  name: string | null;
  /** The game files' quality, 0 poor to 5 legendary, for the name's colour; null when not known. */
  quality: number | null;
  itemLevel: number;
  /** The item's game icon, only where the item lists would show it (docs/ASSETS.md); the page fills it. */
  icon?: string | null;
}

/** Every slot in the game's order, with the row equipped there or null for an empty slot. */
export function paperDoll(rows: readonly GearRow[]): Record<GearSlot, GearRow | null> {
  const by = Object.fromEntries((Object.keys(GEAR_SLOTS) as GearSlot[]).map((k) => [k, null])) as Record<GearSlot, GearRow | null>;
  for (const r of rows) by[r.slot] = r;
  return by;
}

/**
 * The character sheet's numbers, grouped as the game groups them. No collector records them yet, so real pages
 * hold this `unsupported`; only the sample fills it.
 */
export const STAT_GROUPS = ["Attributes", "Melee", "Ranged", "Spell", "Defense"] as const;
export type StatsData = { group: (typeof STAT_GROUPS)[number]; stats: { label: string; value: string }[] }[];
export interface TalentsData {
  /** The active spec's trees and points, as the snapshot holds them. */
  trees: { name: string; points: number }[];
  /** The calculator's share code for the snapshot, when it converts; the link then opens the build. */
  code: string | null;
  /** Saved builds the owner attached to the character (/b/<slug>). */
  planned: { name: string; slug: string }[];
}
/** One linked character's PvP standing. A number the game did not report is null, and its line is not drawn. */
export interface PvpData {
  rank: number | null;
  rankPoints: number | null;
  rankThreshold: number | null;
  rankMax: number | null;
  season: number | null;
  honorableKills: number | null;
}
export interface ProfessionRow { name: string; rank: number; maxRank: number }
/** A faction the catalog agrees on. A renown faction has ranks, not standings, and is not supported yet. */
export type ReputationRow = { faction: string; standing: string; value: number; max: number } | { faction: string; renown: true };
export interface RaidsData {
  /** This character's lockouts this week. */
  lockouts: {
    instance: string; difficulty: string; killed: number; total: number;
    /** The reset day, YYYY-MM-DD. */
    resets: string;
    /** Each boss in encounter order, for the strip; empty when the lockout names none. */
    bosses: { name: string; killed: boolean }[];
  }[];
  /** The guild's agreed kills: the guild's progress, not this character's attendance. Null when the guild is not shown. */
  guildKills: { instance: string; killed: number; total: number }[] | null;
}
/** The order the game lists standings in, best first: the reputation list is grouped by it. */
export const STANDINGS = ["Exalted", "Revered", "Honored", "Friendly", "Neutral", "Unfriendly", "Hostile", "Hated"] as const;

/**
 * The factions grouped by standing, best first, as the game's reputation window orders them. A standing the list
 * does not know comes after the known ones; renown factions come last, in a group of their own.
 */
export function reputationGroups(rows: readonly ReputationRow[]): { standing: string; rows: ReputationRow[] }[] {
  const rank = (r: ReputationRow) => {
    if ("renown" in r) return STANDINGS.length + 1;
    const i = (STANDINGS as readonly string[]).indexOf(r.standing);
    return i < 0 ? STANDINGS.length : i;
  };
  const groups = new Map<string, ReputationRow[]>();
  for (const r of [...rows].sort((a, b) => rank(a) - rank(b))) {
    const key = "renown" in r ? "Renown" : r.standing;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([standing, list]) => ({ standing, rows: list }));
}

/** The progress the completion rows hold: achievements, titles and quests. */
export interface CollectionsData {
  achievements: number;
  points: number;
  /** The newest achievements first, with the day each was earned. */
  recent: { name: string; date: string }[];
  /** Achievements earned out of those the catalog lists, per category. */
  categories: { name: string; done: number; total: number }[];
  titles: string[];
  /** Quests completed; null when the rows hold no count, drawn as a line, never a zero. */
  quests: number | null;
}

export interface ShowcaseInput {
  /** Fixtures only: the page and card say so. */
  sample: boolean;
  /** The page's own address. */
  path: string;
  name: string;
  level: number;
  /** Store tokens, as the census writes them: "Orc", "SHAMAN". */
  race: string;
  class: string;
  /** Null for a race with no side (Skyborne). */
  faction: "Alliance" | "Horde" | null;
  realm: string;
  /** The title the character wears, as the game writes it; null for none or none synced. */
  title: string | null;
  /** Null unless the owner shows it. `path` only when the guild's page is public. */
  guild: { name: string; path: string | null } | null;
  /** The newest upload any shown section came from, YYYY-MM-DD. */
  lastUpload: string;
  gear: Section<GearRow[]>;
  stats: Section<StatsData>;
  talents: Section<TalentsData>;
  pvp: Section<PvpData>;
  professions: Section<ProfessionRow[]>;
  reputations: Section<ReputationRow[]>;
  raids: Section<RaidsData>;
  collections: Section<CollectionsData>;
}

export type SectionKey = "gear" | "stats" | "talents" | "pvp" | "raids" | "collections" | "reputations" | "professions";
/** Page order: the character sheet first, then what the character has done, then its standing and trades. */
export const SECTION_TITLES: Record<SectionKey, string> = {
  gear: "Gear",
  stats: "Stats",
  talents: "Talents",
  pvp: "PvP",
  raids: "Raids",
  collections: "Progress",
  reputations: "Reputations",
  professions: "Professions",
};

/** The lines each state stands for; nothing is estimated in their place. */
export const EMPTY_LINE = "Nothing synced for this yet.";
export const PRIVATE_LINE = "Hidden from the public page.";
export const UNSUPPORTED_LINE = "The game does not report this to addons yet.";
/** The stats are there in game; what is missing is a collector, so their line says that instead. */
export const NOT_RECORDED_LINE = "The Everloot addon does not record this yet.";
export const STALE_LINE = "May be out of date.";
/** Under the planned builds: saved in the calculator, so a plan, not what the character runs in game. */
export const PLANNED_LINE = "Saved in the talent calculator by this character's linked player. A plan, not a record of play.";
export const FOOTER_LINE = "Self-reported by this character's linked player through the Everloot addon. Not checked against Blizzard.";

export interface ShownSection { key: SectionKey; title: string; section: Section<unknown>; asOf: string | null; stale: boolean }

export interface CardBlock { label: string; value: string }

/** A number the header shows beside the name, only from a section in the `shown` state. */
export interface Headline { label: string; value: number }

export interface Showcase {
  input: ShowcaseInput;
  /** "Level 60 Orc Shaman". */
  line: string;
  /** The class slug for the colour tokens, or null for a class the tokens do not know. */
  classSlug: string | null;
  /** "From the player's own addon upload, 2026-10-31 (1 day ago)". */
  freshness: string;
  /**
   * The sections in page order. The public page leaves out `empty` and `private`; the owner's preview, and the
   * sample, show every state.
   */
  sections: ShownSection[];
  /** Up to three stat blocks for the share card, only from shown sections. */
  blocks: CardBlock[];
  /** The header's numbers: average item level and achievement points, each only when its section is shown. */
  headlines: Headline[];
}

const DAY = 86_400_000;

/** Whole days from a YYYY-MM-DD date to `now`, never below 0. */
export function daysSince(date: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / DAY));
}

const ago = (days: number) => (days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);

/** The header's freshness line. Never "verified": these rows come from the player's own install. */
export function freshnessLabel(date: string, now: Date): string {
  return `From the player's own addon upload, ${date} (${ago(daysSince(date, now))})`;
}

/** The mean item level of the equipped items, rounded down, or null with none. */
export function averageItemLevel(gear: readonly GearRow[]): number | null {
  return gear.length ? Math.floor(gear.reduce((sum, g) => sum + g.itemLevel, 0) / gear.length) : null;
}

/** Whether a section can appear on the public page. */
export const isPublic = (s: Section<unknown>) => s.state === "shown" || s.state === "unsupported";

function cardBlocks(input: ShowcaseInput): CardBlock[] {
  const blocks: CardBlock[] = [];
  if (input.gear.state === "shown") {
    const avg = averageItemLevel(input.gear.data);
    if (avg !== null) blocks.push({ label: "Average item level", value: String(avg) });
  }
  if (input.raids.state === "shown" && input.raids.data.lockouts.length) {
    const top = input.raids.data.lockouts[0]!;
    blocks.push({ label: "Raid this week", value: `${top.killed}/${top.total} ${top.instance}` });
  }
  if (input.professions.state === "shown" && input.professions.data.length) {
    blocks.push({ label: "Professions", value: input.professions.data.slice(0, 2).map((p) => `${p.name} ${p.rank}`).join(" · ") });
  }
  return blocks.slice(0, 3);
}

function headlines(input: ShowcaseInput): Headline[] {
  const out: Headline[] = [];
  const avg = input.gear.state === "shown" ? averageItemLevel(input.gear.data) : null;
  if (avg !== null) out.push({ label: "Item level", value: avg });
  if (input.collections.state === "shown") out.push({ label: "Achievement points", value: input.collections.data.points });
  return out;
}

export function buildShowcase(input: ShowcaseInput, now: Date): Showcase {
  const slug = input.class.toLowerCase();
  const sections = (Object.keys(SECTION_TITLES) as SectionKey[]).map((key): ShownSection => {
    const section = input[key] as Section<unknown>;
    const asOf = section.state === "shown" ? section.asOf : null;
    return { key, title: SECTION_TITLES[key], section, asOf, stale: asOf !== null && daysSince(asOf, now) > STALE_DAYS };
  });
  return {
    input,
    line: describePlayer(input),
    classSlug: (CLASSES as readonly string[]).includes(slug) ? slug : null,
    freshness: freshnessLabel(input.lastUpload, now),
    sections,
    blocks: cardBlocks(input),
    headlines: headlines(input),
  };
}
