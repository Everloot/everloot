import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { loadNews, newsSitemapPaths, postText, publishedPost, publishedPosts, renderNewsFeed } from "./news";

const FIXTURES = fileURLToPath(new URL("../test/news", import.meta.url));

test("reads every post that parses, shows only the published ones, newest first", () => {
  const news = loadNews(FIXTURES);
  expect([...news.keys()].sort()).toEqual(["older-post", "test-draft", "test-post"]);
  expect(publishedPosts(news).map((p) => p.slug)).toEqual(["test-post", "older-post"]);
  expect(publishedPost(news, "test-draft")).toBeNull();
  expect(publishedPost(news, "test-post")?.tags).toEqual(["site", "database"]);
  // Fields the front matter leaves out get their defaults.
  expect(publishedPost(news, "older-post")).toMatchObject({ tags: [], sources: [] });
});

test("the sitemap lists the hub and each post, dated by the day it last changed", () => {
  expect(newsSitemapPaths(loadNews(FIXTURES))).toEqual([
    { path: "/news", lastModified: new Date("2026-10-25") },
    { path: "/news/test-post", lastModified: new Date("2026-10-25") },
    { path: "/news/older-post", lastModified: new Date("2026-10-20") },
  ]);
  expect(newsSitemapPaths(new Map())).toEqual([]);
});

test("the post's text reads its paragraphs and lists, a token as one word", () => {
  const post = publishedPost(loadNews(FIXTURES), "test-post")!;
  const text = postText(post.blocks);
  expect(text).toContain("This fixture stands in for a real post.");
  expect(text).toContain("The dungeon page X is published");
  expect(text).not.toContain("A quote stays a quote");
});

test("the feed escapes what it prints and dates the channel by the newest change", () => {
  const posts = publishedPosts(loadNews(FIXTURES));
  const xml = renderNewsFeed([{ ...posts[0], title: "Tom & <Jerry>" }], { baseUrl: "https://everloot.app/", now: new Date("2026-10-26") });
  expect(xml).toContain("<title>Tom &amp; &lt;Jerry&gt;</title>");
  expect(xml).toContain('<guid isPermaLink="true">https://everloot.app/news/test-post</guid>');
  expect(xml).toContain(`<lastBuildDate>${new Date("2026-10-25").toUTCString()}</lastBuildDate>`);
  expect(renderNewsFeed([], { baseUrl: "https://everloot.app", now: new Date("2026-10-26") })).toContain(`<lastBuildDate>${new Date("2026-10-26").toUTCString()}</lastBuildDate>`);
});

test("the page body drops its own Sources and Related lists and keeps the call to action under them", async () => {
  const { bodyForPage, relatedPosts, sourceNames, readingMinutes } = await import("./news");
  const { parsePage } = await import("../../../kb/src/wiki/page");
  const blocks = parsePage(["---", "slug: x", "---", "Intro.", "## Facts", "- one", "## Related", "- [A](/news/older-post)", "- [Changes](/changes)", "", "**Try:** the [calculator](/tools/talents).", "## Sources", "- [Blizzard: B](https://example.com)"].join("\n")).blocks;
  const sources = [{ title: "Blizzard: B", url: "https://example.com" }, { title: "Wowhead: C", url: "https://www.wowhead.com/x" }];
  const body = bodyForPage({ blocks, sources });
  expect(body.blocks.filter((b) => b.type === "heading").map((b) => (b.type === "heading" ? b.text : ""))).toEqual(["Facts"]);
  expect(body.blocks.some((b) => b.type === "paragraph" && JSON.stringify(b).includes("calculator"))).toBe(true);
  expect(body.relatedSlugs).toEqual(["older-post"]);
  // Without front-matter sources the body's own Sources section stays.
  expect(bodyForPage({ blocks, sources: [] }).blocks.some((b) => b.type === "heading" && b.text === "Sources")).toBe(true);
  expect(sourceNames({ sources })).toEqual(["Blizzard", "Wowhead"]);
  expect(readingMinutes(blocks)).toBe(1);
  const news = loadNews(FIXTURES);
  expect(relatedPosts(news, { slug: "test-post" }, ["older-post", "test-draft"], 3).map((p) => p.slug)).toEqual(["older-post"]);
});

test("a hero is optional and checked", async () => {
  const { PostFrontMatter } = await import("../../../kb/src/news/post");
  const base = { slug: "x", title: "T", summary: "S", author: "A", published: "2026-10-25", status: "published" };
  expect(PostFrontMatter.safeParse(base).success).toBe(true);
  expect(PostFrontMatter.safeParse({ ...base, hero: { src: "/news/heroes/x.webp", alt: "A hero" } }).success).toBe(true);
  expect(PostFrontMatter.safeParse({ ...base, hero: { src: "http://x.test/a.png", alt: "A" } }).success).toBe(false);
  expect(PostFrontMatter.safeParse({ ...base, hero: { src: "/a.webp", alt: "A", thumb: "/a-card.webp", share: "/a-share.png" } }).success).toBe(true);
  expect(PostFrontMatter.safeParse({ ...base, hero: { src: "/a.webp", alt: "A", share: "not a path" } }).success).toBe(false);
  expect(PostFrontMatter.safeParse({ ...base, hero: { src: "/a.png" } }).success).toBe(false);
});
