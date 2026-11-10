import { itemPage } from "../../../kb/src/item-page";
import { objectPage } from "../../../kb/src/object-page";
import { npcPage, questPage, vendorPage } from "../../../kb/src/world-pages";
import { loadEdges } from "./edges";
import { loadSpellNames } from "./game-assets";
import { itemIndexable, npcIndexable, objectIndexable, questIndexable, spellIndexable, vendorIndexable } from "./indexable";
import { instanceHref, instanceRows } from "./instances";
import { CLIENT_LAYER, shownItemName } from "./items";
import { loadObjectFacts } from "./objects";
import { loadWorldFacts } from "./rollup-compute";
import { loadShownNames } from "./shown-item-names";
import { loadSpellTalents } from "./talents/spell-talents";
import type { ZoneSightings } from "./zones";

/** Database detail URLs per sitemap file, under the protocol's 50,000. */
export const DATABASE_CHUNK = 40_000;

/** Rows by key, skipping rows without one. */
function byKey<T>(rows: readonly T[], key: (row: T) => number | undefined): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === undefined) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

const ascending = (ids: Iterable<number>) => [...new Set(ids)].sort((a, b) => a - b);

/**
 * The spells the sitemap lists: named in the game files' spell names and related to something, an item it creates or
 * costs, the skill line that teaches it, a relation players reported, or a place in the talent trees. Each passes
 * `spellIndexable` as its page asks it, with the tooltip left out, so a spell known only by its name or its tooltip
 * is left out, as the owner chose: of the 32,000 named spells, only the ones a page has something to say about.
 * Without the names file none is listed.
 */
export function spellIds(
  edges: readonly { fromKind: string; fromId: number; toKind: string; toId: number }[],
  names: { has(spellId: number): boolean } | null,
  talents: { keys(): Iterable<number>; has(spellId: number): boolean },
): number[] {
  if (!names) return [];
  const related = new Set<number>();
  for (const e of edges) {
    if (e.fromKind === "spell") related.add(e.fromId);
    if (e.toKind === "spell") related.add(e.toId);
  }
  return ascending([...related, ...talents.keys()]).filter((id) =>
    spellIndexable({ named: names.has(id), text: false, relations: related.has(id) ? 1 : 0, talents: talents.has(id) ? 1 : 0 }));
}

/**
 * Every item, NPC, quest, object, vendor and related spell page that asks to be indexed, by the same function its
 * robots metadata calls (lib/indexable.ts). Each page is built from only its own rows, which gives the page the
 * whole page would: every builder reads only the rows about its id. Null when upload storage cannot be
 * read, so the sitemap answers 503 instead of a short list.
 */
export async function databasePaths(): Promise<string[] | null> {
  const [{ facts, agreed, matched }, world, objects, edges, spellNames, talents] = await Promise.all([
    loadShownNames(), loadWorldFacts(), loadObjectFacts(), loadEdges(), loadSpellNames(CLIENT_LAYER.build.version), loadSpellTalents(),
  ]);
  if (facts.unreachable || world.unreachable || objects.unreachable || edges.unreachable) return null;

  const names = byKey(facts.names, (r) => r.itemId);
  const rates = byKey(facts.rates, (r) => r.itemId);
  const sightings = byKey(facts.npcs, (r) => r.npcId);
  const items = ascending([...names.keys(), ...rates.keys(), ...(matched?.names.keys() ?? [])]).filter((id) => {
    const own = rates.get(id) ?? [];
    // Pins come from the NPCs this item drops from, so those NPCs' sightings go with it.
    const sources = ascending(own.flatMap((r) => (r.sourceNpcId === undefined ? [] : [r.sourceNpcId])));
    const page = itemPage(id, { names: names.get(id) ?? [], rates: own, npcs: sources.flatMap((n) => sightings.get(n) ?? []) });
    return itemIndexable(page, false, shownItemName(id, agreed, matched?.names));
  });

  const none = { npcs: [], quests: [], vendors: [], recheck: world.recheck };
  const npcRows = byKey(world.npcs, (r) => r.npcId);
  const npcs = ascending(npcRows.keys()).filter((id) => npcIndexable(npcPage(id, { ...none, npcs: npcRows.get(id)! }), false));
  const questRows = byKey(world.quests, (r) => r.questId);
  const quests = ascending(questRows.keys()).filter((id) => questIndexable(questPage(id, { ...none, quests: questRows.get(id)!, npcs: world.npcs }), false));
  const vendorRows = byKey(world.vendors, (r) => r.vendorNpcId);
  const vendors = ascending(vendorRows.keys()).filter((id) => vendorIndexable(vendorPage(id, { ...none, vendors: vendorRows.get(id)!, npcs: world.npcs }), false));

  const objectRates = byKey(objects.rates, (r) => r.sourceObjectId);
  const objectZeros = byKey(objects.measuredZeros, (r) => r.sourceObjectId);
  const objectIds = ascending([...objectRates.keys(), ...objectZeros.keys()]).filter((id) =>
    objectIndexable(objectPage(id, { rates: objectRates.get(id) ?? [], measuredZeros: objectZeros.get(id) ?? [], names: [] }), false));

  return [
    ...items.map((id) => `/database/items/${id}`),
    ...npcs.map((id) => `/database/npcs/${id}`),
    ...quests.map((id) => `/database/quests/${id}`),
    ...objectIds.map((id) => `/database/objects/${id}`),
    ...vendors.map((id) => `/database/vendors/${id}`),
    ...spellIds([...edges.observed, ...edges.client], spellNames?.names ?? null, talents).map((id) => `/database/spells/${id}`),
  ];
}

/**
 * The instance pages that ask to be indexed: one per row `instanceRows` gives, which leaves out an instance known
 * only from a held-back zone, as the page 404s for it. The page says noindex while storage cannot be read (it would
 * cache a page without players' reports), so none is listed then, as with the zone pages. Zones, like instances,
 * are listed by sitemap.ts: there are tens of them, not thousands.
 */
export function instancePaths(seen: ZoneSightings & { unreachable?: boolean }): string[] {
  if (seen.unreachable) return [];
  return [...instanceRows(seen).values()].map((row) => instanceHref(row.instanceMapId, row.name));
}

export function databaseUnavailable(): Response {
  return Response.json({ error: "Database unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store" } });
}

/** Pages flip to indexed as uploads roll up; crawlers do not need the list fresher than hourly. */
export const DATABASE_SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, must-revalidate",
  // Next overwrites Cache-Control on dynamic routes, so the CDN reads these instead.
  "CDN-Cache-Control": "max-age=3600, stale-while-revalidate=86400",
};
