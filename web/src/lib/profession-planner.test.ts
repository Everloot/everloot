import { describe, expect, it } from "vitest";
import { planShopping, filterRecipes, cheapestPrices, packRecipes, unpackRecipes, shoppingCatalog, type PlannerRecipe, type SearchRecipe } from "./profession-planner";
const recipes = [
  { profession: "Smithing", recipe: "Iron widget", skillMin: 1, skillMax: 10, points: 2, reagents: [{ item: "Iron Ore", count: 3 }], reporters: 3 },
  { profession: "Smithing", recipe: "Copper widget", skillMin: 1, skillMax: 10, points: 1, reagents: [{ item: "Copper Ore", count: 2 }], reporters: 3 },
];
const prices = { "iron ore": 10, "copper ore": 50 };
describe("shopping list", () => {
  it("cuts ranges using whole existing crafts and aggregates material totals", () => {
    const p = planShopping(recipes, "Smithing", 3, 8, [], prices);
    expect(p.steps[0].crafts).toBe(3);
    expect(p.reagents).toEqual([{ item: "Iron Ore", count: 9 }]);
    expect(p.copper).toBe(90);
  });
  it("adds shared materials across steps after cutting both range boundaries", () => {
    const route = [
      {...recipes[0], skillMin:1, skillMax:5, points:1},
      {...recipes[1], skillMin:5, skillMax:10, reagents:[{item:"iron ore",count:2}]},
    ];
    const p=planShopping(route,"Smithing",3,7,[],prices);
    expect(p.steps.map(s=>s.crafts)).toEqual([2,2]);
    expect(p.reagents).toEqual([{item:"Iron Ore",count:10}]);
    expect(p.copper).toBe(100);
  });
  it("recomputes from the next best agreed craft when skipped", () => {
    const p = planShopping(recipes, "Smithing", 3, 8, ["Iron widget"], prices);
    expect(p.steps[0].recipe).toBe("Copper widget");
    expect(p.reagents[0].count).toBe(10);
    expect(planShopping(recipes, "Smithing", 3, 8, recipes.map(r => r.recipe), prices).gaps).toEqual([{ fromSkill: 3, toSkill: 8 }]);
  });
  it("leaves a missing price unknown and does not treat it as free", () => {
    expect(planShopping(recipes.slice(0, 1), "Smithing", 1, 4, [], {}).copper).toBeNull();
  });
  it("does not loop or accept reversed, fractional or unbounded ranges", () => {
    for (const [a,b] of [[5,1],[1,Infinity],[1.5,3],[0,300],[1,501]]) expect(() => planShopping(recipes,"Smithing",a,b,[],prices)).toThrow();
  });
  it("takes listed minima only from selected houses and records each price date", () => {
    const rows = [{ house:"Alliance", itemId:1, copper:10, day:"2026-11-14" }, {house:"Horde",itemId:1,copper:4,day:"2026-11-13"}];
    expect(cheapestPrices(rows,["Alliance"])[1]).toEqual(rows[0]);
    expect(cheapestPrices(rows,["Alliance","Horde"])[1].copper).toBe(4);
  });
});
const rows: SearchRecipe[] = [
  { profession:"Smithing",slug:"smithing",spellId:1,name:"Widget",itemName:"Widget",recipeItems:[{itemId:5,name:"Plans: Widget",sources:[]}], yellow:10,grey:20,reagents:[{itemId:2,name:"Iron Ore",count:3}] },
  { profession:"Smithing",slug:"smithing",spellId:2,name:"Unknown",itemName:null,recipeItems:[],yellow:null,grey:null,reagents:[] },
];
describe("recipe filtering", () => {
  it("matches materials, spell names and recipe items without case sensitivity", () => {
    for (const q of ["iron ore","WIDGET","plans: widget"]) expect(filterRecipes(rows,q,null).map(r=>r.spellId)).toEqual([1]);
  });
  it("hides grey at the boundary but keeps recipes without both colours", () => {
    expect(filterRecipes(rows,"",20).map(r=>r.spellId)).toEqual([2]);
    expect(filterRecipes([{...rows[0],yellow:null}],"",20)).toHaveLength(1);
    expect(filterRecipes(rows,"",19)).toHaveLength(2);
  });
});

describe("what the shopping list is sent", () => {
  // Agreed steps carry no training cost; derived steps carry a number or null, and the list shows the difference.
  const path: PlannerRecipe[] = [
    ...recipes,
    { profession: "Smithing", recipe: "Steel widget", skillMin: 8, skillMax: 30, points: 1, reagents: [{ item: "Iron Ore", count: 2 }, { item: "Coal", count: 1 }], reporters: 4, trainingCopper: 500 },
    { profession: "smithing", recipe: "Bronze widget", skillMin: 20, skillMax: 40, points: 1, reagents: [{ item: "Copper Ore", count: 1 }], reporters: 3, trainingCopper: null },
  ];
  it("packs the path recipes so the planner gives the same plan for every range and skip", () => {
    const back = unpackRecipes(packRecipes(path), "Smithing");
    for (const [from, to] of [[1, 40], [3, 8], [9, 35], [25, 40]]) for (const skip of [[], ["Iron widget"], ["Steel widget", "Copper widget"]]) {
      expect(planShopping(back, "Smithing", from, to, skip, prices)).toEqual(planShopping(path, "Smithing", from, to, skip, prices));
    }
    expect(back.map(r => r.trainingCopper)).toEqual([undefined, undefined, 500, null]);
  });
  it("sends each path recipe as its name, skills and reagent counts only", () => {
    const one = JSON.stringify(packRecipes([path[2]]));
    // The strings the planner reads (recipe and reagent names) plus 40 bytes of numbers and brackets.
    expect(one.length).toBeLessThanOrEqual('"Steel widget""Iron Ore""Coal"'.length + 40);
    expect(one).not.toContain("profession");
  });
  const catalog: SearchRecipe[] = Array.from({ length: 50 }, (_, i) => ({
    profession: "Smithing", slug: "smithing", spellId: 1000 + i, name: i === 1 ? "Widget 0" : `Widget ${i}`, itemName: `Widget ${i}`, itemUnconfirmed: false, yellow: 10, grey: 20,
    recipeItems: [{ itemId: 5000 + i, name: `Plans: Widget ${i}`, unconfirmed: true, sources: [] }],
    reagents: [{ itemId: 2, name: "Iron Ore", count: 3 }, { itemId: 3, name: "Coal", count: 1 }, { itemId: 4000 + i, name: `Part ${i}`, count: 2 }],
  }));
  const named = catalog.map(r => ({ ...path[0], recipe: ` ${r.name.toUpperCase()} ` }));
  it("keeps the catalog to reagent ids and the teaching items of names only one recipe has", () => {
    const sent = shoppingCatalog(catalog, named);
    expect(sent.reagents).toEqual([2, 3, ...catalog.map((_, i) => 4000 + i)]);
    expect(sent.taught["widget 2"]).toEqual([5002]);
    // Two recipes named "Widget 0": the list shows neither one's teaching item, as before.
    expect(sent.taught["widget 0"]).toBeUndefined();
    expect(shoppingCatalog(catalog, named.slice(2, 3))).toEqual({ reagents: [2, 3, 4002], taught: { "widget 2": [5002] } });
  });
  it("stays under 32 bytes per recipe, with the item names left to the page's item lookup", () => {
    const json = JSON.stringify(shoppingCatalog(catalog, named));
    expect(json.length / catalog.length).toBeLessThanOrEqual(32);
    expect(json).not.toMatch(/Iron Ore|Plans:|Part \d/);
  });
});
