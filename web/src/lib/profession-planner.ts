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
/**
 * A path recipe as the page sends it to the shopping list: [recipe, skillMin, skillMax, points, reporters, [reagent, count][],
 * trainingCopper]. The training cost is left off when the step has none (agreed steps), and is a number or null otherwise.
 */
export type PackedRecipe = [string, number, number, number, number, [string, number][], (number | null)?];
export function packRecipes(recipes: PlannerRecipe[]): PackedRecipe[] {
  return recipes.map((r) => {
    const row: PackedRecipe = [r.recipe, r.skillMin, r.skillMax, r.points, r.reporters, r.reagents.map((x): [string, number] => [x.item, x.count])];
    if (r.trainingCopper !== undefined) row.push(r.trainingCopper);
    return row;
  });
}
/** Every packed recipe belongs to the one profession the list is for. */
export function unpackRecipes(rows: PackedRecipe[], profession: string): PlannerRecipe[] {
  return rows.map(([recipe, skillMin, skillMax, points, reporters, reagents, ...training]) => ({
    profession, recipe, skillMin, skillMax, points, reporters, reagents: reagents.map(([item, count]) => ({ item, count })),
    ...(training.length ? { trainingCopper: training[0] } : {}),
  }));
}
/**
 * What the shopping list reads from one profession's game-file catalog for the path's recipes: the reagent item ids (it
 * matches the path's reagent names to them through the page's item lookup), and the teaching items by lowercased recipe
 * name, for names only one recipe has. Names and badges come from the item lookup, so each item's name is sent once.
 */
export type ShoppingCatalog = { reagents: number[]; taught: Record<string, number[]> };
export function shoppingCatalog(catalog: SearchRecipe[], recipes: PlannerRecipe[]): ShoppingCatalog {
  const key = (name: string) => name.trim().toLowerCase();
  const onPath = new Set(recipes.map((r) => key(r.recipe)));
  const rows = catalog.filter((r) => onPath.has(key(r.name)));
  const named = new Map<string, SearchRecipe[]>();
  for (const r of rows) named.set(key(r.name), [...(named.get(key(r.name)) ?? []), r]);
  const taught: Record<string, number[]> = {};
  for (const [name, [only, ...more]] of named) if (!more.length && only.recipeItems.length) taught[name] = only.recipeItems.map((x) => x.itemId);
  return { reagents: [...new Set(rows.flatMap((r) => r.reagents.map((x) => x.itemId)))], taught };
}
export function filterRecipes(rows: SearchRecipe[], query: string, skill: number | null): SearchRecipe[] {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter(r => !(skill !== null && r.yellow !== null && r.grey !== null && skill >= r.grey)
    && (!q || [r.name,r.itemName ?? "",...r.recipeItems.map(x=>x.name),...r.reagents.map(x=>x.name)].some(n=>n.toLocaleLowerCase().includes(q))));
}
