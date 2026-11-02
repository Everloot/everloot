import { expect, test } from "vitest";
import { CLIENT_RECIPES } from "@/data/game-data/client-recipes";
import { CLIENT_PROFESSIONS, professionByName, professionBySlug, professionHrefById, recipeGroups, recipeItemIds, type RecipeView } from "./professions";

const recipe = (spellId: number, yellow: number | null, grey: number | null = null, extra: Partial<RecipeView> = {}): RecipeView =>
  ({ spellId, itemId: null, learn: null, yellow, grey, reagents: [], ...extra });

test("the committed file lists the twelve professions players browse, and no test line", () => {
  expect(CLIENT_PROFESSIONS.map((p) => p.slug)).toEqual([
    "alchemy", "blacksmithing", "enchanting", "engineering", "herbalism", "leatherworking", "mining", "skinning", "tailoring", "cooking", "first-aid", "fishing",
  ]);
  expect(CLIENT_RECIPES.professions.some((p) => /\[DNT\]/.test(p.name))).toBe(false);
  // Every recipe makes an item or costs a reagent; that is what makes it a recipe.
  for (const p of CLIENT_PROFESSIONS) for (const r of p.recipes) expect(r.itemId !== null || r.reagents.length > 0).toBe(true);
});

test("a recipe keeps the files' item, reagents and ranks; MinSkillLineRank shows only above 1", () => {
  const alchemy = professionBySlug("alchemy")!;
  // Elixir of Minor Strength in build 1.60.1.70707: yellow 55, grey 95, required rank 1 (so none shown).
  expect(alchemy.recipes.find((r) => r.spellId === 2329)).toEqual({
    spellId: 2329, itemId: 2454, learn: null, yellow: 55, grey: 95,
    reagents: [{ itemId: 2449, count: 1 }, { itemId: 765, count: 1 }, { itemId: 3371, count: 1 }],
  });
  expect(professionByName(" first aid ")?.slug).toBe("first-aid");
  expect(professionBySlug("riding")).toBeUndefined();
  expect(professionHrefById(171)).toBe("/tools/professions/alchemy");
  expect(professionHrefById(762)).toBeNull();
});

test("recipeGroups: brackets by the yellow rank, lowest first, unranked last, empty brackets left out", () => {
  const groups = recipeGroups([recipe(1, 200, 240), recipe(2, 55, 95), recipe(3, null), recipe(4, 55, 90), recipe(5, 320, 360)]);
  expect(groups.map((g) => [g.label, g.recipes.map((r) => r.spellId)])).toEqual([
    ["Skill 1–75", [4, 2]],
    ["Skill 151–225", [1]],
    ["Skill 301+", [5]],
    ["No skill ranks in the files", [3]],
  ]);
  expect(recipeGroups([])).toEqual([]);
});

test("recipeItemIds: made and used items, once each", () => {
  expect(recipeItemIds([
    recipe(1, 1, 2, { itemId: 10, reagents: [{ itemId: 20, count: 2 }, { itemId: 10, count: 1 }] }),
    recipe(2, 1, 2, { reagents: [{ itemId: 20, count: 1 }] }),
  ]).sort((a, b) => a - b)).toEqual([10, 20]);
});

test("every profession page's description fits a search result (160 characters)", async () => {
  const { generateMetadata } = await import("@/app/tools/professions/[profession]/page");
  for (const p of CLIENT_PROFESSIONS) {
    const m = await generateMetadata({ params: Promise.resolve({ profession: p.slug }) });
    expect(String(m.description).length, p.slug).toBeLessThanOrEqual(160);
  }
});
