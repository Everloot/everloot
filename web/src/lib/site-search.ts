import { tools, toolHref } from "@/data/tools";
import { allDocsPages } from "@/lib/docs/nav";
import { entityHref } from "@/components/EntityLink";
import { describe } from "@kb/item-taxonomy";
import { objectList } from "@kb/object-page";
import { achievementHref, chainHref, factionHref, loadCatalog, titleDisplayName, titleHref } from "./completion-lists";
import { currencyEntries, currencyHref, mountEntries, mountHref, petEntries, petHref } from "./collectibles";
import { holidayEntries, holidayHref, petFamilyEntries, petFamilyHref } from "./world-events";
import { CLIENT_TAXONOMY } from "./items";
import { itemSet, itemSetHref } from "./item-sets";
import type { SearchHit } from "@kb/search";
import { classLabel } from "./class-context";
import { CLASSES } from "@/design/tokens";
import { instanceHref, instanceRows, instanceTitle, levelLabel, type InstanceRow } from "./instances";
import { laterExpansionPages, loreSlug, MAX_QUERY, searchLore, searchLoreSomeWords, UNAVAILABLE } from "./lore";
import { byPhrase, byTypo, byWords, rank, respelling, type Match } from "./name-match";
import { loadNames, type Names } from "./names";
import { loadObjectFacts } from "./objects";
import { loadWiki, publishedPages, wikiHref } from "./wiki";
import { WORLD_MAP } from "./world-map";
import { zoneHref } from "./zones";

export { byTypo, editDistance } from "./name-match";

/**
 * One page the search found. `exact` is an exact id or an exact name: those lead their group, and the page.
 * Database rows carry their id; item rows the game files' quality (0 poor to 5 legendary) and type, when
 * the item is in the build.
 */
export interface SearchResult { label: string; href: string; note?: string; exact: boolean; id?: number; quality?: number | null; meta?: string }
export type SearchType = "class" | "item" | "npc" | "vendor" | "quest" | "object" | "spell" | "achievement" | "faction" | "title" | "chain" | "item-set" | "mount" | "pet" | "currency" | "holiday" | "family" | "zone" | "instance" | "guide" | "lore" | "tool" | "doc";
/**
 * `total` counts every match; `results` holds the first `limit` of them. `respelled` is how the typo fallback read the
 * query ("linen cloth" for "lnen clth"), on every group when it fired.
 */
export interface SearchGroup { type: SearchType; heading: string; results: SearchResult[]; total: number; page?: number; respelled?: string }
export const GROUP_LIMIT = 8;
export const LORE_LIMIT = 5;

export const HEADINGS: Record<SearchType, string> = {
  class: "Classes", item: "Items", npc: "NPCs", vendor: "Vendors", quest: "Quests", object: "Objects", spell: "Spells", achievement: "Achievements", faction: "Factions", title: "Titles", chain: "Quest chains", "item-set": "Item sets", mount: "Mounts", pet: "Companion pets", currency: "Currencies", holiday: "Holidays and world events", family: "Hunter pet families", zone: "Zones", instance: "Dungeons and raids", guide: "Wiki", lore: "Lore archive", tool: "Tools", doc: "Docs",
};
/** The lore group's heading when its pages hold only some of the asked words. */
export const LORE_SOME_WORDS = "Lore archive, some of your words";
const ORDER: SearchType[] = ["class", "item", "npc", "vendor", "quest", "object", "spell", "achievement", "faction", "title", "chain", "item-set", "mount", "pet", "currency", "holiday", "family", "zone", "instance", "guide", "lore", "tool", "doc"];
/** The types a search can be scoped to (`/search?q=…&in=item`); `in=lore` is the lore archive's own list. */
export const SCOPES = ["item", "npc", "quest", "object"] as const satisfies readonly SearchType[];
export type Scope = (typeof SCOPES)[number];
export const isScope = (v: unknown): v is Scope => (SCOPES as readonly unknown[]).includes(v);
/** These groups keep search's matching rules and page within search rather than a database list. */
export const PAGED_SCOPES = ["vendor", "spell", "achievement", "faction", "title", "chain", "item-set", "mount", "pet", "currency", "holiday", "family", "zone", "instance"] as const;
export type ResultScope = Scope | (typeof PAGED_SCOPES)[number];
export const isPagedScope = (v: unknown): v is (typeof PAGED_SCOPES)[number] => (PAGED_SCOPES as readonly unknown[]).includes(v);
export const isResultScope = (v: unknown): v is ResultScope => isScope(v) || isPagedScope(v);

/** Every match of `entries`, best first (exact name, then prefix, then contains, then alphabetical). */
function byName<T extends { name: string }>(entries: Iterable<T>, match: Match): { entry: T; exact: boolean; r: number }[] {
  const hits: { entry: T; r: number; n: string }[] = [];
  for (const entry of entries) {
    const n = entry.name.toLowerCase();
    const r = match(n);
    if (r !== null) hits.push({ entry, r, n });
  }
  return hits.sort((a, b) => a.r - b.r || a.n.localeCompare(b.n)).map((h) => ({ entry: h.entry, exact: h.r === 0, r: h.r }));
}

/** An id typed whole ("1234", "#1234"): the digits, else null. */
export function exactId(q: string): number | null {
  const m = q.match(/^#?([1-9]\d{0,8})$/);
  return m ? Number(m[1]) : null;
}

let itemRows: Map<number, (typeof CLIENT_TAXONOMY.items)[number]> | null = null;
/** The quality and type the game files give an item, for colouring its name; nothing for an id not in the build. */
function itemFacts(id: number): Pick<SearchResult, "quality" | "meta"> {
  itemRows ??= new Map(CLIENT_TAXONOMY.items.map((row) => [row[0], row]));
  const row = itemRows.get(id);
  if (!row) return {};
  const c = describe(CLIENT_TAXONOMY, row);
  return { quality: row[4], meta: [c.subclass?.name, c.slot?.name].filter(Boolean).join(" · ") || undefined };
}

const WORD = { item: "Item", npc: "NPC", quest: "Quest" } as const;

/** One name of a name map, with its lowercase form for matching. */
export interface NamedRow { id: number; name: string; n: string }
const sortedRows = new WeakMap<Map<number, string>, NamedRow[]>();
/**
 * A name map's rows in name order, built once per map: the maps are replaced when the corpus or a names file
 * reloads, so each keystroke matches against the same array instead of copying and sorting the whole map.
 */
export function sortedNames(names: Map<number, string>): NamedRow[] {
  let rows = sortedRows.get(names);
  if (!rows) {
    rows = [...names].map(([id, name]) => ({ id, name, n: name.toLowerCase() })).sort((a, b) => a.n.localeCompare(b.n));
    sortedRows.set(names, rows);
  }
  return rows;
}

/** `byName` over rows already in name order: a stable sort by rank keeps the name order within a rank. */
function bySortedName(rows: readonly NamedRow[], match: Match): { entry: NamedRow; exact: boolean; r: number }[] {
  const hits: { entry: NamedRow; exact: boolean; r: number }[] = [];
  for (const entry of rows) {
    const r = match(entry.n);
    if (r !== null) hits.push({ entry, exact: r === 0, r });
  }
  return hits.sort((a, b) => a.r - b.r);
}

/** Exact id first (any id opens its page), then the agreed names that match, best first. */
function agreed(kind: "item" | "npc" | "quest", names: Map<number, string>, match: Match, id: number | null): { results: (SearchResult & { r: number })[]; total: number } {
  const out: (SearchResult & { r: number })[] = [];
  const extra = (n: number) => (kind === "item" ? itemFacts(n) : {});
  if (id !== null) out.push({ label: names.get(id) ?? `${WORD[kind]} ${id}`, href: entityHref(kind, id), note: `id ${id}`, exact: true, id, r: -1, ...extra(id) });
  const rows = bySortedName(sortedNames(names), match).filter(({ entry }) => entry.id !== id);
  for (const { entry, exact, r } of rows) out.push({ label: entry.name, href: entityHref(kind, entry.id), note: `id ${entry.id}`, exact, id: entry.id, r, ...extra(entry.id) });
  return { results: out, total: out.length };
}

let instanceList: InstanceRow[] | null = null;
/**
 * Dungeons and raids, the rows /database/instances lists from the game files (an entrance in a held-back zone is
 * left out, as there), by name with or without a leading "The": best first, then by name. Read once per process.
 */
function instanceHits(match: Match): (SearchResult & { id: number; r: number })[] {
  instanceList ??= [...instanceRows().values()];
  return instanceList.flatMap((row) => {
    const t = instanceTitle(row).toLowerCase();
    const r = Math.min(match(t) ?? 9, match(t.replace(/^the /, "")) ?? 9, match(`the ${t}`) ?? 9);
    if (r === 9) return [];
    const level = levelLabel(row.level);
    const note = [row.raid === null ? "Instance" : row.raid ? "Raid" : "Dungeon", level && `level ${level}`].filter(Boolean).join(", ");
    return [{ label: instanceTitle(row), href: instanceHref(row.instanceMapId, row.name), note, exact: r === 0, id: row.instanceMapId, r }];
  }).sort((a, b) => a.r - b.r || a.label.localeCompare(b.label));
}

/** Released zones on the map by name, best first, as the zone group of /search lists them. */
function zoneHits(match: Match): { id: number; label: string; href: string; exact: boolean; r: number }[] {
  return byName(WORLD_MAP.zones.map((z) => ({ id: z.uiMapId, name: z.name })), match)
    .map(({ entry, exact, r }) => ({ id: entry.id, label: entry.name, href: zoneHref(entry.id, entry.name), exact, r }));
}

/** A game-file list's hits by name, with an exact id first; none when the file could not be read. */
function fileHits(rows: { id: number; name: string }[] | null, match: Match, id: number | null, href: (id: number, name: string) => string): (SearchResult & { r: number })[] {
  if (!rows) return [];
  const out: (SearchResult & { r: number })[] = [];
  const exact = id === null ? undefined : rows.find((x) => x.id === id);
  if (exact) out.push({ label: exact.name, href: href(exact.id, exact.name), note: `id ${exact.id}`, exact: true, id: exact.id, r: -1 });
  for (const { entry, exact: same, r } of byName(rows, match)) if (entry.id !== id) out.push({ label: entry.name, href: href(entry.id, entry.name), note: `id ${entry.id}`, exact: same, id: entry.id, r });
  return out;
}

/**
 * A name map's hits (the spell or item set names a page passes in), an exact id first. `known` says whether an id with
 * no name still has a page (an item set the game files list); its row then carries `unnamed(id)`.
 */
function namedHits(names: Map<number, string>, match: Match, id: number | null, href: (id: number) => string, unnamed?: { known: (id: number) => boolean; label: (id: number) => string }): (SearchResult & { r: number })[] {
  const out: (SearchResult & { r: number })[] = [];
  const label = id === null ? undefined : names.get(id) ?? (unnamed?.known(id) ? unnamed.label(id) : undefined);
  if (id !== null && label !== undefined) out.push({ label, href: href(id), note: `id ${id}`, exact: true, id, r: -1 });
  for (const { entry, exact, r } of bySortedName(sortedNames(names), match)) if (entry.id !== id) out.push({ label: entry.name, href: href(entry.id), note: `id ${entry.id}`, exact, id: entry.id, r });
  return out;
}

const vendorRowsMemo = new WeakMap<Map<number, string>, WeakMap<Set<number>, NamedRow[]>>();
/**
 * The vendors /database/vendors lists (`ids`, passed in by the page), by the NPC names it shows, an exact id first; an
 * unnamed vendor keeps the list's label and is found by its id only. The rows are built once per name map and id set.
 */
function vendorHits(ids: Set<number>, npcs: Map<number, string>, match: Match, id: number | null): (SearchResult & { r: number })[] {
  let byIds = vendorRowsMemo.get(npcs);
  if (!byIds) { byIds = new WeakMap(); vendorRowsMemo.set(npcs, byIds); }
  let rows = byIds.get(ids);
  if (!rows) { rows = sortedNames(npcs).filter((row) => ids.has(row.id)); byIds.set(ids, rows); }
  const out: (SearchResult & { r: number })[] = [];
  if (id !== null && ids.has(id)) out.push({ label: npcs.get(id) ?? `Vendor NPC ${id}`, href: entityHref("vendor", id), note: `id ${id}`, exact: true, id, r: -1 });
  for (const { entry, exact, r } of bySortedName(rows, match)) if (entry.id !== id) out.push({ label: entry.name, href: entityHref("vendor", entry.id), note: `id ${entry.id}`, exact, id: entry.id, r });
  return out;
}

const spellHref = (id: number) => entityHref("spell", id);
const UNNAMED_SET = { known: (id: number) => itemSet(id) !== undefined, label: (id: number) => `Item set ${id}` };

type ObjectFacts = Awaited<ReturnType<typeof loadObjectFacts>>;
const publicObjects = new WeakMap<object, WeakMap<object, Set<number>>>();
const namedObjects = new WeakMap<Map<number, string>, WeakMap<Set<number>, NamedRow[]>>();
/**
 * The ids /database/objects lists, and the named ones in name order. The rate arrays stay the same object while the
 * rollup does, so the list and the rows are built once per rollup and names version, not per keystroke.
 */
function objectRows(facts: ObjectFacts, names: Map<number, string>): { ids: Set<number>; rows: NamedRow[] } {
  let byZeros = publicObjects.get(facts.rates);
  if (!byZeros) { byZeros = new WeakMap(); publicObjects.set(facts.rates, byZeros); }
  let ids = byZeros.get(facts.measuredZeros);
  if (!ids) { ids = new Set(objectList(facts).map((o) => o.objectId)); byZeros.set(facts.measuredZeros, ids); }
  return { ids, rows: objectRowsOf(ids, names) };
}

/** The named objects among `ids`, in name order, built once per id set and names version. */
function objectRowsOf(ids: Set<number>, names: Map<number, string>): NamedRow[] {
  let byIds = namedObjects.get(names);
  if (!byIds) { byIds = new WeakMap(); namedObjects.set(names, byIds); }
  let rows = byIds.get(ids);
  if (!rows) { rows = sortedNames(names).filter((row) => ids.has(row.id)); byIds.set(ids, rows); }
  return rows;
}

/**
 * Names and ids from the same public object list as /database/objects: the list's ids when the caller holds them (the
 * stored search names file), else from the object facts; unavailable facts yield no hits.
 */
async function objectHits(match: Match, id: number | null, names: Map<number, string>, read: Promise<ObjectFacts> | Set<number> = loadObjectFacts()): Promise<(SearchResult & { r: number })[]> {
  let ids: Set<number>, rows: NamedRow[];
  if (read instanceof Set) { ids = read; rows = objectRowsOf(ids, names); } else {
    const facts = await read;
    if (facts.unreachable) return [];
    ({ ids, rows } = objectRows(facts, names));
  }
  const out: (SearchResult & { r: number })[] = [];
  if (id !== null && ids.has(id)) out.push({ label: names.get(id) ?? `Object ${id}`, href: entityHref("object", id), note: `id ${id}`, exact: true, id, r: -1 });
  for (const { entry, exact, r } of bySortedName(rows, match)) if (entry.id !== id) out.push({ label: entry.name, href: entityHref("object", entry.id), note: `id ${entry.id}`, exact, id: entry.id, r });
  return out;
}

/**
 * What only the site's own pages pass in, read by them from the private name files and the stored views: the spell
 * names the spell list shows, the item set names the set pages show, and the vendor ids /database/vendors lists. The
 * API's callers pass none, so its search has no spell, item set or vendor group.
 */
export interface PageNames {
  spells?: Map<number, string> | Promise<Map<number, string> | undefined>;
  itemSets?: Map<number, string> | Promise<Map<number, string> | undefined>;
  vendors?: Set<number> | Promise<Set<number> | undefined>;
}

/** The lore archive's hits, and its some-words hits when no page has every word; null when the archive is out of reach. */
async function loreHits(text: string): Promise<{ hits: SearchHit[]; some: SearchHit[] | null } | null> {
  const lore = await searchLore(text, 1);
  if (lore === UNAVAILABLE) return null;
  if (lore.hits.length) return { hits: lore.hits, some: null };
  const some = await searchLoreSomeWords(text, LORE_LIMIT);
  return { hits: lore.hits, some: some === UNAVAILABLE ? null : some };
}

/**
 * Everything the site knows by this name or id, grouped by type. Names are the ones players agree on, or
 * `names` when a page passes the ones it shows (never the API's caller); zones are the released ones on the map,
 * lore comes from the archive, tools from the tool list. A group with an exact id or name match comes first; an
 * empty group is left out. `only` keeps one result type; `limit` is the rows per group. Paged scopes clamp the page to the last match and return at most 50 rows.
 * `objects` is the ids /database/objects lists when the caller already holds them (the stored search names file): the
 * object group then reads no facts.
 */
export async function siteSearch(raw: string, { only, limit = GROUP_LIMIT, page = 1, names: given, objects, spells: spellsRead, itemSets: setsRead, vendors: vendorsRead }: {
  only?: ResultScope; limit?: number; page?: number; names?: Names | Promise<Names>; objects?: Set<number> | Promise<Set<number> | undefined>;
} & PageNames = {}): Promise<SearchGroup[]> {
  const text = raw.trim().slice(0, MAX_QUERY);
  const q = text.toLowerCase();
  if (!q) return [];
  const id = exactId(q);
  const found = new Map<SearchType, { results: SearchResult[]; total: number; heading?: string }>();
  const want = (t: SearchType) => !only || only === t;

  const paged = isPagedScope(only);
  if (paged) limit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 50;
  // No read depends on another, so they all start now. Item, NPC, quest and object scopes do not need the completion
  // catalogue; only the unscoped page asks the lore archive.
  // The object ids the caller holds, else the facts, both started now; a caller's promise that settles to no ids
  // (the aggregate path) reads the facts once the names are in, which that path has loaded by then.
  const objectsRead: Promise<ObjectFacts> | Promise<Set<number> | undefined> | Set<number> | null = want("object") ? (objects === undefined ? loadObjectFacts() : objects) : null;
  const loreRead = only ? null : loreHits(text);
  // A failed name read rejects the search before these are awaited; their own failure must not go unhandled then.
  if (objectsRead instanceof Promise) objectsRead.catch(() => {});
  loreRead?.catch(() => {});
  const [names, catalog, spells, itemSets, vendors] = await Promise.all([
    given ?? loadNames(), only && !paged ? null : loadCatalog(), want("spell") ? spellsRead : undefined, want("item-set") ? setsRead : undefined, want("vendor") ? vendorsRead : undefined,
  ]);
  // The things a player meets in the game, by every typed word in any order; when none matches and no id was typed, by
  // the same words within a typo or two, and the groups say how the fallback read the query.
  const game = async (match: Match) => {
    const hits = new Map<SearchType, (SearchResult & { r: number })[]>();
    for (const kind of ["item", "npc", "quest"] as const) if (want(kind)) hits.set(kind, agreed(kind, names[`${kind}s`], match, id).results);
    if (objectsRead) {
      const held = await objectsRead;
      hits.set("object", await objectHits(match, id, names.objects, held instanceof Set ? held : held === undefined ? loadObjectFacts() : Promise.resolve(held)));
    }
    if (!only || paged) {
      if (want("zone")) hits.set("zone", zoneHits(match).map(({ label, href, exact, r }) => ({ label, href, note: "zone", exact, r })));
      if (want("instance")) hits.set("instance", instanceHits(match));
      // Mounts, companion pets and currencies the game files list, by name or id.
      if (want("mount")) hits.set("mount", fileHits(mountEntries(), match, id, mountHref));
      if (want("pet")) hits.set("pet", fileHits(petEntries(), match, id, petHref));
      if (want("currency")) hits.set("currency", fileHits(currencyEntries(), match, id, currencyHref));
      // Holidays and hunter pet families the game files list, by name or id.
      if (want("holiday")) hits.set("holiday", fileHits(holidayEntries(), match, id, holidayHref));
      if (want("family")) hits.set("family", fileHits(petFamilyEntries(), match, id, petFamilyHref));
      // Spells, item sets and vendors by the names their lists show, which only a page passes in (never the API).
      if (spells) hits.set("spell", namedHits(spells, match, id, spellHref));
      if (itemSets) hits.set("item-set", namedHits(itemSets, match, id, itemSetHref, UNNAMED_SET));
      if (vendors) hits.set("vendor", vendorHits(vendors, names.npcs, match, id));
    }
    return hits;
  };
  let hits = await game(byWords(q));
  let respelled: string | undefined;
  const typo = id === null && [...hits.values()].every((h) => h.length === 0) ? byTypo(q) : null;
  if (typo) {
    const near = await game(typo);
    const best = [...near.values()].flat().sort((a, b) => a.r - b.r)[0];
    if (best) { hits = near; respelled = respelling(q, best.label); }
  }
  for (const [type, results] of hits) found.set(type, { results, total: results.length });

  if (!only || paged) {
    // Achievements, factions, titles and quest chains three players reported, by name or id; none when the rollup cannot be read.
    if (catalog) {
      const hit = (label: string, href: string, n: number, exact: boolean): SearchResult => ({ label, href, note: `id ${n}`, exact, id: n });
      const achievements = byName(catalog.achievements, byWords(q)).map(({ entry, exact }) => hit(entry.name, achievementHref(entry.achievementId, entry.name), entry.achievementId, exact));
      const factions = byName(catalog.factions, byWords(q)).map(({ entry, exact }) => hit(entry.name, factionHref(entry.factionId, entry.name), entry.factionId, exact));
      if (id !== null) {
        const a = catalog.achievements.find((x) => x.achievementId === id), f = catalog.factions.find((x) => x.factionId === id);
        if (a && !achievements.some((r) => r.id === id)) achievements.unshift(hit(a.name, achievementHref(id, a.name), id, true));
        if (f && !factions.some((r) => r.id === id)) factions.unshift(hit(f.name, factionHref(id, f.name), id, true));
      }
      found.set("achievement", { results: achievements, total: achievements.length });
      found.set("faction", { results: factions, total: factions.length });
      const titles = byName(catalog.titles, byWords(q)).map(({ entry, exact }) => hit(titleDisplayName(entry.name), titleHref(entry.titleId, entry.name), entry.titleId, exact));
      const chains = byName(catalog.chains, byWords(q)).map(({ entry, exact }) => hit(entry.name, chainHref(entry.questLineId, entry.name), entry.questLineId, exact));
      if (id !== null) {
        const t = catalog.titles.find((x) => x.titleId === id), c = catalog.chains.find((x) => x.questLineId === id);
        if (t && !titles.some((r) => r.id === id)) titles.unshift(hit(titleDisplayName(t.name), titleHref(id, t.name), id, true));
        if (c && !chains.some((r) => r.id === id)) chains.unshift(hit(c.name, chainHref(id, c.name), id, true));
      }
      found.set("title", { results: titles, total: titles.length });
      found.set("chain", { results: chains, total: chains.length });
    }
  }

  if (!only) {
    // A class named anywhere in the words ("best race for a warlock") leads to its page: guides, talents, who can play it.
    const words = new Set(q.split(/[^a-z]+/).flatMap((w) => [w, w.replace(/s$/, "")]));
    const classes = CLASSES.filter((slug) => words.has(slug))
      .map((slug) => ({ label: classLabel(slug), href: `/classes/${slug}`, note: "Guides, talents and who can play it", exact: q.replace(/s$/, "") === slug }));
    found.set("class", { results: classes, total: classes.length });

    // Everloot's own wiki pages (dungeons, raids, races), published pages only: by title, with or without a leading
    // "The", then by summary. They are the Forever record, so they sit with the database groups, above the archive.
    const guides = publishedPages(loadWiki()).flatMap((p) => {
      const t = p.title.toLowerCase();
      const best = Math.min(rank(t, q) ?? 9, rank(t.replace(/^the /, ""), q) ?? 9);
      const r = best < 9 ? best : p.summary.toLowerCase().includes(q) ? 3 : null;
      return r === null ? [] : [{ label: p.title, href: wikiHref(p.slug), note: p.summary, exact: r === 0, r }];
    }).sort((a, b) => a.r - b.r).map(({ r: _r, ...hit }) => hit);
    found.set("guide", { results: guides, total: guides.length });

    const lore = await loreRead;
    if (lore) {
      // When the words also name something in WoW: Forever, the lore pages about later expansions (their wiki
      // categories name only expansions after the original game: Mechagon, the Argent Tournament) are left out.
      const forever = [...GAME].some((t) => (found.get(t)?.total ?? 0) > 0);
      const later = forever ? await laterExpansionPages([...lore.hits, ...(lore.some ?? [])].map((h) => h.id)) : new Set<number>();
      const kept = (hits: SearchHit[]) => hits.filter((h) => !later.has(h.id));
      const loreHit = (h: SearchHit) => ({ label: h.name, href: `/lore/${loreSlug(h)}`, note: h.snippet, exact: h.name.toLowerCase() === q });
      if (lore.hits.length || !lore.some) {
        const hits = kept(lore.hits).map(loreHit);
        found.set("lore", { results: hits.slice(0, LORE_LIMIT), total: hits.length });
      } else {
        const some = kept(lore.some).map(loreHit);
        found.set("lore", { results: some, total: some.length, heading: LORE_SOME_WORDS });
      }
    }

    const matches = tools.filter((t) => !t.private && !t.hidden).flatMap((t) => {
      const hay = [t.title, t.shortTitle, ...t.keywords].map((s) => s.toLowerCase());
      const r = rank(t.title.toLowerCase(), q) ?? (hay.some((s) => s.includes(q)) ? 2 : null);
      return r === null ? [] : [{ label: t.title, href: toolHref(t), note: t.tagline, exact: r === 0 }];
    }).sort((a, b) => Number(b.exact) - Number(a.exact));
    found.set("tool", { results: matches, total: matches.length });

    // Docs pages by title, then by their one-line description.
    const docs = allDocsPages().flatMap((p) => {
      const r = rank(p.title.toLowerCase(), q) ?? (p.lede.toLowerCase().includes(q) ? 3 : null);
      return r === null ? [] : [{ label: p.title, href: p.href, note: p.lede, exact: r === 0, r }];
    }).sort((a, b) => a.r - b.r).map(({ r: _r, ...hit }) => hit);
    found.set("doc", { results: docs, total: docs.length });
  }

  return ORDER
    .map((type) => {
      const f = found.get(type) ?? { results: [], total: 0 };
      const current = paged ? Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, Math.ceil(f.total / limit))) : 1;
      const start = (current - 1) * limit;
      return { type, heading: f.heading ?? HEADINGS[type], results: f.results.slice(start, start + limit).map(strip), total: f.total, ...(paged ? { page: current } : {}), ...(respelled ? { respelled } : {}) };
    })
    .filter((g) => want(g.type) && g.results.length > 0)
    .map((g, i) => ({ g, i, tier: tier(g) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map(({ g }) => g);
}

/** The things a player meets in the game: their groups lead the page. */
const GAME: ReadonlySet<SearchType> = new Set(["item", "npc", "quest", "object", "zone", "instance"]);
const DATABASE: ReadonlySet<SearchType> = new Set([...GAME, "class", "vendor", "spell", "achievement", "faction", "title", "chain", "item-set", "guide"]);

/**
 * Where a group sits, lowest first; the order above within a tier. An exact name or id on a game entry leads,
 * then any other exact hit, then the game entries, then the rest of the database, tools and docs. The lore archive
 * (Warcraft Wiki copies) comes after every other group, even on an exact name: the Forever record comes first.
 */
function tier(g: SearchGroup): number {
  const exact = g.results.some((r) => r.exact);
  if (g.type === "lore") return 6;
  if (exact) return GAME.has(g.type) ? 0 : 1;
  return GAME.has(g.type) ? 2 : DATABASE.has(g.type) ? 3 : 5;
}

/** Drops the internal rank from a result. */
function strip(result: SearchResult & { r?: number }): SearchResult {
  const out = { ...result };
  delete out.r;
  return out;
}

/**
 * One instant suggestion under a search box: an item, NPC, quest or object page, or (unscoped only) a zone page, a
 * dungeon or raid page whose `note` says which and its level ("Dungeon, level 16"), or a spell or vendor page.
 */
export interface Suggestion { type: Scope | "zone" | "instance" | "spell" | "vendor"; id: number; label: string; href: string; quality?: number | null; note?: string }
export const SUGGEST_LIMIT = 8;

/**
 * Up to 8 pages for a search box as the visitor types: an exact id first, then exact names, then names that
 * start with the text, then names that contain it, across items, NPCs, quests, objects and, unscoped, zones, dungeons
 * and raids (or one of the first four). Names only where players agree on them, as on /search; instances from the
 * same rows as /search; no lore or tools, so it stays cheap per keystroke. `tolerant` (the site's own boxes) also
 * matches the words in any order and, when nothing matches and no id was typed, within a typo or two, as /search
 * does; without it (/api/suggest) the text matches as one phrase, as it always has. `objects` as for siteSearch;
 * `spells` and `vendors` (unscoped only) are the names and ids the site's own boxes pass in, as siteSearch's.
 */
export async function suggest(raw: string, scope?: Scope, names?: Names, { tolerant = false, objects, spells, vendors }: { tolerant?: boolean; objects?: Set<number>; spells?: Map<number, string>; vendors?: Set<number> } = {}): Promise<Suggestion[]> {
  const q = raw.trim().slice(0, MAX_QUERY).toLowerCase();
  if (!q) return [];
  const id = exactId(q);
  const all = names ?? await loadNames();
  const order: Scope[] = scope ? [scope] : [...SCOPES];
  const rows = async (match: Match) => {
    const ranked: { s: Suggestion; r: number; t: number }[] = [];
    for (const [t, type] of order.entries()) {
      if (type === "object") {
        for (const o of (await objectHits(match, id, all.objects, objects)).slice(0, SUGGEST_LIMIT)) ranked.push({ s: { type, id: o.id!, label: o.label, href: o.href }, r: o.r, t });
        continue;
      }
      for (const x of agreed(type, all[`${type}s`], match, id).results.slice(0, SUGGEST_LIMIT)) {
        ranked.push({ s: { type, id: x.id!, label: x.label, href: x.href, ...(type === "item" ? { quality: x.quality ?? null } : {}) }, r: x.r, t });
      }
    }
    if (!scope) {
      for (const x of zoneHits(match).slice(0, SUGGEST_LIMIT)) {
        ranked.push({ s: { type: "zone", id: x.id, label: x.label, href: x.href, note: "Zone" }, r: x.r, t: order.length });
      }
      for (const x of instanceHits(match).slice(0, SUGGEST_LIMIT)) {
        ranked.push({ s: { type: "instance", id: x.id, label: x.label, href: x.href, note: x.note }, r: x.r, t: order.length + 1 });
      }
      if (vendors) for (const x of vendorHits(vendors, all.npcs, match, id).slice(0, SUGGEST_LIMIT)) {
        ranked.push({ s: { type: "vendor", id: x.id!, label: x.label, href: x.href }, r: x.r, t: order.length + 2 });
      }
      if (spells) for (const x of namedHits(spells, match, id, spellHref).slice(0, SUGGEST_LIMIT)) {
        ranked.push({ s: { type: "spell", id: x.id!, label: x.label, href: x.href }, r: x.r, t: order.length + 3 });
      }
    }
    return ranked.sort((a, b) => a.r - b.r || a.t - b.t).slice(0, SUGGEST_LIMIT).map((x) => x.s);
  };
  if (!tolerant) return rows(byPhrase(q));
  const found = await rows(byWords(q));
  const typo = found.length === 0 && id === null ? byTypo(q) : null;
  return typo ? rows(typo) : found;
}
