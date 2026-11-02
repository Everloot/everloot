import type { AddonPopularity, AddonTrend } from "../../../kb/src/addon-rollup";
import type { ProjectView } from "../../../kb/src/ecosystem";
import { curatedAddon } from "@/data/addon-repos";
import type { AddonGithubSummaryResult } from "./addon-github";
import { logoUrl, repoOwner } from "./addon-board";

/**
 * The /addons/popular leaderboard: the addons Forever players run, ranked by the share of reporting installs,
 * with each one's GitHub facts beside it. GitHub facts come from the ecosystem snapshot (kb/changes/ecosystem.json,
 * no request at view time) when the addon is a tracked project, else from a live read of the repository the
 * curated map (web/src/data/addon-repos.ts) names. CurseForge and Wago are links only: their APIs are not called.
 */

/** At most this many repositories are read live per view, two GitHub requests each. */
export const LIVE_LIMIT = 10;

export type Movement = { kind: "up" | "down" | "same"; by: number } | { kind: "new" };

export interface LeaderRow {
  rank: number;
  name: string;
  title: string;
  share: number;
  loadedInstalls: number;
  lastSeen: string;
  /** Against the board a week earlier; null when there was no board a week earlier to compare with. */
  movement: Movement | null;
  /** Weekly shares for the sparkline, oldest first; null where the addon was not listed yet. */
  shares: (number | null)[];
  repo: string | null;
  owner: string | null;
  logo: string | null;
  stars: number | null;
  release: { tag: string; date: string; url: string } | null;
  github: string | null;
  /** The author's CurseForge page when the curated map has one, else a search there. */
  curseforge: { href: string; search: boolean };
  wago: string | null;
}

const curseforgeSearch = (title: string) => `https://www.curseforge.com/wow/search?search=${encodeURIComponent(title)}`;

function trackedProject(name: string, projects: readonly ProjectView[]): ProjectView | null {
  const wanted = name.toLowerCase();
  return projects.find((p) => p.addonNames.some((n) => n.toLowerCase() === wanted)) ?? null;
}

/** The snapshot's facts for a tracked project, or null when it has none to show. */
function snapshotFacts(project: ProjectView | null) {
  const m = project?.metrics?.status === "ok" ? project.metrics : null;
  return m ? { stars: m.stars, release: m.release ? { ...m.release, date: m.release.date.slice(0, 10) } : null } : null;
}

/** The repositories a view reads live: curated, not in the snapshot, in rank order, at most LIVE_LIMIT. */
export function liveRepos(addons: readonly AddonPopularity[], projects: readonly ProjectView[]): string[] {
  const repos: string[] = [];
  for (const addon of addons) {
    const repo = curatedAddon(addon.name)?.source.repo;
    if (repo && !snapshotFacts(trackedProject(addon.name, projects)) && !repos.includes(repo)) repos.push(repo);
  }
  return repos.slice(0, LIVE_LIMIT);
}

function movement(trend: AddonTrend | undefined, rank: number, hadBoard: boolean): Movement | null {
  if (!hadBoard) return null;
  const before = trend?.previousRank ?? null;
  if (before === null) return { kind: "new" };
  return before === rank ? { kind: "same", by: 0 } : { kind: before > rank ? "up" : "down", by: Math.abs(before - rank) };
}

export function leaderRows(
  addons: readonly AddonPopularity[],
  trends: Readonly<Record<string, AddonTrend>>,
  projects: readonly ProjectView[],
  live: Readonly<Record<string, AddonGithubSummaryResult>>,
): LeaderRow[] {
  // Listed addons stay listed (counts only grow), so a board a week ago existed when any of today's had a rank on it.
  const hadBoard = Object.values(trends).some((t) => t.previousRank !== null);
  return addons.map((addon, i): LeaderRow => {
    const rank = i + 1;
    const project = trackedProject(addon.name, projects);
    const curated = curatedAddon(addon.name)?.source ?? null;
    const repo = curated?.repo ?? project?.repo ?? null;
    const fromLive = curated ? live[curated.repo] : undefined;
    const facts = snapshotFacts(project) ?? (fromLive?.status === "ok" ? fromLive.data : null);
    return {
      rank,
      name: addon.name,
      title: addon.title,
      share: addon.share,
      loadedInstalls: addon.loadedInstalls,
      lastSeen: addon.lastSeen,
      movement: movement(trends[addon.name], rank, hadBoard),
      shares: trends[addon.name]?.shares ?? [],
      repo,
      owner: repo ? repoOwner(repo) : null,
      logo: repo ? logoUrl(repo) : null,
      stars: facts?.stars ?? null,
      release: facts?.release ?? null,
      github: repo ? `https://github.com/${repo}` : null,
      curseforge: curated?.curseforge ? { href: curated.curseforge, search: false } : { href: curseforgeSearch(addon.title), search: true },
      wago: curated?.wago ?? null,
    };
  });
}

/** True when a live read failed because GitHub's hourly limit ran out. */
export function rateLimited(live: Readonly<Record<string, AddonGithubSummaryResult>>): boolean {
  return Object.values(live).some((r) => r.status === "unavailable" && r.rateLimited);
}

export const SPARK = { width: 64, height: 18 } as const;

/** SVG polyline points for the weekly shares, scaled to the row's own range; null with fewer than two listed weeks. */
export function sparkPoints(shares: readonly (number | null)[]): string | null {
  const points = shares.map((s, i) => [i, s] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (points.length < 2) return null;
  const values = points.map(([, s]) => s);
  const lo = Math.min(...values), hi = Math.max(...values);
  const pad = 2;
  const x = (i: number) => pad + (i / Math.max(1, shares.length - 1)) * (SPARK.width - 2 * pad);
  const y = (s: number) => (hi === lo ? SPARK.height / 2 : pad + (1 - (s - lo) / (hi - lo)) * (SPARK.height - 2 * pad));
  return points.map(([i, s]) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(" ");
}
