import { CLIENT_RECIPES } from "@/data/game-data/client-recipes";
import acquisition from "@/data/profession-recipe-sources.json";
import teachingItems from "@/data/game-data/client-recipe-items.json";
import snapshot from "@/data/profession-search-names.json";
import { CLIENT_PROFESSIONS, RECIPES_BUILD } from "./professions";
import type { SearchRecipe } from "./profession-planner";

/** Build-time only: the narrow, build-matched snapshot contains names already shown on our profession pages.
 * No private name ledger, corpus or player identifiers enter this public site asset. */
export function buildRecipeCatalog(): { build: string; named: boolean; credit: string; namesSource: string; sourcesAsOf: string | null; recipes: SearchRecipe[] } {
  const current = snapshot.build === RECIPES_BUILD;
  const items: Record<string,string> = current ? snapshot.items : {};
  const spells: Record<string,string> = current ? snapshot.spells : {};
  const teachingNames:Record<string,string>=teachingItems.build.version===RECIPES_BUILD ? teachingItems.names : {};
  const teachingLinks:Record<string,number[]>=teachingItems.build.version===RECIPES_BUILD ? teachingItems.links : {};
  const sourceRows:Record<string,{rel:string;kind:string;id:number;lastSeen:string}[]>=acquisition.sources;
  const sourceLinks=(id:number)=>(sourceRows[id] ?? []).flatMap(s=>{
    const category=s.rel==="sold_by" ? "Vendor" : s.rel==="dropped_by" ? "Drop" : s.rel==="reward_from" ? "Quest reward" : null;
    const route=s.rel==="sold_by" && s.kind==="npc" ? "vendors" : ({npc:"npcs",object:"objects",quest:"quests"} as Record<string,string>)[s.kind];
    if(!category || !route) return [];
    return [{label:`${category}: ${s.kind} ${s.id} (observed ${s.lastSeen.slice(0,10)})`,href:`/database/${route}/${s.id}`}];
  });
  const itemName = (id: number) => items[id] ?? teachingNames[id] ?? `Item ${id}`;
  return { build: RECIPES_BUILD, named: current && Object.keys(spells).length > 0,
    credit: CLIENT_RECIPES.credit,
    namesSource: "Recipe/material names shown on Everloot profession pages: player reports, game files and Warcraft Wiki (CC BY-SA 4.0); teaching-item names from the matching Blizzard client, unconfirmed.",
    sourcesAsOf: acquisition.dataAsOf,
    recipes: CLIENT_PROFESSIONS.flatMap(p => p.recipes.map(r => ({
      profession: p.name, slug: p.slug, spellId: r.spellId,
      name: spells[r.spellId] ?? `Spell ${r.spellId}`,
      itemName: r.itemId ? itemName(r.itemId) : null,
      yellow: r.yellow, grey: r.grey,
      recipeItems: (CLIENT_RECIPES.recipeItems?.[r.spellId] ?? teachingLinks[r.spellId] ?? []).map(itemId => { const linked=sourceLinks(itemId); return {itemId,name:itemName(itemId),sources:linked.map(x=>x.label),sourceLinks:linked}; }),
      reagents: r.reagents.map(x => ({ ...x, name: itemName(x.itemId) })),
    }))),
  };
}
