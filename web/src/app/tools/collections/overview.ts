import { rowsOf, type CompletionFacts, type CompletionRows, type OverviewCategory, type OwnedCharacter } from "../../../../../kb/src/completion";

// The URL and the filters of the completionist overview. Every view and filter is a GET link, so it works without JavaScript.

export const PATH = "/tools/collections";
export const GAP_VIEW = "gap";

export const SHOWS = ["all", "done", "missing", "started"] as const;
export type Show = (typeof SHOWS)[number];

export type ViewQuery = { install?: string; character?: string; view?: string; show?: Show; collection?: string };

/** The page's link for a query; empty values and the defaults (overview, all) are left out. */
export function viewHref(q: ViewQuery): string {
  const params = new URLSearchParams();
  if (q.view) params.set("view", q.view);
  if (q.collection?.trim()) params.set("collection", q.collection.trim());
  if (q.install?.trim()) params.set("install", q.install.trim());
  if (q.character?.trim()) params.set("character", q.character.trim());
  if (q.show && q.show !== "all") params.set("show", q.show);
  const s = params.toString();
  return s ? `${PATH}?${s}` : PATH;
}

export const showOf = (value: string): Show => (SHOWS as readonly string[]).includes(value) ? (value as Show) : "all";

export type CategoryRow = CompletionRows[keyof CompletionRows];

/** Started: an achievement with progress, a reputation below the top standing, a chain with some quests done. */
export function isStarted(row: CategoryRow): boolean {
  if (row.done) return false;
  if (row.kind === "achievements") return row.progress !== undefined;
  if (row.kind === "reputation") return row.standing !== undefined;
  if (row.kind === "quests") return row.have > 0;
  return false;
}

/** The rows behind one overview bar: its kind, narrowed to the bar's achievement category or reputation header. */
export function categoryRows(facts: CompletionFacts, character: OwnedCharacter | null, cat: OverviewCategory): CategoryRow[] {
  const rows: CategoryRow[] = rowsOf(facts, character, cat.kind);
  if (!cat.group) return rows;
  return rows.filter((r) => (r.kind === "achievements" ? r.entry.category === cat.group : r.kind === "reputation" ? r.entry.header === cat.group : true));
}

export function filterRows(rows: CategoryRow[], show: Show): CategoryRow[] {
  if (show === "done") return rows.filter((r) => r.done);
  if (show === "missing") return rows.filter((r) => !r.done);
  if (show === "started") return rows.filter(isStarted);
  return rows;
}
