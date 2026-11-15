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

test("the name snapshot contains only this build's recipe and material/output item IDs", async () => {
 const {default:snapshot}=await import("@/data/profession-search-names.json");
 const {CLIENT_PROFESSIONS,RECIPES_BUILD}=await import("./professions");
 const recipes=CLIENT_PROFESSIONS.flatMap(p=>p.recipes);
 const spells=new Set(recipes.map(r=>r.spellId));
 const items=new Set(recipes.flatMap(r=>[...(r.itemId ? [r.itemId] : []),...r.reagents.map(x=>x.itemId)]));
 expect(snapshot.build).toBe(RECIPES_BUILD);
 expect(Object.keys(snapshot.spells).every(id=>spells.has(Number(id)))).toBe(true);
 expect(Object.keys(snapshot.items).every(id=>items.has(Number(id)))).toBe(true);
});

test("both catalog routes explicitly remain static and the profession asset is scoped", async () => {
 const {dynamic,GET}=await import("@/app/tools/professions/recipe-catalog.json/route");
 const route=await import("@/app/tools/professions/[profession]/recipe-catalog.json/route");
 expect(dynamic).toBe("force-static");
 expect(route.dynamic).toBe("force-static");
 expect((await (await GET()).json()).recipes.length).toBeGreaterThan(2000);
 const data=await (await route.GET(new Request("https://example.test"),{params:Promise.resolve({profession:"alchemy"})})).json();
 expect(data.recipes.length).toBeGreaterThan(0);
 expect(data.recipes.every((r:{slug:string})=>r.slug==="alchemy")).toBe(true);
});

test("the matching client export makes physical recipe items searchable without inventing absent names", () => {
 const c=buildRecipeCatalog();
 const teaching=c.recipes.flatMap(r=>r.recipeItems);
 expect(teaching.length).toBeGreaterThan(1900);
 expect(filterRecipes(c.recipes,"Pattern: Fine Leather Boots",null).some(r=>r.spellId===2158)).toBe(true);
 expect(teaching.some(x=>/^Item \d+$/.test(x.name))).toBe(true);
});

test("known teaching-item acquisition uses dated public sources with entity links", () => {
 const items=buildRecipeCatalog().recipes.flatMap(r=>r.recipeItems);
 const known=items.filter(x=>x.sources.length>0);
 expect(known.length).toBeGreaterThan(0);
 expect(known.every(x=>x.sources.every(s=>s.includes("observed 2026-")))).toBe(true);
 expect(known.every(x=>x.sourceLinks?.every(l=>l.href.startsWith("/database/")))).toBe(true);
});
