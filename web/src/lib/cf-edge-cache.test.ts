import { expect, test } from "vitest";
import { classContextParams } from "./class-context";
import { DEGRADED_TTL, ITEM_LIST_PARAMS, cacheCopy, cacheVersionFor, cachedResponse, edgeCacheKey, edgeCacheable, edgeDegraded, edgeTtl, forCache, fromCache, isPrivatePath, versionsComplete } from "./cf-edge-cache";
import { itemsHref } from "./items";

const page = (headers: Record<string, string>, status = 200) => new Response("<html></html>", { status, headers });
const VERSIONS = { template: "t1", data: "d1", knowledge: "k1", addon: "a1" };
const version = (path: string, over: Partial<typeof VERSIONS> = {}) => cacheVersionFor(path, { ...VERSIONS, ...over });

test("only a page next.config marks for the CDN is kept, for its CDN max-age", () => {
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=3600, stale-while-revalidate=86400", "cache-control": "private, no-cache, no-store" }))).toBe(3600);
  expect(edgeTtl(page({ "cache-control": "public, max-age=3600" }))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=0" }))).toBeNull();
});

test("an error, a response that sets a cookie, or one that varies on a credential is never kept", () => {
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=300" }, 503))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=300", "set-cookie": "a=b" }))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "private, max-age=3600" }))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "no-store, max-age=3600" }))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=3600", vary: "cookie" }))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=3600", vary: "Accept-Encoding, Authorization" }))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=3600", vary: "*" }))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=3600", vary: "accept-encoding" }))).toBe(3600);
});

test("only plain GETs without credentials use the shared cache; a cookie or authorization bypasses it", () => {
  expect(edgeCacheable(new Request("https://everloot.app/database"))).toBe(true);
  expect(edgeCacheable(new Request("https://everloot.app/database", { method: "POST" }))).toBe(false);
  expect(edgeCacheable(new Request("https://everloot.app/database", { headers: { authorization: "Bearer evl_x" } }))).toBe(false);
  // The Cache API ignores Vary, so a request carrying a session must never read a copy rendered for someone else.
  expect(edgeCacheable(new Request("https://everloot.app/database", { headers: { cookie: "evl_session=abc" } }))).toBe(false);
});

test("the pages that hold a session or the account never reach the shared cache", () => {
  for (const path of ["/chat", "/chat/abc", "/account", "/settings", "/tools/builds", "/tools/builds/12", "/tools/alts", "/guides/write"]) {
    expect(edgeCacheable(new Request(`https://everloot.app${path}`)), path).toBe(false);
    expect(isPrivatePath(path), path).toBe(true);
  }
  // A prefix only matches a whole segment: /chatty and /accounting are public pages.
  expect(edgeCacheable(new Request("https://everloot.app/chatty"))).toBe(true);
  expect(edgeCacheable(new Request("https://everloot.app/accounting"))).toBe(true);
  expect(edgeCacheable(new Request("https://everloot.app/guides/frost-leveling"))).toBe(true);
});

test("the key carries the route's content version, not the deploy: the same content keeps the cache, a change starts a new key", () => {
  const a = edgeCacheKey(new Request("https://everloot.app/search?q=thrall"), version("/search")).url;
  expect(a).toBe(`https://everloot.app/search?q=thrall&__edge_version=${version("/search")}`);
  // Another deploy with the same content versions keeps this key: an account, API or test change does not empty the cache.
  expect(edgeCacheKey(new Request("https://everloot.app/search?q=thrall"), version("/search")).url).toBe(a);
  // A template bump refreshes every route; a data or knowledge change only the pages that read it.
  expect(edgeCacheKey(new Request("https://everloot.app/search?q=thrall"), version("/search", { template: "t2" })).url).not.toBe(a);
});

test("a data change refreshes data pages, a knowledge change knowledge pages, an addon change addon pages, and the template all", () => {
  const changed = (path: string, over: Partial<typeof VERSIONS>) => cacheVersionFor(path, { ...VERSIONS, ...over });
  expect(changed("/database/items", { data: "d2" })).not.toBe(version("/database/items"));
  expect(changed("/map", { data: "d2" })).not.toBe(version("/map"));
  expect(changed("/guides/frost-leveling", { data: "d2" })).toBe(version("/guides/frost-leveling"));
  expect(changed("/guides/frost-leveling", { knowledge: "k2" })).not.toBe(version("/guides/frost-leveling"));
  expect(changed("/addon", { addon: "a2" })).not.toBe(version("/addon"));
  expect(changed("/addons", { addon: "a2" })).not.toBe(version("/addons"));
  // Addon pages join the ecosystem snapshot from kb.
  expect(changed("/addon", { knowledge: "k2" })).not.toBe(version("/addon"));
  expect(changed("/addon-guide", { addon: "a2" })).toBe(version("/addon-guide"));
  expect(changed("/about", { data: "d2", knowledge: "k2", addon: "a2" })).toBe(version("/about"));
  expect(changed("/about", { template: "t2" })).not.toBe(version("/about"));
  // The sitemap lists data, knowledge and addon pages, so it follows all three.
  expect(changed("/sitemap.xml", { data: "d2" })).not.toBe(version("/sitemap.xml"));
  expect(changed("/sitemap.xml", { knowledge: "k2" })).not.toBe(version("/sitemap.xml"));
  expect(changed("/sitemap.xml", { addon: "a2" })).not.toBe(version("/sitemap.xml"));
});

test("the home page reads the game files, the knowledge timeline and the addon release, so it follows all three", () => {
  for (const over of [{ data: "d2" }, { knowledge: "k2" }, { addon: "a2" }, { template: "t2" }] as Partial<typeof VERSIONS>[]) {
    expect(cacheVersionFor("/", { ...VERSIONS, ...over }), JSON.stringify(over)).not.toBe(version("/"));
  }
  expect(cacheVersionFor("/home", { ...VERSIONS })).toBe(version("/"));
  // /homepage is a different route, not the home page.
  expect(cacheVersionFor("/homepage", { ...VERSIONS, data: "d2" })).toBe(version("/homepage"));
});

test("the browser gets the page's own Cache-Control back from a cached copy", async () => {
  const stored = forCache(page({ "cdn-cache-control": "max-age=3600", "cache-control": "private, no-cache, no-store" }), 3600);
  expect(stored.headers.get("cache-control")).toBe("public, max-age=3600");
  const served = fromCache(stored);
  expect(served.headers.get("cache-control")).toBe("private, no-cache, no-store");
  expect(served.headers.get("x-everloot-edge-cache")).toBe("HIT");
  expect(served.headers.has("x-everloot-browser-cache-control")).toBe(false);
  expect(await served.text()).toBe("<html></html>");
});

test("a page that marks itself degraded is kept a minute, not its full lifetime; a whole page keeps its lifetime", async () => {
  const headers = { "cdn-cache-control": "max-age=3600", "cache-control": "private, no-cache, no-store", "content-type": "text/html" };
  const degraded = '<html><head><meta name="everloot-degraded" content="storage"/></head><body>Item 25</body></html>';
  const short = await cacheCopy(new Response(degraded, { headers }), 3600);
  expect(DEGRADED_TTL).toBe(60);
  expect(short.headers.get("cache-control")).toBe(`public, max-age=${DEGRADED_TTL}`);
  expect(short.headers.get("content-type")).toBe("text/html");
  expect(await short.text()).toBe(degraded);
  const whole = await cacheCopy(new Response("<html><body>Worn Shortsword</body></html>", { headers }), 3600);
  expect(whole.headers.get("cache-control")).toBe("public, max-age=3600");
  expect(await fromCache(whole).text()).toBe("<html><body>Worn Shortsword</body></html>");
  // A lifetime already shorter than a minute is not lengthened.
  expect((await cacheCopy(new Response(degraded, { headers }), 30)).headers.get("cache-control")).toBe("public, max-age=30");
});

test("a cached image (the /map social card) is stored byte for byte, never read as text", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
  const kept = await cacheCopy(new Response(png, { headers: { "cdn-cache-control": "max-age=3600", "content-type": "image/png" } }), 3600);
  expect(kept.headers.get("cache-control")).toBe("public, max-age=3600");
  expect(new Uint8Array(await kept.arrayBuffer())).toEqual(png);
});

test("only the marker element counts as degraded, not the same words in a page's text or in the router payload", () => {
  expect(edgeDegraded('<meta name="everloot-degraded" content="storage"/>')).toBe(true);
  // Text and attribute values are escaped, and the RSC payload is a JSON string, so neither can spell the element.
  expect(edgeDegraded("<p>&lt;meta name=&quot;everloot-degraded&quot;&gt; everloot-degraded</p>")).toBe(false);
  expect(edgeDegraded('<script>self.__next_f.push([1,"[\\"$\\",\\"meta\\",null,{\\"name\\":\\"everloot-degraded\\"}]"])</script>')).toBe(false);
  expect(edgeDegraded("<html><body>Item 25</body></html>")).toBe(false);
});

test("on the item lists, parameters the page never reads do not split the cache, and order does not matter", () => {
  const key = (u: string) => edgeCacheKey(new Request(u), "v1").url;
  const plain = key("https://everloot.app/database/items/weapons");
  expect(key("https://everloot.app/database/items/weapons?utm_source=x&cb=123")).toBe(plain);
  expect(key("https://everloot.app/database/items?quality=epic&slot=head")).toBe(key("https://everloot.app/database/items?slot=head&quality=epic&fbclid=z"));
  expect(key("https://everloot.app/database/items/weapons/one-handed-swords?page=2&x=1")).toBe("https://everloot.app/database/items/weapons/one-handed-swords?page=2&__edge_version=v1");
  // Class context is part of the list: a mage list never shares a key with a warrior list.
  expect(key("https://everloot.app/database/items?class=mage&level=60")).not.toBe(key("https://everloot.app/database/items?class=warrior&level=60"));
  // Item pages and other routes keep the query they read, sorted, without campaign tags.
  expect(key("https://everloot.app/search?q=thrall&x=1")).toBe("https://everloot.app/search?q=thrall&x=1&__edge_version=v1");
  expect(key("https://everloot.app/search?q=thrall&utm_source=x&cb=1")).toBe(key("https://everloot.app/search?q=thrall"));
  expect(key("https://everloot.app/search?b=2&a=1")).toBe(key("https://everloot.app/search?a=1&b=2"));
  expect(key("https://everloot.app/search?q=thrall")).not.toBe(key("https://everloot.app/search?q=jaina"));
});

test("every parameter the item lists' own links write survives the key", () => {
  const href = itemsHref("armor", "cloth", {
    q: "x", slot: ["head"], quality: ["epic"], src: ["vendor"] as never, skill: "tailoring", crafted: true, reagent: true, set: true, seen: true,
    ilvl: { min: 10, max: 20 }, req: { min: 5, max: 5 }, bind: "pickup", dev: true, unnamed: true, sort: { key: "ilvl", desc: true }, page: 3,
  });
  const written = [...new URL(href, "https://everloot.app").searchParams.keys(), ...classContextParams({ classSlug: "mage", level: 60, role: "damage" } as never).map(([k]) => k)];
  expect(written.length).toBeGreaterThan(15);
  for (const k of written) expect(ITEM_LIST_PARAMS.has(k), k).toBe(true);
  const kept = new URL(edgeCacheKey(new Request("https://everloot.app/database/items?class=mage&level=60&role=damage&sort=-ilvl"), "b").url).searchParams;
  expect([...kept.keys()].sort()).toEqual(["__edge_version", "class", "level", "role", "sort"]);
});

test("router (RSC) requests bypass the shared cache, so they never share a key with the HTML", () => {
  const u = "https://everloot.app/database/items/weapons";
  for (const h of ["RSC", "Next-Router-State-Tree", "Next-Router-Prefetch", "Next-Router-Segment-Prefetch", "Next-Url"]) {
    expect(edgeCacheable(new Request(u, { headers: { [h]: "1" } })), h).toBe(false);
  }
  expect(edgeCacheable(new Request(`${u}?_rsc=abc`))).toBe(false);
  expect(edgeCacheable(new Request(u))).toBe(true);
});

test("a name search on an item list is not cached; an empty one is", () => {
  expect(edgeCacheable(new Request("https://everloot.app/database/items?q=thrall"))).toBe(false);
  expect(edgeCacheable(new Request("https://everloot.app/database/items/weapons?q=%20sword%20"))).toBe(false);
  expect(edgeCacheable(new Request("https://everloot.app/database/items?q="))).toBe(true);
  expect(edgeCacheable(new Request("https://everloot.app/database/items?q=%20"))).toBe(true);
  expect(edgeCacheable(new Request("https://everloot.app/database/items", { headers: { cookie: "a=b" } }))).toBe(false);
});

/** A Cache API stand-in: keys are URLs, and a stored copy is cloned on the way out like the real one. */
function fakeStore() {
  const entries = new Map<string, Response>();
  return {
    entries,
    match: async (key: Request) => entries.get(key.url)?.clone(),
    put: async (key: Request, value: Response) => { entries.set(key.url, value); },
  };
}

/** Collects waitUntil work so a test waits for the store write the way the runtime would after the response. */
function fakeContext() {
  const waits: Promise<unknown>[] = [];
  return { waits, waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
}

function cachedPage(body: string, extra: Record<string, string> = {}) {
  return new Response(body, { headers: { "cdn-cache-control": "max-age=60", "cache-control": "private, no-cache", "content-type": "text/html", ...extra } });
}

test("a second request is a HIT without rendering; an unrelated deploy keeps it and a content change starts a new key", async () => {
  const store = fakeStore();
  const ctx = fakeContext();
  let rendered = 0;
  const handler = async () => { rendered++; return cachedPage(`<html>Worn Shortsword ${rendered}</html>`); };
  const request = () => new Request("https://everloot.app/database/items?slot=head");
  const first = await cachedResponse(request(), VERSIONS, handler, store, ctx);
  await Promise.all(ctx.waits);
  expect(rendered).toBe(1);
  expect(await first.text()).toBe("<html>Worn Shortsword 1</html>");

  const second = await cachedResponse(request(), VERSIONS, handler, store, ctx);
  expect(rendered).toBe(1);
  expect(second.headers.get("x-everloot-edge-cache")).toBe("HIT");
  expect(second.headers.get("cache-control")).toBe("private, no-cache");
  expect(await second.text()).toBe("<html>Worn Shortsword 1</html>");

  // The same canonical content from another deploy hits; a changed data version renders and replaces the copy.
  expect((await cachedResponse(request(), { ...VERSIONS, data: "d1" }, handler, store, ctx)).headers.get("x-everloot-edge-cache")).toBe("HIT");
  const changed = await cachedResponse(request(), { ...VERSIONS, data: "d2" }, handler, store, ctx);
  expect(await changed.text()).toBe("<html>Worn Shortsword 2</html>");
  await Promise.all(ctx.waits);
  expect(store.entries.size).toBe(2);
});

test("a request with a session bypasses the cache even on a public route, and stores nothing", async () => {
  const store = fakeStore();
  const ctx = fakeContext();
  let rendered = 0;
  const handler = async () => { rendered++; return cachedPage("<html>public</html>"); };
  const withCookie = () => new Request("https://everloot.app/database", { headers: { cookie: "evl_session=abc" } });
  await cachedResponse(withCookie(), VERSIONS, handler, store, ctx);
  await Promise.all(ctx.waits);
  await cachedResponse(withCookie(), VERSIONS, handler, store, ctx);
  expect(rendered).toBe(2);
  expect(store.entries.size).toBe(0);
});

test("a protected page is rendered every time and never stored, even without a cookie", async () => {
  const store = fakeStore();
  const ctx = fakeContext();
  let rendered = 0;
  const handler = async () => { rendered++; return cachedPage("<html>account</html>"); };
  await cachedResponse(new Request("https://everloot.app/account"), VERSIONS, handler, store, ctx);
  await Promise.all(ctx.waits);
  await cachedResponse(new Request("https://everloot.app/account"), VERSIONS, handler, store, ctx);
  expect(rendered).toBe(2);
  expect(store.entries.size).toBe(0);
});

test("a page that sets a cookie is served but never stored", async () => {
  const store = fakeStore();
  const ctx = fakeContext();
  let rendered = 0;
  const handler = async () => { rendered++; return cachedPage("<html>x</html>", { "set-cookie": "a=b" }); };
  await cachedResponse(new Request("https://everloot.app/database"), VERSIONS, handler, store, ctx);
  await Promise.all(ctx.waits);
  await cachedResponse(new Request("https://everloot.app/database"), VERSIONS, handler, store, ctx);
  expect(rendered).toBe(2);
  expect(store.entries.size).toBe(0);
});

test("a missing content version disables the cache instead of sharing a made-up key", async () => {
  expect(versionsComplete(VERSIONS)).toBe(true);
  expect(versionsComplete({ ...VERSIONS, template: "" })).toBe(false);
  expect(versionsComplete({ ...VERSIONS, addon: undefined as unknown as string })).toBe(false);
  const store = fakeStore();
  const ctx = fakeContext();
  let rendered = 0;
  const handler = async () => { rendered++; return cachedPage("<html>x</html>"); };
  const incomplete = { ...VERSIONS, knowledge: "" };
  await cachedResponse(new Request("https://everloot.app/database"), incomplete, handler, store, ctx);
  await cachedResponse(new Request("https://everloot.app/database"), incomplete, handler, store, ctx);
  expect(rendered).toBe(2);
  expect(store.entries.size).toBe(0);
});
