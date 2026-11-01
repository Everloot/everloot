import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("news mounts no ads, including a CSS-hidden rail, with an AdSense client configured", async () => {
  fixtures();
  vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
  const { default: NewsArticle } = await import("./[slug]/page");
  const html = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: "test-post" }) }));
  expect(html).not.toContain("data-reading-rail");
  expect(html).not.toContain("data-ad-slot");
  expect(html).not.toContain("data-ad-end-of-article");
  expect(html).not.toContain("data-ad-in-article");
});

test("no ad markup at all without an AdSense client", async () => {
  fixtures();
  const { default: NewsArticle } = await import("./[slug]/page");
  const html = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: "test-post" }) }));
  expect(html).not.toContain("adsbygoogle");
});

// Reviewed published corpus before adding hero fields: every editorial byte stays unchanged.
const CORPUS = {
  "wow-forever-beta-stats-8-million-characters": "3ed6fba6a5fccda62da5aeff728a9ba9b3207d0781bece4539460eeb6a0f33bf",
  "wow-forever-launch-week-checklist-nov-4": "2dcb196a7aa4b047027ca93dc70cbd3738695e66c1f390be415821920d112113",
  "wow-forever-layering-world-refresh-fixes": "c009712f88aceb6b144045abf0048d6aed008dd0ddac030814384b6ead175a66",
  "wow-forever-4-month-patch-cadence": "5b7d9982b39d9ae78f77a7fd187f70f88203d2d6a576c6c369cf88e93d9f9ab8",
  "datamined-30-xp-potions-patch-12-1-7-not-forever": "7abd75147282a5dbe7fdb1402272fb6f7c563adaa67e3eff3d38ba0e5d964035",
  "item-names-are-live": "f76f222209e2bd46d5b4fb5ca5836ced6c55ed158016340dfcc6d4c0859782bc",
  "wow-forever-beta-closed-priority-fixes-podcast": "f4a7e82971211c8b3a7942e8be6360dafbb770eddaff55e1c2afd9cf29e09a34",
  "wow-forever-beta-ends-world-bosses-legendaries-scourge": "22a42bc8330ab9089341613b0d7d7dfe35bae8ea10a13130baeaaaf72cd484f7",
  "wow-forever-beta-over-endgame-question": "2140d316d578b43684c8a306c135aba9a36434301b9687fdf1f3454f206f49a8",
  "wow-forever-character-creation-opens-tomorrow-checklist": "f73c200327bd9fdbd8b0c15066727329d83e5f7b8d3a94c57b7ee2823513d847",
  "wow-forever-journey-episode-1-norway": "132576ceda1e06c3c133f56e71c619c519e185b843b51fd37152c49e270166c8",
  "wow-forever-molten-core-new-mechanics-raid-tease": "b9f2a33a4027f45e45dc19c20c4f97e559d752678ae18f5cb21cf70648b901c9",
  "wow-forever-racial-changes-character-creation": "d4f0eae6d6160c50dfc8169ee6625fc651d16051377216c02e241efccebacc7f",
  "wow-forever-restricted-name-bug-fix": "345eae53307068917a95ed036ae00665f4d11f1961e5b36fb2d0b2fd289f0a0d",
  "wow-forever-name-reservations-how-to-reserve": "e6ef0ebd510cc478ff17bea1667f8d82d41601739f92ceeca652487219b48e53",
  "wow-forever-two-part-names-explained": "f2eabd19f8208c26f142f6dbee7365c89f83963e348fccde73eaebb935cd296e",
  "wow-forever-rulesets-explained-pvp-rp-pvp-hardcore": "04ec3dc8ac735626be9ebec24d742fbe9ebe6d984c108e724e3f0db4e59e4905",
  "wow-weekly-forever-name-reservations-zulaman-hallows-end": "64c5c8d7dff54cbeaa1b1030179939e01207d0a92e79b5b59b655e3f4c8815be"
};

test("all 18 published posts retain their editorial source and survive pages, hub, RSS and sitemap with nine heroes", async () => {
  const dir = fileURLToPath(new URL("../../../../kb/news/", import.meta.url));
  vi.stubEnv("NEWS_DIR", dir); vi.stubEnv("WIKI_DIR", WIKI);
  vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT", "ca-pub-test");
  const { loadNews, publishedPosts, newsSitemapPaths, bodyForPage } = await import("@/lib/news");
  const news = loadNews(dir);
  const posts = publishedPosts(news);
  const slugs = Object.keys(CORPUS).sort();
  expect(posts.map((p) => p.slug).sort()).toEqual(slugs);
  expect(posts.filter((p) => p.hero)).toHaveLength(9);
  const { default: NewsArticle, generateStaticParams } = await import("./[slug]/page");
  const { default: NewsHub } = await import("./page");
  const { GET } = await import("./feed.xml/route");
  expect(generateStaticParams().map((p) => p.slug).sort()).toEqual(slugs);
  const hub = renderToStaticMarkup(await NewsHub());
  const rss = await GET().text();
  const sitemap = newsSitemapPaths(news).map((p) => p.path);
  expect(hub.match(/data-news-post=/g)).toHaveLength(18);
  expect(rss.match(/<item>/g)).toHaveLength(18);
  expect(sitemap).toHaveLength(19);
  expect(hub).not.toContain("data-ad-slot");
  for (const post of posts) {
    const source = readFileSync(join(dir, `${post.slug}.md`), "utf8").replace(/\r\n/g, "\n");
    const withoutHero = source.replace(/^hero:\n(?:  .*\n)+/m, "");
    expect(createHash("sha256").update(withoutHero).digest("hex"), post.slug).toBe(CORPUS[post.slug as keyof typeof CORPUS]);
    const href = `/news/${post.slug}`;
    expect(hub).toContain(`href="${href}"`);
    expect(rss).toContain(`<link>https://everloot.app${href}</link>`);
    expect(sitemap).toContain(href);
    const html = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: post.slug }) }));
    expect(html).toContain(`data-author="true"`);
    expect(html.match(/id="sources"/g) ?? []).toHaveLength(post.sources.length ? 1 : 0);
    expect(html.match(/id="related"/g)).toHaveLength(1);
    expect(html.match(/data-related-card=/g)).toHaveLength(3);
    const sources = html.split('<section aria-labelledby="sources"')[1]?.split("</section>")[0] ?? "";
    for (const source of post.sources) expect(sources).toContain(`href="${source.url.replace(/&/g, "&amp;")}"`);
    expect(html).not.toContain("data-ad-slot");
    expect(html).not.toContain("data-ad-in-article");
    expect(html).not.toContain("data-reading-rail");
    const related = html.split('<section aria-labelledby="related"')[1].split("</section>")[0];
    for (const block of bodyForPage(post).relatedBlocks) {
      if (block.type !== "list") continue;
      for (const run of block.items.flat()) {
        if (run.kind !== "text") continue;
        for (const link of run.text.matchAll(/\]\((\/(?:changes|database\/zones)[^)]*)\)/g)) expect(related).toContain(`href="${link[1]}"`);
      }
    }
  }
  const weekly = news.get("wow-weekly-forever-name-reservations-zulaman-hallows-end")!;
  expect(weekly.hero?.alt).toHaveLength(203);
  for (const slug of ["wow-forever-beta-over-endgame-question", "wow-forever-rulesets-explained-pvp-rp-pvp-hardcore"]) {
    expect(news.get(slug)?.updated).toBe("2026-10-26");
  }
});

test("Related mixed items keep authored destinations and CTA while draft and unknown news links stay text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "news-related-"));
  writeFileSync(join(dir, "mixed.md"), ["---", "slug: mixed", "title: Mixed", "summary: Related destinations stay together.", "author: Everloot Team", "published: 2026-10-25", "status: published", "---", "Body.", "## Related", "- [Self](/news/mixed)", "- [Missing](/news/missing) and [Changes](/changes)", "- [Draft](/news/test-draft) and [Zone](/database/zones/12)", "", "**Try:** [calculator](/tools/talents)."].join("\n"));
  writeFileSync(join(dir, "test-draft.md"), readFileSync(join(FIXTURES, "test-draft.md"), "utf8"));
  vi.stubEnv("NEWS_DIR", dir); vi.stubEnv("WIKI_DIR", WIKI);
  const { default: NewsArticle } = await import("./[slug]/page");
  const html = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: "mixed" }) }));
  expect(html.match(/id="related"/g)).toHaveLength(1);
  for (const href of ["/changes", "/database/zones/12", "/tools/talents"]) expect(html).toContain(`href="${href}"`);
  for (const href of ["/news/missing", "/news/test-draft", "/news/mixed"]) expect(html).not.toContain(`href="${href}"`);
  expect(html).toContain("Missing and");
  expect(html).toContain("Draft and");
  expect(html).toContain("Try:");
});

test("a figure draws a lazy image at its fixed size with its alt text and an optional caption; one the check refuses draws nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "news-figures-"));
  writeFileSync(join(dir, "figures.md"), ["---", "slug: figures", "title: Figures", "summary: A post with figures.", "author: Everloot Team", "published: 2026-10-25", "status: published", "---", "Before the map.", "", '![The zone map with the camps marked](/news/figures/figures/map.webp "Where the camps are")', "", "![A camp at dusk](/news/figures/figures/camp.webp)", "", "![Elsewhere](https://example.com/a.webp)", "", "![](/news/figures/figures/no-alt.webp)", "", "After the map."].join("\n"));
  vi.stubEnv("NEWS_DIR", dir); vi.stubEnv("WIKI_DIR", WIKI);
  const { default: NewsArticle } = await import("./[slug]/page");
  const html = renderToStaticMarkup(await NewsArticle({ params: Promise.resolve({ slug: "figures" }) }));
  const figures = html.match(/<figure data-news-figure[^]*?<\/figure>/g) ?? [];
  expect(figures).toHaveLength(2);
  expect(figures[0]).toMatch(/<img src="\/news\/figures\/figures\/map\.webp" alt="The zone map with the camps marked" width="1600" height="900" loading="lazy" decoding="async"/);
  expect(figures[0]).toMatch(/<figcaption[^>]*>Where the camps are<\/figcaption>/);
  expect(figures[1]).toContain('alt="A camp at dusk"');
  expect(figures[1]).not.toContain("<figcaption");
  for (const refused of ["example.com", "no-alt", "Elsewhere"]) expect(html).not.toContain(refused);
  expect(html.indexOf("Before the map.")).toBeLessThan(html.indexOf("map.webp"));
  expect(html.indexOf("camp.webp")).toBeLessThan(html.indexOf("After the map."));
});
