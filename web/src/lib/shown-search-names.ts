import { npcReportedName, type WorldFacts } from "../../../kb/src/world-pages";
import { loadQuestNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { loadNames, type Names } from "@/lib/names";
import { loadWorldFacts } from "@/lib/rollup-compute";
import { loadShownNames, type ShownNames } from "@/lib/shown-item-names";
import { loadWikiEntityNames, type WikiEntityNames } from "@/lib/wiki-entity-names";

// The names the database pages show, for the site's own search: /search and the type-ahead under the
// header and hub search boxes (/search/suggest). Server only, and pages only: /api/suggest, the MCP server
// and the bulk download keep the names 3 installs agree on (docs/DATA_POLICY.md, item names and quest titles).

/** The agreed name first, then the one the name rule allows, as the pages pick them. */
function merged<T extends { name: string }>(agreed: Map<number, string>, rule: Map<number, T> | null | undefined): Map<number, string> {
  if (!rule?.size) return agreed;
  const out = new Map<number, string>();
  for (const [id, x] of rule) out.set(id, x.name);
  for (const [id, name] of agreed) out.set(id, name);
  return out;
}

// Both inputs are read once per corpus or file version, so the merged maps are kept while they stay the same.
const memo = new WeakMap<Map<number, string>, WeakMap<object, Map<number, string>>>();
const EMPTY = {};
function mergedOnce<T extends { name: string }>(agreed: Map<number, string>, rule: Map<number, T> | null | undefined): Map<number, string> {
  const key = rule ?? EMPTY;
  let inner = memo.get(agreed);
  if (!inner) { inner = new WeakMap(); memo.set(agreed, inner); }
  let out = inner.get(key);
  if (!out) { out = merged(agreed, rule); inner.set(key, out); }
  return out;
}

// The NPC page's rule (shownNpcName): one or two installs' unanimous name, where it matches a Warcraft Wiki NPC name.
// One pass over the sightings per corpus and wiki file version.
const wikiNpcMemo = new WeakMap<object, WeakMap<object, Map<number, { name: string }>>>();
function wikiNpcNames(facts: WorldFacts & { unreachable?: boolean }, wiki: WikiEntityNames | null): Map<number, { name: string }> | null {
  if (facts.unreachable || !wiki?.names.size) return null;
  let inner = wikiNpcMemo.get(facts.npcs);
  if (!inner) { inner = new WeakMap(); wikiNpcMemo.set(facts.npcs, inner); }
  let out = inner.get(wiki);
  if (!out) {
    const byNpc = new Map<number, WorldFacts["npcs"]>();
    for (const row of facts.npcs) { const rows = byNpc.get(row.npcId); if (rows) rows.push(row); else byNpc.set(row.npcId, [row]); }
    out = new Map();
    for (const [id, npcs] of byNpc) {
      const candidate = npcReportedName(id, { ...facts, npcs });
      const hit = candidate ? wiki.names.get(candidate) : undefined;
      if (hit) out.set(id, { name: hit.name });
    }
    inner.set(wiki, out);
  }
  return out;
}

/**
 * Item names, NPC names, object names and quest titles as the pages print them: the name 3 installs agree on, else the
 * game files and Warcraft Wiki match for items, the Warcraft Wiki name a unanimous report matches for NPCs, and the
 * wiki title for quests. Objects have agreed names only, as their pages do.
 */
export async function loadShownSearchNames(shownRead: Promise<ShownNames> = loadShownNames()): Promise<Names> {
  // One world read serves the agreed names and the wiki match.
  const worldRead = loadWorldFacts();
  const [agreed, shown, quests, world, npcWiki] = await Promise.all([
    loadNames(shownRead.then((shown) => shown.facts), worldRead), shownRead, loadQuestNames(CLIENT_LAYER.build.version), worldRead, loadWikiEntityNames("npc"),
  ]);
  return {
    items: mergedOnce(agreed.items, shown.matched?.names),
    npcs: mergedOnce(agreed.npcs, wikiNpcNames(world, npcWiki)),
    objects: agreed.objects,
    quests: mergedOnce(agreed.quests, quests?.names),
  };
}
