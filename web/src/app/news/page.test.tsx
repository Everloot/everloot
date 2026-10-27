import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { ChangeEntry } from "@/lib/changes";

// `loads` counts the timeline lookups, so a test can tell a page that never asked for the timeline.
const timeline = vi.hoisted((): { entries: ChangeEntry[]; loads: number } => ({ entries: [], loads: 0 }));
vi.mock("@/lib/changes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/changes")>();
  return { ...real, loadTimeline: async () => { timeline.loads++; return real.groupAnnouncements(timeline.entries); } };
});
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

// Blizzard's side of the timeline: a forum post a test post cites, a hotfix, a build and a Classic post.
const cited: ChangeEntry = {
  id: "forum:777", type: "post", game: "forever", at: "2026-10-23T18:00:00.000Z", title: "A Blizzard post", url: "https://us.forums.blizzard.com/en/wow/t/a-blizzard-post/777",
  author: "Kaivax", role: "Community Manager", category: "WoW: Forever General Discussion", source: "forum", region: "us", excerpt: "Words.",
};
const ENTRIES: ChangeEntry[] = [
  { ...cited, id: "forum:778", type: "hotfix", at: "2026-10-24T18:00:00.000Z", title: "WoW: Forever Hotfixes", url: "https://us.forums.blizzard.com/en/wow/t/hotfixes/9" },
  cited,
  { id: "build:b", type: "build", game: "forever", at: "2026-10-22T06:00:00.000Z", title: "WoW: Forever build 1.60.1.70532", url: null, version: "1.60.1.70532", diffUrl: null },
  { ...cited, id: "forum:779", game: "classic", title: "A Classic notice", url: "https://us.forums.blizzard.com/en/wow/t/classic/10" },
];
timeline.entries = ENTRIES;
afterEach(() => { vi.unstubAllEnvs(); timeline.entries = ENTRIES; timeline.loads = 0; });

const fixtures = () => { vi.stubEnv("NEWS_DIR", FIXTURES); vi.stubEnv("WIKI_DIR", WIKI); };

test("the hub lists published posts newest first, with the feed and the changes timeline apart", async () => {
  fixtures();
  const { default: NewsHub, generateMetadata } = await import("./page");
  const html = renderToStaticMarkup(await NewsHub());
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

test("under the cards, the newest Forever entries from the changes timeline, each linked to its page", async () => {
  fixtures();
  const { default: NewsHub } = await import("./page");
  const html = renderToStaticMarkup(await NewsHub());
  // The cards come first; Blizzard's entries follow them.
  expect(html.indexOf("data-news-featured")).toBeLessThan(html.indexOf('id="blizzard"'));
  const section = html.slice(html.indexOf('id="blizzard"'));
  expect(section).toContain(">From Blizzard</h2>");
  expect(section).toContain("Every change →");
  expect(section).toContain('href="/changes"');
  expect(section.indexOf("WoW: Forever Hotfixes")).toBeLessThan(section.indexOf("A Blizzard post"));
  expect(section).toContain('href="/changes/us-778-wow-forever-hotfixes"');
  expect(section).toContain('href="/changes/us-777-a-blizzard-post"');
  expect(section).toContain('<time dateTime="2026-10-23T18:00:00.000Z" class="whitespace-nowrap">October 23, 2026</time>');
  expect(section).toMatch(/>Hotfix · <\/span>/);
  // A build has no page: its title stays plain. Classic stays on /changes.
  expect(section).toContain('<span class="text-fg [overflow-wrap:anywhere]">WoW: Forever build 1.60.1.70532</span>');
  expect(section).not.toContain("A Classic notice");
  expect(section).not.toContain("Open the changes timeline");
  // With nothing on the timeline the section still points to the changes page.
  timeline.entries = [];
  expect(renderToStaticMarkup(await NewsHub())).toContain("Open the changes timeline");
});

test("an entry Everloot wrote never shows under From Blizzard, and is left out before the six newest are taken", async () => {
  fixtures();
  // The newest entry is a hand-written one (source "manual"), then seven of Blizzard's: forum posts, a Bluesky post and a build.
  const hour = (h: number) => new Date(Date.UTC(2026, 9, 26, 23 - h)).toISOString();
  const titles = ["Alpha notice", "Bravo maintenance", "Charlie hotfixes", "Delta podcast", "Echo stress test", "Foxtrot realms", "Golf roadmap"];
  timeline.entries = [
    { ...cited, id: "manual:everloot-note", type: "hotfix", source: "manual", region: undefined, at: hour(0), title: "Everloot's own note", url: "https://worldofwarcraft.blizzard.com/en-us/news/1" },
    ...titles.map((title, i): ChangeEntry => (i === 3
      ? { id: "build:x", type: "build", game: "forever", at: hour(i + 1), title, url: null, version: "1.60.1.70600", diffUrl: null }
      : i === 4
        ? { ...cited, id: "bluesky:3mzzz", source: "bluesky", region: undefined, category: "Bluesky", at: hour(i + 1), title, url: "https://bsky.app/profile/worldofwarcraft.blizzard.com/post/3mzzz" }
        : { ...cited, id: `forum:${900 + i}`, at: hour(i + 1), title, url: `https://us.forums.blizzard.com/en/wow/t/x/${900 + i}` })),
  ];
  const { default: NewsHub } = await import("./page");
  const section = renderToStaticMarkup(await NewsHub()).split('id="blizzard"')[1];
  expect(section).not.toContain("Everloot&#x27;s own note");
  expect(section).not.toContain("Everloot's own note");
  // Six of Blizzard's newest, the build and the Bluesky post among them; the seventh waits its turn.
  for (const title of titles.slice(0, 6)) expect(section).toContain(title);
  expect(section).not.toContain("Golf roadmap");
});

test("with no published post the hub says so, points to the changes and the feed, and stays out of search", async () => {
  vi.stubEnv("NEWS_DIR", mkdtempSync(join(tmpdir(), "news-")));
  const { default: NewsHub, generateMetadata } = await import("./page");
  const html = renderToStaticMarkup(await NewsHub());
  const empty = html.slice(html.indexOf("data-empty-state"), html.indexOf('id="blizzard"'));
  expect(empty).toContain("No posts yet.");
  expect(empty).toContain('href="/news/feed.xml"');
  expect(empty).toContain('href="/changes"');
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
  // Its one source is a Blizzard news article, which is never a stored post: no timeline lookup, no "On Everloot".
  expect(timeline.loads).toBe(0);
  expect(html).not.toContain("On Everloot");
  // The body's text runs at reading measure; the column, its headings and an in-article ad keep their width.
  expect(html).toContain('<div data-news-body="true" class="mt-8 [&amp;_[data-prose]&gt;:is(p,ul,ol,blockquote)]:max-w-[48ch]">');
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

test("a post citing a Blizzard forum post links its Everloot page; a post citing only other sites never loads the timeline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "news-sources-"));
  const post = (slug: string, sources: [string, string][]) => writeFileSync(join(dir, `${slug}.md`), [
    "---", `slug: ${slug}`, `title: ${slug}`, "summary: A summary long enough to read as one.", "author: Everloot Team", "published: 2026-10-25",
    "sources:", ...sources.flatMap(([title, url]) => [`  - title: "${title}"`, `    url: ${url}`]), "status: published", "---", "", "Body.",
  ].join("\n"));
  post("cites-forum", [["Blizzard forums: A Blizzard post", `${cited.url}/`], ["Wowhead: a story", "https://www.wowhead.com/news/1"]]);
  post("third-party", [["Wowhead: a story", "https://www.wowhead.com/news/1"], ["PC Gamer: a column", "https://www.pcgamer.com/a"]]);
  post("blizzard-article", [["Blizzard: an article", "https://news.blizzard.com/en-us/article/1"]]);
  vi.stubEnv("NEWS_DIR", dir); vi.stubEnv("WIKI_DIR", WIKI);
  const { default: NewsArticle } = await import("./[slug]/page");
  const render = async (slug: string) => renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug }) }));

  const forum = await render("cites-forum");
  expect(timeline.loads).toBe(1);
  expect(forum).toMatch(/>Blizzard forums: A Blizzard post<\/a> · <a href="\/changes\/us-777-a-blizzard-post"[^>]*>On Everloot<\/a>/);
  // Third-party sources, or a Blizzard host that is not the forums or Bluesky, can never be a stored post.
  for (const slug of ["third-party", "blizzard-article"]) {
    const html = await render(slug);
    expect(html).not.toContain("On Everloot");
    expect(html).toContain('id="sources"');
  }
  expect(timeline.loads).toBe(1);
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
  const hub = renderToStaticMarkup(await NewsHub());
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

test("cards name the publishers a post cites, mark an unconfirmed post with the dashed edge, and keep WoW's casing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "news-cards-"));
  const post = (slug: string, published: string, extra: string[]) => writeFileSync(join(dir, `${slug}.md`), ["---", `slug: ${slug}`, `title: ${slug}`, "summary: A summary long enough to read as one.", "author: Everloot Team", `published: ${published}`, ...extra, "status: published", "---", "", "Body."].join("\n"));
  post("lead", "2026-10-26", ["tags: [datamine, unconfirmed]", "sources:", '  - title: "Wowhead: a story"', "    url: https://www.wowhead.com/news/1"]);
  post("cited", "2026-10-25", ["tags: [wow-forever]", "sources:", '  - title: "Blizzard: an article"', "    url: https://news.blizzard.com/a", '  - title: "Blizzard forums: a thread"', "    url: https://us.forums.blizzard.com/en/wow/t/x/1"]);
  post("plain", "2026-10-24", ["tags: [site]"]);
  vi.stubEnv("NEWS_DIR", dir); vi.stubEnv("WIKI_DIR", WIKI);
  const { default: NewsHub } = await import("./page");
  const hub = renderToStaticMarkup(await NewsHub());
  const card = (slug: string) => hub.slice(hub.indexOf(`href="/news/${slug}"`), hub.indexOf("</a>", hub.indexOf(`href="/news/${slug}"`)));
  // The same names the post's byline badge gives (#449's sourceNames), on the featured card and the grid's.
  expect(card("lead")).toContain('<p data-news-sources="true" class="text-meta text-muted">Source: Wowhead</p>');
  expect(card("cited")).toContain('<p data-news-sources="true" class="text-meta text-muted mt-auto pt-1">Source: Blizzard, Blizzard forums</p>');
  expect(card("plain")).not.toContain("data-news-sources");
  // Dashed means unconfirmed; the chip says so to a screen reader too.
  expect(card("lead")).toMatch(/<span data-news-chip="true" title="Unconfirmed" class="[^"]*border-dashed border-edge">Datamine<span class="sr-only">, unconfirmed<\/span><\/span>/);
  expect(card("cited")).toMatch(/<span data-news-chip="true" class="[^"]*border-line">WoW forever<\/span>/);
  expect(hub).not.toContain(">Wow forever<");
});

test("news ad units: sidebar on posts, in-article only after the third paragraph of a long post, one before related", async () => {
  fixtures();
  vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
  const { default: NewsArticle } = await import("./[slug]/page");
  const { AD_SLOTS } = await import("@/components/AdSlot");
  const html = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: "test-post" }) }));
  expect(html).toContain("data-reading-rail");
  expect(html).toContain(`data-ad-slot="${AD_SLOTS.sidebar}"`);
  expect(html).toContain("data-ad-end-of-article");
  const end = html.indexOf("data-ad-end-of-article");
  const related = html.indexOf('id="related"');
  if (related >= 0) expect(end).toBeLessThan(related);
  const paragraphs = (html.split("data-ad-in-article")[0].match(/<p[ >]/g) ?? []).length;
  if (html.includes("data-ad-in-article")) expect(paragraphs).toBeGreaterThanOrEqual(3);
});

test("no ad markup at all without an AdSense client", async () => {
  fixtures();
  const { default: NewsArticle } = await import("./[slug]/page");
  const html = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: "test-post" }) }));
  expect(html).not.toContain("adsbygoogle");
});
