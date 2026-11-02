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
  expect(JSON.stringify(body.relatedBlocks)).toContain("[Changes](/changes)");
  // Without front-matter sources the body's own Sources section stays.
  expect(bodyForPage({ blocks, sources: [] }).blocks.some((b) => b.type === "heading" && b.text === "Sources")).toBe(true);
  expect(sourceNames({ sources })).toEqual(["Blizzard", "Wowhead"]);
  expect(readingMinutes(blocks)).toBe(1);
  const news = loadNews(FIXTURES);
  expect(relatedPosts(news, { slug: "test-post" }, ["older-post", "test-draft"], 3).map((p) => p.slug)).toEqual(["older-post"]);
  const expanded = new Map(news);
  for (const slug of ["alpha", "bravo", "charlie", "delta"]) expanded.set(slug, { ...news.get("test-post")!, slug });
  expect(relatedPosts(expanded, { slug: "test-post" }, ["delta", "delta", "test-post", "test-draft", "unknown", "older-post"]).map((p) => p.slug)).toEqual(["delta", "older-post", "alpha"]);
});

test("Related retains mixed items and non-news destinations while pure news links become card candidates", async () => {
  const { bodyForPage, relatedPosts } = await import("./news");
  const { parsePage } = await import("../../../kb/src/wiki/page");
  const blocks = parsePage("---\nslug: x\n---\n## Related\n- [Older](/news/older-post)\n- [Older](/news/older-post) and [Changes](/changes), then {zone:12}.\n- [Draft](/news/test-draft)\n- [Unknown](/news/missing)\n- [Self](/news/test-post)\n\n**Try:** [calculator](/tools/talents).\n").blocks;
  const body = bodyForPage({ blocks, sources: [] });
  expect(body.relatedSlugs).toEqual(["older-post", "test-draft", "missing", "test-post"]);
  expect(body.relatedBlocks).toMatchObject([{
    type: "list", items: [(blocks.find((b) => b.type === "list") as Extract<typeof blocks[number], { type: "list" }>).items[1]],
  }]);
  expect(JSON.stringify(body.blocks)).toContain("calculator");
  expect(relatedPosts(loadNews(FIXTURES), { slug: "test-post" }, body.relatedSlugs).map((p) => p.slug)).toEqual(["older-post"]);
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

test("a figure needs alt text and an image in the post's own figures folder; its caption is optional", async () => {
  const { postFigure } = await import("../../../kb/src/news/post");
  const { parsePage } = await import("../../../kb/src/wiki/page");
  const block = (line: string) => parsePage(`---\nslug: x\n---\n${line}\n`).blocks[0];
  const src = "/news/figures/test-post/map.webp";
  expect(postFigure(block(`![The map](${src} "Where the camps are")`), "test-post")).toEqual({ figure: { src, alt: "The map", caption: "Where the camps are" } });
  expect(postFigure(block(`![The map](${src})`), "test-post")).toEqual({ figure: { src, alt: "The map" } });
  expect(postFigure(block(`![ ](${src} "Caption")`), "test-post")).toEqual({ problem: expect.stringContaining("needs alt text") });
  for (const foreign of ["https://example.com/map.webp", "/news/heroes/map.webp", "/news/figures/other/map.webp", "/news/figures/test-post/../map.webp", "/news/figures/test-post/map.png"]) {
    expect(postFigure(block(`![The map](${foreign})`), "test-post"), foreign).toEqual({ problem: expect.stringContaining("this post's folder") });
  }
  expect(postFigure(block(`Look at ![The map](${src}) here.`), "test-post")).toEqual({ problem: expect.stringContaining("a paragraph of its own") });
  expect(postFigure(block("Plain words with a [link](/changes)."), "test-post")).toBeNull();
});

test("the text reads a figure as its caption or alt text, and the feed carries the summary, not the body's figures", async () => {
  const { parsePage } = await import("../../../kb/src/wiki/page");
  const blocks = parsePage(["---", "slug: x", "---", "Intro.", "", '![The map](/news/figures/x/map.webp "Where the camps are")', "", "![The camp](/news/figures/x/camp.webp)", "", "![Bad](https://example.com/a.webp)"].join("\n")).blocks;
  expect(postText(blocks)).toBe("Intro. Where the camps are The camp");
  const post = publishedPost(loadNews(FIXTURES), "test-post")!;
  const xml = renderNewsFeed([{ ...post, blocks: [...post.blocks, ...blocks] }], { baseUrl: "https://everloot.app", now: new Date("2026-10-26") });
  expect(xml).not.toContain("<img");
  expect(xml).not.toContain("figures");
  expect(xml).toContain(`<description>${post.summary}</description>`);
});
