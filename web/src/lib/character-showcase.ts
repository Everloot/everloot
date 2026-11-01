import { describePlayer } from "@/app/players/player-view";
import { CLASSES } from "@/design/tokens";

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

/** A section older than this says it may be out of date. */
export const STALE_DAYS = 14;

/**
 * Where a section stands. `shown`: synced and switched on, with its own date. `empty`: nothing synced yet.
 * `private`: the owner switched it off. `unsupported`: the game does not report it to addons, so there is no value,
 * never a zero.
 */
export type SectionState = "shown" | "empty" | "private" | "unsupported";
export type Section<T> = { state: "shown"; asOf: string; data: T } | { state: Exclude<SectionState, "shown"> };

export interface GearRow { slot: string; itemId: number; /** Null until 3 installs agree on the name: shown as "Item <id>". */ name: string | null; itemLevel: number }
export interface TalentsData {
  /** The active spec's trees and points, as the snapshot holds them. */
  trees: { name: string; points: number }[];
  /** The calculator's share code for the snapshot, when it converts; the link then opens the build. */
  code: string | null;
  /** Saved builds the owner attached to the character (/b/<slug>). */
  planned: { name: string; slug: string }[];
}
export interface ProfessionRow { name: string; rank: number; maxRank: number }
/** A faction the catalog agrees on. A renown faction has ranks, not standings, and is not supported yet. */
export type ReputationRow = { faction: string; standing: string; value: number; max: number } | { faction: string; renown: true };
export interface RaidsData {
  /** This character's lockouts this week. */
  lockouts: { instance: string; difficulty: string; killed: number; total: number; resets: string }[];
  /** The guild's agreed kills: the guild's progress, not this character's attendance. Null when the guild is not shown. */
  guildKills: { instance: string; killed: number; total: number }[] | null;
}
export interface CollectionsData { achievements: number; points: number; titles: string[] }

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
  /** Null unless the owner shows it. `path` only when the guild's page is public. */
  guild: { name: string; path: string | null } | null;
  /** The newest upload any shown section came from, YYYY-MM-DD. */
  lastUpload: string;
  gear: Section<GearRow[]>;
  talents: Section<TalentsData>;
  professions: Section<ProfessionRow[]>;
  reputations: Section<ReputationRow[]>;
  raids: Section<RaidsData>;
  collections: Section<CollectionsData>;
}

export type SectionKey = "gear" | "talents" | "professions" | "reputations" | "raids" | "collections";
export const SECTION_TITLES: Record<SectionKey, string> = {
  gear: "Gear",
  talents: "Talents",
  professions: "Professions",
  reputations: "Reputations",
  raids: "Raids",
  collections: "Collections",
};

/** The lines each state stands for; nothing is estimated in their place. */
export const EMPTY_LINE = "Nothing synced for this yet.";
export const PRIVATE_LINE = "Hidden from the public page.";
export const UNSUPPORTED_LINE = "The game does not report this to addons yet.";
export const STALE_LINE = "May be out of date.";
export const FOOTER_LINE = "Self-reported by this character's linked player through the Everloot addon. Not checked against Blizzard.";

export interface ShownSection { key: SectionKey; title: string; section: Section<unknown>; asOf: string | null; stale: boolean }

export interface CardBlock { label: string; value: string }

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
  };
}
