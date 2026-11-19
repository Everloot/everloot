import { tools, toolHref } from "@/data/tools";
import { allDocsPages } from "@/lib/docs/nav";
import { entityHref } from "@/components/EntityLink";
import { describe } from "../../../kb/src/item-taxonomy";
import { objectList } from "../../../kb/src/object-page";
import { achievementHref, chainHref, factionHref, loadCatalog, titleDisplayName, titleHref } from "./completion-lists";
import { CLIENT_TAXONOMY } from "./items";
import { allTerms, type SearchHit } from "../../../kb/src/search";
import { classLabel } from "./class-context";
import { CLASSES } from "@/design/tokens";
import { instanceHref, instanceRows, instanceTitle, levelLabel, type InstanceRow } from "./instances";
import { laterExpansionPages, loreSlug, MAX_QUERY, searchLore, searchLoreSomeWords, UNAVAILABLE } from "./lore";
import { loadNames, type Names } from "./names";
import { loadObjectFacts } from "./objects";
import { loadWiki, publishedPages, wikiHref } from "./wiki";
import { WORLD_MAP } from "./world-map";
import { zoneHref } from "./zones";

/**
 * One page the search found. `exact` is an exact id or an exact name: those lead their group, and the page.
 * Database rows carry their id; item rows the game files' quality (0 poor to 5 legendary) and type, when
 * the item is in the build.
 */
export interface SearchResult { label: string; href: string; note?: string; exact: boolean; id?: number; quality?: number | null; meta?: string }
export type SearchType = "class" | "item" | "npc" | "quest" | "object" | "achievement" | "faction" | "title" | "chain" | "zone" | "instance" | "guide" | "lore" | "tool" | "doc";
/**
 * `total` counts every match; `results` holds the first `limit` of them. `respelled` is how the typo fallback read the
 * query ("linen cloth" for "lnen clth"), on every group when it fired.
 */
export interface SearchGroup { type: SearchType; heading: string; results: SearchResult[]; total: number; page?: number; respelled?: string }
export const GROUP_LIMIT = 8;
export const LORE_LIMIT = 5;

export const HEADINGS: Record<SearchType, string> = {
  class: "Classes", item: "Items", npc: "NPCs", quest: "Quests", object: "Objects", achievement: "Achievements", faction: "Factions", title: "Titles", chain: "Quest chains", zone: "Zones", instance: "Dungeons and raids", guide: "Wiki", lore: "Lore archive", tool: "Tools", doc: "Docs",
};
/** The lore group's heading when its pages hold only some of the asked words. */
export const LORE_SOME_WORDS = "Lore archive, some of your words";
const ORDER: SearchType[] = ["class", "item", "npc", "quest", "object", "achievement", "faction", "title", "chain", "zone", "instance", "guide", "lore", "tool", "doc"];
/** The types a search can be scoped to (`/search?q=…&in=item`); `in=lore` is the lore archive's own list. */
export const SCOPES = ["item", "npc", "quest", "object"] as const satisfies readonly SearchType[];
export type Scope = (typeof SCOPES)[number];
export const isScope = (v: unknown): v is Scope => (SCOPES as readonly unknown[]).includes(v);
/** These groups keep search's matching rules and page within search rather than a database list. */
export const PAGED_SCOPES = ["achievement", "faction", "title", "chain", "zone", "instance"] as const;
export type ResultScope = Scope | (typeof PAGED_SCOPES)[number];
export const isPagedScope = (v: unknown): v is (typeof PAGED_SCOPES)[number] => (PAGED_SCOPES as readonly unknown[]).includes(v);
export const isResultScope = (v: unknown): v is ResultScope => isScope(v) || isPagedScope(v);
/** 0 exact, 1 starts with, 2 contains, null no match; both sides lowercase. */
function phraseRank(name: string, q: string): number | null {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  return name.includes(q) ? 2 : null;
}

/** Whether `word` starts a word of `name`: at its start or after a character that is not a letter or digit. */
function atWordStart(name: string, word: string): boolean {
  for (let i = name.indexOf(word); i !== -1; i = name.indexOf(word, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(name[i - 1]!)) return true;
  return false;
}

/**
 * As `phraseRank`, then the words in any order ("cloth linen"): 3 when each word starts a word of the name, 4 when
 * each is somewhere in it. A one-word query ranks exactly as `phraseRank`.
 */
function rank(name: string, q: string, words: readonly string[] = q.split(/\s+/)): number | null {
  const r = phraseRank(name, q);
  if (r !== null) return r;
  if (words.length < 2 || !words.every((w) => name.includes(w))) return null;
  return words.every((w) => atWordStart(name, w)) ? 3 : 4;
}

/** How a list asks whether a lowercase name matches: its rank, lowest best, or null. */
type Match = (name: string) => number | null;
const byWords = (q: string): Match => { const words = q.split(/\s+/); return (n) => rank(n, q, words); };
const byPhrase = (q: string): Match => (n) => phraseRank(n, q);

/** Typo tolerance needs this many letters in a word: shorter words must be typed right. */
const TYPO_MIN = 4;
/** The edits a typed word may be from a word of the name: one, two from 8 letters. */
const typoEdits = (word: string) => (word.length < TYPO_MIN ? 0 : word.length >= 8 ? 2 : 1);

/**
 * Edits between two words, a swap of neighbouring letters counting as one (optimal string alignment), or
 * `max + 1` as soon as it is certain to be more than `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let prevLow = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      cur[j] = v;
      if (v < low) low = v;
    }
    // A swap reaches back two rows, so only two rows past `max` in a row rule a match out.
    if (low > max && prevLow > max) return max + 1;
    before = prev;
    prev = cur;
    prevLow = low;
  }
  return Math.min(prev[b.length]!, max + 1);
}

/**
 * The fallback when nothing matches the words as typed ("lnen clth", "hoger"): every typed word is in the name, or
 * within `typoEdits` of one of its words. Ranks 5 plus the edits, so it never ties a match `byWords` finds. A word is
 * only measured when its length is within the allowed edits of the typed one (each edit changes the length by at most
 * one, so this drops no match), and each distinct word once per query. Null when no typed word is long enough.
 */
export function byTypo(q: string): Match | null {
  const typed = q.split(/\s+/);
  if (!typed.some((t) => typoEdits(t) > 0)) return null;
  const seen = typed.map(() => new Map<string, number>());
  return (n) => {
    let edits = 0;
    for (const [i, t] of typed.entries()) {
      if (n.includes(t)) continue;
      const k = typoEdits(t);
      if (!k) return null;
      // The name's words as allTerms splits them, scanned in place: this runs on every name of a list.
      let best = k + 1;
      for (let start = 0, end = 0; start < n.length; start = end + 1) {
        end = start;
        while (end < n.length && wordChar(n.charCodeAt(end))) end++;
        if (Math.abs(end - start - t.length) > k) continue;
        const w = n.slice(start, end);
        let d = seen[i]!.get(w);
        if (d === undefined) seen[i]!.set(w, (d = editDistance(t, w, k)));
        if (d < best) best = d;
      }
      if (best > k) return null;
      edits += best;
    }
    return 5 + edits;
  };
}

/** A letter or digit in a lowercase name: a to z, 0 to 9, or past ASCII (accented letters). */
const wordChar = (c: number) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c > 127;

/** The query as a name the fallback matched spells it: each mistyped word becomes that name's nearest word. */
function respelling(q: string, name: string): string {
  const words = allTerms(name).split(" ");
  return q.split(/\s+/).map((t) => {
    if (name.toLowerCase().includes(t)) return t;
    let best = t, edits = typoEdits(t) + 1;
    for (const w of words) { const d = editDistance(t, w, typoEdits(t)); if (d < edits) { best = w; edits = d; } }
    return best;
  }).join(" ");
}

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
  let byIds = namedObjects.get(names);
  if (!byIds) { byIds = new WeakMap(); namedObjects.set(names, byIds); }
  let rows = byIds.get(ids);
  if (!rows) { const kept = ids; rows = sortedNames(names).filter((row) => kept.has(row.id)); byIds.set(ids, rows); }
  return { ids, rows };
}

/** Names and ids from the same public object list as /database/objects; unavailable facts yield no hits. */
async function objectHits(match: Match, id: number | null, names: Map<number, string>, read: Promise<ObjectFacts> = loadObjectFacts()): Promise<(SearchResult & { r: number })[]> {
  const facts = await read;
  if (facts.unreachable) return [];
  const { ids, rows } = objectRows(facts, names);
  const out: (SearchResult & { r: number })[] = [];
  if (id !== null && ids.has(id)) out.push({ label: names.get(id) ?? `Object ${id}`, href: entityHref("object", id), note: `id ${id}`, exact: true, id, r: -1 });
  for (const { entry, exact, r } of bySortedName(rows, match)) if (entry.id !== id) out.push({ label: entry.name, href: entityHref("object", entry.id), note: `id ${entry.id}`, exact, id: entry.id, r });
  return out;
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
 */
export async function siteSearch(raw: string, { only, limit = GROUP_LIMIT, page = 1, names: given }: { only?: ResultScope; limit?: number; page?: number; names?: Names | Promise<Names> } = {}): Promise<SearchGroup[]> {
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
  const objectsRead = want("object") ? loadObjectFacts() : null;
  const loreRead = only ? null : loreHits(text);
  // A failed name read rejects the search before these are awaited; their own failure must not go unhandled then.
  objectsRead?.catch(() => {});
  loreRead?.catch(() => {});
  const [names, catalog] = await Promise.all([given ?? loadNames(), only && !paged ? null : loadCatalog()]);
  // The things a player meets in the game, by every typed word in any order; when none matches and no id was typed, by
  // the same words within a typo or two, and the groups say how the fallback read the query.
  const game = async (match: Match) => {
    const hits = new Map<SearchType, (SearchResult & { r: number })[]>();
    for (const kind of ["item", "npc", "quest"] as const) if (want(kind)) hits.set(kind, agreed(kind, names[`${kind}s`], match, id).results);
    if (objectsRead) hits.set("object", await objectHits(match, id, names.objects, objectsRead));
    if (!only || paged) {
      if (want("zone")) hits.set("zone", zoneHits(match).map(({ label, href, exact, r }) => ({ label, href, note: "zone", exact, r })));
      if (want("instance")) hits.set("instance", instanceHits(match));
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
const DATABASE: ReadonlySet<SearchType> = new Set([...GAME, "class", "achievement", "faction", "title", "chain", "guide"]);

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
 * One instant suggestion under a search box: an item, NPC, quest or object page, or (unscoped only) a zone page, or
 * a dungeon or raid page whose `note` says which and its level ("Dungeon, level 16").
 */
export interface Suggestion { type: Scope | "zone" | "instance"; id: number; label: string; href: string; quality?: number | null; note?: string }
export const SUGGEST_LIMIT = 8;

/**
 * Up to 8 pages for a search box as the visitor types: an exact id first, then exact names, then names that
 * start with the text, then names that contain it, across items, NPCs, quests, objects and, unscoped, zones, dungeons
 * and raids (or one of the first four). Names only where players agree on them, as on /search; instances from the
 * same rows as /search; no lore or tools, so it stays cheap per keystroke. `tolerant` (the site's own boxes) also
 * matches the words in any order and, when nothing matches and no id was typed, within a typo or two, as /search
 * does; without it (/api/suggest) the text matches as one phrase, as it always has.
 */
export async function suggest(raw: string, scope?: Scope, names?: Names, { tolerant = false }: { tolerant?: boolean } = {}): Promise<Suggestion[]> {
  const q = raw.trim().slice(0, MAX_QUERY).toLowerCase();
  if (!q) return [];
  const id = exactId(q);
  const all = names ?? await loadNames();
  const order: Scope[] = scope ? [scope] : [...SCOPES];
  const rows = async (match: Match) => {
    const ranked: { s: Suggestion; r: number; t: number }[] = [];
    for (const [t, type] of order.entries()) {
      if (type === "object") {
        for (const o of (await objectHits(match, id, all.objects)).slice(0, SUGGEST_LIMIT)) ranked.push({ s: { type, id: o.id!, label: o.label, href: o.href }, r: o.r, t });
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
    }
    return ranked.sort((a, b) => a.r - b.r || a.t - b.t).slice(0, SUGGEST_LIMIT).map((x) => x.s);
  };
  if (!tolerant) return rows(byPhrase(q));
  const found = await rows(byWords(q));
  const typo = found.length === 0 && id === null ? byTypo(q) : null;
  return typo ? rows(typo) : found;
}
