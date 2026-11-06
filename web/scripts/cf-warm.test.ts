import { expect, test } from "vitest";
import { MAX_MS, MAX_PAGES, rateLimited, requestHeaders, sitemapUrls, summarize, warm } from "./cf-warm.mjs";

test("with EVERLOOT_EDGE_CHECK set, every request carries it as x-everloot-check; without it, only the user agent", () => {
  expect(requestHeaders({ EVERLOOT_EDGE_CHECK: "s3cret" })).toEqual({ "user-agent": "everloot-deploy-warm", "x-everloot-check": "s3cret" });
  expect(requestHeaders({})).toEqual({ "user-agent": "everloot-deploy-warm" });
  expect(requestHeaders({ EVERLOOT_EDGE_CHECK: "" })).toEqual({ "user-agent": "everloot-deploy-warm" });
});

test("a secret stored with a trailing newline is trimmed: a newline in a header value makes fetch throw", () => {
  const headers = requestHeaders({ EVERLOOT_EDGE_CHECK: "s3cret\r\n" });
  expect(headers["x-everloot-check"]).toBe("s3cret");
  expect(() => new Headers(headers)).not.toThrow();
  expect(requestHeaders({ EVERLOOT_EDGE_CHECK: " \n" })).toEqual({ "user-agent": "everloot-deploy-warm" });
});

test("the sitemap's pages, in order, once each, with escaped ampersands read back", () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://everloot.app/</loc></url>
    <url><loc> https://everloot.app/map </loc></url>
    <url><loc>https://everloot.app/search?q=a&amp;b=1</loc></url>
    <url><loc>https://everloot.app/</loc></url>
  </urlset>`;
  expect(sitemapUrls(xml)).toEqual(["https://everloot.app/", "https://everloot.app/map", "https://everloot.app/search?q=a&b=1"]);
});

test("a run passes only when every page answered 200, and names the ones that did not", () => {
  const good = { url: "https://everloot.app/", status: 200, ms: 40 };
  expect(summarize([good, { ...good, ms: 120 }])).toEqual({ ok: true, lines: ["2 pages, 2 answered 200, p95 120 ms"] });
  const failed = summarize([good, { url: "https://everloot.app/map", status: 503, ms: 900 }, { url: "https://everloot.app/x", status: 0, error: "TimeoutError", ms: 30_000 }]);
  expect(failed.ok).toBe(false);
  expect(failed.lines).toEqual(["3 pages, 1 answered 200, p95 30000 ms", "  503 https://everloot.app/map", "  TimeoutError https://everloot.app/x"]);
});

test("a warm pass asks at most MAX_PAGES pages, however long the sitemap, and names the rest", async () => {
  const urls = Array.from({ length: 1_000 }, (_, n) => `https://everloot.app/p/${n}`);
  const asked: string[] = [];
  const { results, skipped } = await warm(urls, {
    maxPages: 3,
    maxMs: 10_000,
    now: () => 0,
    get: async (url: string) => { asked.push(url); return { url, status: 200, body: "", ms: 1, retryAfter: null }; },
  });
  expect(asked).toEqual(urls.slice(0, 3));
  expect(results).toHaveLength(3);
  expect(skipped).toEqual(urls.slice(3));
  expect(skipped).toHaveLength(1_000 - 3);
  expect(MAX_PAGES).toBeLessThan(1_000);
});

test("a warm pass stops at MAX_MS, so a slow site cannot turn the deploy into a crawl", async () => {
  const urls = Array.from({ length: 100 }, (_, n) => `https://everloot.app/p/${n}`);
  let clock = 0;
  const { results, skipped } = await warm(urls, {
    maxPages: 100,
    maxMs: 25,
    concurrency: 1,
    now: () => clock,
    get: async (url: string) => { clock += 10; return { url, status: 200, body: "", ms: 10, retryAfter: null }; },
  });
  // Three pages start before the 25 ms budget is spent (at 0, 10 and 20 ms); the next would start past it.
  expect(results.map((r) => r.url)).toEqual(urls.slice(0, 3));
  expect(skipped).toEqual(urls.slice(3));
  expect(MAX_MS).toBeLessThanOrEqual(120_000);
});

test("pages left by a limit are named apart and do not fail the run", () => {
  const good = { url: "https://everloot.app/", status: 200, ms: 40 };
  const { ok, lines } = summarize([good], ["https://everloot.app/a", "https://everloot.app/b"]);
  expect(ok).toBe(true);
  expect(lines).toEqual(["1 of 3 pages, 1 answered 200, p95 40 ms", "  2 not checked (warm limit)"]);
});

test("the pages a pass left at 429 are asked again after the longest Retry-After, or a minute when none is given", () => {
  const ok = { url: "https://everloot.app/", status: 200, ms: 40 };
  const a = { url: "https://everloot.app/database/titles/1-a", status: 429, ms: 5, retryAfter: "30" };
  const b = { url: "https://everloot.app/database/titles/2-b", status: 429, ms: 5, retryAfter: null };
  expect(rateLimited([ok, a, b])).toEqual({ urls: [a.url, b.url], waitMs: 30_000 });
  expect(rateLimited([ok, b])).toEqual({ urls: [b.url], waitMs: 60_000 });
  expect(rateLimited([ok, { url: "https://everloot.app/x", status: 503, ms: 9 }])).toEqual({ urls: [], waitMs: 60_000 });
  // A network error (status 0, e.g. a TypeError from fetch) is asked again too; a 503 stays a failure.
  const lost = { url: "https://everloot.app/database/achievements/1", status: 0, error: "TypeError", ms: 9 };
  expect(rateLimited([ok, lost, a])).toEqual({ urls: [lost.url, a.url], waitMs: 30_000 });
});
