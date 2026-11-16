import teachingItems from "@/data/game-data/client-recipe-items.json";
import { RECIPES_BUILD, type ProfessionInfo } from "./professions";
import type { SearchRecipe } from "./profession-planner";

/** Page-scoped props only. Callers supply the names their existing page readers may show. */
export function buildRecipeCatalog(p: ProfessionInfo, itemName: (id: number) => string, spellName: (id: number) => string | undefined, isFiles: (id: number) => boolean = () => false): SearchRecipe[] {
  const links: Record<string, number[]> = teachingItems.build.version === RECIPES_BUILD ? teachingItems.links : {};
  return p.recipes.map(r => ({
    profession: p.name, slug: p.slug, spellId: r.spellId,
    name: spellName(r.spellId) ?? `Spell ${r.spellId}`,
    itemName: r.itemId ? itemName(r.itemId) : null,
    itemUnconfirmed: Boolean(r.itemId && isFiles(r.itemId)),
    yellow: r.yellow, grey: r.grey,
    recipeItems: (links[r.spellId] ?? []).map(itemId => ({ itemId, name: itemName(itemId), unconfirmed: isFiles(itemId), sources: [] })),
    reagents: r.reagents.map(x => ({ ...x, name: itemName(x.itemId), unconfirmed: isFiles(x.itemId) })),
  }));
}

export function teachingItemIds(spellIds: readonly number[]): number[] {
  const links: Record<string, number[]> = teachingItems.build.version === RECIPES_BUILD ? teachingItems.links : {};
  return [...new Set(spellIds.flatMap(id => links[id] ?? []))];
}
