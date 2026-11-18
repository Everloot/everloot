import type { RecipeView } from "./professions";
import { filterRecipes, type SearchRecipe } from "./profession-planner";

/**
 * The game-file recipe table on a profession page, one page at a time: `?page=&size=&q=&min=&max=`. The server
 * filters and pages, so a page carries only the rows it shows instead of every recipe of the profession. A value
 * outside what the table offers is clamped to the nearest one rather than refused, so an edited URL still shows recipes.
 */

export const RECIPE_PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_RECIPE_PAGE_SIZE = 50;
/** The parameters this table owns; every other one on the page (class context, path range, market) is kept as it is. */
export const RECIPE_LIST_PARAMS = ["page", "size", "q", "min", "max"] as const;

type Search = Record<string, string | string[] | undefined>;
const one = (search: Search, k: string) => {
  const v = search[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};
const whole = (v: string) => (/^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : null);

export interface RecipeListQuery { page: number; size: number; q: string; min: number | null; max: number | null }

/** A size the table offers: the largest one not above the asked size, 25 at least, 200 at most; 50 when unreadable. */
export function clampPageSize(raw: string): number {
  const n = whole(raw);
  if (n === null || n < 1) return DEFAULT_RECIPE_PAGE_SIZE;
  return [...RECIPE_PAGE_SIZES].reverse().find((s) => s <= n) ?? RECIPE_PAGE_SIZES[0];
}

/** A skill bound: a whole number 1 to 999 (the top bracket is "301+"), larger ones clamped; null when absent or unreadable. */
function skillBound(raw: string): number | null {
  const n = whole(raw);
  return n === null || n < 1 ? null : Math.min(n, 999);
}

/** The table's state from the URL. `page` is clamped to the result count by `recipePage`, which knows it. */
export function recipeListQuery(search: Search): RecipeListQuery {
  let min = skillBound(one(search, "min")), max = skillBound(one(search, "max"));
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const page = whole(one(search, "page"));
  return { page: page !== null && page >= 1 ? page : 1, size: clampPageSize(one(search, "size")), q: one(search, "q").trim().slice(0, 60), min, max };
}

/**
 * The recipes the query keeps, in the order given. `q` matches the recipe, what it makes, its reagents and the item
 * that teaches it, as the catalog names them (the page's own name rule); `min`/`max` bound the skill where a recipe
 * turns yellow, so a recipe the files give no ranks for drops out once either is set.
 */
export function filterRecipeViews(recipes: readonly RecipeView[], catalog: readonly SearchRecipe[], query: Pick<RecipeListQuery, "q" | "min" | "max">): RecipeView[] {
  const named = query.q ? new Set(filterRecipes([...catalog], query.q, null).map((r) => r.spellId)) : null;
  const ranged = query.min !== null || query.max !== null;
  return recipes.filter((r) => (!named || named.has(r.spellId))
    && (!ranged || (r.yellow !== null && (query.min === null || r.yellow >= query.min) && (query.max === null || r.yellow <= query.max))));
}

/** One page of rows; a page past the last shows the last, and an empty result is page 1 of 1. */
export function recipePage<T>(rows: readonly T[], query: Pick<RecipeListQuery, "page" | "size">): { rows: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(rows.length / query.size));
  const page = Math.min(query.page, pages);
  return { rows: rows.slice((page - 1) * query.size, page * query.size), page, pages, total: rows.length };
}

/**
 * The table's URL with some of its state changed: the page's other parameters kept in their order, the table's own
 * written after them and left out at their defaults (page 1, size 50, no search, no range). A change that is not a
 * page move starts again at page 1. Lands on the table (`#prof-recipes`).
 */
export function recipeListHref(path: string, search: Search, query: RecipeListQuery, change: Partial<RecipeListQuery>): string {
  const next = { ...query, ...("page" in change ? {} : { page: 1 }), ...change };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if ((RECIPE_LIST_PARAMS as readonly string[]).includes(k) || v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
  }
  if (next.q) params.set("q", next.q);
  if (next.min !== null) params.set("min", String(next.min));
  if (next.max !== null) params.set("max", String(next.max));
  if (next.size !== DEFAULT_RECIPE_PAGE_SIZE) params.set("size", String(next.size));
  if (next.page > 1) params.set("page", String(next.page));
  const s = params.toString();
  return `${path}${s ? `?${s}` : ""}#prof-recipes`;
}

/** The URL's other parameters and the table's size and range, for the search box's hidden fields (a new search starts at page 1). */
export function recipeSearchKeep(search: Search, query: RecipeListQuery): Record<string, string> {
  const keep: Record<string, string> = {};
  for (const [k, v] of Object.entries(search)) {
    if ((RECIPE_LIST_PARAMS as readonly string[]).includes(k) || v === undefined) continue;
    keep[k] = Array.isArray(v) ? v[0] ?? "" : v;
  }
  if (query.min !== null) keep.min = String(query.min);
  if (query.max !== null) keep.max = String(query.max);
  if (query.size !== DEFAULT_RECIPE_PAGE_SIZE) keep.size = String(query.size);
  return keep;
}
