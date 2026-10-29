import { expect, test } from "vitest";
import { sitemapUrls, summarize } from "./cf-warm.mjs";

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
