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

/** Whether a request may be answered from, or stored in, the shared cache. */
export function edgeCacheable(req: Request): boolean {
  return req.method === "GET" && !req.headers.has("authorization") && !req.headers.get("range");
}

/**
 * The query parameters the item lists read (categoryQuery and itemsHref in src/lib/items.ts, the class context in
 * src/lib/class-context.ts), plus Next's `_rsc` so a router payload never shares a key with the HTML page.
 */
const ITEM_LIST_PARAMS = new Set([
  "q", "slot", "quality", "src", "skill", "crafted", "reagent", "set", "seen", "ilvl", "req", "bind", "dev", "unnamed", "sort", "page",
  "level", "role", "_rsc",
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
