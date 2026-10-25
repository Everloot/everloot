import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
// The post page resolves its tokens against the database; the fixture's item gets a fixed name.
vi.mock("@/lib/wiki-names", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wiki-names")>()),
  resolveTokens: async () => new Map([["item:2589", { name: "Rough Copper Vest", href: "/database/items/2589" }]]),
}));

const FIXTURES = fileURLToPath(new URL("../../test/news", import.meta.url));
const WIKI = fileURLToPath(new URL("../../test/wiki", import.meta.url));
afterEach(() => { vi.unstubAllEnvs(); });

const fixtures = () => { vi.stubEnv("NEWS_DIR", FIXTURES); vi.stubEnv("WIKI_DIR", WIKI); };

test("the hub lists published posts newest first, with the feed and the changes timeline apart", async () => {
  fixtures();
  const { default: NewsHub, generateMetadata } = await import("./page");
  const html = renderToStaticMarkup(NewsHub());
  expect(html.indexOf("Test Post")).toBeLessThan(html.indexOf("Older Post"));
  expect(html).toContain('href="/news/test-post"');
  expect(html).toContain('href="/news/older-post"');
  expect(html).not.toContain("test-draft");
  expect(html).toContain('<time dateTime="2026-10-24">October 24, 2026</time>');
  expect(html).toContain("Test Author");
  expect(html).toContain('href="/news/feed.xml"');
  expect(html).toContain('href="/changes"');
  const meta = await generateMetadata();
  expect(meta.robots).toEqual({ index: true, follow: true });
  expect(meta.alternates?.canonical).toBe("/news");
  expect(String(meta.description).length).toBeGreaterThanOrEqual(120);
  expect(String(meta.description).length).toBeLessThanOrEqual(160);
});

test("with no published post the hub says so and stays out of search", async () => {
  vi.stubEnv("NEWS_DIR", mkdtempSync(join(tmpdir(), "news-")));
  const { default: NewsHub, generateMetadata } = await import("./page");
  expect(renderToStaticMarkup(NewsHub())).toContain("No posts yet.");
  expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
});

test("a post page shows the byline, the body with its links and tokens, the sources and the other posts", async () => {
  fixtures();
  const { default: NewsArticle, generateMetadata, generateStaticParams } = await import("./[slug]/page");
  expect(generateStaticParams().map((p) => p.slug).sort()).toEqual(["older-post", "test-post"]);
  const html = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: "test-post" }) }));
  expect(html).toContain("<h1");
  expect(html).toContain("Test Post");
  expect(html).toMatch(/<span data-author(?:="[^"]*")?(?: class="[^"]*")?>Test Author<\/span>/);
  expect(html).toContain("data-reading-time");
  expect(html).toContain("Source: worldofwarcraft.blizzard.com");
  // One Sources list and one related list, no "More news".
  expect(html.match(/id="sources"/g)).toHaveLength(1);
  expect(html).toContain('id="related"');
  expect(html).not.toContain("More news");
  expect(html).toContain('<time dateTime="2026-10-24">October 24, 2026</time>');
  expect(html).toContain('<span>Updated <time dateTime="2026-10-25">October 25, 2026</time></span>');
  expect(html).toContain("data-news-article");
  expect(html).toContain('href="/database/items"');
  expect(html).toContain('<a href="/database/items/2589">Rough Copper Vest</a>');
  expect(html).toContain('<a href="/wiki/test-dungeon">Test Dungeon</a>');
  expect(html).not.toContain('href="/wiki/test-draft"');
  expect(html).toContain("<span>test draft</span>");
  expect(html).toContain("<blockquote");
  expect(html).toContain('href="https://worldofwarcraft.blizzard.com/en-us/news/example"');
  expect(html).toContain('href="/news/older-post"');
  expect(html).toContain('"@type":"NewsArticle"');
  expect(html).not.toContain('"@type":"Article"');
  expect(html).toContain('"author":{"@type":"Organization","name":"Everloot Team"}');
  expect(html).toContain('"headline":"Test Post"');
  expect(html).toContain('"mainEntityOfPage":');
  expect(html).toContain('"publisher":');
  expect(html).toContain('"datePublished":"2026-10-24"');
  expect(html).toContain('"dateModified":"2026-10-25"');
  expect(html).not.toContain('"Person"');
  const meta = await generateMetadata({ params: Promise.resolve({ slug: "test-post" }) });
  expect(meta.robots).toEqual({ index: true, follow: true });
  expect(meta.alternates?.canonical).toBe("/news/test-post");
  expect(meta.openGraph).toMatchObject({ type: "article", publishedTime: "2026-10-24", modifiedTime: "2026-10-25" });
});

test("a draft or unknown slug is a 404 and is not indexed", async () => {
  fixtures();
  const { default: NewsArticle, generateMetadata } = await import("./[slug]/page");
  for (const slug of ["test-draft", "nope"]) {
    await expect(NewsArticle({ params: Promise.resolve({ slug }) })).rejects.toThrow("404");
    expect((await generateMetadata({ params: Promise.resolve({ slug }) })).robots).toEqual({ index: false, follow: true });
  }
});

test("the feed lists the published posts newest first with their pages as links", async () => {
  fixtures();
  const { GET } = await import("./feed.xml/route");
  const res = GET();
  expect(res.headers.get("Content-Type")).toContain("application/rss+xml");
  const body = await res.text();
  expect(body).toContain("<title>Everloot news</title>");
  expect(body.indexOf("<title>Test Post</title>")).toBeLessThan(body.indexOf("<title>Older Post</title>"));
  expect(body).toContain("<link>https://everloot.app/news/test-post</link>");
  expect(body).toContain("<category>site</category>");
  expect(body).not.toContain("Test Draft");
  expect(body).toContain(`<pubDate>${new Date("2026-10-24").toUTCString()}</pubDate>`);
});

test("posts with a hero get card thumbnails, a featured card and the share image; one without gets the placeholder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "news-hero-"));
  const post = (slug: string, published: string, hero: string[]) => writeFileSync(join(dir, `${slug}.md`), ["---", `slug: ${slug}`, `title: ${slug}`, "summary: A summary long enough to read as one.", "author: Everloot Team", `published: ${published}`, "tags: [news-recap, forever]", ...hero, "status: published", "---", "", "Body."].join("\n"));
  post("new-one", "2026-10-25", ["hero:", "  src: /news/heroes/new-one/clean.webp", "  alt: The new art", "  thumb: /news/heroes/new-one/card.webp", "  share: /news/heroes/new-one/share.png"]);
  post("mid-one", "2026-10-24", ["hero:", "  src: /news/heroes/mid-one/clean.webp", "  alt: The mid art", "  thumb: /news/heroes/mid-one/card.webp"]);
  post("old-one", "2026-10-23", []);
  vi.stubEnv("NEWS_DIR", dir); vi.stubEnv("WIKI_DIR", WIKI);
  const { default: NewsHub } = await import("./page");
  const hub = renderToStaticMarkup(NewsHub());
  expect(hub.indexOf("data-news-featured")).toBeLessThan(hub.indexOf('href="/news/mid-one"'));
  expect(hub).toMatch(/<img data-news-thumb[^>]*src="\/news\/heroes\/new-one\/card.webp"[^>]*loading="eager"/);
  expect(hub).toMatch(/<img data-news-thumb[^>]*src="\/news\/heroes\/mid-one\/card.webp"[^>]*width="800" height="450"[^>]*loading="lazy"/);
  expect(hub.match(/data-news-thumb-placeholder/g)).toHaveLength(1);
  expect(hub).toContain(">Forever</span>");
  const { default: NewsArticle, generateMetadata } = await import("./[slug]/page");
  const page = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: "new-one" }) }));
  expect(page).toMatch(/<img data-news-hero[^>]*src="\/news\/heroes\/new-one\/clean.webp" alt="The new art" width="1600" height="900"/);
  expect(page).toContain('"image":["https://everloot.app/news/heroes/new-one/share.png"]');
  expect(page).toMatch(/data-related-card[^]*src="\/news\/heroes\/mid-one\/card.webp"/);
  const meta = await generateMetadata({ params: Promise.resolve({ slug: "new-one" }) });
  expect(meta.openGraph?.images).toEqual([{ url: "/news/heroes/new-one/share.png", width: 1200, height: 675, alt: "The new art" }]);
  const fallback = await generateMetadata({ params: Promise.resolve({ slug: "mid-one" }) });
  expect(fallback.openGraph?.images).toEqual([{ url: "/news/heroes/mid-one/clean.webp", width: 1600, height: 900, alt: "The mid art" }]);
});
