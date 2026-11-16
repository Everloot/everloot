import { expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { buildRecipeCatalog, teachingItemIds } from "./recipe-catalog";
import { CLIENT_PROFESSIONS } from "./professions";
import { filterRecipes } from "./profession-planner";

test("search receives only the viewed profession and the names its page supplies", () => {
 const p = CLIENT_PROFESSIONS[0];
 const id = p.recipes.find(r => r.reagents.length)!.reagents[0].itemId;
 const rows = buildRecipeCatalog(p, n => n === id ? "Test material" : `Item ${n}`, () => undefined, n => n === id);
 expect(rows.flatMap(r => r.reagents).filter(x => x.itemId === id).every(x => x.unconfirmed)).toBe(true);
 expect(rows).toHaveLength(p.recipes.length);
 expect(rows.every(r => r.slug === p.slug && /^Spell \d+$/.test(r.name))).toBe(true);
 expect(filterRecipes(rows, "Test material", null).length).toBeGreaterThan(0);
 expect(rows.flatMap(r => r.recipeItems).every(x => x.sources.length === 0)).toBe(true);
 expect(teachingItemIds(p.recipes.map(r => r.spellId)).length).toBeGreaterThan(0);
});

test("committed teaching data contains no names and no public name catalogs remain", () => {
 const data = JSON.parse(readFileSync("src/data/game-data/client-recipe-items.json", "utf8"));
 expect(data).not.toHaveProperty("names");
 for (const file of ["src/data/profession-search-names.json", "src/data/profession-recipe-sources.json", "src/app/tools/professions/recipe-catalog.json/route.ts", "src/app/tools/professions/[profession]/recipe-catalog.json/route.ts"]) expect(existsSync(file)).toBe(false);
});
