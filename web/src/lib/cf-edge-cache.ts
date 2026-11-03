/**
 * The Worker's edge cache (web/scripts/cf-entry.mjs). next.config.js marks the public pages
 * that read no cookies with `CDN-Cache-Control` (Next sends `private, no-store` to browsers on dynamic pages, so
 * the CDN-specific header carries the edge lifetime). A Worker's own responses skip
 * Cloudflare's cache, so the entry keeps them in the Cache API instead, for the same lifetime.
 *
 * Only a GET without credentials, answered 200 with `CDN-Cache-Control: max-age=N` and no `Set-Cookie`, is kept.
 * The key carries the deployed commit, so a deploy never serves an hour-old page that names script files the new
 * build no longer has. Browsers get the response's own
 * headers either way.
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
 * next.config.js marks only pages that read no cookies for the CDN, and a response that sets one is never kept.
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

/**
 * The cache key: the URL plus the build, so each deploy starts with an empty cache. On the item lists, parameters
 * the page never reads (utm tags, cache busters bots add) are dropped and the rest sorted, so they cannot mint
 * an unbounded number of misses that each render the whole list (about 550 ms of CPU).
 */
export function edgeCacheKey(req: Request, build: string): Request {
  const url = new URL(req.url);
  if (ITEM_LIST_PATH.test(url.pathname)) {
    const kept = [...url.searchParams].filter(([k]) => ITEM_LIST_PARAMS.has(k));
    kept.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
    url.search = new URLSearchParams(kept).toString();
  }
  url.searchParams.set("__edge_build", build || "unknown");
  return new Request(url.toString(), { method: "GET" });
}

/** Seconds the shared cache may keep this response, from `CDN-Cache-Control: max-age`; null when it must not. */
export function edgeTtl(res: Response): number | null {
  if (res.status !== 200 || res.headers.has("set-cookie")) return null;
  const cdn = res.headers.get("cdn-cache-control");
  const m = cdn?.match(/(?:^|,)\s*max-age=(\d+)/i);
  const ttl = m ? Number(m[1]) : 0;
  return ttl > 0 ? ttl : null;
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
