import { catalogPath } from "./catalog-paths.js";

/**
 * The lore archive's URL slugs, shared by the site's /lore pages and the MCP server's search and fetch
 * tools, so both name the same page for one record.
 */

/** Lowercase ASCII letters and digits joined by hyphens; accents stripped, everything else dropped. */
export function slugify(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const runs = ascii.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return runs.join("-").slice(0, 80).replace(/-+$/, "");
}

/** `<extId>-<name-slug>` for a numeric wiki page id; a curated kebab id is the whole slug. */
export function loreSlug(row: { extId: string; name: string }): string {
  return /^[1-9]\d*$/.test(row.extId) ? `${row.extId}-${slugify(row.name)}` : row.extId;
}

/** A lore page shorter than this, or a redirect stub, renders but is not indexed. */
export const INDEXABLE_MIN_BODY = 300;

export function isIndexable(body: string): boolean {
  return body.length >= INDEXABLE_MIN_BODY && !body.includes("REDIRECT");
}

/**
 * Curated records whose subject now has an Everloot page of its own. The old lore address redirects there
 * (web/next.config.js), so an answer links the page instead of the redirect.
 */
export const MOVED_LORE: Readonly<Record<string, string>> = { "forever-launch-date": "/wow-forever" };

/** The site path of a lore record: its /lore page, or the page its subject moved to. */
export function lorePath(row: { extId: string; name: string }): string {
  const slug = loreSlug(row);
  return MOVED_LORE[slug] ?? `/lore/${slug}`;
}

/**
 * Where a knowledge record is read: a lore page has its own page on the site, where the source and
 * licence are shown with the text; a catalog record points at its database page; any other record points at the
 * source's own page.
 */
export function recordUrl(row: { kind: string; extId: string; name: string; sourceUrl: string }, site: string): string {
  if (row.kind === "lore_page") return `${site}${lorePath(row)}`;
  const path = catalogPath(row.kind, row.extId, row.name);
  return path === null ? row.sourceUrl : `${site}${path}`;
}
