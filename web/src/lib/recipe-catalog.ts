import teachingItems from "@/data/game-data/client-recipe-items.json";
import { recipeBySpell, RECIPES_BUILD, type ProfessionInfo } from "./professions";
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

let taughtBy: Map<number, number | null> | null = null;

/**
 * The item a recipe item teaches how to make: the item its recipe creates (client-recipe-items.json links the
 * teaching item to the recipe spell, client-recipes.json the spell to what it creates). Null for an item that
 * teaches no recipe, a recipe that creates no item (an enchant), or recipes that create different items.
 */
export function taughtItemId(itemId: number): number | null {
  if (!taughtBy) {
    const links: Record<string, number[]> = teachingItems.build.version === RECIPES_BUILD ? teachingItems.links : {};
    const made = new Map<number, Set<number>>();
    for (const [spell, items] of Object.entries(links)) {
      const created = recipeBySpell(Number(spell))?.itemId;
      for (const item of items) made.set(item, new Set([...(made.get(item) ?? []), ...(created ? [created] : [])]));
    }
    taughtBy = new Map([...made].map(([item, set]) => [item, set.size === 1 ? [...set][0]! : null]));
  }
  return taughtBy.get(itemId) ?? null;
}

export function teachingItemIds(spellIds: readonly number[]): number[] {
  const links: Record<string, number[]> = teachingItems.build.version === RECIPES_BUILD ? teachingItems.links : {};
  return [...new Set(spellIds.flatMap(id => links[id] ?? []))];
}
