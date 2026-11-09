import type { BadgeId, EcosystemView, ProjectView } from "@/lib/ecosystem";

/**
 * The /addons leaderboard: the ecosystem tracker's projects as ranked rows. The default signal is GitHub stars,
 * ties broken by commits in the last 4 weeks, then by name. Every number comes from the committed GitHub
 * snapshot (kb/changes/ecosystem.json) or Everloot's install counts; a fact we do not have stays null.
 */

export const BOARD_SORTS = ["stars", "change", "commits", "release", "updated", "installs", "name"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];
export const BOARD_VIEWS = ["leaderboard", "cards"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export type BoardKind = ProjectView["kind"];

export interface BoardQuery { view: BoardView; sort: BoardSort; desc: boolean; kind?: BoardKind }
export const DEFAULT_QUERY: BoardQuery = { view: "leaderboard", sort: "stars", desc: true };

export type Search = Record<string, string | string[] | undefined>;
const one = (search: Search, k: string) => (typeof search[k] === "string" ? (search[k] as string) : undefined);

/** `?view=cards&kind=tool&sort=-commits`. A value that is not one of ours falls back to the default. */
export function boardQuery(search: Search): BoardQuery {
  const view = one(search, "view");
  const kind = one(search, "kind");
  const sort = /^(-?)([a-z]+)$/.exec(one(search, "sort") ?? "");
  const known = sort && (BOARD_SORTS as readonly string[]).includes(sort[2]);
  return {
    view: (BOARD_VIEWS as readonly string[]).includes(view ?? "") ? (view as BoardView) : DEFAULT_QUERY.view,
    sort: known ? (sort[2] as BoardSort) : DEFAULT_QUERY.sort,
    desc: known ? sort[1] === "-" : DEFAULT_QUERY.desc,
    ...(kind === "addon" || kind === "tool" ? { kind } : {}),
  };
}

/** The URL of a view, with defaults left out so the plain page is plain `/addons`. */
export function boardHref(q: BoardQuery): string {
  const params = new URLSearchParams();
  if (q.view !== DEFAULT_QUERY.view) params.set("view", q.view);
  if (q.kind) params.set("kind", q.kind);
  if (q.sort !== DEFAULT_QUERY.sort || q.desc !== DEFAULT_QUERY.desc) params.set("sort", `${q.desc ? "-" : ""}${q.sort}`);
  const s = params.toString();
  return s ? `/addons?${s}` : "/addons";
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The GitHub account that owns the repository, or null when the repo field is not owner/name. */
export function repoOwner(repo: string): string | null {
  const owner = repo.split("/")[0];
  return repo.split("/").length === 2 && OWNER.test(owner) ? owner : null;
}

/** The owner's GitHub avatar at 64 px, or null (the page then draws an initials tile). */
export function logoUrl(repo: string): string | null {
  const owner = repoOwner(repo);
  return owner ? `https://github.com/${owner}.png?size=64` : null;
}

/** Up to two letters for the fallback tile: "forever-ref" is "FR", "Polestar" is "PO". */
export function initials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export interface BoardRow {
  project: ProjectView;
  rank: number;
  owner: string | null;
  logo: string | null;
  description: string | null;
  stars: number | null;
  change: number | null;
  changeSince: string | null;
  commits4w: number | null;
  release: { tag: string; date: string; url: string } | null;
  updated: string | null;
  installs: number | null;
}

const time = (iso: string | null) => (iso ? Date.parse(iso) : null);

function sortValue(row: BoardRow, key: BoardSort): number | string | null {
  switch (key) {
    case "stars": return row.stars;
    case "change": return row.change;
    case "commits": return row.commits4w;
    case "release": return time(row.release?.date ?? null);
    case "updated": return time(row.updated);
    case "installs": return row.installs;
    case "name": return row.project.name.toLowerCase();
  }
}

/** The default order, used to break every tie: stars, then commits in 4 weeks, high first, then name. */
function byDefault(a: BoardRow, b: BoardRow): number {
  return (b.stars ?? -1) - (a.stars ?? -1) || (b.commits4w ?? -1) - (a.commits4w ?? -1) || a.project.name.localeCompare(b.project.name);
}

/** A sorted copy, numbered 1 to n in the new order. Missing values sort last either way. */
export function sortBoard(rows: readonly BoardRow[], sort: BoardSort, desc: boolean): BoardRow[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort), y = sortValue(b, sort);
    if (x === null || y === null) return x === y ? byDefault(a, b) : x === null ? 1 : -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c * dir || byDefault(a, b);
  }).map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Every project as a row, in the default order. The change is the view's own, the one the tracker's Rising board shows. */
export function boardRows(view: EcosystemView): BoardRow[] {
  const rows = view.projects.map((p): BoardRow => {
    const m = p.metrics?.status === "ok" ? p.metrics : null;
    const delta = p.starGain7d;
    return {
      project: p,
      rank: 0,
      owner: repoOwner(p.repo),
      logo: logoUrl(p.repo),
      description: p.summary.trim() || null,
      stars: m?.stars ?? null,
      change: delta?.change ?? null,
      changeSince: delta?.since ?? null,
      commits4w: m?.commits4w ?? null,
      release: m?.release ?? null,
      updated: m?.lastCommit ?? null,
      installs: p.installs,
    };
  });
  return sortBoard(rows, DEFAULT_QUERY.sort, DEFAULT_QUERY.desc);
}

/** The oldest day a change is counted from, or null when no row has a change (the column is then left out). */
export function changeSince(rows: readonly BoardRow[]): string | null {
  const days = rows.map((r) => r.changeSince).filter((d): d is string => d !== null).sort();
  return days[0] ?? null;
}

/** The tracker's badges as card tags. The licence badge is left off this page. */
export const TAG_LABEL: Partial<Record<BadgeId, string>> = {
  "forever-ready": "Forever-ready",
  active: "Active",
  "fresh-release": "Fresh release",
  responsive: "Responsive",
  archived: "Archived",
};
