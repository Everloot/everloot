import type { GameVersion, Kind } from "./entities.js";
import type { LoreType } from "./importers/wiki-classify.js";
import { expandAliases, NAME_ALIASES, withoutArticle } from "./name-aliases.js";
import { releaseDb, type ReleaseDb, type ReleaseSource } from "./release-db.js";
import { fromSpanish } from "./spanish.js";

export interface SearchHit {
  id: number;
  extId: string;
  kind: string;
  name: string;
  snippet: string;
  gameVersion: GameVersion;
  sourceUrl: string;
  sourceId: string;
  licence: string;
  retrievedAt: string;
}

export interface SearchOptions {
  kinds?: Kind[];
  versions?: GameVersion[];
  /** Restrict to `data.type` values (lore pages). The SQL is built here; every value is bound. */
  types?: LoreType[];
}

/** Every term is quoted, so user input can never be read as FTS syntax. Terms are ANDed. */
export function toFtsQuery(input: string): string {
  const terms = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.map((t) => `"${t}"`).join(" ");
}

/**
 * Words that carry no meaning for a knowledge lookup ("where is Thrall" asks about Thrall).
 * Single letters are contraction debris ("don't" -> "don" + "t"). When everything is noise
 * ("The"), the raw terms are used so the query still matches something.
 */
const STOPWORDS = new Set([
  "a", "about", "an", "and", "are", "at", "be", "been", "can", "could", "did", "do", "does",
  "find", "for", "from", "get", "give", "how", "in", "is", "list", "me", "of", "on", "or",
  "please", "show", "should", "tell", "the", "to", "was", "were", "what", "when", "where",
  "which", "who", "whom", "whose", "why", "with", "would",
  // The same questions typed without the apostrophe ("whats", not "what's").
  "whats", "wheres", "whos", "hows",
]);

/**
 * Words that ask for a pick, not a topic. They stay in a full search ("Best in Show" is a name), but when
 * no page has every word, they are what failed it, so the fallback leaves them out.
 */
const PICK_WORDS = new Set(["best", "better", "worse", "worst", "good", "top"]);

/**
 * A name as its words: lowercased, split on anything that is not a letter or number, joined by
 * one space. ASCII and Unicode punctuation (', ’, ‘, “, ”, –, —, …) are all word separators, and
 * non-ASCII letters fold to lower case. Stored as `entities.name_norm` and used by the re-rank.
 */
export function allTerms(name: string): string {
  return (name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

function contentTerms(input: string): string[] {
  const terms = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const kept = terms.filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return kept.length > 0 ? kept : terms;
}

const ROW_SNIPPET_FTS = `snippet(entities_fts, 1, '', '', '…', 16) AS snippet`;
const ROW_SNIPPET_BODY = `CASE WHEN length(e.body) > 160 THEN substr(e.body, 1, 160) || '…' ELSE e.body END AS snippet`;
function rowSelect(snippetExpr: string): string {
  return `e.id, e.ext_id AS extId, e.kind, e.name,
  ${snippetExpr},
  e.game_version AS gameVersion, e.source_url AS sourceUrl,
  e.source_id AS sourceId, e.licence, e.retrieved_at AS retrievedAt`;
}

const ROW = rowSelect(ROW_SNIPPET_FTS);
const ROW_EXACT = rowSelect(ROW_SNIPPET_BODY);

const RERANK = 50;

/**
 * Approximates allTerms(name) in SQL for releases built before `entities.name_norm` existed:
 * lowercase, common punctuation becomes a space, runs of spaces collapsed, ends trimmed. It
 * scans the whole table and misses non-ASCII case and unlisted punctuation, which is why newer
 * databases store the JS result instead. The final rank still uses the exact JS allTerms equality.
 */
const NORM_PUNCT = [
  "'",
  "-",
  ":",
  ",",
  ".",
  "/",
  "(",
  ")",
  "[",
  "]",
  '"',
  "!",
  "?",
  ";",
  "_",
  "+",
  "*",
  "&",
  "@",
  "#",
  "%",
  "’",
  "‘",
  "“",
  "”",
  "–",
  "—",
];
function normExpr(col: string): string {
  let e = `lower(${col})`;
  for (const p of NORM_PUNCT) {
    const lit = p === "'" ? "''''" : `'${p}'`;
    e = `replace(${e}, ${lit}, ' ')`;
  }
  return `trim(replace(replace(replace(${e}, '  ', ' '), '  ', ' '), '  ', ' '))`;
}

const NORM_SQL = normExpr("e.name");

/** Whether each open database has `entities.name_norm`; checked once per handle. */
const hasNameNorm = new WeakMap<ReleaseDb, boolean>();
async function nameNormSql(db: ReleaseDb): Promise<string> {
  let has = hasNameNorm.get(db);
  if (has === undefined) {
    const cols = await db.all<{ name: string }>("SELECT name FROM pragma_table_info('entities')");
    has = cols.some((c) => c.name === "name_norm");
    hasNameNorm.set(db, has);
  }
  return has ? "e.name_norm" : NORM_SQL;
}

/** SearchOptions currently exposes only kinds, versions and types: no sourceId/sources/excluded-kinds/publishable filters exist. */
function pushOptionFilters(conds: string[], params: unknown[], opts: SearchOptions): void {
  if (opts.kinds?.length) {
    conds.push(`e.kind IN (${opts.kinds.map(() => "?").join(",")})`);
    params.push(...opts.kinds);
  }
  if (opts.versions?.length) {
    conds.push(`e.game_version IN (${opts.versions.map(() => "?").join(",")})`);
    params.push(...opts.versions);
  }
  if (opts.types?.length) {
    conds.push(`json_extract(e.data, '$.type') IN (${opts.types.map(() => "?").join(",")})`);
    params.push(...opts.types);
  }
}

export async function search(source: ReleaseSource, query: string, limit = 10, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const db = releaseDb(source);
  // "where is MC" asks about Molten Core: the short forms players type become the names the pages carry.
  const { text: raw, expanded } = expandAliases(fromSpanish(query.trim()));
  if (!raw) return [];
  const q = contentTerms(raw)
    .map((t) => `"${t}"`)
    .join(" ");
  if (!q) return [];
  const conds = ["entities_fts MATCH ?"];
  const params: unknown[] = [q];
  pushOptionFilters(conds, params, opts);
  // Rank from a pool, then cut: "Who is Thrall?" must put the page named Thrall first even at limit 1.
  // The SQL boost matches the raw query or its meaningful words, so a long exact page enters the pool.
  const wanted = contentTerms(raw).join(" ");
  params.push(raw, wanted, Math.max(limit, 50));
  const pool = await db.all<SearchHit>(
    `SELECT ${ROW}
     FROM entities_fts JOIN entities e ON e.id = entities_fts.rowid
     WHERE ${conds.join(" AND ")}
     ORDER BY CASE WHEN e.name = ? COLLATE NOCASE OR e.name = ? COLLATE NOCASE THEN 0 ELSE 1 END,
       bm25(entities_fts, 10.0, 1.0), e.id
     LIMIT ?`,
    ...params,
  );
  // The page being asked about: first a name made of exactly the asked words ("Thrall"), then a name
  // that matches only once its stopwords are dropped ("Find Thrall!"), then everything else.
  // Names that match only after punctuation is stripped ("Kel'Thuzad" for "kel thuzad") get no SQL
  // boost and can fall outside the re-rank window. Pull a few by normalized name so the re-rank sees them.
  // The full asked words also count, so a punctuated name with stopwords ("Rise of the Lich-King"
  // for "rise of the lich king") is pulled too; it ranks second, like any name equal after dropping them.
  // Skipped entirely when the pool already holds the exact row: one fewer query on the common path.
  const asked = allTerms(raw);
  const exact: SearchHit[] = pool.some((h) => allTerms(h.name) === wanted)
    ? []
    : await (async () => {
        const exactConds = [`${await nameNormSql(db)} IN (?, ?)`];
        const exactParams: unknown[] = [wanted, asked];
        pushOptionFilters(exactConds, exactParams, opts);
        return db.all<SearchHit>(`SELECT ${ROW_EXACT} FROM entities e WHERE ${exactConds.join(" AND ")} LIMIT 10`, ...exactParams);
      })();
  const seen = new Set(pool.map((h) => h.id));
  // A short form names its page outright: "BRD entrance" is about Blackrock Depths before any page that
  // mentions the words. The expanded names' own pages lead, whatever the body text ranks.
  const named = expanded.length ? await pagesNamed(db, expanded, opts) : [];
  for (const h of named) seen.add(h.id);
  const merged = [...named, ...exact.filter((h) => !seen.has(h.id) && [wanted, asked].includes(allTerms(h.name))), ...pool.filter((h) => !named.some((n) => n.id === h.id))];
  const rank = (hit: SearchHit) => (allTerms(hit.name) === wanted ? 0 : contentTerms(hit.name).join(" ") === wanted ? 1 : 2);
  // At the same rank, Everloot's own curated entries come before the copied Warcraft Wiki pages.
  const own = (hit: SearchHit) => (hit.sourceId === "curated" ? 0 : 1);
  // Re-rank only the first RERANK rows: they are the same rows whatever the limit, so page cuts at
  // different limits stay a stable prefix of one ordering. Rows after them keep the SQL order.
  const head = merged.slice(0, RERANK).sort((a, b) => rank(a) - rank(b) || own(a) - own(b));
  return [...head, ...merged.slice(RERANK)].slice(0, limit);
}

/** The pages whose title is one of `names` (by normalized name), in the names' order; at most 2 per name. */
async function pagesNamed(db: ReleaseDb, names: readonly string[], opts: SearchOptions): Promise<SearchHit[]> {
  const out: SearchHit[] = [];
  for (const name of names) {
    const conds = [`${await nameNormSql(db)} = ?`];
    const params: unknown[] = [allTerms(name)];
    pushOptionFilters(conds, params, opts);
    out.push(...(await db.all<SearchHit>(`SELECT ${ROW_EXACT} FROM entities e WHERE ${conds.join(" AND ")} ORDER BY e.id LIMIT 2`, ...params)));
  }
  return out;
}

/** The line an answer starts with when its pages hold only some of the asked words. */
export const SOME_WORDS = "No page has every word you asked for. Pages with some of them:";

/**
 * For when no page has every asked word ("whats the best racial class for warlock on horde"): pages with
 * any of them, those with more of the asked words first, then bm25. Empty for a one-word query, where any
 * word is every word, so `search` has already said all there is. Pick words ("best") are left out.
 */
export async function searchSomeWords(source: ReleaseSource, query: string, limit = 10, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const asked = [...new Set(contentTerms(expandAliases(fromSpanish(query.trim())).text))];
  const terms = asked.filter((t) => !PICK_WORDS.has(t));
  // One word is a new search only when a pick word was dropped from beside it ("best gnome").
  if (terms.length === 0 || (terms.length === 1 && asked.length === 1)) return [];
  const conds = ["entities_fts MATCH ?"];
  const params: unknown[] = [terms.map((t) => `"${t}"`).join(" OR ")];
  pushOptionFilters(conds, params, opts);
  params.push(Math.max(limit, RERANK));
  const pool = await releaseDb(source).all<SearchHit & { words: string }>(
    `SELECT ${ROW}, e.name || ' ' || e.body AS words
     FROM entities_fts JOIN entities e ON e.id = entities_fts.rowid
     WHERE ${conds.join(" AND ")}
     ORDER BY bm25(entities_fts, 10.0, 1.0), e.id
     LIMIT ?`,
    ...params,
  );
  const count = (words: string) => {
    const has = new Set(allTerms(words).split(" "));
    return terms.filter((t) => has.has(t)).length;
  };
  // The sort is stable, so pages with the same count keep their bm25 order.
  return pool
    .map(({ words, ...hit }) => ({ hit, count: count(words) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((r) => r.hit);
}

interface EntityRow {
  id: number;
  extId: string;
  kind: string;
  name: string;
  body: string;
  gameVersion: GameVersion;
  sourceUrl: string;
  sourceId: string;
  licence: string;
  retrievedAt: string;
}

const ROW_BY_ID = `id, ext_id AS extId, kind, name, body, game_version AS gameVersion, source_url AS sourceUrl,
  source_id AS sourceId, licence, retrieved_at AS retrievedAt`;

function toHit(r: EntityRow): SearchHit {
  return {
    id: r.id,
    extId: r.extId,
    kind: r.kind,
    name: r.name,
    snippet: r.body.length > 160 ? `${r.body.slice(0, 160)}…` : r.body,
    gameVersion: r.gameVersion,
    sourceUrl: r.sourceUrl,
    sourceId: r.sourceId,
    licence: r.licence,
    retrievedAt: r.retrievedAt,
  };
}

/** One row by id, for page rendering and the MCP server. Unknown id gives undefined. */
export async function getEntity(source: ReleaseSource, id: number): Promise<SearchHit | undefined> {
  const r = await releaseDb(source).get<EntityRow>(`SELECT ${ROW_BY_ID} FROM entities WHERE id = ?`, id);
  return r ? toHit(r) : undefined;
}

/** One row by id with its whole body, for the fetch tool. Unknown id gives undefined. */
export async function getDocument(source: ReleaseSource, id: number): Promise<(SearchHit & { body: string }) | undefined> {
  const r = await releaseDb(source).get<EntityRow>(`SELECT ${ROW_BY_ID} FROM entities WHERE id = ?`, id);
  return r ? { ...toHit(r), body: r.body } : undefined;
}

/** Exact full-name match (case-insensitive), optionally narrowed to one kind. */
export async function getByName(source: ReleaseSource, name: string, kind?: Kind): Promise<SearchHit[]> {
  const db = releaseDb(source);
  const cond = kind ? "AND kind = ?" : "";
  const exact = async (n: string) => {
    const params = kind ? [n, kind] : [n];
    const rows = await db.all<EntityRow>(`SELECT ${ROW_BY_ID} FROM entities WHERE name = ? COLLATE NOCASE ${cond} ORDER BY id`, ...params);
    return rows.map(toHit);
  };
  const asked = name.trim();
  const hits = await exact(asked);
  if (hits.length || !asked) return hits;
  // The name as players shorten it ("MC"), then with its article the other way round ("The Barrens" / "Barrens").
  const alias = NAME_ALIASES[asked.toLowerCase()];
  if (alias) { const found = await exact(alias); if (found.length) return found; }
  const bare = withoutArticle(asked);
  for (const variant of bare === asked ? [`The ${asked}`] : [bare]) { const found = await exact(variant); if (found.length) return found; }
  return [];
}
