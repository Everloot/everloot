import { CLIENT_RECIPES } from "@/data/game-data/client-recipes";
import snapshot from "@/data/profession-search-names.json";
import { CLIENT_PROFESSIONS, RECIPES_BUILD } from "./professions";
import type { SearchRecipe } from "./profession-planner";

/** Build-time only: the narrow, build-matched snapshot contains names already shown on our profession pages.
 * No private name ledger, corpus or player identifiers enter this public site asset. */
export function buildRecipeCatalog(): { build: string; named: boolean; credit: string; namesSource: string; recipes: SearchRecipe[] } {
  const current = snapshot.build === RECIPES_BUILD;
  const items: Record<string,string> = current ? snapshot.items : {};
  const spells: Record<string,string> = current ? snapshot.spells : {};
  const itemName = (id: number) => items[id] ?? `Item ${id}`;
  return { build: RECIPES_BUILD, named: current && Object.keys(spells).length > 0,
    credit: CLIENT_RECIPES.credit,
    namesSource: "Names already shown on Everloot profession pages: player reports, game files and Warcraft Wiki (CC BY-SA 4.0).",
    recipes: CLIENT_PROFESSIONS.flatMap(p => p.recipes.map(r => ({
      profession: p.name, slug: p.slug, spellId: r.spellId,
      name: spells[r.spellId] ?? `Spell ${r.spellId}`,
      itemName: r.itemId ? itemName(r.itemId) : null,
      yellow: r.yellow, grey: r.grey,
      recipeItems: (CLIENT_RECIPES.recipeItems?.[r.spellId] ?? []).map(itemId => ({ itemId, name: itemName(itemId), sources: [] })),
      reagents: r.reagents.map(x => ({ ...x, name: itemName(x.itemId) })),
    }))),
  };
}
