import { CLIENT_PROFESSIONS, type RecipeView } from "./professions";
import { catalogTree, type CatalogRecipe } from "./crafting-profit";
import type { PlanCatalogEntry } from "@/app/tools/professions/recipe-shopping";

/**
 * The catalog makes a selected recipe's card is sent, on the server. Every catalog recipe that makes an item, in any
 * profession (catalog planning is hypothetical), indexed once; the card gets the producers of its materials within
 * the planner's depth and recipe bounds, and within CARD_CATALOG_BYTES of serialized catalog and names so the card's
 * props stay within their 40 KiB budget. A cut list says so (`truncated`).
 */

/** Serialized catalog entries plus the item names they need; the rest of the card's props stay well under 6 KiB. */
export const CARD_CATALOG_BYTES = 34 * 1024;

let producers: Map<number, (CatalogRecipe & { profession: string })[]> | null = null;
export function catalogProducers(): Map<number, (CatalogRecipe & { profession: string })[]> {
  if (!producers) {
    producers = new Map();
    for (const prof of CLIENT_PROFESSIONS) {
      for (const r of prof.recipes) {
        if (!r.itemId || !r.reagents.length) continue;
        const entry = { recipeId: r.spellId, itemId: r.itemId, minimum: r.output?.minimum ?? null, maximum: r.output?.maximum ?? null,
          reagents: r.reagents, cooldownMs: r.output?.cooldownMs ?? null, profession: prof.name };
        producers.set(r.itemId, [...(producers.get(r.itemId) ?? []), entry]);
      }
    }
  }
  return producers;
}

export function planCardCatalog(recipe: Pick<RecipeView, "spellId" | "reagents">, spellName: (id: number) => string, itemName: (id: number) => string,
  budget = CARD_CATALOG_BYTES): { catalog: PlanCatalogEntry[]; itemNames: Record<number, string>; truncated: boolean } {
  const tree = catalogTree(recipe.reagents, catalogProducers(), recipe.spellId);
  const itemNames: Record<number, string> = {};
  const name = (id: number) => { if (!(id in itemNames)) itemNames[id] = itemName(id); };
  for (const g of recipe.reagents) name(g.itemId);
  let bytes = JSON.stringify(itemNames).length;
  const catalog: PlanCatalogEntry[] = [];
  let truncated = tree.truncated;
  for (const r of tree.recipes) {
    const entry: PlanCatalogEntry = {
      recipeId: r.recipeId, name: spellName(r.recipeId), profession: (r as CatalogRecipe & { profession: string }).profession,
      itemId: r.itemId, minimum: r.minimum, maximum: r.maximum, reagents: r.reagents.map((g): [number, number] => [g.itemId, g.count]), cooldownMs: r.cooldownMs,
    };
    const fresh = [r.itemId, ...r.reagents.map((g) => g.itemId)].filter((id, i, all) => !(id in itemNames) && all.indexOf(id) === i);
    const added = JSON.stringify(entry).length + 1 + fresh.reduce((n, id) => n + JSON.stringify(itemName(id)).length + String(id).length + 4, 0);
    if (bytes + added > budget) { truncated = true; break; }
    bytes += added;
    catalog.push(entry);
    for (const id of fresh) name(id);
  }
  return { catalog, itemNames, truncated };
}
