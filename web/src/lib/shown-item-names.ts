import { cache } from "react";
import { agreedItemNames } from "@kb/item-page";
import { npcReportedName, type WorldFacts } from "@kb/world-pages";
import { loadItemNames, PRIVATE_UNREACHABLE, type ItemNames, type QuestNames } from "@/lib/game-assets";
import { CLIENT_LAYER, shownItemName } from "@/lib/items";
import { npcNames, questTitles, type Names } from "@/lib/names";
import { loadItemFacts } from "@/lib/rollup-compute";
import type { WikiEntityNames } from "@/lib/wiki-entity-names";

// SHOWN names: what the database pages print. The policy, and what "agreed" and "shown" mean, is the comment at the
// top of names.ts. Server only, and pages only: the API, MCP server and bulk download never import this
// (talents/assets.test.ts checks that). The loaders that feed the composers below stay beside their callers
// (shown-search-names.ts, wiki-names.ts), so each page reads only the sources it needs.

export interface ShownNames {
  facts: Awaited<ReturnType<typeof loadItemFacts>>;
  /** Names 3 installs agree on; empty when upload storage cannot be reached. */
  agreed: Map<number, string>;
  /** Names the game files and the Warcraft Wiki agree on, for this build; null without the private file. */
  matched: ItemNames | null;
  /** Whether an item has a name from either: the share a category needs before it is indexed. */
  named: { has(id: number): boolean };
  /**
   * Whether a page may show an item's game file tooltip (icon, item level, required level, binding, and the rest):
   * players reported it (an agreed name or a public drop, as its page counts them), or its name shows under the
   * item name rule (docs/DATA_POLICY.md). Any other id may be unreleased content.
   */
  showsTip(id: number): boolean;
  /** Upload storage or the private bucket could not be read: names may be missing (components/EdgeDegraded.tsx). */
  degraded: boolean;
}

/** The item names the item pages may show, read once per request (React `cache`) for the page, its metadata and the sitemap. */
export const loadShownNames = cache(async (): Promise<ShownNames> => {
  const [facts, read] = await Promise.all([loadItemFacts(), loadItemNames(CLIENT_LAYER.build.version)]);
  const matched = read === PRIVATE_UNREACHABLE ? null : read;
  const agreed = facts.unreachable ? new Map<number, string>() : agreedItemNames(facts);
  // The same test as itemPage's name, drops and pins (pins come only with a drop), in one pass.
  const dropped = new Set(facts.unreachable ? [] : facts.rates.filter((r) => r.public).map((r) => r.itemId));
  return {
    facts, agreed, matched, degraded: facts.unreachable || read === PRIVATE_UNREACHABLE,
    named: { has: (id) => agreed.has(id) || Boolean(matched?.names.has(id)) },
    showsTip: (id) => agreed.has(id) || dropped.has(id) || Boolean(matched?.names.has(id)),
  };
});

/** The agreed name first, then the one the name rule allows, as the pages pick them. */
function merged<T extends { name: string }>(agreed: Map<number, string>, rule: Map<number, T> | null | undefined): Map<number, string> {
  if (!rule?.size) return agreed;
  const out = new Map<number, string>();
  for (const [id, x] of rule) out.set(id, x.name);
  for (const [id, name] of agreed) out.set(id, name);
  return out;
}

// Both inputs are read once per corpus or file version, so the merged maps are kept while they stay the same.
const mergedMemo = new WeakMap<Map<number, string>, WeakMap<object, Map<number, string>>>();
const EMPTY = {};
function mergedOnce<T extends { name: string }>(agreed: Map<number, string>, rule: Map<number, T> | null | undefined): Map<number, string> {
  const key = rule ?? EMPTY;
  let inner = mergedMemo.get(agreed);
  if (!inner) { inner = new WeakMap(); mergedMemo.set(agreed, inner); }
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
 * Item names, NPC names, object names and quest titles as the pages print them, for the site's own search: the name
 * 3 installs agree on, else the game files and Warcraft Wiki match for items, the Warcraft Wiki name a unanimous report
 * matches for NPCs, and the wiki title for quests. Objects have agreed names only, as their pages do.
 */
export function shownSearchNames(sources: {
  agreed: Names;
  shown: Pick<ShownNames, "matched">;
  quests: QuestNames | null;
  world: WorldFacts & { unreachable?: boolean };
  npcWiki: WikiEntityNames | null;
}): Names {
  const { agreed, shown, quests, world, npcWiki } = sources;
  return {
    items: mergedOnce(agreed.items, shown.matched?.names),
    npcs: mergedOnce(agreed.npcs, wikiNpcNames(world, npcWiki)),
    objects: agreed.objects,
    quests: mergedOnce(agreed.quests, quests?.names),
  };
}

/**
 * The names of a wiki page's entity tokens: an item's shown name (players' agreed name, else the game files where the
 * Warcraft Wiki agrees), an NPC's agreed name, a quest's agreed title else the wiki's. Undefined when there is none.
 */
export function tokenNamer(sources: {
  shown: Pick<ShownNames, "agreed" | "matched"> | null;
  world: (WorldFacts & { unreachable?: boolean }) | null;
  questWiki: QuestNames | null;
}): (kind: "item" | "npc" | "quest", id: number) => string | undefined {
  const { shown, world, questWiki } = sources;
  const npcs = world && !world.unreachable ? npcNames(world) : new Map<number, string>();
  const quests = world && !world.unreachable ? questTitles(world) : new Map<number, string>();
  return (kind, id) => {
    if (kind === "item") return shown ? shownItemName(id, shown.agreed, shown.matched?.names)?.name : undefined;
    if (kind === "npc") return npcs.get(id);
    return quests.get(id) ?? questWiki?.names.get(id)?.name;
  };
}
