import {
  CENSUS_CLASSES, CENSUS_RACES, FACTIONS, LEVEL_BANDS, type CensusCount, type CensusWindow, type Faction, type LevelBand,
} from "../../../kb/src/census";
import { DEFAULT_RULESET } from "./player-pages";

/**
 * /census filters: faction, race, class, level band and ruleset in the URL. A filter only ever picks cells the
 * census rollup already publishes (kb/src/census.ts: the tables, the race and class grid and the level crosses),
 * each under the rollup's own suppression, so no filter adds a sum the suppression did not check. A combination
 * with no published cell (race, class and level at once; a faction's class total) says so instead of adding
 * one up.
 */

export type CensusDim = "faction" | "race" | "class" | "level";
export const CENSUS_DIMS: readonly CensusDim[] = ["faction", "race", "class", "level"];

export interface CensusFilter {
  faction?: Faction;
  /** UnitRace's token, such as "Scourge". */
  race?: string;
  /** UnitClass's token, such as "MAGE". */
  class?: string;
  level?: LevelBand;
  /** Every realm is "forever" until realms are mapped to rulesets, so this narrows nothing yet. */
  ruleset?: string;
}

export const RULESETS: readonly string[] = [DEFAULT_RULESET];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** A race's URL value: its name, so Undead is "undead" and Night Elf "nightelf". Skyborne is one value on both sides. */
export const raceSlug = (token: string) => slug(CENSUS_RACES.find((r) => r.token === token)!.name);
const RACE_BY_SLUG = new Map<string, string>(CENSUS_RACES.flatMap((r) => [[slug(r.name), r.token], [slug(r.token), r.token]]));
const RACE_NAME = new Map<string, string>(CENSUS_RACES.map((r) => [r.token, r.name]));
const CLASS_NAME = new Map<string, string>(CENSUS_CLASSES.map((c) => [c.token, c.name]));
const BAND_LABEL = new Map<string, string>(LEVEL_BANDS.map((b) => [b.id, b.label]));

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The URL's filters, keeping only values the census knows; anything else is ignored. */
export function parseCensusFilter(search: Search): CensusFilter {
  const f: CensusFilter = {};
  const faction = FACTIONS.find((x) => x.toLowerCase() === one(search.faction)?.toLowerCase());
  if (faction) f.faction = faction;
  const race = RACE_BY_SLUG.get(slug(one(search.race) ?? ""));
  if (race) f.race = race;
  const cls = one(search.class)?.toUpperCase();
  if (cls && CLASS_NAME.has(cls)) f.class = cls;
  const level = LEVEL_BANDS.find((b) => b.id === one(search.level));
  if (level) f.level = level.id;
  const ruleset = one(search.ruleset)?.toLowerCase();
  if (ruleset && RULESETS.includes(ruleset)) f.ruleset = ruleset;
  return f;
}

/** Filters that narrow the counts (a ruleset narrows nothing until realms are mapped). */
export const activeDims = (f: CensusFilter): CensusDim[] => CENSUS_DIMS.filter((d) => f[d] !== undefined);

/** The census URL for these filters and window, in a fixed order. */
export function censusHref(f: CensusFilter, window: "week" | "launch" = "week"): string {
  const params = new URLSearchParams();
  if (f.faction) params.set("faction", f.faction.toLowerCase());
  if (f.race) params.set("race", raceSlug(f.race));
  if (f.class) params.set("class", f.class.toLowerCase());
  if (f.level) params.set("level", f.level);
  if (f.ruleset) params.set("ruleset", f.ruleset);
  if (window === "launch") params.set("window", "launch");
  const s = params.toString();
  return s ? `/census?${s}` : "/census";
}

/** One published cell, with the filter values that pick it. */
interface Picked { pick: CensusFilter; count: CensusCount }

/** Every published table, as the dimensions its cells are keyed by. A race cell carries its faction. */
function tables(w: CensusWindow): { dims: CensusDim[]; cells: Picked[] }[] {
  return [
    { dims: [], cells: [{ pick: {}, count: w.characters }] },
    { dims: ["faction"], cells: w.factions.map((c) => ({ pick: { faction: c.faction }, count: c.count })) },
    { dims: ["faction", "race"], cells: w.races.map((c) => ({ pick: { faction: c.faction, race: c.race }, count: c.count })) },
    { dims: ["class"], cells: w.classes.map((c) => ({ pick: { class: c.class }, count: c.count })) },
    { dims: ["faction", "race", "class"], cells: w.raceClass.map((c) => ({ pick: { faction: c.faction, race: c.race, class: c.class }, count: c.count })) },
    { dims: ["level"], cells: w.levels.map((c) => ({ pick: { level: c.band }, count: c.count })) },
    { dims: ["faction", "level"], cells: w.factionLevels.map((c) => ({ pick: { faction: c.faction, level: c.band }, count: c.count })) },
    { dims: ["faction", "race", "level"], cells: w.raceLevels.map((c) => ({ pick: { faction: c.faction, race: c.race, level: c.band }, count: c.count })) },
    { dims: ["class", "level"], cells: w.classLevels.map((c) => ({ pick: { class: c.class, level: c.band }, count: c.count })) },
  ];
}

export interface FilteredRow { key: string; label: string; count: CensusCount; href: string }
export interface Breakdown { by: CensusDim; rows: FilteredRow[] }

export interface FilteredCensus {
  filter: CensusFilter;
  /** What the filter picks, in words: "Troll", "Horde Mage", "Level 60 Night Elf". */
  label: string;
  /** The one published cell for the whole filter, or null when none is published (see `note`). */
  headline: { count: CensusCount } | null;
  /** The same filter split by each dimension it leaves open, from published cells only. */
  breakdowns: Breakdown[];
  /** Why there is no headline or no breakdown, when there isn't. */
  note: "impossible" | "both-sides" | "no-total" | "too-fine" | null;
}

/** Whether a cell's keys agree with every filter it is keyed by. */
const matches = (pick: CensusFilter, f: CensusFilter, dims: CensusDim[]) => dims.every((d) => f[d] === undefined || pick[d] === f[d]);

/** The words for a filter, in a reading order: level, faction, race, class. */
export function filterLabel(f: CensusFilter): string {
  const parts: string[] = [];
  if (f.level) parts.push(f.level === "60" ? "Level 60" : `Level ${BAND_LABEL.get(f.level)}`);
  if (f.faction && !f.race) parts.push(f.faction);
  if (f.race) parts.push(RACE_NAME.get(f.race)!);
  if (f.class) parts.push(CLASS_NAME.get(f.class)!);
  const words = parts.join(" ");
  return f.race && f.faction && f.race === "Skyborne" ? `${words} (${f.faction})` : words || "All characters";
}

/** A row's own name in a breakdown by `by`. */
function rowLabel(by: CensusDim, pick: CensusFilter, f: CensusFilter): string {
  if (by === "faction") return pick.faction!;
  if (by === "class") return CLASS_NAME.get(pick.class!)!;
  if (by === "level") return BAND_LABEL.get(pick.level!)!;
  return f.faction ? RACE_NAME.get(pick.race!)! : `${RACE_NAME.get(pick.race!)} (${pick.faction})`;
}

/**
 * The census under a filter, from one window's published cells. A table answers the filter when it is keyed by
 * every filtered dimension: keyed by exactly those, its matching cell is the headline; keyed by one more, its
 * matching cells are the breakdown by that one. A race is keyed with its faction, so "by race" covers both.
 */
export function filterCensus(w: CensusWindow, f: CensusFilter, window: "week" | "launch" = "week"): FilteredCensus {
  const want = activeDims(f);
  // A race brings its faction (Skyborne is on both sides, so without a faction it matches two cells).
  const need = new Set<CensusDim>(f.race ? [...want, "faction"] : want);
  let headline: FilteredCensus["headline"] = null;
  let bothSides: Picked[] = [];
  const breakdowns: Breakdown[] = [];
  for (const t of tables(w)) {
    if (![...need].every((d) => t.dims.includes(d))) continue;
    const extra = t.dims.filter((d) => !need.has(d));
    // Race is keyed with faction: a table that adds both splits by race.
    const by = extra.includes("race") ? ["race" as const] : extra;
    const cells = t.cells.filter((c) => matches(c.pick, f, t.dims));
    if (by.length === 0) {
      if (cells.length === 1) headline = { count: cells[0].count };
      else if (cells.length > 1) bothSides = cells;
    } else if (by.length === 1 && cells.length > 0) {
      breakdowns.push({
        by: by[0],
        rows: cells.map((c) => {
          const next = { ...f, ...c.pick };
          // A race link keeps the faction only where the race needs it (Skyborne) or the reader chose it.
          if (!f.faction && next.race && next.race !== "Skyborne") delete next.faction;
          return { key: Object.values(c.pick).join("/"), label: rowLabel(by[0], c.pick, f), count: c.count, href: censusHref(next, window) };
        }),
      });
    }
  }
  breakdowns.sort((a, b) => CENSUS_DIMS.indexOf(a.by) - CENSUS_DIMS.indexOf(b.by));
  if (bothSides.length > 0) {
    // Skyborne without a side: the two sides are two published cells, never added up.
    return {
      filter: f, label: filterLabel(f), headline: null, note: "both-sides",
      breakdowns: [{ by: "faction", rows: bothSides.map((c) => ({ key: c.pick.faction!, label: c.pick.faction!, count: c.count, href: censusHref({ ...f, faction: c.pick.faction }, window) })) }],
    };
  }
  const possible = !(f.race && (f.faction && !CENSUS_RACES.some((r) => r.token === f.race && r.faction === f.faction)))
    && !(f.race && f.class && !CENSUS_RACES.some((r) => r.token === f.race && (!f.faction || r.faction === f.faction) && (r.classes as readonly string[]).includes(f.class!)));
  const note = !possible ? "impossible" : headline ? null : breakdowns.length > 0 ? "no-total" : "too-fine";
  return { filter: f, label: filterLabel(f), headline: possible ? headline : null, breakdowns: possible ? breakdowns : [], note };
}


