import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { emptyStore, ingestBluePosts } from "../src/blue-posts.js";
import { buildTimeline } from "../src/changes.js";
import { newsLinks, parseNewsArticle } from "../src/blue-news.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/blue/${name}`, import.meta.url), "utf8");
const now = new Date("2026-11-17T10:00:00Z");
const url = "https://news.blizzard.com/en-us/article/24315281/wow-forever-hotfixes-november-16-2026";

test("recorded Blizzard news cards discover one Forever article, excluding unrelated links", () => {
  expect(newsLinks(fixture("news-index.html"))).toEqual([url]);
});

test("recorded news metadata becomes a linked hotfix announcement with no article body", () => {
  const post = parseNewsArticle(fixture("news-article.html"), url, now);
  expect(post).toMatchObject({ id: "news:24315281", source: "news", game: "forever", kind: "hotfix",
    title: "WoW: Forever Hotfixes - November 16, 2026", postedAt: "2026-11-17T02:17:13.000Z", url, excerpt: "" });
  expect(buildTimeline([post], [])[0]).toMatchObject({ source: "news", url, type: "hotfix" });
  expect(parseNewsArticle("<html>Unexpected layout</html>", url, now)).toBeNull();
  expect(newsLinks('<a href="https://example.com/en-us/article/1/wow-forever">Bad host</a>')).toEqual([]);
});

test("the scheduled reader checks news robots, keeps a linked announcement, and preserves its identity across edits", async () => {
  const fetcher = async (address: string) => {
    if (address.endsWith("robots.txt")) return new Response("", { status: 404 });
    if (address.endsWith("/feed/world-of-warcraft")) return new Response(fixture("news-index.html"));
    if (address === url) return new Response(fixture("news-article.html"));
    throw new Error(`Unexpected request: ${address}`);
  };
  const result = await ingestBluePosts({ store: emptyStore(), fetcher, now, regions: [], sleep: async () => {} });
  expect(result.store.posts).toHaveLength(1);
  expect(result.store.posts[0]).toMatchObject({ id: "news:24315281", source: "news", excerpt: "" });
  expect(result.errors).toEqual([{ source: "bluesky", error: expect.stringContaining("Unexpected request") }]);
  const again = await ingestBluePosts({ store: result.store, fetcher, now: new Date(now.getTime() + 30 * 60_000), regions: [], sleep: async () => {} });
  expect(again.store.posts).toHaveLength(1);
  expect(again.store.posts[0].firstSeen).toBe(now.toISOString());
});

test.each(["disallowed", "redirect", "rate-limit", "bad-layout"])("reports a news %s without following links or losing stored posts", async (failure) => {
  const calls: string[] = [];
  const fetcher = async (address: string) => {
    calls.push(address);
    if (address.endsWith("robots.txt")) return new Response(failure === "disallowed" ? "User-agent: *\nDisallow: /en-us/feed/" : "");
    if (address.includes("bsky")) return Response.json({ feed: [] });
    if (failure === "redirect") return new Response(null, { status: 302, headers: { location: "https://example.com/" } });
    if (failure === "rate-limit") return new Response(null, { status: 429, headers: { "retry-after": "3600" } });
    return new Response("<html>Unexpected layout</html>");
  };
  const store = emptyStore();
  const post = parseNewsArticle(fixture("news-article.html"), url, now)!;
  store.posts.push(post);
  const result = await ingestBluePosts({ store, fetcher, now, regions: [], sleep: async () => {} });
  expect(result.errors.some((error) => error.source === "news")).toBe(true);
  expect(result.store.posts).toEqual([post]);
  expect(calls.some((address) => address.startsWith("https://example.com/"))).toBe(false);
  if (failure === "disallowed") expect(calls.filter((address) => address.startsWith("https://news."))).toHaveLength(1);
  if (failure === "rate-limit") {
    expect(result.store.fetched.news.notBefore).toBe("2026-11-17T11:00:00.000Z");
    calls.length = 0;
    await ingestBluePosts({ store: result.store, fetcher, now: new Date(now.getTime() + 30 * 60_000), regions: [], sleep: async () => {} });
    expect(calls.some((address) => address.startsWith("https://news."))).toBe(false);
  }
});
