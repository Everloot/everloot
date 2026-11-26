import { edgesFrom, edgesTo } from "@kb/edges";
import { loadEdges } from "@/lib/edges";
import { loadSiteAssets, loadSpellNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { loadSpellTalents } from "@/lib/talents/spell-talents";
import { loadWikiEntityNames, shownEntityName } from "@/lib/wiki-entity-names";

// The page and its social card (opengraph-image.tsx beside it) read the spell the same way, so both give one 404.

/**
 * What the page reads about one spell. The spell is unknown, a 404 rather than an empty page, when the game
 * files' spell names are loaded and do not hold it, it has no tooltip and no relation points from or to it.
 * Without the names file, or with upload storage out of reach, nothing can be ruled out.
 */
export async function loadSpell(spellId: number) {
  const [edges, assets, spellNames, talentIndex] = await Promise.all([
    loadEdges(),
    loadSiteAssets(),
    loadSpellNames(CLIENT_LAYER.build.version),
    loadSpellTalents(),
  ]);
  const both = [...edges.observed, ...edges.client];
  // Both directions: the files store what a spell creates and what it costs on the item (item -> created_by
  // or reagent_for -> spell), and what teaches it on the spell (spell -> in_skill_line -> skill).
  const all = [...edgesFrom(both, "spell", spellId), ...edgesTo(both, "spell", spellId)];
  const wiki = await loadWikiEntityNames("spell");
  const shownName = shownEntityName(spellId, spellNames?.names.get(spellId) || assets?.spellTips.get(spellId)?.name, wiki);
  const name = shownName.name;
  const tip = assets?.spellTips.get(spellId);
  const talents = talentIndex.get(spellId) ?? [];
  const unknown = spellNames !== null && !edges.unreachable && name === undefined && !tip && !all.length && !talents.length;
  return { edges, assets, all, name, tip, talents, unknown, fromWiki: shownName.fromWiki };
}
