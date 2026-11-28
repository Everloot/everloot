import { describe, expect, it } from "vitest";
import { filterRecipes, type SearchRecipe } from "./profession-planner";

const rows: SearchRecipe[] = [
  { profession: "Smithing", slug: "smithing", spellId: 1, name: "Widget", itemName: "Widget", recipeItems: [{ itemId: 5, name: "Plans: Widget", sources: [] }], yellow: 10, grey: 20, reagents: [{ itemId: 2, name: "Iron Ore", count: 3 }] },
  { profession: "Smithing", slug: "smithing", spellId: 2, name: "Unknown", itemName: null, recipeItems: [], yellow: null, grey: null, reagents: [] },
];

describe("recipe filtering", () => {
  it("matches materials, spell names and recipe items without case sensitivity", () => {
    for (const q of ["iron ore", "WIDGET", "plans: widget"]) expect(filterRecipes(rows, q, null).map(r => r.spellId)).toEqual([1]);
  });
  it("hides grey at the boundary but keeps recipes without both colours", () => {
    expect(filterRecipes(rows, "", 20).map(r => r.spellId)).toEqual([2]);
    expect(filterRecipes([{ ...rows[0]!, yellow: null }], "", 20)).toHaveLength(1);
    expect(filterRecipes(rows, "", 19)).toHaveLength(2);
  });
});
