import { loadItemNames, loadItemSetNames, loadQuestNames, loadSpellNames, PRIVATE_UNREACHABLE } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { loadNames, type Names } from "@/lib/names";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { loadStoredSearchNames } from "@/lib/search-names-store";
import { loadShownNames, shownSearchNames, shownSearchNamesFromStored, type ShownNames } from "@/lib/shown-item-names";
import { loadWikiEntityNames } from "@/lib/wiki-entity-names";
import { publicVendors } from "@/lib/world-lists";

// The loader for the site's own search: /search and the type-ahead under the header and hub search boxes
// (/search/suggest). Which names it may show, and why /api/suggest, the MCP server and the bulk download keep the
// agreed ones, is the policy at the top of names.ts; the merge is `shownSearchNames` in shown-item-names.ts.

/** The shown item, NPC, object and quest names, with one world read serving the agreed names and the wiki match. */
export async function loadShownSearchNames(shownRead: Promise<ShownNames> = loadShownNames(), worldRead: ReturnType<typeof loadWorldFacts> = loadWorldFacts()): Promise<Names> {
  const [agreed, shown, quests, world, npcWiki] = await Promise.all([
    loadNames(shownRead.then((shown) => shown.facts), worldRead), shownRead, loadQuestNames(CLIENT_LAYER.build.version), worldRead, loadWikiEntityNames("npc"),
  ]);
  return shownSearchNames({ agreed, shown, quests, world, npcWiki });
}


/**
 * What a search surface needs: the names it matches, whether an item row may show its icon (shown-item-names.ts
 * showsTip), and, from the stored file, the ids the object list shows (undefined on the aggregate path, which reads them).
 * `spells` and `itemSets` are the names the spell list and the set pages show (the private game-file names, pages only),
 * and `vendors` the ids /database/vendors lists; each is undefined when it could not be read, and its group is left out.
 */
export interface SearchShown { names: Names; showsTip: (id: number) => boolean; objects?: Set<number>; spells?: Map<number, string>; itemSets?: Map<number, string>; vendors?: Set<number> }

/** The spell and item set names the pages show, from the private name files; a file that is not there leaves its group out. */
async function pageFileNames(): Promise<Pick<SearchShown, "spells" | "itemSets">> {
  const [spells, sets] = await Promise.all([loadSpellNames(CLIENT_LAYER.build.version), loadItemSetNames(CLIENT_LAYER.build.version)]);
  return { ...(spells ? { spells: spells.names } : {}), ...(sets ? { itemSets: sets.names } : {}) };
}

/**
 * The search surfaces' names from the stored names file (search-names-store.ts) merged with the private game-file
 * names, so a keystroke never parses the aggregates; with no file, the aggregate path above, as before.
 */
export async function loadSearchShown(): Promise<SearchShown> {
  const [stored, files] = await Promise.all([loadStoredSearchNames(), pageFileNames()]);
  if (!stored) {
    const shown = loadShownNames();
    const worldRead = loadWorldFacts();
    const [names, world] = await Promise.all([loadShownSearchNames(shown, worldRead), worldRead]);
    // The vendor list's own rule, on the world facts this read already holds.
    const vendors = world.unreachable ? {} : { vendors: new Set(publicVendors(world).map((v) => v.vendorNpcId)) };
    return { names, showsTip: (await shown).showsTip, ...files, ...vendors };
  }
  const [read, quests, npcWiki] = await Promise.all([loadItemNames(CLIENT_LAYER.build.version), loadQuestNames(CLIENT_LAYER.build.version), loadWikiEntityNames("npc")]);
  const matched = read === PRIVATE_UNREACHABLE ? null : read;
  return {
    names: shownSearchNamesFromStored(stored, { matched, quests, npcWiki }),
    // The item page's rule, as loadShownNames applies it: an agreed name, a public drop, or the game files' name.
    showsTip: (id) => stored.names.items.has(id) || stored.dropped.has(id) || Boolean(matched?.names.has(id)),
    objects: stored.objectIds,
    ...files,
    ...(stored.vendorIds ? { vendors: stored.vendorIds } : {}),
  };
}
