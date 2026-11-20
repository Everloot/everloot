import { professionPath, type AgreedRecipe } from "@kb/profession-path";
export type PlannerRecipe = AgreedRecipe & { profession: string };
export type RecipeItem = { itemId: number; name: string; unconfirmed?: boolean; sources: string[]; sourceLinks?: {label:string;href:string}[] };
export interface SearchRecipe {
  profession: string; slug: string; spellId: number; name: string; itemName: string | null; itemUnconfirmed?: boolean;
  yellow: number | null; grey: number | null;
  recipeItems: RecipeItem[];
  reagents: { itemId: number; name: string; count: number; unconfirmed?: boolean }[];
}
export type ListedPrice = { itemId: number; house: string; copper: number; day: string };
export function cheapestPrices(rows: ListedPrice[], houses: string[]): Record<number, ListedPrice> {
  const out: Record<number, ListedPrice> = {};
  for (const row of rows) {
    if (!houses.includes(row.house) || !Number.isFinite(row.copper) || row.copper < 0) continue;
    if (!out[row.itemId] || row.copper < out[row.itemId].copper) out[row.itemId] = row;
  }
  return out;
}
export function planShopping(recipes: PlannerRecipe[], profession: string, fromSkill: number, toSkill: number, skipped: string[], prices: Record<string, number>) {
  if (![fromSkill,toSkill].every(n => Number.isInteger(n) && n >= 1 && n <= 500) || toSkill <= fromSkill) throw new Error("Choose whole skills from 1 to 500, with To above From.");
  // Reuse the upload planner's exact craft counts, coverage priorities and rounding.
  const priceMap = new Map(Object.entries(prices));
  return professionPath([], [], { profession, fromSkill, toSkill }, recipes.filter(r => !skipped.includes(r.recipe)), priceMap);
}
export function filterRecipes(rows: SearchRecipe[], query: string, skill: number | null): SearchRecipe[] {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter(r => !(skill !== null && r.yellow !== null && r.grey !== null && skill >= r.grey)
    && (!q || [r.name,r.itemName ?? "",...r.recipeItems.map(x=>x.name),...r.reagents.map(x=>x.name)].some(n=>n.toLocaleLowerCase().includes(q))));
}
