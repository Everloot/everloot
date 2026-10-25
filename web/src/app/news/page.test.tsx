import { mkdtempSync } from "node:fs";
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
  expect(html).toMatch(/<span data-author(?:="[^"]*")?>Test Author<\/span>/);
  expect(html).toContain('<time dateTime="2026-10-24">October 24, 2026</time>');
  expect(html).toContain('Updated <time dateTime="2026-10-25">October 25, 2026</time>');
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
