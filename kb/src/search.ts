import type { GameVersion, Kind } from "./entities.js";
import { TESTING_ONLY, type LoreType } from "./importers/wiki-classify.js";
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
  // "does Thunder Bluff have a zeppelin", "is there any", "my mount": asking words, not the topic.
  "have", "has", "there", "any", "my",
]);

/**
 * Words that ask for a pick, not a topic. They stay in a full search ("Best in Show" is a name), but when
 * no page has every word, they are what failed it, so the fallback leaves them out.
 */
export const PICK_WORDS = new Set(["best", "better", "worse", "worst", "good", "top"]);

/**
 * A name as its words: lowercased, split on anything that is not a letter or number, joined by
 * one space. ASCII and Unicode punctuation (', ’, ‘, “, ”, –, —, …) are all word separators, and
 * non-ASCII letters fold to lower case. Stored as `entities.name_norm` and used by the re-rank.
 */
export function allTerms(name: string): string {
  return (name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

/** Whether a lowercased word carries no topic: a stopword or contraction debris. */
export const askingWord = (term: string): boolean => term.length <= 1 || STOPWORDS.has(term);

export function contentTerms(input: string): string[] {
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

/**
 * The condition for a kind filter. The entities table's kind check has no `object`, so the pfQuest importer stores objects as
 * `npc` rows with the ext id `object:<id>` (importers/pfquest.ts); kind "object" asks for those rows.
 */
const OBJECT_ROWS = (alias: string) => `(${alias}kind = 'npc' AND ${alias}ext_id LIKE 'object:%')`;
function kindFilter(alias: string, kinds: readonly Kind[]): { sql: string; params: Kind[] } {
  const stored = kinds.filter((k) => k !== "object");
  const parts = [
    ...(stored.length ? [`${alias}kind IN (${stored.map(() => "?").join(",")})`] : []),
    ...(kinds.includes("object") ? [OBJECT_ROWS(alias)] : []),
  ];
  return { sql: parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0]!, params: stored };
}

/**
 * SearchOptions currently exposes only kinds, versions and types: no sourceId/sources/excluded-kinds/publishable filters exist.
 * Every search also leaves out the wiki's testing-only pages, which no player is asking about; they stay
 * reachable by id and by exact name (getEntity, getDocument, getByName).
 */
function pushOptionFilters(conds: string[], params: unknown[], opts: SearchOptions): void {
  if (opts.kinds?.length) {
    const kinds = kindFilter("e.", opts.kinds);
    conds.push(kinds.sql);
    params.push(...kinds.params);
  }
  if (opts.versions?.length) {
    conds.push(`e.game_version IN (${opts.versions.map(() => "?").join(",")})`);
    params.push(...opts.versions);
  }
  if (opts.types?.length) {
    conds.push(`json_extract(e.data, '$.type') IN (${opts.types.map(() => "?").join(",")})`);
    params.push(...opts.types);
  }
  conds.push(`NOT EXISTS (SELECT 1 FROM json_each(e.data, '$.categories') WHERE value = ?)`);
  params.push(TESTING_ONLY);
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
  const pool = await db.all<SearchHit & { lead?: string }>(
    `SELECT ${ROW}, ${LEAD}
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
  // Then a title holding every asked word ("Thunder Bluff to Orgrimmar travel guide" for "orgrimmar to thunder bluff")
  // before pages that hold some of them in the title and the rest in the text.
  const wantedTerms = wanted.split(" ");
  const rank = (hit: SearchHit) => {
    const name = allTerms(hit.name);
    if (name === wanted) return 0;
    if (contentTerms(hit.name).join(" ") === wanted) return 1;
    const words = new Set(name.split(" "));
    return wantedTerms.length > 1 && wantedTerms.every((t) => words.has(t)) ? 2 : 3;
  };
  // At the same rank, Everloot's own curated entries come before the copied Warcraft Wiki pages.
  const own = (hit: SearchHit) => (hit.sourceId === "curated" ? 0 : 1);
  // Re-rank only the first RERANK rows: they are the same rows whatever the limit, so page cuts at
  // different limits stay a stable prefix of one ordering. Rows after them keep the SQL order.
  const head = merged.slice(0, RERANK).sort((a, b) => rank(a) - rank(b) || own(a) - own(b));
  // A page the question names ("where does Linen Cloth drop") opens with its own first lines ("Hogger is an elite
  // gnoll…"), not the fragment where bm25 found the words ("…Model updated."). Other hits keep the fragment that
  // shows why they matched.
  const namedIn = (hit: SearchHit) => rank(hit) < 2 || ` ${asked} `.includes(` ${allTerms(hit.name)} `);
  return [...head, ...merged.slice(RERANK)].slice(0, limit).map(({ lead, ...hit }: SearchHit & { lead?: string }) =>
    (lead !== undefined && namedIn(hit) ? { ...hit, snippet: lead } : hit));
}

/** The body's opening, the same cut as an exact lookup's snippet. */
const LEAD = `CASE WHEN length(e.body) > 160 THEN substr(e.body, 1, 160) || '…' ELSE e.body END AS lead`;

/** A word the player changed and what it was read as. */
export interface Respelling { from: string; to: string }

/** At most this many spellings are tried for one word, so one check stays one query under D1's bound-parameter cap. */
const MAX_TRIES = 90;
/** A word on this many pages or fewer may be a typo; a spelling on more than COMMON of them (the count stops at 20) replaces it. */
const RARE = 2;
const COMMON = 10;

/**
 * The spellings tried for a word: one letter dropped ("zeppeling"), two neighbours swapped, one vowel changed, one
 * letter doubled ("orgrimar"), two vowels swapped ("monestary"), in that order.
 */
function nearSpellings(word: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i < word.length; i++) out.add(word.slice(0, i) + word.slice(i + 1));
  for (let i = 0; i < word.length - 1; i++) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  for (let i = 0; i < word.length; i++) {
    if (!"aeiou".includes(word[i]!)) continue;
    for (const v of "aeiou") if (v !== word[i]) out.add(word.slice(0, i) + v + word.slice(i + 1));
  }
  for (let i = 0; i < word.length; i++) out.add(word.slice(0, i + 1) + word.slice(i));
  // Two vowels typed in each other's place ("monestary" for "monastery").
  const vowels = [...word].flatMap((c, i) => ("aeiou".includes(c) ? [i] : []));
  for (const [n, i] of vowels.entries()) for (const j of vowels.slice(n + 1)) {
    if (word[i] === word[j]) continue;
    const swapped = [...word];
    [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
    out.add(swapped.join(""));
  }
  out.delete(word);
  return [...out].filter((w) => w.length >= 3);
}

/** How many pages (capped) carry each FTS query, one statement for all of them. */
async function pageCounts(db: ReleaseDb, queries: readonly string[]): Promise<number[]> {
  if (!queries.length) return [];
  const parts = queries.map((_, i) => `SELECT ${i} AS i, (SELECT count(*) FROM (SELECT 1 FROM entities_fts WHERE entities_fts MATCH ? LIMIT 20)) AS n`);
  const rows = await db.all<{ i: number; n: number }>(parts.join(" UNION ALL "), ...queries);
  const counts = queries.map(() => 0);
  for (const r of rows) counts[r.i] = r.n;
  return counts;
}

/** The question's other topic words, quoted for FTS. */
const others = (question: string, word: string) => contentTerms(question).filter((t) => t !== word).map((t) => `"${t}"`).join(" ");

/**
 * Of spellings equally common, the one that most pages carry beside the question's other words ("scarlet monastery
 * level", not "scarlet monetary level"); the first tried when none does.
 */
async function inContext(db: ReleaseDb, spellings: readonly string[], context: string): Promise<string> {
  if (!context) return spellings[0]!;
  const counts = await pageCounts(db, spellings.map((w) => `"${w}" ${context}`));
  return spellings[counts.indexOf(Math.max(...counts))]!;
}

/**
 * The question with its words read the way the pages write them, for when no page title holds every word: a name typed
 * as one word becomes the page title's words ("thunderbluff" → "thunder bluff", "mankriks" → "mankrik s"), and a
 * word no page carries, or only a page or two, becomes its nearest spelling that many pages carry ("zeppeling" →
 * "zeppelin"). A word the pages use is kept. Null when nothing changes. One query per word of five letters or more.
 */
export async function respell(
  source: ReleaseSource, question: string, keep: ReadonlySet<string> = new Set(),
): Promise<{ text: string; changes: Respelling[] } | null> {
  const db = releaseDb(source);
  const changes: Respelling[] = [];
  for (const word of new Set(contentTerms(question))) {
    // `keep`: words the caller knows are right, such as names in the game files that the 2023 pages never had.
    if (word.length < 5 || !/^\p{L}+$/u.test(word) || PICK_WORDS.has(word) || keep.has(word)) continue;
    // A page title holding the word as typed means it is a name already ("Zephyr"), so it is never split or changed.
    const splits = [];
    for (let i = 3; i < word.length; i++) splits.push(`${word.slice(0, i)} ${word.slice(i)}`);
    const near = nearSpellings(word).slice(0, MAX_TRIES - splits.length - 2);
    const queries = [`name : "${word}"`, `"${word}"`, ...splits.map((s) => `name : "${s}"`), ...near.map((w) => `"${w}"`)];
    const counts = await pageCounts(db, queries);
    const [inTitle, onPages] = counts as [number, number];
    let to: string | null = null;
    if (!inTitle) {
      const split = splits.findIndex((_, i) => counts[2 + i]! > 0);
      if (split !== -1) to = splits[split]!;
    }
    // A word a page title carries is a name ("Sneed"), never another word's typo ("seed").
    if (!to && !inTitle && onPages <= RARE) {
      // The spelling most pages use; on a tie, the one the question's other words fit. A word a page or two carry is
      // most likely the same typo on those pages ("monestary"), so it gives way only to a spelling on many more of them.
      const nearCounts = counts.slice(2 + splits.length);
      const most = Math.max(0, ...nearCounts);
      const tied = near.filter((_, i) => nearCounts[i] === most);
      if (most > (onPages ? COMMON : 0)) to = tied.length > 1 ? await inContext(db, tied, others(question, word)) : tied[0]!;
    }
    if (to) changes.push({ from: word, to });
  }
  if (!changes.length) return null;
  let text = question;
  for (const c of changes) text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${c.from}(?![\\p{L}\\p{N}])`, "giu"), c.to);
  return { text, changes };
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

/** The `data` column as an object; anything that does not parse to one is an empty record. */
function parseData(text: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(text);
    return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** One row by id with its whole body and structured data, for the fetch tool. Unknown id gives undefined. */
export async function getDocument(source: ReleaseSource, id: number): Promise<(SearchHit & { body: string; data: Record<string, unknown> }) | undefined> {
  const r = await releaseDb(source).get<EntityRow & { data: string }>(`SELECT ${ROW_BY_ID}, data FROM entities WHERE id = ?`, id);
  return r ? { ...toHit(r), body: r.body, data: parseData(r.data) } : undefined;
}

/** Every row of one kind with its `data`, by name, optionally where one data field equals a value. Both are bound. */
export async function listByKind(
  source: ReleaseSource,
  kind: Kind,
  where?: { dataKey: string; equals: string },
): Promise<(SearchHit & { data: Record<string, unknown> })[]> {
  const cond = where ? " AND json_extract(data, '$.' || ?) = ?" : "";
  const params = where ? [kind, where.dataKey, where.equals] : [kind];
  const rows = await releaseDb(source).all<EntityRow & { data: string }>(
    `SELECT ${ROW_BY_ID}, data FROM entities WHERE kind = ?${cond} ORDER BY name, id`,
    ...params,
  );
  return rows.map((r) => ({ ...toHit(r), data: JSON.parse(r.data) as Record<string, unknown> }));
}

/** Exact full-name match (case-insensitive), optionally narrowed to one kind. */
export async function getByName(source: ReleaseSource, name: string, kind?: Kind): Promise<SearchHit[]> {
  const db = releaseDb(source);
  const kinds = kind ? kindFilter("", [kind]) : null;
  const cond = kinds ? `AND ${kinds.sql}` : "";
  const exact = async (n: string) => {
    const params = kinds ? [n, ...kinds.params] : [n];
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
