import {
  CENSUS_CLASSES, CENSUS_LAUNCH, CENSUS_MIN_CHARACTERS, CENSUS_MIN_INSTALLS, CENSUS_MIN_REPORTERS, CENSUS_RACES, FACTIONS, rollupCensus,
  type CensusCount, type CensusRow, type CensusWindow, type Faction,
} from "../../../kb/src/census";
import { longDate } from "@/data/wow-forever";
import { censusHref } from "./census-filter";
import type { JsonLd } from "./jsonld";
import { absoluteUrl } from "./seo";
import { uploadStore, type CensusRead } from "./upload-store";

/**
 * The rankings hub, first version: the census rankings (classes, races, faction balance), one ISO week at a time.
 * Each week is the census rollup run over that week's stored rows, so its counts are exactly what /census would
 * show for that span: the same 10-characters, 3-installs, 3-addresses rule, rounding to 5 and complementary
 * suppression. Ranks come from the published (rounded) counts, never from the true ones.
 */

export type RankingSlug = "classes" | "races" | "factions";
export type RankingFilterKey = "faction" | "class";

export interface RankingDef {
  slug: RankingSlug;
  title: string;
  /** What the ranking counts, in one line. */
  lede: string;
  /** The page's meta description. */
  description: string;
  /** Filters that only pick published cells (never a new sum). */
  filters: RankingFilterKey[];
}

export const RANKINGS: RankingDef[] = [
  {
    slug: "classes", title: "Classes by players", lede: "Characters of each class active in the week.", filters: [],
    description: "The most played classes in WoW Forever, week by week: characters of each class from the Everloot census, ranked, with change against last week.",
  },
  {
    slug: "races", title: "Races", lede: "Characters of each race active in the week.", filters: ["faction", "class"],
    description: "The most played races in WoW Forever, week by week: characters of each race and faction from the Everloot census, ranked, with change against last week.",
  },
  {
    slug: "factions", title: "Faction balance", lede: "Characters on each side active in the week.", filters: [],
    description: "Alliance against Horde in WoW Forever, week by week: characters on each side from the Everloot census, with their share and change against last week.",
  },
];

export const rankingDef = (slug: string): RankingDef | undefined => RANKINGS.find((r) => r.slug === slug);
export const rankingPath = (slug: RankingSlug) => `/rankings/${slug}`;

/** The rail: every ranking, grouped, then the boards that live elsewhere on the site. */
export const RAIL_GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
  { title: "Population", links: RANKINGS.map((r) => ({ label: r.title, href: rankingPath(r.slug) })) },
  {
    title: "Elsewhere",
    links: [
      { label: "Census", href: "/census" },
      { label: "Addons players run", href: "/addons/popular" },
      { label: "Addons by stars", href: "/addons" },
    ],
  },
];

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Frozen weeks in the chart and the week picker; the current week comes on top of these. */
export const CHART_WEEKS = 12;
/** Rows in the chart, from the top of the chosen week. */
export const CHART_SERIES = 10;
/** Rows each ranking shows on the hub. */
export const HUB_ROWS = 5;
/** Ranked rows an unfiltered ranking needs before search engines may index it. */
export const INDEX_MIN_ROWS = 10;

/** Monday 00:00 UTC of the ISO week holding `t`. */
export function weekStart(t: number): number {
  const day = Math.floor(t / DAY_MS) * DAY_MS;
  return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS;
}

/** The first ranked week: the first full ISO week after launch (launch week itself is partial). */
export function firstWeek(launch: string = CENSUS_LAUNCH): number {
  const at = Date.parse(launch);
  const start = weekStart(at);
  return start === at ? start : start + WEEK_MS;
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** What the rankings say before their first week: no numbers, only when they start. */
export const START_LINE = `Rankings start with the first full week after ${longDate(CENSUS_LAUNCH.slice(0, 10))}.`;

export interface RankingWeek {
  /** Monday, YYYY-MM-DD: the week's id in URLs. */
  start: string;
  /** The last instant counted, ISO: Sunday's end for a frozen week, the data time for the current one. */
  to: string;
  /** The week still running ("so far"). */
  current: boolean;
  window: CensusWindow;
}

/**
 * The weeks the rankings show, oldest first: up to CHART_WEEKS frozen weeks and the current one, none before the
 * first full week after launch. Each week runs the census rollup over its own rows only.
 */
export function rankingWeeks(rows: readonly CensusRow[], asOf: string | Date, launch: string = CENSUS_LAUNCH): RankingWeek[] {
  const now = new Date(asOf).getTime();
  const current = weekStart(now);
  const weeks: RankingWeek[] = [];
  for (let start = Math.max(firstWeek(launch), current - CHART_WEEKS * WEEK_MS); start <= current; start += WEEK_MS) {
    const end = Math.min(start + WEEK_MS - 1, now);
    const inWeek = rows.filter((r) => {
      const at = Date.parse(r.capturedAt);
      return at >= start && at <= end;
    });
    const view = rollupCensus(inWeek, { asOf: new Date(end), launch });
    weeks.push({ start: isoDay(start), to: new Date(end).toISOString(), current: start === current, window: view.windows.week });
  }
  return weeks;
}

export type Change = { dir: "up" | "down"; by: number } | "same" | "new";

export interface RankRow {
  key: string;
  label: string;
  /** The faction, for races (Skyborne is on both sides). */
  sub?: string;
  /** A class token, for the class-colour mark. */
  classToken?: string;
  faction?: Faction;
  /** Rounded count, or null when hidden ("not enough reports"). */
  count: CensusCount;
  /** Share of the week's characters, from the two rounded counts. */
  share: number | null;
  /** Competition rank (equal counts share a rank); null for a hidden count. */
  rank: number | null;
  /** Against the week before; null when there is nothing to compare with. */
  change: Change | null;
}

export interface RankingQuery { faction?: Faction; class?: string; week?: string }

const CLASS_NAME = new Map<string, string>(CENSUS_CLASSES.map((c) => [c.token, c.name]));
const RACE_NAME = new Map<string, string>(CENSUS_RACES.map((r) => [r.token, r.name]));

type Cell = Omit<RankRow, "share" | "rank" | "change">;

/** The published cells a ranking lists for one week. A class filter on races reads the race and class grid. */
function cellsOf(slug: RankingSlug, w: CensusWindow, q: RankingQuery): Cell[] {
  if (slug === "classes") return w.classes.map((c) => ({ key: c.class, label: CLASS_NAME.get(c.class)!, classToken: c.class, count: c.count }));
  if (slug === "factions") return w.factions.map((f) => ({ key: f.faction, label: f.faction, faction: f.faction, count: f.count }));
  const races = q.class
    ? w.raceClass.filter((c) => c.class === q.class).map((c) => ({ faction: c.faction, race: c.race, count: c.count }))
    : w.races;
  return races
    .filter((r) => !q.faction || r.faction === q.faction)
    .map((r) => ({ key: `${r.faction}/${r.race}`, label: RACE_NAME.get(r.race)!, sub: r.faction, faction: r.faction, classToken: q.class, count: r.count }));
}

/** Ranked rows for a week: shown counts high to low, then name; hidden counts after them, unranked. */
export function rankRows(slug: RankingSlug, w: CensusWindow, q: RankingQuery = {}, previous: CensusWindow | null = null): RankRow[] {
  const cells = cellsOf(slug, w, q);
  const shown = cells.filter((c) => c.count !== null).sort((a, b) => b.count! - a.count! || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  const hidden = cells.filter((c) => c.count === null);
  const rankOf = (count: number, all: Cell[]) => 1 + all.filter((c) => c.count !== null && c.count > count).length;
  const before = previous && !previous.collecting ? new Map(cellsOf(slug, previous, q).filter((c) => c.count !== null).map((c) => [c.key, c])) : null;
  const beforeCells = before ? [...before.values()] : [];
  return [
    ...shown.map((c): RankRow => {
      const rank = rankOf(c.count!, shown);
      let change: Change | null = null;
      if (before) {
        const was = before.get(c.key);
        if (!was) change = "new";
        else {
          const diff = rankOf(was.count!, beforeCells) - rank;
          change = diff === 0 ? "same" : { dir: diff > 0 ? "up" : "down", by: Math.abs(diff) };
        }
      }
      return { ...c, rank, share: w.characters ? c.count! / w.characters : null, change };
    }),
    ...hidden.map((c): RankRow => ({ ...c, rank: null, share: null, change: null })),
  ];
}

export const rankedCount = (rows: readonly RankRow[]) => rows.filter((r) => r.rank !== null).length;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The URL's filters, keeping only values this ranking offers; anything else is ignored. */
export function parseRankingQuery(def: RankingDef, search: Search, weeks: readonly RankingWeek[]): RankingQuery {
  const q: RankingQuery = {};
  const faction = one(search.faction)?.toLowerCase();
  const cls = one(search.class)?.toUpperCase();
  const week = one(search.week);
  if (def.filters.includes("faction")) {
    const f = FACTIONS.find((x) => x.toLowerCase() === faction);
    if (f) q.faction = f;
  }
  if (def.filters.includes("class") && cls && CLASS_NAME.has(cls)) q.class = cls;
  if (week && weeks.some((w) => w.start === week)) q.week = week;
  return q;
}

/** A ranking's URL with these filters, in a fixed order. */
export function rankingHref(slug: RankingSlug, q: RankingQuery): string {
  const params = new URLSearchParams();
  if (q.faction) params.set("faction", q.faction.toLowerCase());
  if (q.class) params.set("class", q.class.toLowerCase());
  if (q.week) params.set("week", q.week);
  const s = params.toString();
  return s ? `${rankingPath(slug)}?${s}` : rankingPath(slug);
}

export const isFiltered = (q: RankingQuery) => Boolean(q.faction || q.class || q.week);

export interface ChartSeries { key: string; label: string; classToken?: string; faction?: Faction; points: (number | null)[] }

export interface RankingView {
  def: RankingDef;
  query: RankingQuery;
  weeks: RankingWeek[];
  /** The week the rows show: the newest week with numbers unless the URL picks one. Null before the first week. */
  week: RankingWeek | null;
  /** The week before it, when it has numbers: the change column needs it. */
  previous: RankingWeek | null;
  rows: RankRow[];
  /** Weeks with numbers: the chart draws from two. */
  weeksWithNumbers: number;
  series: ChartSeries[];
}

export function rankingView(def: RankingDef, weeks: RankingWeek[], search: Search = {}): RankingView {
  const query = parseRankingQuery(def, search, weeks);
  const fallback = [...weeks].reverse().find((w) => !w.window.collecting) ?? weeks[weeks.length - 1] ?? null;
  const week = query.week ? weeks.find((w) => w.start === query.week)! : fallback;
  const at = week ? weeks.indexOf(week) : -1;
  const before = at > 0 ? weeks[at - 1] : null;
  const previous = before && !before.window.collecting && week && !week.window.collecting ? before : null;
  const rows = week ? rankRows(def.slug, week.window, query, previous?.window ?? null) : [];
  const top = rows.filter((r) => r.rank !== null).slice(0, CHART_SERIES);
  const perWeek = weeks.map((w) => new Map(rankRows(def.slug, w.window, query).map((r) => [r.key, r.share])));
  return {
    def,
    query,
    weeks,
    week,
    previous,
    rows,
    weeksWithNumbers: weeks.filter((w) => !w.window.collecting).length,
    series: top.map((r) => ({ key: r.key, label: r.label, classToken: r.classToken, faction: r.faction, points: perWeek.map((m) => m.get(r.key) ?? null) })),
  };
}

/**
 * The census filtered to what a ranking row counts, with the ranking's own filters. The census counts the last 7
 * days, not the ISO week, so its number can differ from the row's.
 */
export function censusHrefOf(slug: RankingSlug, row: RankRow, q: RankingQuery = {}): string {
  if (slug === "classes") return censusHref({ class: row.key });
  if (slug === "factions") return censusHref({ faction: row.faction });
  const race = row.key.split("/")[1];
  // A race names its side only where it needs one: Skyborne is on both.
  return censusHref({ race, faction: race === "Skyborne" ? row.faction : undefined, class: q.class });
}

/** The hub's headline numbers, from the week the rankings show and the week before it. */
export interface HubMetrics {
  week: RankingWeek;
  characters: CensusCount;
  /** Characters against the week before, from the two rounded counts; null without a week before with numbers. */
  change: { by: number; share: number | null } | null;
  installs: number;
  /**
   * The class or classes ranked first among those with a published count (more than one on a tie). A hidden class
   * is not ranked, so it could be larger: this is the leading published class, not always the most played.
   */
  leadingClasses: RankRow[];
  /** Whether any class is hidden that week, so a larger class could be among them. */
  classHidden: boolean;
}

export function hubMetrics(views: readonly RankingView[]): HubMetrics | null {
  const classes = views.find((v) => v.def.slug === "classes");
  const week = classes?.week;
  if (!classes || !week) return null;
  const now = week.window.characters;
  const before = classes.previous?.window.characters ?? null;
  return {
    week,
    characters: now,
    change: now !== null && before !== null ? { by: now - before, share: before ? (now - before) / before : null } : null,
    installs: week.window.installs,
    leadingClasses: classes.rows.filter((r) => r.rank === 1),
    classHidden: classes.rows.some((r) => r.rank === null),
  };
}

/** Characters counted each week the rankings show, oldest first; null while a week is collecting. */
export const weeklyCharacters = (weeks: readonly RankingWeek[]): { week: RankingWeek; count: CensusCount }[] =>
  weeks.map((w) => ({ week: w, count: w.window.collecting ? null : w.window.characters }));

export interface Mover { def: RankingDef; row: RankRow; href: string }

/** The rows that moved most against last week, over every ranking: the largest rank change first, then the larger share. */
export function topMovers(views: readonly RankingView[], n = 5): Mover[] {
  return views
    .flatMap((v) => v.rows.filter((r) => typeof r.change === "object" && r.change !== null).map((row) => ({ def: v.def, row, href: censusHrefOf(v.def.slug, row, v.query) })))
    .sort((a, b) => (b.row.change as { by: number }).by - (a.row.change as { by: number }).by || (b.row.share ?? 0) - (a.row.share ?? 0) || a.row.label.localeCompare(b.row.label))
    .slice(0, n);
}

/** Search engines index a ranking only unfiltered and with at least 10 ranked rows. */
export const rankingIndexable = (view: RankingView): boolean => !isFiltered(view.query) && rankedCount(view.rows) >= INDEX_MIN_ROWS;

/** The hub is indexed once one of its rankings is. */
export const hubIndexable = (weeks: RankingWeek[]): boolean => RANKINGS.some((def) => rankingIndexable(rankingView(def, weeks)));

/** Said in place of a week's rows while that week is under the census thresholds. */
export const COLLECTING_LINE =
  `Still collecting: a week shows numbers once it has at least ${CENSUS_MIN_CHARACTERS} characters reported by at least ${CENSUS_MIN_INSTALLS} installs from at least ${CENSUS_MIN_REPORTERS} addresses.`;

/** schema.org ItemList for an unfiltered ranking page or the hub. */
export function itemListJsonLd(name: string, path: string, items: { name: string; path?: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: absoluteUrl(path),
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, ...(item.path ? { url: absoluteUrl(item.path) } : {}) })),
  };
}

let memo: { read: CensusRead; weeks: RankingWeek[] } | null = null;

/** The ranking weeks from the stored census rows. An unreadable store is unavailable, never zero. */
export async function loadRankingWeeks(): Promise<{ weeks: RankingWeek[]; unreachable: boolean; dataAsOf: string | null }> {
  let read: CensusRead;
  try {
    read = await uploadStore.loadCensus();
  } catch {
    read = { rows: [], dataAsOf: null, unreachable: true };
  }
  if (read.unreachable) return { weeks: [], unreachable: true, dataAsOf: null };
  // The store hands back the same read object while its cache holds, so the weeks are computed once per read.
  if (memo?.read !== read) memo = { read, weeks: rankingWeeks(read.rows, read.dataAsOf ?? new Date()) };
  return { weeks: memo.weeks, unreachable: false, dataAsOf: read.dataAsOf };
}
