import { loadQuestNames } from "@/lib/game-assets";
import { CLIENT_LAYER } from "@/lib/items";
import { loadNames, type Names } from "@/lib/names";
import { loadShownNames, type ShownNames } from "@/lib/shown-item-names";

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

/**
 * Item names, NPC names, object names and quest titles as the pages print them: the name 3 installs agree on, else the
 * game files and Warcraft Wiki match for items, and the wiki title for quests. NPCs and objects have agreed names only.
 */
export async function loadShownSearchNames(shownRead: Promise<ShownNames> = loadShownNames()): Promise<Names> {
  const [agreed, shown, quests] = await Promise.all([loadNames(shownRead.then((shown) => shown.facts)), shownRead, loadQuestNames(CLIENT_LAYER.build.version)]);
  return {
    items: mergedOnce(agreed.items, shown.matched?.names),
    npcs: agreed.npcs,
    objects: agreed.objects,
    quests: mergedOnce(agreed.quests, quests?.names),
  };
}
