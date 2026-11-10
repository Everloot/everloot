import { loreHeadsNamed, loreSlug, onlyUsable, UNAVAILABLE } from "./lore";
import { LINKED_TYPES, loadLinkNames, loreStanding, namesOfType, WIKI_SOURCE } from "./lore-links";

/**
 * The lore archive pages about something in WoW: Forever. A Warcraft Wiki copy stands for a Forever database page
 * under the rule in lib/lore-links.ts (`loreStanding`): it then links that page under "In the Forever database", asks
 * to be indexed and is listed in /lore-sitemap.xml; every other wiki copy stays noindex and unlisted (owner decision,
 * 2026-11-10). Everloot's own entries keep the length rule alone and are not listed: the one there is today moved to
 * /wow-forever.
 */

/** Lore URLs per sitemap file, under the protocol's 50,000. */
export const LORE_CHUNK = 40_000;
/** Names per release query: one JSON parameter, well inside D1's statement and value limits. */
const NAME_BATCH = 2_000;

/**
 * The Warcraft Wiki copies that ask to be indexed, or null when the release or upload storage cannot be read (the
 * routes answer 503 rather than a short list). For each lore type a database page can stand for, every name a kind
 * of that type holds is looked up through the release's (type, name) index, a batch of names per query, and each
 * page found is judged by `loreStanding`, the rule its own robots and link use; the first `LORE_HEAD` characters of a
 * body are all that rule reads. The query reads only the rows of those names, never the whole archive (D1 bills per
 * row read). A release query that fails returns null, so the routes answer 503 rather than throw.
 */
export async function lorePaths(): Promise<string[] | null> {
  try {
    return await readLorePaths();
  } catch (err) {
    console.error("lore sitemap: release read failed", err);
    return null;
  }
}

async function readLorePaths(): Promise<string[] | null> {
  const sets = await loadLinkNames("all");
  const out = new Set<string>();
  for (const type of LINKED_TYPES) {
    const names = namesOfType(type, sets);
    // Storage down: the routes answer 503 rather than a list that leaves out every page the missing names would link.
    if (!names) return null;
    const groups = await loreHeadsNamed(type, names, NAME_BATCH);
    if (groups === UNAVAILABLE) return null;
    for (const rows of groups) {
      const only = onlyUsable(rows.map((r) => ({ ...r, body: r.head })))?.extId ?? null;
      for (const row of rows) {
        if (row.sourceId !== WIKI_SOURCE) continue;
        const page = { extId: row.extId, sourceId: row.sourceId, type, name: row.name, body: row.head };
        if (loreStanding(page, only, sets).index) out.add(`/lore/${loreSlug(row)}`);
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
