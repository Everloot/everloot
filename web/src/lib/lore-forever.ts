import { getRelease } from "./release";
import { isIndexable, loreSlug, type LorePage } from "./lore";
import { idForName, loadNames, type Names } from "./names";
import { loadItemFacts, loadWorldFacts } from "./rollup-compute";

/**
 * The lore archive pages about something in WoW: Forever. A Warcraft Wiki copy stands for a Forever database page when
 * it is typed as an NPC, an item or a quest and its name is exactly the one name players agreed on for that kind
 * (`idForName`): the page then links that database page under "In the Forever database". Those copies are indexed and
 * listed in /lore-sitemap.xml; every other wiki copy stays noindex and unlisted (owner decision, 2026-11-10).
 * Everloot's own entries keep the length rule alone and are not listed: the one there is today moved to /wow-forever.
 */

export const WIKI_SOURCE = "warcraft-wiki-2023";
export const FOREVER_KINDS = ["npc", "item", "quest"] as const;
export type ForeverKind = (typeof FOREVER_KINDS)[number];

const namesFor = (names: Pick<Names, "npcs" | "items" | "quests">, kind: ForeverKind) =>
  kind === "npc" ? names.npcs : kind === "item" ? names.items : names.quests;

/** The database kind a wiki lore page could stand for, from its type; null for other types and Everloot's own entries. */
export function foreverKind(page: Pick<LorePage, "sourceId" | "type">): ForeverKind | null {
  return page.sourceId === WIKI_SOURCE && (FOREVER_KINDS as readonly string[]).includes(page.type ?? "") ? (page.type as ForeverKind) : null;
}

/** The database page a wiki lore page stands for, or null. */
export function foreverMatch(page: Pick<LorePage, "sourceId" | "type" | "name">, names: Pick<Names, "npcs" | "items" | "quests">): { kind: ForeverKind; id: number } | null {
  const kind = foreverKind(page);
  if (!kind) return null;
  const id = idForName(namesFor(names, kind), page.name);
  return id === null ? null : { kind, id };
}

/**
 * Whether a lore page asks to be indexed: long enough and not a redirect, and, for a Warcraft Wiki copy, about
 * something in the Forever database. The page's robots and the lore sitemap both ask this.
 */
export const loreIndexable = (page: Pick<LorePage, "sourceId" | "body">, inDatabase: boolean): boolean =>
  isIndexable(page.body) && (page.sourceId !== WIKI_SOURCE || inDatabase);

/** Lore URLs per sitemap file, under the protocol's 50,000. */
export const LORE_CHUNK = 40_000;
/** Names per release query: one JSON parameter, well inside D1's statement and value limits. */
const NAME_BATCH = 2_000;

/**
 * The Warcraft Wiki copies that ask to be indexed, by kind, or null when the release or upload storage cannot be
 * read (the routes answer 503 rather than a short list). Each agreed name is looked up through the release's
 * (type, name) index, a batch of names per query; the first 300 characters of a body are enough for the length rule.
 */
export async function lorePaths(): Promise<string[] | null> {
  const [release, items, world] = await Promise.all([getRelease(), loadItemFacts(), loadWorldFacts()]);
  if (!release || items.unreachable || world.unreachable) return null;
  const names = await loadNames(Promise.resolve(items));
  const out = new Set<string>();
  for (const kind of FOREVER_KINDS) {
    const unique = [...new Set([...namesFor(names, kind).values()].map((n) => n.trim()).filter(Boolean))];
    for (let i = 0; i < unique.length; i += NAME_BATCH) {
      const rows = await release.db.all<{ extId: string; name: string; head: string }>(
        `SELECT ext_id AS extId, name, substr(body, 1, 300) AS head FROM entities
         WHERE kind = 'lore_page' AND source_id = ? AND json_extract(data, '$.type') = ?
           AND name COLLATE NOCASE IN (SELECT value FROM json_each(?)) AND instr(body, 'REDIRECT') = 0
         ORDER BY name COLLATE NOCASE, id`,
        WIKI_SOURCE, kind, JSON.stringify(unique.slice(i, i + NAME_BATCH)),
      );
      for (const row of rows) {
        const page = { sourceId: WIKI_SOURCE, type: kind, name: row.name, body: row.head };
        if (loreIndexable(page, foreverMatch(page, names) !== null)) out.add(`/lore/${loreSlug(row)}`);
      }
    }
  }
  return [...out];
}

export function loreUnavailable(): Response {
  return Response.json({ error: "Lore archive unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store" } });
}

/** Pages flip as players agree on names; crawlers do not need the list fresher than hourly. */
export const LORE_SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, must-revalidate",
  // Next overwrites Cache-Control on dynamic routes, so the CDN reads these instead.
  "CDN-Cache-Control": "max-age=3600, stale-while-revalidate=86400",
};
