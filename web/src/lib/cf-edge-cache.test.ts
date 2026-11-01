import { expect, test } from "vitest";
import { edgeCacheKey, edgeCacheable, edgeTtl, forCache, fromCache } from "./cf-edge-cache";

const page = (headers: Record<string, string>, status = 200) => new Response("<html></html>", { status, headers });

test("only a page next.config marks for the CDN is kept, for its CDN max-age", () => {
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=3600, stale-while-revalidate=86400", "cache-control": "private, no-cache, no-store" }))).toBe(3600);
  expect(edgeTtl(page({ "cache-control": "public, max-age=3600" }))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=0" }))).toBeNull();
});

test("an error, or a response that sets a cookie, is never kept", () => {
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=300" }, 503))).toBeNull();
  expect(edgeTtl(page({ "cdn-cache-control": "max-age=300", "set-cookie": "a=b" }))).toBeNull();
});

test("only plain GETs without credentials use the shared cache", () => {
  expect(edgeCacheable(new Request("https://everloot.app/database"))).toBe(true);
  expect(edgeCacheable(new Request("https://everloot.app/database", { method: "POST" }))).toBe(false);
  expect(edgeCacheable(new Request("https://everloot.app/database", { headers: { authorization: "Bearer evl_x" } }))).toBe(false);
});

test("the key carries the build, so a deploy starts with an empty cache, and keeps the query", () => {
  const a = edgeCacheKey(new Request("https://everloot.app/search?q=thrall"), "abc1234").url;
  expect(a).toBe("https://everloot.app/search?q=thrall&__edge_build=abc1234");
  expect(edgeCacheKey(new Request("https://everloot.app/search?q=thrall"), "def5678").url).not.toBe(a);
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

test("on the item lists, parameters the page never reads do not split the cache, and order does not matter", () => {
  const key = (u: string) => edgeCacheKey(new Request(u), "abc1234").url;
  const plain = key("https://everloot.app/database/items/weapons");
  expect(key("https://everloot.app/database/items/weapons?utm_source=x&cb=123")).toBe(plain);
  expect(key("https://everloot.app/database/items?quality=epic&slot=head")).toBe(key("https://everloot.app/database/items?slot=head&quality=epic&fbclid=z"));
  expect(key("https://everloot.app/database/items/weapons/one-handed-swords?page=2&x=1")).toBe("https://everloot.app/database/items/weapons/one-handed-swords?page=2&__edge_build=abc1234");
  // Router payloads keep their own key.
  expect(key("https://everloot.app/database/items/weapons?_rsc=abc")).not.toBe(plain);
  // Item pages and other routes keep the query as it came.
  expect(key("https://everloot.app/search?q=thrall&x=1")).toBe("https://everloot.app/search?q=thrall&x=1&__edge_build=abc1234");
});
