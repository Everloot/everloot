import type { Edge } from "../../../../kb/src/edges";
import { categoryOf } from "../../../../kb/src/item-taxonomy";
import { pendingForNpc } from "../../../../kb/src/pending-loot";
import { CLIENT_TAXONOMY } from "@/lib/items";
import type { computeRollups, loadWorldFacts } from "@/lib/rollup-compute";
import type { ShownNames } from "@/lib/shown-item-names";

// Whether an id is a page at all. A page and its social card (opengraph-image.tsx beside it) ask the same
// question, so a link to an unknown id gets a 404 from both, not an empty page or a blank card (docs/SEO.md).

/**
 * An id neither the game files nor any upload knows: no row in the client layer, no report about it (even one
 * short of the 3 installs), no relation. It is a 404, not an empty page. While upload storage is out of reach
 * nothing can be ruled out.
 */
export function unknownItem(itemId: number, facts: ShownNames["facts"], relations: readonly Edge[], seen: { seen: Set<number>; unreachable: boolean }): boolean {
  if (facts.unreachable || seen.unreachable || categoryOf(CLIENT_TAXONOMY, itemId) !== null || relations.length > 0 || seen.seen.has(itemId)) return false;
  return !facts.names.some((r) => r.itemId === itemId) && !facts.rates.some((r) => r.itemId === itemId);
}

/**
 * An id no upload mentions: no sighting, no vendor or quest row naming it, no loot window from it, counted or not. The game
 * files the site reads hold no NPC table, so that is a 404, not an empty page. Unreachable storage rules nothing out.
 */
export function unknownNpc(npcId: number, facts: Awaited<ReturnType<typeof loadWorldFacts>>, rollup: Awaited<ReturnType<typeof computeRollups>>): boolean {
  if (facts.unreachable || rollup.stats.unreachable) return false;
  return !facts.npcs.some((r) => r.npcId === npcId)
    && !facts.vendors.some((r) => r.vendorNpcId === npcId)
    && !facts.quests.some((r) => r.giverNpcId === npcId || r.turnInNpcId === npcId)
    && !rollup.rates.some((r) => r.sourceNpcId === npcId)
    && !rollup.measuredZeros.some((r) => r.sourceNpcId === npcId)
    && !pendingForNpc(facts.pending, npcId);
}

/**
 * An id no upload mentions and the game files' quest list (the titles file) does not hold: a 404, not an empty
 * page. Without that file, or with storage out of reach, nothing can be ruled out.
 */
export function unknownQuest(questId: number, facts: Awaited<ReturnType<typeof loadWorldFacts>>, wiki: { names: { has(questId: number): boolean } } | null): boolean {
  return !facts.unreachable && wiki !== null && !wiki.names.has(questId) && !facts.quests.some((r) => r.questId === questId);
}
