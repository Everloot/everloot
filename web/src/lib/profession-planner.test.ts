import { describe, expect, it } from "vitest";
import { planShopping, filterRecipes, cheapestPrices, type SearchRecipe } from "./profession-planner";
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
