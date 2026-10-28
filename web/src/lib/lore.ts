import { SOURCES } from "../../../kb/src/sources";
import { search, searchSomeWords, type SearchHit } from "../../../kb/src/search";
import type { Facets, LoreType } from "../../../kb/src/importers/wiki-classify";
import type { Infobox } from "../../../kb/src/importers/wiki-infobox";
import { getRelease } from "./release";

export type { Facets, LoreType } from "../../../kb/src/importers/wiki-classify";
export type { Infobox } from "../../../kb/src/importers/wiki-infobox";

/**
 * The lore archive: Warcraft Wiki pages from the approved knowledge release, served on the site.
 * Pure helpers (slugs, body rendering, indexing rule) live here with the release-backed lookups.
 */

export const PAGE_SIZE = 20;
export const MAX_QUERY = 200;
/** Deepest search page served; beyond it the answer is "no hits", never a 20 million row LIMIT. */
export const MAX_PAGE = 50;
export const UNAVAILABLE_COPY = "The knowledge release could not be opened. Nothing here is a count or a page; try again later.";
export const CONVERSION_NOTE = "Converted from wikitext with templates, tables and images removed, so some sentences may be missing values.";
export const PRE_CLASSIFICATION_COPY = "This release predates classification.";

/** URL slug -> stored type, for the browse pages. */
export const BROWSE_TYPES = { npcs: "npc", items: "item", quests: "quest", zones: "zone", spells: "spell" } as const;
export type BrowseSlug = keyof typeof BROWSE_TYPES;
export const BROWSE_HEADINGS: Record<BrowseSlug, string> = {
  npcs: "NPCs and characters", items: "Items", quests: "Quests", zones: "Zones and locations", spells: "Spells and abilities",
};
export const FACET_KEYS = ["expansion", "profession", "class", "race", "zone", "faction"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];
export const BROWSE_PAGE_SIZE = 50;
export const LETTERS = [..."abcdefghijklmnopqrstuvwxyz", "#"];

/** `undefined` -> "a"; a-z (any case) -> lower; "#" or "other" -> "#"; anything else -> null. */
export function parseLetter(raw: string | undefined): string | null {
  if (raw === undefined) return "a";
  const l = raw.toLowerCase();
  if (l === "#" || l === "other") return "#";
  return /^[a-z]$/.test(l) ? l : null;
}

// The slug helpers and the indexing rule live with the knowledge base, so the MCP server names the same
// pages and links only the ones the site indexes.
import { INDEXABLE_MIN_BODY } from "../../../kb/src/lore-slug";
export { INDEXABLE_MIN_BODY, isIndexable, loreSlug, slugify } from "../../../kb/src/lore-slug";

/**
 * Wiki ids are digits (`291323-frostwhisper`); curated ids are kebab strings and carry no name
 * part (`forever-launch-date`). Leading zeros, capital letters and anything outside [a-z0-9-] are rejected
 * so one page never answers at two URLs.
 */
export function parseLoreSlug(slug: string): { extId: string; nameSlug: string } | null {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  const numeric = slug.match(/^([1-9]\d*)(?:-(.*))?$/);
  if (numeric) return { extId: numeric[1], nameSlug: numeric[2] ?? "" };
  if (/^0/.test(slug)) return null;
  return { extId: slug, nameSlug: "" };
}

export type BodyBlock = { type: "p"; text: string } | { type: "ul"; items: string[] };

/** Plain-text body → paragraphs split on blank lines; consecutive ` * ` lines form one list. */
export function renderBody(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  for (const chunk of body.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    let items: string[] = [];
    let text: string[] = [];
    const flushText = () => { if (text.length) { blocks.push({ type: "p", text: text.join(" ") }); text = []; } };
    const flushItems = () => { if (items.length) { blocks.push({ type: "ul", items }); items = []; } };
    for (const line of lines) {
      const bullet = line.match(/^\*\s*(.*)$/);
      if (bullet) { flushText(); if (bullet[1]) items.push(bullet[1]); }
      else { flushItems(); text.push(line); }
    }
    flushText();
    flushItems();
  }
  return blocks;
}

/**
 * Cut `text` at `max` on a word boundary with an ellipsis; short text passes through.
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/**
 * The first sentence of the first block, or a word-boundary cut at `max` with an ellipsis.
 * A bullet-first body (disambiguation pages) reads as its items joined by "; ", never "* ".
 */
export function firstSentence(body: string, max = 160): string {
  const first = renderBody(body)[0];
  const text = !first ? "" : first.type === "p" ? first.text : first.items.join("; ");
  const flat = text.replace(/\s+/g, " ").trim();
  if (first?.type === "ul") return truncate(flat, max);
  const end = flat.search(/\.(\s|$)/);
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
  return truncate(sentence, max);
}

// ---- Release-backed lookups ----------------------------------------------------------------

export type Unavailable = "unavailable";
export const UNAVAILABLE: Unavailable = "unavailable";

export interface LorePage {
  extId: string;
  name: string;
  body: string;
  categories: string[];
  revisionTimestamp: string | null;
  sourceUrl: string;
  sourceId: string;
  licence: string;
  retrievedAt: string;
  gameVersion: string;
  /** Null for rows from a release built before classification. */
  type: LoreType | null;
  facets: Facets | null;
  infobox: Infobox | null;
}

const TYPE_VALUES = new Set(["npc", "item", "quest", "zone", "spell", "other"]);
const EMPTY_FACETS: Facets = { expansion: [], profession: [], class: [], race: [], zone: [], faction: [] };

function parseFacets(raw: unknown): Facets | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out: Facets = { ...EMPTY_FACETS };
  for (const key of FACET_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    out[key] = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  }
  return out;
}

function parseInfobox(raw: unknown): Infobox | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.template !== "string" || typeof r.fields !== "object" || r.fields === null) return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.fields as Record<string, unknown>)) if (typeof v === "string") fields[k] = v;
  return { template: r.template, fields };
}

const PUBLISHABLE = Object.values(SOURCES).filter((s) => s.publishable).map((s) => s.id);
const SOURCE_MARKS = PUBLISHABLE.map(() => "?").join(", ");
const INDEXABLE_SQL = `kind = 'lore_page' AND source_id IN (${SOURCE_MARKS}) AND length(body) >= ${INDEXABLE_MIN_BODY} AND instr(body, 'REDIRECT') = 0`;

interface LoreRow {
  extId: string; name: string; body: string; data: string; sourceUrl: string; sourceId: string;
  licence: string; retrievedAt: string; gameVersion: string;
}

export async function loreByExtId(extId: string): Promise<LorePage | null | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  const row = await release.db.get<LoreRow>(
    `SELECT ext_id AS extId, name, body, data, source_url AS sourceUrl, source_id AS sourceId, licence,
       retrieved_at AS retrievedAt, game_version AS gameVersion
     FROM entities WHERE kind = 'lore_page' AND source_id IN (${SOURCE_MARKS}) AND ext_id = ? LIMIT 1`,
    ...PUBLISHABLE, extId,
  );
  if (!row) return null;
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(row.data) as Record<string, unknown>; } catch { /* a row without usable data still renders */ }
  const categories = Array.isArray(data.categories) ? data.categories.filter((c): c is string => typeof c === "string") : [];
  return {
    extId: row.extId, name: row.name, body: row.body, sourceUrl: row.sourceUrl, sourceId: row.sourceId,
    licence: row.licence, retrievedAt: row.retrievedAt, gameVersion: row.gameVersion, categories,
    revisionTimestamp: typeof data.revisionTimestamp === "string" ? data.revisionTimestamp : null,
    type: typeof data.type === "string" && TYPE_VALUES.has(data.type) ? (data.type as LoreType) : null,
    facets: parseFacets(data.facets),
    infobox: parseInfobox(data.infobox),
  };
}

export interface LoreMatch { extId: string; name: string; intro: string }

/** The first paragraph of a body, cut at `max` on a word boundary; "" when the body opens with a list or is empty. */
export function firstParagraph(body: string, max = 420): string {
  const first = renderBody(body)[0];
  return first?.type === "p" ? truncate(first.text.replace(/\s+/g, " ").trim(), max) : "";
}

const MATCH_CACHE_MAX = 500;
const MATCHES = new WeakMap<object, Map<string, LoreMatch | null>>();

/**
 * The lore page for a database entity: an exact name match (any case) within the type. Two pages with one
 * name in a type, a redirect or a page with no opening paragraph are no match: a wrong link is worse than none.
 * The archive has a game id only for quests (a field of their infobox, not indexed), so the id match the plan
 * names would scan the whole file; the name lookup uses the (type, name) index. Answers are kept per opened
 * release, so a page never asks twice for the same name.
 */
export async function loreForEntity(type: "npc" | "item" | "quest" | "zone", name: string): Promise<LoreMatch | null | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  const clean = name.trim();
  if (!clean) return null;
  let cache = MATCHES.get(release.db);
  if (!cache) { cache = new Map(); MATCHES.set(release.db, cache); }
  const key = `${type}|${clean.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const rows = await release.db.all<{ extId: string; name: string; body: string }>(
    `SELECT ext_id AS extId, name, body FROM entities
     WHERE ${LORE_SQL} AND json_extract(data, '$.type') = ? AND name = ? COLLATE NOCASE LIMIT 3`,
    ...PUBLISHABLE, type, clean,
  );
  const usable = rows.filter((r) => !r.body.includes("REDIRECT"));
  const intro = usable.length === 1 ? firstParagraph(usable[0].body) : "";
  const match = intro ? { extId: usable[0].extId, name: usable[0].name, intro } : null;
  if (cache.size >= MATCH_CACHE_MAX) cache.clear();
  cache.set(key, match);
  return match;
}

export async function searchLore(q: string, page: number, type?: LoreType): Promise<{ hits: SearchHit[]; hasNext: boolean } | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  if (p > MAX_PAGE) return { hits: [], hasNext: false };
  const types = type ? [type] : undefined;
  const results = await search(release.db, q.slice(0, MAX_QUERY), p * PAGE_SIZE + 1, { kinds: ["lore_page"], types });
  return { hits: results.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), hasNext: results.length > p * PAGE_SIZE };
}

/** For a question no lore page answers in full: the pages with the most of its words, best first. */
export async function searchLoreSomeWords(q: string, limit: number): Promise<SearchHit[] | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  return searchSomeWords(release.db, q.slice(0, MAX_QUERY), limit, { kinds: ["lore_page"] });
}

/** The count scans every body (seconds on the real file); a read-only release cannot change, so count once per open. */
const COUNTS = new WeakMap<object, number>();

export async function indexableCount(): Promise<number | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  const known = COUNTS.get(release.db);
  if (known !== undefined) return known;
  const row = (await release.db.get<{ n: number }>(`SELECT count(*) AS n FROM entities WHERE ${INDEXABLE_SQL}`, ...PUBLISHABLE))!;
  COUNTS.set(release.db, row.n);
  return row.n;
}

// ---- Types, facets and browsing ---------------------------------------------------------------

/** The manifest says whether this release was built with type data. */
export async function hasTypes(): Promise<boolean | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  return release.manifest.types !== undefined;
}

export async function typeCounts(): Promise<Record<string, number> | null | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  return release.manifest.types ?? null;
}

const LORE_SQL = `kind = 'lore_page' AND source_id IN (${SOURCE_MARKS})`;

/** Deepest browse page served (50 rows each); beyond it the answer is "no more results", never a 64-bit OFFSET. */
export const BROWSE_MAX_PAGE = 200;

function letterClause(letter: string | null): { sql: string; params: unknown[] } {
  if (letter === null) return { sql: "1 = 1", params: [] };
  if (letter === "#") return { sql: "lower(substr(name, 1, 1)) NOT BETWEEN 'a' AND 'z'", params: [] };
  return { sql: "name LIKE ? ESCAPE '\\'", params: [`${letter}%`] };
}

/** The letters (and "#") this type actually has pages under, so empty letters stay out of the sitemap. */
export async function lettersWithRows(type: LoreType): Promise<string[] | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  // A typed release without the letter lists is refused at open; an untyped release has none.
  return release.manifest.letters?.[type] ?? [];
}

/** Pages of one type whose name starts with `letter`, filtered by exact facet values, ordered by name. */
export async function browse(
  type: LoreType,
  letter: string | null,
  filters: Partial<Record<FacetKey, string>>,
  page: number,
): Promise<{ rows: { extId: string; name: string }[]; hasNext: boolean } | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  if (p > BROWSE_MAX_PAGE) return { rows: [], hasNext: false };
  const conds = [LORE_SQL, "json_extract(data, '$.type') = ?"];
  const params: unknown[] = [...PUBLISHABLE, type];
  const l = letterClause(letter);
  conds.push(l.sql);
  params.push(...l.params);
  for (const key of FACET_KEYS) {
    const value = filters[key];
    if (value === undefined || value === "") continue;
    conds.push(`EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.facets.${key}')) WHERE value = ?)`);
    params.push(value);
  }
  const rows = await release.db.all<{ extId: string; name: string }>(
    `SELECT ext_id AS extId, name FROM entities WHERE ${conds.join(" AND ")} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
    ...params, BROWSE_PAGE_SIZE + 1, (p - 1) * BROWSE_PAGE_SIZE,
  );
  return { rows: rows.slice(0, BROWSE_PAGE_SIZE), hasNext: rows.length > BROWSE_PAGE_SIZE && p < BROWSE_MAX_PAGE };
}

const FACET_VALUES = new WeakMap<object, Map<string, Record<FacetKey, string[]>>>();

/** Distinct facet values present for one type, computed once per opened release. */
export async function facetValues(type: LoreType): Promise<Record<FacetKey, string[]> | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  let perType = FACET_VALUES.get(release.db);
  if (!perType) { perType = new Map(); FACET_VALUES.set(release.db, perType); }
  const known = perType.get(type);
  if (known) return known;
  const out = { ...EMPTY_FACETS } as Record<FacetKey, string[]>;
  // The manifest carries every value per type (a typed release without them is refused at open),
  // so the lists come from the manifest; an untyped release has no facet data at all.
  const summaries = release.manifest.facets?.byType[type];
  for (const key of FACET_KEYS) out[key] = Array.isArray(summaries?.[key]) ? summaries[key] : [];
  perType.set(type, out);
  return out;
}

// ---- The landing's way in ---------------------------------------------------------------------

/**
 * Wiki page ids for the landing's "Start here" list, checked against the 2026-10-24 release: Alliance,
 * Horde, Human, Orc, Eastern Kingdoms, Kalimdor, Burning Legion, Scourge. An id the release lacks is skipped.
 */
export const START_HERE = ["481380", "360548", "353113", "19317", "397389", "144560", "490354", "201569"] as const;

export interface LoreLink { extId: string; name: string; sentence: string }

/** The first sentence of the first paragraph, past hatnotes and quotes set as lists; "" when there is none. */
export function openingSentence(body: string): string {
  const first = renderBody(body).find((b) => b.type === "p");
  return first ? firstSentence(first.text) : "";
}

const START = new WeakMap<object, LoreLink[]>();

/** The "Start here" pages this release has, in list order, each with its own opening sentence. */
export async function startHere(): Promise<LoreLink[] | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  const known = START.get(release.db);
  if (known) return known;
  const out: LoreLink[] = [];
  for (const extId of START_HERE) {
    const page = await loreByExtId(extId);
    if (!page || page === UNAVAILABLE || page.body.includes("REDIRECT")) continue;
    out.push({ extId: page.extId, name: page.name, sentence: openingSentence(page.body) });
  }
  START.set(release.db, out);
  return out;
}

const ZONES = new WeakMap<object, { extId: string; name: string }[]>();

/**
 * Zone pages with the wiki's zone infobox (not towns or instances), by name. The data names a continent
 * for too few of them to group by, so the list is alphabetical. A "<name> (Classic)" page is left out when
 * "<name>" is in the list too. Empty for a release without type data.
 */
export async function zonePages(): Promise<{ extId: string; name: string }[] | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  const known = ZONES.get(release.db);
  if (known) return known;
  const rows = await release.db.all<{ extId: string; name: string }>(
    `SELECT ext_id AS extId, name FROM entities
     WHERE ${INDEXABLE_SQL} AND json_extract(data, '$.type') = 'zone' AND json_extract(data, '$.infobox.template') = 'infobox zone'
     ORDER BY name COLLATE NOCASE, id`,
    ...PUBLISHABLE,
  );
  const names = new Set(rows.map((r) => r.name));
  const out = rows.filter((r) => !(r.name.endsWith(" (Classic)") && names.has(r.name.slice(0, -" (Classic)".length))));
  ZONES.set(release.db, out);
  return out;
}

export interface Coverage {
  types: Record<string, number> | null;
  damaged: number | null;
  indexable: number;
  createdAt: string;
  facets: Record<FacetKey, { value: string; n: number }[]>;
}

const COVERAGE = new WeakMap<object, Coverage>();

/** What the release covers: counts by type and facet, indexable pages, damage, release date. */
export async function coverage(): Promise<Coverage | Unavailable> {
  const release = await getRelease();
  if (!release) return UNAVAILABLE;
  const known = COVERAGE.get(release.db);
  if (known) return known;
  const indexable = await indexableCount();
  if (indexable === UNAVAILABLE) return UNAVAILABLE;
  const facets = {} as Record<FacetKey, { value: string; n: number }[]>;
  // The manifest carries the top ten per key (a typed release without them is refused at open);
  // an untyped release has no facet data at all.
  const summaries = release.manifest.facets?.top;
  for (const key of FACET_KEYS) {
    const entries = summaries?.[key];
    facets[key] = Array.isArray(entries) ? entries.map((e) => ({ value: e.value, n: e.n })) : [];
  }
  const out: Coverage = {
    types: release.manifest.types ?? null,
    damaged: release.manifest.damaged ?? null,
    indexable,
    createdAt: release.manifest.createdAt,
    facets,
  };
  COVERAGE.set(release.db, out);
  return out;
}
