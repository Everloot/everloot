export type RecipeItem = { itemId: number; name: string; unconfirmed?: boolean; sources: string[]; sourceLinks?: { label: string; href: string }[] };
export interface SearchRecipe {
  profession: string; slug: string; spellId: number; name: string; itemName: string | null; itemUnconfirmed?: boolean;
  yellow: number | null; grey: number | null;
  recipeItems: RecipeItem[];
  reagents: { itemId: number; name: string; count: number; unconfirmed?: boolean }[];
}

export function filterRecipes(rows: SearchRecipe[], query: string, skill: number | null): SearchRecipe[] {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter(r => !(skill !== null && r.yellow !== null && r.grey !== null && skill >= r.grey)
    && (!q || [r.name, r.itemName ?? "", ...r.recipeItems.map(x => x.name), ...r.reagents.map(x => x.name)]
      .some(name => name.toLocaleLowerCase().includes(q))));
}
