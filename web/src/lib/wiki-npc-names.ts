import { agreedNpcsOf, type WorldFacts } from "@kb/world-pages";
import type { WikiEntityNames } from "./wiki-entity-names";

/**
 * `shownNpcName`'s Warcraft Wiki half for every NPC at once (the NPC list and the search): one or two installs' unanimous
 * name, where it matches a wiki NPC name. One pass over the agreed NPC table per corpus (or stored table) and wiki file
 * version. Null without the wiki file or the uploads.
 */
const wikiNpcMemo = new WeakMap<object, WeakMap<object, Map<number, { name: string; wikiPage: string }>>>();
export function wikiNpcNames(facts: WorldFacts & { unreachable?: boolean }, wiki: WikiEntityNames | null): Map<number, { name: string; wikiPage: string }> | null {
  if (facts.unreachable || !wiki?.names.size) return null;
  const table = agreedNpcsOf(facts);
  let inner = wikiNpcMemo.get(table);
  if (!inner) { inner = new WeakMap(); wikiNpcMemo.set(table, inner); }
  let out = inner.get(wiki);
  if (!out) {
    out = new Map();
    for (const { npcId, reportedName } of table.values()) {
      const hit = reportedName ? wiki.names.get(reportedName) : undefined;
      if (hit) out.set(npcId, hit);
    }
    inner.set(wiki, out);
  }
  return out;
}
