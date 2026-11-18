import { expect, test } from "vitest";
import type { RecipeView } from "./professions";
import type { SearchRecipe } from "./profession-planner";
import { clampPageSize, filterRecipeViews, recipeListHref, recipeListQuery, recipePage, recipeSearchKeep } from "./recipe-list";

test("a page size is one the table offers: 50 by default, 200 at most, the next size down otherwise", () => {
  for (const [raw, size] of [
    ["", 50], ["abc", 50], ["0", 50], ["-25", 50], ["1.5", 50],
    ["25", 25], ["50", 50], ["100", 100], ["200", 200],
    ["1", 25], ["30", 25], ["99", 50], ["150", 100], ["201", 200], ["5000", 200], ["999999999", 200],
  ] as const) expect(clampPageSize(raw), raw).toBe(size);
});

test("the URL state reads page, size, search and skill range, clamping what it cannot use", () => {
  expect(recipeListQuery({})).toEqual({ page: 1, size: 50, q: "", min: null, max: null });
  expect(recipeListQuery({ page: "3", size: "100", q: "  healing  ", min: "50", max: "125" })).toEqual({ page: 3, size: 100, q: "healing", min: 50, max: 125 });
  // Unreadable values fall back; a reversed range is swapped; bounds above 999 clamp; a repeated name reads the first.
  expect(recipeListQuery({ page: "0", size: "nope", min: "x", max: "2000" })).toEqual({ page: 1, size: 50, q: "", min: null, max: 999 });
  expect(recipeListQuery({ page: ["2", "9"], min: "200", max: "100" })).toMatchObject({ page: 2, min: 100, max: 200 });
  expect(recipeListQuery({ q: "x".repeat(200) }).q).toHaveLength(60);
});

const view = (spellId: number, yellow: number | null, itemId = 0): RecipeView =>
  ({ spellId, yellow, grey: yellow === null ? null : yellow + 20, learn: null, itemId, reagents: [] }) as unknown as RecipeView;
const entry = (spellId: number, name: string, reagent = "Peacebloom"): SearchRecipe => ({
  profession: "Alchemy", slug: "alchemy", spellId, name, itemName: null, yellow: null, grey: null, recipeItems: [],
  reagents: [{ itemId: 2447, count: 1, name: reagent }],
});

test("the server filters by name, reagent and the skill where a recipe turns yellow, keeping the given order", () => {
  const recipes = [view(1, 1), view(2, 60), view(3, 150), view(4, null)];
  const catalog = [entry(1, "Minor Healing Potion"), entry(2, "Elixir of Lion's Strength"), entry(3, "Greater Healing Potion", "Khadgar's Whisker"), entry(4, "Spell 4")];
  const ids = (q: Partial<{ q: string; min: number | null; max: number | null }>) =>
    filterRecipeViews(recipes, catalog, { q: "", min: null, max: null, ...q }).map((r) => r.spellId);
  expect(ids({})).toEqual([1, 2, 3, 4]);
  expect(ids({ q: "healing" })).toEqual([1, 3]);
  expect(ids({ q: "WHISKER" })).toEqual([3]);
  expect(ids({ q: "spell 4" })).toEqual([4]);
  expect(ids({ min: 50 })).toEqual([2, 3]);
  expect(ids({ max: 60 })).toEqual([1, 2]);
  expect(ids({ min: 1, max: 75, q: "potion" })).toEqual([1]);
  expect(ids({ q: "nothing like this" })).toEqual([]);
});

test("a page holds at most its size; a page past the end shows the last one", () => {
  const rows = Array.from({ length: 201 }, (_, i) => i);
  expect(recipePage(rows, { page: 1, size: 50 })).toMatchObject({ page: 1, pages: 5, total: 201 });
  expect(recipePage(rows, { page: 1, size: 50 }).rows).toHaveLength(50);
  expect(recipePage(rows, { page: 5, size: 50 }).rows).toEqual([200]);
  expect(recipePage(rows, { page: 99, size: 200 })).toMatchObject({ page: 2, pages: 2, rows: [200] });
  expect(recipePage([], { page: 4, size: 25 })).toEqual({ rows: [], page: 1, pages: 1, total: 0 });
});

test("links keep the page's other parameters, drop defaults and go back to page 1 on any change but a page move", () => {
  const search = { class: "mage", from: "1", to: "300", market: "forever.pvp.horde.us", sort: "-net", page: "3", q: "potion", size: "100" };
  const query = recipeListQuery(search);
  expect(recipeListHref("/tools/professions/alchemy", search, query, { page: 4 }))
    .toBe("/tools/professions/alchemy?class=mage&from=1&to=300&market=forever.pvp.horde.us&sort=-net&q=potion&size=100&page=4#prof-recipes");
  expect(recipeListHref("/tools/professions/alchemy", search, query, { min: 76, max: 150 }))
    .toBe("/tools/professions/alchemy?class=mage&from=1&to=300&market=forever.pvp.horde.us&sort=-net&q=potion&min=76&max=150&size=100#prof-recipes");
  expect(recipeListHref("/tools/professions/alchemy", {}, recipeListQuery({}), { size: 50, page: 1 })).toBe("/tools/professions/alchemy#prof-recipes");
  expect(recipeListHref("/tools/professions/alchemy", search, query, { q: "", min: null, max: null }))
    .toBe("/tools/professions/alchemy?class=mage&from=1&to=300&market=forever.pvp.horde.us&sort=-net&size=100#prof-recipes");
  // The search box keeps everything but the search itself and the page.
  expect(recipeSearchKeep({ ...search, min: "1", max: "75" }, recipeListQuery({ ...search, min: "1", max: "75" })))
    .toEqual({ class: "mage", from: "1", to: "300", market: "forever.pvp.horde.us", sort: "-net", min: "1", max: "75", size: "100" });
});
