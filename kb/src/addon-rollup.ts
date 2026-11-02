/**
 * Which addons Forever players run, from the addon_seen records of installs that turned the addon
 * list on. An addon is public once 3 distinct installs report it: a rarer name can identify a
 * setup. Everloot itself is left out of the ranking. The result carries counts, never install ids.
 */

import { INDEPENDENT_INSTALLS } from "./drop-rollup.js";

/** Everloot and the answers addon its companion writes are on every reporting install. */
export const OWN_ADDONS: ReadonlySet<string> = new Set(["Everloot", "EverlootAnswers"]);

export interface AddonSeenRow {
  installId: string;
  capturedAt: string;
  name: string;
  title: string;
  /** The .toc Version field, when the install reported one. */
  version?: string;
  loaded: boolean;
}

export interface AddonPopularity {
  name: string;
  /** The plain title at least three installs agree on, or else the folder name. */
  title: string;
  /** Installs that reported the addon, loaded or not. */
  installs: number;
  /** Installs that had it loaded in at least one report. */
  loadedInstalls: number;
  /** Versions at least three installs reported, newest version first. A version fewer installs report is left out. */
  versions: { version: string; installs: number }[];
  /** loadedInstalls out of every install that reported its addons. */
  share: number;
  /** UTC ISO time by which the third install had reported it. */
  firstSeen: string;
  /** UTC ISO time: the newest date three installs reported it on or after. */
  lastSeen: string;
  public: boolean;
}

export interface AddonRollup {
  addons: AddonPopularity[];
  /** Distinct installs with any addon_seen record: the share's denominator. */
  reportingInstalls: number;
}

/**
 * A title as plain text: WoW's colour codes (|cAARRGGBB ... |r), textures (|T ... |t), atlases
 * (|A ... |a) and links (|H ... |h) removed. The addon strips them too; this keeps an older or
 * hand-edited upload from putting them on the page.
 */
export function plainTitle(title: string): string {
  return title
    .replace(/\|c[0-9a-fA-F]{8}/g, "").replace(/\|r/g, "")
    .replace(/\|T.*?\|t/g, "").replace(/\|A.*?\|a/g, "")
    .replace(/\|H.*?\|h/g, "").replace(/\|h/g, "")
    .replace(/\s+/g, " ").trim();
}

/** The title the most installs reported, if at least three agree on it. Ties go to the alphabetically first. */
function agreedTitle(titles: Map<string, Set<string>>): string | null {
  const [best] = [...titles].sort(([a, x], [b, y]) => y.size - x.size || a.localeCompare(b));
  return best && best[1].size >= INDEPENDENT_INSTALLS ? best[0] : null;
}

/**
 * The third value in order (or the last, below three installs), so no single install sets a date:
 * first seen is when the third install had reported the addon, last seen the newest date that three
 * installs reported it on or after.
 */
function nth(times: number[], order: "asc" | "desc"): number {
  const sorted = [...times].sort((a, b) => (order === "asc" ? a - b : b - a));
  return sorted[Math.min(INDEPENDENT_INSTALLS, sorted.length) - 1];
}

/**
 * Every addon, including those below the three-install rule. Internal: publish popularAddonsFromRecords instead.
 * `asOf` is when the corpus was current; rows dated after it are ignored. Last seen is never before first seen.
 */
export function rollupAllAddons(rows: AddonSeenRow[], asOf: string | Date = new Date()): AddonRollup {
  const until = new Date(asOf).getTime();
  const reporting = new Set<string>();
  const byName = new Map<string, {
    /** Per install: its earliest and latest report. */
    installs: Map<string, { first: number; last: number }>;
    loaded: Set<string>;
    /** Per plain title: the installs that reported it. */
    titles: Map<string, Set<string>>;
    /** Per version: the installs that reported it, and its newest report. */
    versions: Map<string, { installs: Set<string>; last: number }>;
  }>();
  for (const row of rows) {
    const at = Date.parse(row.capturedAt);
    // A row dated after the corpus was current is a wrong clock or a forgery; either way not a fact yet.
    if (!Number.isFinite(at) || at > until) continue;
    reporting.add(row.installId);
    if (OWN_ADDONS.has(row.name)) continue;
    const entry = byName.get(row.name) ?? { installs: new Map(), loaded: new Set<string>(), titles: new Map(), versions: new Map() };
    const seen = entry.installs.get(row.installId);
    entry.installs.set(row.installId, seen ? { first: Math.min(seen.first, at), last: Math.max(seen.last, at) } : { first: at, last: at });
    if (row.loaded) entry.loaded.add(row.installId);
    const title = plainTitle(row.title);
    if (title) entry.titles.set(title, (entry.titles.get(title) ?? new Set<string>()).add(row.installId));
    const version = row.version?.replace(/\s+/g, " ").trim();
    if (version) {
      const v = entry.versions.get(version) ?? { installs: new Set<string>(), last: at };
      v.installs.add(row.installId);
      v.last = Math.max(v.last, at);
      entry.versions.set(version, v);
    }
    byName.set(row.name, entry);
  }
  const addons: AddonPopularity[] = [...byName].map(([name, e]) => {
    const spans = [...e.installs.values()];
    const firstSeen = nth(spans.map((s) => s.first), "asc");
    return {
      name,
      title: agreedTitle(e.titles) ?? name,
      installs: e.installs.size,
      loadedInstalls: e.loaded.size,
      versions: [...e.versions]
        .filter(([, v]) => v.installs.size >= INDEPENDENT_INSTALLS)
        .sort(([a], [b]) => b.localeCompare(a, "en", { numeric: true }))
        .map(([version, v]) => ({ version, installs: v.installs.size })),
      share: e.loaded.size / reporting.size,
      firstSeen: new Date(firstSeen).toISOString(),
      lastSeen: new Date(Math.max(firstSeen, nth(spans.map((s) => s.last), "desc"))).toISOString(),
      public: e.installs.size >= INDEPENDENT_INSTALLS,
    };
  });
  addons.sort((a, b) => b.loadedInstalls - a.loadedInstalls || b.installs - a.installs || a.name.localeCompare(b.name));
  return { addons, reportingInstalls: reporting.size };
}

export function addonRowsFromRecords(records: unknown[]): AddonSeenRow[] {
  const rows: AddonSeenRow[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.kind !== "addon_seen" || typeof row.installId !== "string" || typeof row.capturedAt !== "string" ||
      typeof row.name !== "string" || typeof row.title !== "string" || typeof row.loaded !== "boolean") continue;
    rows.push({
      installId: row.installId, capturedAt: row.capturedAt, name: row.name, title: row.title, loaded: row.loaded,
      ...(typeof row.version === "string" ? { version: row.version } : {}),
    });
  }
  return rows;
}

/**
 * The leaderboard's rows from one upload record list: only addons at least three installs report.
 * `asOf` is when the corpus was current (its dataAsOf); rows dated after it are ignored.
 */
export function popularAddonsFromRecords(records: unknown[], asOf: string | Date = new Date()): AddonRollup {
  const all = rollupAllAddons(addonRowsFromRecords(records), asOf);
  return { ...all, addons: all.addons.filter((addon) => addon.public) };
}

const WEEK_MS = 7 * 86_400_000;

export interface AddonTrend {
  /**
   * The share as the leaderboard stood at the end of each of the last weeks, oldest first, the last one at `asOf`.
   * Null for a week the addon was not listed yet (fewer than three installs had reported it).
   */
  shares: (number | null)[];
  /** The addon's rank on the board as it stood a week before `asOf`, or null when it was not listed then. */
  previousRank: number | null;
}

/**
 * The board as it stood at the end of each of the last `weeks` weeks, by addon folder name, for the addons
 * listed at `asOf`. Each week is the same all-time count cut off at that week's end, so the three-install rule
 * holds for every point, and a week before the first upload has no listed addons.
 */
export function addonTrends(rows: AddonSeenRow[], asOf: string | Date = new Date(), weeks = 8): Record<string, AddonTrend> {
  const end = new Date(asOf).getTime();
  const boards = Array.from({ length: weeks }, (_, i) => {
    const listed = rollupAllAddons(rows, new Date(end - (weeks - 1 - i) * WEEK_MS)).addons.filter((a) => a.public);
    return new Map(listed.map((a, rank) => [a.name, { share: a.share, rank: rank + 1 }]));
  });
  const trends: Record<string, AddonTrend> = {};
  for (const name of boards[weeks - 1]?.keys() ?? []) {
    trends[name] = {
      shares: boards.map((board) => board.get(name)?.share ?? null),
      previousRank: weeks > 1 ? boards[weeks - 2].get(name)?.rank ?? null : null,
    };
  }
  return trends;
}
