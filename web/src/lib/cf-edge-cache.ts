/**
 * The Worker's edge cache (web/scripts/cf-entry.mjs). next.config.js marks the public pages
 * that read no cookies with `CDN-Cache-Control` (Next sends `private, no-store` to browsers on dynamic pages, so
 * the CDN-specific header carries the edge lifetime). A Worker's own responses skip
 * Cloudflare's cache, so the entry keeps them in the Cache API instead, for the same lifetime.
 *
 * Only a GET without credentials, answered 200 with `CDN-Cache-Control: max-age=N`, no `Set-Cookie` and no
 * `Vary` on credentials, is kept. The key carries the content versions the entry is built with, not the
 * deployed commit: a deploy that changes another page, a test or an API route keeps the public pages it did not
 * change. A content change starts those pages on a new key, so an old page is never served after its data changed
 * and never outlives its lifetime. Browsers get the response's own headers either way.
 */
export const ORIGINAL_CACHE_CONTROL = "x-everloot-browser-cache-control";

/**
 * Headers Next's router sends for a React Server Components payload instead of HTML. The Cache API ignores
 * `Vary`, so a request carrying any of them (or `_rsc`) bypasses the shared cache: an RSC payload can never be
 * stored under the HTML page's key, nor the HTML served to the router.
 */
const RSC_HEADERS = ["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url"];

/**
 * Whether a request may be answered from, or stored in, the shared cache. Requests carrying a Cookie still may:
 * next.config.js marks only pages that read no cookies for the CDN, and a response that sets one, or varies on one,
 * is never kept. A credential in the Authorization header bypasses the cache outright.
 */
export function edgeCacheable(req: Request): boolean {
  if (req.method !== "GET" || req.headers.has("authorization") || req.headers.get("range")) return false;
  if (RSC_HEADERS.some((h) => req.headers.has(h))) return false;
  const url = new URL(req.url);
  if (url.searchParams.has("_rsc")) return false;
  // A name search on an item list is one-off text: caching it only fills the cache with keys nobody repeats.
  if (ITEM_LIST_PATH.test(url.pathname) && url.searchParams.getAll("q").some((v) => v.trim() !== "")) return false;
  return true;
}

/**
 * The query parameters the item lists read: categoryQuery in src/lib/items.ts and the class context
 * (class, level, role) in src/lib/class-context.ts. cf-edge-cache.test.ts checks every parameter the pages' own
 * links write survives the key. (`q` is listed for completeness; a non-empty q is never cached.)
 */
export const ITEM_LIST_PARAMS: ReadonlySet<string> = new Set([
  "q", "slot", "quality", "src", "skill", "crafted", "reagent", "set", "seen", "ilvl", "req", "bind", "dev", "unnamed", "sort", "page",
  "class", "level", "role",
]);
const ITEM_LIST_PATH = /^\/database\/items(?:\/[a-z][a-z0-9-]*(?:\/[^/]+)?)?\/?$/;

/** Parameters a campaign or bot appends that no page reads. They are dropped from every key. */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "_", "_ga", "_gl", "cache", "cachebust", "cb", "dclid", "fbclid", "gbraid", "gclid", "igshid", "mc_cid", "mc_eid",
  "msclkid", "nocache", "oly_anon_id", "oly_enc_id", "ref_src", "ref_url", "srsltid", "twclid", "vero_id", "wbraid",
  "yclid",
]);
const isTracking = (k: string) => TRACKING_PARAMS.has(k) || k.startsWith("utm_");

/**
 * The content versions the Worker has this deploy. `template` is bumped by hand (src/data/edge-cache-version.json)
 * when the public pages' markup changes; the other three come from the files or release the pages read.
 */
export interface EdgeCacheVersions {
  template: string;
  data: string;
  knowledge: string;
  addon: string;
}

const DATA_PATH = /^\/(?:database(?:\/|$)|map(?:\/|$)|tools\/(?:talents|professions|legacy)(?:\/|$))/;
const ADDON_PATH = /^\/(?:addon(?:\/|$)|addons(?:\/|$))/;
const KNOWLEDGE_PATH = /^\/(?:changes(?:\/|$)|guides(?:\/|$)|lore(?:\/|$)|news(?:\/|$)|search(?:\/|$)|wiki(?:\/|$))/;

/**
 * The version a route's cached copy belongs to. Data pages follow the game files and the knowledge files they
 * join; changes, guides, lore, news, search and wiki follow the knowledge release; addon pages follow the zips.
 * Every page follows the hand-bumped template version, so a markup change refreshes all of them. A route outside
 * these groups keeps only the template version: a change to an account, API or test file does not empty the
 * public cache.
 */
export function cacheVersionFor(pathname: string, versions: EdgeCacheVersions): string {
  const t = versions.template || "dev";
  if (pathname === "/sitemap.xml") return `s.${versions.data || "dev"}.${versions.knowledge || "dev"}.${t}`;
  if (ADDON_PATH.test(pathname)) return `a.${versions.addon || "dev"}.${t}`;
  if (DATA_PATH.test(pathname)) return `d.${versions.data || "dev"}.${versions.knowledge || "dev"}.${t}`;
  if (KNOWLEDGE_PATH.test(pathname)) return `k.${versions.knowledge || "dev"}.${t}`;
  return `t.${t}`;
}

/**
 * The cache key: the URL plus the route's content version, so a deploy only starts an empty cache for the pages
 * whose content changed. Parameters the page never reads (tracking tags, cache busters bots add) are dropped and
 * the rest sorted on every route, so they cannot mint an unbounded number of misses; the item lists keep only the
 * parameters they read. Meaningful values stay, and different ones are different keys.
 */
export function edgeCacheKey(req: Request, version: string): Request {
  const url = new URL(req.url);
  const kept = ITEM_LIST_PATH.test(url.pathname)
    ? [...url.searchParams].filter(([k]) => ITEM_LIST_PARAMS.has(k))
    : [...url.searchParams].filter(([k]) => !isTracking(k));
  kept.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  url.search = new URLSearchParams(kept).toString();
  url.searchParams.set("__edge_version", version || "unknown");
  return new Request(url.toString(), { method: "GET" });
}

/**
 * Seconds the shared cache may keep this response, from `CDN-Cache-Control: max-age`; null when it must not.
 * The Cache API ignores `Vary`, so a response that varies on a credential (or on everything) is refused, as is a
 * private or no-store CDN lifetime even if it also names a max-age.
 */
export function edgeTtl(res: Response): number | null {
  if (res.status !== 200 || res.headers.has("set-cookie")) return null;
  const cdn = res.headers.get("cdn-cache-control") ?? "";
  if (/(?:^|,)\s*(?:private|no-store|no-cache)\b/i.test(cdn)) return null;
  const vary = res.headers.get("vary")?.toLowerCase() ?? "";
  if (vary.split(",").some((v) => ["*", "cookie", "authorization"].includes(v.trim()))) return null;
  const m = cdn.match(/(?:^|,)\s*max-age=(\d+)/i);
  const ttl = m ? Number(m[1]) : 0;
  return ttl > 0 ? ttl : null;
}

/**
 * A page that rendered without data it could not read (upload storage or the private game files out of reach)
 * says so with this element (components/EdgeDegraded.tsx). The first render after a deploy is the one the cache
 * keeps, so a read that failed then would otherwise show for the page's whole lifetime.
 */
export const DEGRADED_META = "everloot-degraded";
/** Seconds the shared cache keeps a degraded page: long enough to spare storage during an outage, short enough to heal. */
export const DEGRADED_TTL = 60;
const DEGRADED_TAG = `<meta name="${DEGRADED_META}"`;

/** Whether the HTML carries the marker element. Page text is escaped and the router payload is JSON, so only the element matches. */
export const edgeDegraded = (html: string): boolean => html.includes(DEGRADED_TAG);

/**
 * The copy to store: an HTML page is read in full and kept DEGRADED_TTL seconds at most when degraded, else `ttl`.
 * Anything else (the /map social card is a PNG under a cached path) is stored as it is: reading it as text would
 * corrupt it.
 */
export async function cacheCopy(res: Response, ttl: number): Promise<Response> {
  if (!/^text\/html\b/i.test(res.headers.get("content-type") ?? "")) return forCache(res, ttl);
  const html = await res.text();
  const kept = new Response(html, { status: res.status, statusText: res.statusText, headers: res.headers });
  return forCache(kept, edgeDegraded(html) ? Math.min(ttl, DEGRADED_TTL) : ttl);
}

/** The copy to store: the cache keeps it `ttl` seconds; the browser's own header rides along to be restored. */
export function forCache(res: Response, ttl: number): Response {
  const headers = new Headers(res.headers);
  headers.set(ORIGINAL_CACHE_CONTROL, res.headers.get("cache-control") ?? "");
  headers.set("cache-control", `public, max-age=${ttl}`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** A cached copy as the browser should see it: its original Cache-Control back, marked as a hit. */
export function fromCache(res: Response): Response {
  const headers = new Headers(res.headers);
  const original = headers.get(ORIGINAL_CACHE_CONTROL);
  headers.delete(ORIGINAL_CACHE_CONTROL);
  if (original) headers.set("cache-control", original); else headers.delete("cache-control");
  headers.set("x-everloot-edge-cache", "HIT");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
