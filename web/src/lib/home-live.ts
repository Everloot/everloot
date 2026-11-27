import { unstable_cache } from "next/cache";
import { guildLadder } from "@kb/guilds";
import { QUALITIES } from "@/design/tokens";
import { loadDatabaseActivity } from "./database-activity-store";
import type { PublicFact } from "./database-activity";
import { loadItemNames, loadQuestNames, loadSiteAssets, PRIVATE_UNREACHABLE, readItemTips } from "./game-assets";
import gameBuild from "@/data/game-data/build-version.json";
import type { Names } from "./names";
import { loadStoredSearchNames } from "./search-names-store";
import { shownSearchNamesFromStored } from "./shown-item-names";
import { loadWikiEntityNames } from "./wiki-entity-names";
import { loadStoredGuildLadder } from "./guild-ladder-store";
import { GUILD_SEARCH_TAG, guildsOn, loadGuildData, raidsOpen, type GuildData } from "./guilds";
import { loadStoredRankingWeeks } from "./ranking-weeks-store";
import { RANKINGS, rankingView, topMovers, type Mover, type RankingWeek } from "./rankings";

/**
 * The landing page's three live panels (`/`, not the signed-in `/home`): the newest public facts, the guild ladder and
 * the census week. Addon and game-file data only, never the armory's: the page may carry an ad slot. Each read is kept
 * five minutes by `unstable_cache` (the page's own revalidate), which also keeps a `no-store` read inside it from
 * making the page dynamic. A failed read throws inside the cache, so it is never kept, and comes out as null: the
 * panel says it could not be read, and the other two still show.
 */
const KEEP_SECONDS = 300;
export const HOME_NEWEST = 5;
export const HOME_LADDER = 5;
export const HOME_MOVERS = 3;

export interface HomeFact {
  kind: PublicFact["kind"];
  id: number;
  name: string;
  path: string;
  publicAt: string;
  estimated?: boolean;
  /** Items only, from the game files: the icon and the quality token name ("rare"). */
  icon?: string | null;
  quality?: (typeof QUALITIES)[number] | null;
}

/** The newest public facts, newest first; items carry their icon and quality when the game files give them. */
export function newestFacts(entries: readonly PublicFact[], tips: ReadonlyMap<number, { icon: string | null; quality: string }> = new Map(), n = HOME_NEWEST): HomeFact[] {
  return [...entries]
    .sort((a, b) => b.publicAt.localeCompare(a.publicAt))
    .slice(0, n)
    .map((e) => {
      const tip = e.kind === "item" ? tips.get(e.id) : undefined;
      return {
        kind: e.kind, id: e.id, name: e.name, path: e.path, publicAt: e.publicAt, ...(e.estimated ? { estimated: true } : {}),
        ...(tip ? { icon: tip.icon, quality: QUALITIES.find((q) => q === tip.quality.toLowerCase()) ?? null } : {}),
      };
    });
}

const FALLBACK = { item: "Item", npc: "NPC", quest: "Quest", object: "Object" } as const;
const PAGE_NAMES = { item: "items", npc: "npcs", quest: "quests", object: "objects" } as const;
const isFallback = (e: PublicFact): e is PublicFact & { kind: keyof typeof FALLBACK } => e.kind in FALLBACK && e.name === `${FALLBACK[e.kind as keyof typeof FALLBACK]} #${e.id}`;

/**
 * The activity file names a fact only by the 3-install agreed name, else "Item #id". A fact under that fallback takes
 * the name its own page shows (shown-item-names.ts: the game files and Warcraft Wiki names); one whose page has no
 * name either keeps the fallback. Agreed names already are the pages' first choice, so they stay.
 */
export function pageNamed<T extends PublicFact>(entries: readonly T[], names: Names | null): T[] {
  if (!names) return [...entries];
  return entries.map((e) => {
    const shown = isFallback(e) ? names[PAGE_NAMES[e.kind]].get(e.id) : undefined;
    return shown ? { ...e, name: shown } : e;
  });
}

/** The page names, read only when a shown fact needs one: the stored search names file, never the corpus (#1354). */
async function loadPageNames(): Promise<Names> {
  const [stored, read, quests, npcWiki] = await Promise.all([loadStoredSearchNames(), loadItemNames(gameBuild.version), loadQuestNames(gameBuild.version), loadWikiEntityNames("npc")]);
  const empty = { names: { items: new Map(), npcs: new Map(), objects: new Map(), quests: new Map() }, candidates: new Map<number, string>() };
  return shownSearchNamesFromStored(stored ?? empty, { matched: read === PRIVATE_UNREACHABLE ? null : read, quests, npcWiki });
}

export interface HomeLadder {
  /** The ladder's instance: the newest with an agreed kill. Null before anyone has one. */
  instance: { name: string; raid: boolean } | null;
  rows: { key: string; rank: number; guildName: string; realm: string; faction: "alliance" | "horde" | null; killed: number; bosses: number }[];
  /** Guilds on the whole ladder. */
  total: number;
  /** Raids are open: the empty ladder then waits on a first kill, not on a date. */
  raidsOpen: boolean;
}

/** The top of the newest ladder, as /guilds opens on it: the newest instance with a kill, its first rows. */
export function ladderTop(data: Pick<GuildData, "instances" | "progress">, open: boolean, n = HOME_LADDER): HomeLadder {
  const killed = new Set(data.progress.filter((p) => p.killed > 0).map((p) => p.instanceMapId));
  const instance = data.instances.filter((i) => killed.has(i.instanceMapId)).sort((a, b) => b.tier - a.tier)[0];
  if (!instance) return { instance: null, rows: [], total: 0, raidsOpen: open };
  const all = guildLadder(data.progress, instance.instanceMapId);
  return {
    instance: { name: instance.name, raid: instance.instanceType === "raid" },
    rows: all.slice(0, n).map((r) => ({ key: r.key, rank: r.rank, guildName: r.guildName, realm: r.realm, faction: r.faction, killed: r.killed, bosses: r.bosses })),
    total: all.length,
    raidsOpen: open,
  };
}

export interface HomeWeek {
  /** The week the numbers are from; null before the first ranked week. */
  week: { start: string; current: boolean } | null;
  /** Each class with a published count that week, largest share first. Empty while the week is collecting. */
  classes: { key: string; label: string; classToken: string; share: number }[];
  /** True when a class is hidden, so the shares do not add up to the whole. */
  classHidden: boolean;
  /** Rows that moved most against last week; null without a week before to compare with. */
  movers: Mover[] | null;
}

/** The census week the rankings show: the class shares and the top movers, from the stored ranking weeks. */
export function censusWeek(weeks: RankingWeek[], n = HOME_MOVERS): HomeWeek {
  const views = RANKINGS.map((def) => rankingView(def, weeks));
  const classes = views.find((v) => v.def.slug === "classes")!;
  const week = classes.week && !classes.week.window.collecting ? classes.week : null;
  return {
    week: classes.week ? { start: classes.week.start, current: classes.week.current } : null,
    classes: week
      ? classes.rows.flatMap((r) => (r.rank !== null && r.share !== null && r.classToken ? [{ key: r.key, label: r.label, classToken: r.classToken, share: r.share }] : []))
      : [],
    classHidden: classes.rows.some((r) => r.rank === null),
    movers: week && classes.previous ? topMovers(views, n) : null,
  };
}

const failed = (what: string): never => { throw new Error(`${what} could not be read`); };

/** Null when a read fails: a thrown error inside unstable_cache is not kept, so the next render asks again. */
async function orNull<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

const cachedNewest = unstable_cache(async (): Promise<HomeFact[]> => {
  const file = (await loadDatabaseActivity()) ?? failed("database activity");
  const latest = [...file.entries].sort((a, b) => b.publicAt.localeCompare(a.publicAt)).slice(0, HOME_NEWEST);
  // Page names are an extra too: without the name files a fact keeps the name the activity file gave it.
  const entries = latest.some(isFallback) ? pageNamed(latest, await orNull(loadPageNames)) : latest;
  const items = entries.filter((e) => e.kind === "item").map((e) => e.id);
  // Icons and quality are extras: without the asset files the names still show.
  const tips = items.length ? (await orNull(async () => (await readItemTips(await loadSiteAssets(), items)).tips)) ?? new Map() : new Map();
  return newestFacts(entries, tips);
}, ["home-newest"], { revalidate: KEEP_SECONDS });

// Tagged with the guild search tag: recording a guild hide clears it at once, as it clears the guild pages.
const cachedLadder = unstable_cache(async (): Promise<HomeLadder> => {
  // Only the stored ladder: the landing page never replays the corpus for it (#1354).
  if (!(await loadStoredGuildLadder())) failed("stored guild ladder");
  const data = await loadGuildData();
  if (data.unreachable) failed("guild ladder");
  return ladderTop(data, raidsOpen());
}, ["home-ladder"], { revalidate: KEEP_SECONDS, tags: [GUILD_SEARCH_TAG] });

const cachedWeek = unstable_cache(async (): Promise<HomeWeek> => {
  // Only the stored weeks (20 KB), never the census rows behind them (#1354).
  const stored = (await loadStoredRankingWeeks()) ?? failed("stored ranking weeks");
  return censusWeek(stored.weeks);
}, ["home-week"], { revalidate: KEEP_SECONDS });

export const loadHomeNewest = () => orNull(cachedNewest);
/** Undefined while the guild pages are off: there is no ladder to show or link to. */
export const loadHomeLadder = async (): Promise<HomeLadder | null | undefined> => (guildsOn() ? orNull(cachedLadder) : undefined);
export const loadHomeWeek = () => orNull(cachedWeek);
