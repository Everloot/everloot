/**
 * The Worker's edge cache (web/scripts/cf-entry.mjs). next.config.js marks the public pages
 * that read no cookies with `CDN-Cache-Control` (Next sends `private, no-store` to browsers on dynamic pages, so
 * the CDN-specific header carries the edge lifetime). A Worker's own responses skip
 * Cloudflare's cache, so the entry keeps them in the Cache API instead, for the same lifetime.
 *
 * Only a GET without credentials (a Cookie or an Authorization header), answered 200 with
 * `CDN-Cache-Control: max-age=N`, no `Set-Cookie` and no `Vary` on credentials, is kept. The pages that hold a
 * session or the account (data/protected-paths.json) never reach the cache at all. The key carries the content
 * versions the entry is built with, not the deployed commit: a deploy that changes another page, a test or an
 * API route keeps the public pages it did not change. A content change starts those pages on a new key, so an
 * old page is never served after its data changed and never outlives its lifetime. Browsers get the response's
 * own headers either way.
 */
import PROTECTED_PATHS from "../data/protected-paths.json";

export const ORIGINAL_CACHE_CONTROL = "x-everloot-browser-cache-control";

/**
 * The routes that sign a visitor in, read or change the session, or sit behind a purchase: auth, the signed-in
 * visitor's own data, sign-in, sign-up and password reset, and a cart. Matched by route, before any lookup, so no
 * header a handler sets can put one of them in the shared cache. `/cart` and `/api/cart` have no route today; they
 * are listed so a later one is private from its first deploy.
 */
const SESSION_PATHS: readonly string[] = ["/api/auth", "/api/me", "/me", "/sign-in", "/sign-up", "/reset-password", "/cart", "/api/cart"];

/** The pages that hold a session or the account. They are never looked up in, or stored in, the shared cache. */
const PRIVATE_PATHS: readonly string[] = [...PROTECTED_PATHS, ...SESSION_PATHS];
export function isPrivatePath(pathname: string): boolean {
  // The router reads the decoded path, so `/%6De` is `/me`: match what it will serve. An undecodable path is refused.
  let route: string;
  try {
    route = decodeURIComponent(pathname).replace(/\/{2,}/g, "/").toLowerCase();
  } catch {
    return true;
  }
  return PRIVATE_PATHS.some((p) => route === p || route.startsWith(`${p}/`));
}

/**
 * The site's hover cards (app/database/card/[type]/[id]): JSON that reads no cookie and no header. A signed-in visitor,
 * or one Cloudflare has cleared after a challenge, sends cookies with every same-site fetch, and a cookie bypasses the
 * shared cache, so their cards were rendered on every hover. The entry takes the credentials off these requests before
 * the lookup and before the handler, so the card cannot depend on what it never sees. Matched on the path as sent: a
 * spelling this does not match keeps its credentials and bypasses the cache, as before.
 */
const CREDENTIAL_FREE_PATH = /^\/database\/card\/[a-z]+\/[1-9]\d{0,9}$/;

/** The request without its Cookie and Authorization headers on a route that reads neither; any other request as it is. */
export function withoutCredentials(req: Request): Request {
  if (req.method !== "GET" || !(req.headers.has("cookie") || req.headers.has("authorization"))) return req;
  if (!CREDENTIAL_FREE_PATH.test(new URL(req.url).pathname)) return req;
  const headers = new Headers(req.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  return new Request(req.url, { method: "GET", headers });
}

/**
 * Headers Next's router sends for a React Server Components payload instead of HTML. The Cache API ignores
 * `Vary`, so a request carrying any of them (or `_rsc`) bypasses the shared cache: an RSC payload can never be
 * stored under the HTML page's key, nor the HTML served to the router.
 */
const RSC_HEADERS = ["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url"];

/**
 * Whether a request may be answered from, or stored in, the shared cache. A Cookie or an Authorization header
 * bypasses it outright: the Cache API ignores `Vary`, so a request that could carry a session must never read a
 * copy rendered for someone else, even when the page nominally reads no cookie. The protected pages (the chat
 * keys, the account, the saved builds) bypass it too, before any lookup.
 */
export function edgeCacheable(req: Request): boolean {
  if (req.method !== "GET" || req.headers.has("authorization") || req.headers.has("cookie") || req.headers.get("range")) return false;
  if (RSC_HEADERS.some((h) => req.headers.has(h))) return false;
  const url = new URL(req.url);
  if (isPrivatePath(url.pathname)) return false;
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
 * Parameters a campaign or bot appends that no page reads, and this cache's own markers (`__edge_*`): a request
 * that carries one, once or repeated, gets the key it would have without it, and cannot choose its own version.
 * They are dropped from every key.
 */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "_", "_ga", "_gl", "cache", "cachebust", "cb", "dclid", "fbclid", "gbraid", "gclid", "igshid", "mc_cid", "mc_eid",
  "msclkid", "nocache", "oly_anon_id", "oly_enc_id", "ref_src", "ref_url", "srsltid", "twclid", "vero_id", "wbraid",
  "yclid", "__edge_build", "__edge_version",
]);
const isTracking = (k: string) => TRACKING_PARAMS.has(k) || k.startsWith("utm_");

/**
 * The content versions the Worker has this deploy, from scripts/cache-versions.mjs. `template` is the committed
 * rendering source, so a markup change is its own version instead of a number raised by hand; `data` is the game
 * files, `knowledge` the kb tree plus the D1 release, `addon` the public zips plus the owner-approved source list.
 */
export interface EdgeCacheVersions {
  template: string;
  data: string;
  knowledge: string;
  addon: string;
}

/** Every version must be present: a missing one would make unrelated deploys share a key ("dev"). */
export function versionsComplete(versions: EdgeCacheVersions): boolean {
  return [versions.template, versions.data, versions.knowledge, versions.addon].every((v) => typeof v === "string" && v.length > 0);
}

const HOME_PATH = /^\/(?:home\/?)?$/;
const DATA_PATH = /^\/(?:database(?:\/|$)|map(?:\/|$)|tools\/(?:talents|professions|legacy)(?:\/|$))/;
const ADDON_PATH = /^\/(?:addon(?:\/|$)|addons(?:\/|$))/;
const KNOWLEDGE_PATH = /^\/(?:changes(?:\/|$)|guides(?:\/|$)|lore(?:\/|$)|news(?:\/|$)|search(?:\/|$)|wiki(?:\/|$))/;

/**
 * The version a route's cached copy belongs to. The home page reads the game files, the knowledge timeline and
 * the addon release, and the sitemap lists data, knowledge and addon pages, so both follow all three. Data pages
 * follow the game files and the knowledge files they join; changes, guides, lore, news, search and wiki follow
 * the knowledge release; addon pages follow the zips and the ecosystem snapshot they join. Every page follows the
 * template version, so a markup change refreshes all of them. A route outside these groups keeps only the template
 * version: a change to an account, API or test file does not empty the public cache.
 */
export function cacheVersionFor(pathname: string, versions: EdgeCacheVersions): string {
  const t = versions.template;
  if (HOME_PATH.test(pathname)) return `h.${versions.data}.${versions.knowledge}.${versions.addon}.${t}`;
  if (pathname === "/sitemap.xml") return `s.${versions.data}.${versions.knowledge}.${versions.addon}.${t}`;
  if (ADDON_PATH.test(pathname)) return `a.${versions.addon}.${versions.knowledge}.${t}`;
  if (DATA_PATH.test(pathname)) return `d.${versions.data}.${versions.knowledge}.${t}`;
  if (KNOWLEDGE_PATH.test(pathname)) return `k.${versions.knowledge}.${t}`;
  return `t.${t}`;
}

/**
 * The cache key: the URL plus the route's content version, so a deploy only starts an empty cache for the pages
 * whose content changed. Parameters the page never reads (tracking tags, cache busters bots add, this cache's own
 * markers) are dropped and the rest ordered by name on every route, so they cannot mint an unbounded number of
 * misses; the item lists keep only the parameters they read. Meaningful values stay, and different ones are
 * different keys. The values of one repeated name keep the order they came in: a page reads the first of them, so
 * `?realm=a&realm=b` and `?realm=b&realm=a` are different pages and must not share a key.
 */
export function edgeCacheKey(req: Request, version: string): Request {
  const url = new URL(req.url);
  const kept = ITEM_LIST_PATH.test(url.pathname)
    ? [...url.searchParams].filter(([k]) => ITEM_LIST_PARAMS.has(k))
    : [...url.searchParams].filter(([k]) => !isTracking(k));
  // Array.prototype.sort is stable: equal names stay in request order.
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // The suggest box answers `Thunder` and `thunder ` alike (app/api/suggest/route.ts), so they share a key.
  if (url.pathname === "/api/suggest") for (const pair of kept) if (pair[0] === "q") pair[1] = pair[1].trim().toLowerCase();
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

/** The slice of the Workers Cache API the entry uses; a fake fills it in tests without a network. */
export interface EdgeCacheStore {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, value: Response): Promise<void>;
}
/** The slice of the Workers ExecutionContext the entry uses. */
export interface EdgeCacheContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Answer a request from the shared cache, or render and store it. This is the whole lookup path, kept here so a
 * test runs the same entry logic against a deterministic store: the request is refused before any lookup when it
 * carries a credential, a version is missing, or the route is not the kind next.config marks for the CDN; a hit is
 * served without calling the handler; a miss renders once and stores a copy after the response. Routes that change
 * their content version start a new key, so a build that changes canonical data never reads the old copy.
 */
export async function cachedResponse(
  request: Request,
  versions: EdgeCacheVersions,
  handler: (request: Request) => Promise<Response>,
  store: EdgeCacheStore,
  ctx: EdgeCacheContext,
): Promise<Response> {
  request = withoutCredentials(request);
  if (!edgeCacheable(request) || !versionsComplete(versions)) return handler(request);
  const key = edgeCacheKey(request, cacheVersionFor(new URL(request.url).pathname, versions));
  const hit = await store.match(key);
  if (hit) return fromCache(hit);
  const res = await handler(request);
  const ttl = edgeTtl(res);
  if (ttl) ctx.waitUntil(cacheCopy(res.clone(), ttl).then((copy) => store.put(key, copy)));
  return res;
}
