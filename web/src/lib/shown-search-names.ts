import { loadQuestNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { loadNames, type Names } from "@/lib/names";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { loadShownNames, shownSearchNames, type ShownNames } from "@/lib/shown-item-names";
import { loadWikiEntityNames } from "@/lib/wiki-entity-names";

// The loader for the site's own search: /search and the type-ahead under the header and hub search boxes
// (/search/suggest). Which names it may show, and why /api/suggest, the MCP server and the bulk download keep the
// agreed ones, is the policy at the top of names.ts; the merge is `shownSearchNames` in shown-item-names.ts.

/** The shown item, NPC, object and quest names, with one world read serving the agreed names and the wiki match. */
export async function loadShownSearchNames(shownRead: Promise<ShownNames> = loadShownNames()): Promise<Names> {
  const worldRead = loadWorldFacts();
  const [agreed, shown, quests, world, npcWiki] = await Promise.all([
    loadNames(shownRead.then((shown) => shown.facts), worldRead), shownRead, loadQuestNames(CLIENT_LAYER.build.version), worldRead, loadWikiEntityNames("npc"),
  ]);
  return shownSearchNames({ agreed, shown, quests, world, npcWiki });
}
