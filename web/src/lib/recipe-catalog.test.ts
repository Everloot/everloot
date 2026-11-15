import { expect, test } from "vitest";
import { buildRecipeCatalog } from "./recipe-catalog";
import { filterRecipes } from "./profession-planner";
test("the static catalog can answer an actual material query with no runtime service", () => {
 const catalog=buildRecipeCatalog();
 expect(catalog.named).toBe(true);
 expect(catalog.recipes.length).toBeGreaterThan(2000);
 expect(filterRecipes(catalog.recipes,"Iron Ore",null).length).toBeGreaterThan(0);
 expect(JSON.stringify(catalog)).not.toMatch(/installId|accessKey|secretKey/);
});
