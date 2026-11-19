import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { ChangeEntry } from "@/lib/changes";

const timeline = vi.hoisted((): { entries: ChangeEntry[] } => ({ entries: [] }));
vi.mock("@/lib/changes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/changes")>();
  // The real loadTimeline groups the bundled posts; the fixtures go through the same grouping.
  return { ...real, loadTimeline: () => real.groupAnnouncements(timeline.entries) };
});
vi.mock("next/link", () => ({
  default: ({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

import ChangesPage from "./page";
import ChangeList from "./change-list";
import { GET } from "./feed.xml/route";

const entries: ChangeEntry[] = [
  { id: "build:b", type: "build", game: "forever", at: "2026-10-17T06:00:00.000Z", title: "WoW: Forever build 1.60.1.70460", url: null, version: "1.60.1.70460", diffUrl: null },
  {
    id: "forum:1", type: "post", game: "forever", at: "2026-10-16T22:00:00.000Z", title: "Synthetic beta notice <b>", url: "https://us.forums.blizzard.com/en/wow/t/x/1",
    author: "Linxy", role: "Community Manager", category: "WoW: Forever Beta Discussion", source: "forum", region: "us", excerpt: "A short excerpt. Second sentence.",
  },
  { id: "forum:eu:2", type: "hotfix", game: "forever", at: "2026-10-16T18:00:00.000Z", title: "WoW: Forever Hotfixes", url: "https://eu.forums.blizzard.com/en/wow/t/y/2", author: "Kaivax", role: "Community Manager", category: "WoW: Forever", source: "forum", region: "eu", excerpt: "Fixed a thing." },
  { id: "forum:3", type: "post", game: "classic", at: "2026-10-15T18:00:00.000Z", title: "Classic realm move", url: "https://us.forums.blizzard.com/en/wow/t/z/3", author: "Fwoibles", role: "WoW Developer", category: "WoW Classic", source: "forum", region: "us", excerpt: "Moving." },
  { id: "build:c", type: "build", game: "forever", at: "2026-09-01T06:00:00.000Z", title: "WoW: Forever build 1.60.1.70450", url: null, version: "1.60.1.70450", diffUrl: "https://everloot.app/changes/diff/70450" },
];
timeline.entries = entries;

const page = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await ChangesPage({ searchParams: Promise.resolve(params) }));
const rows = (html: string) => (html.match(/data-change-row/g) ?? []).length;

const manualRow: ChangeEntry = { id: "manual:fixture", source: "manual", type: "post", game: "retail", at: "2026-10-23T00:00:00.000Z", title: "Retail source fixture", summary: "Everloot summary fixture.", url: "https://us.forums.blizzard.com/en/wow/t/example/123/4" };
test("compact ChangeList manual rows show Everloot summary and clickable original with a plain Post label", () => {
  const html = renderToStaticMarkup(<ChangeList entries={[manualRow]} types />);
  expect(html).toContain("Summary by Everloot");
  expect(html).toContain(manualRow.summary);
  expect(html).toContain(`href="${manualRow.url}"`);
  expect(html).toContain("Original source");
  expect(html).not.toContain("Blue post");
  expect(html).not.toContain("/changes/manual");
  expect(html).toContain('dateTime="2026-10-23"');
});
test("manual retail rows link the original from the title, say Everloot wrote the summary, and keep day precision", async () => {
  timeline.entries = [...entries, manualRow];
  const html = await page({ game: "retail" });
  const original = /<a href="([^"]+)"[^>]*>Retail source fixture<\/a>/.exec(html);
  expect(original?.[1]).toBe(manualRow.url);
  expect(html).toContain("Summary by Everloot; the title links the original source. Everloot summary fixture.");
  expect(html).toContain('dateTime="2026-10-23"');
  expect(html).toContain('"datePublished":"2026-10-23"');
  expect(html).not.toContain("2026-10-23T00:00");
  expect(html).not.toContain(">Blue post</span>");
  expect(html).not.toContain("/changes/manual");
});
test("retail/all include manual rows while default and Forever RSS stay isolated", async () => {
  timeline.entries = [...entries, manualRow];
  expect(await page()).not.toContain(manualRow.title);
  expect(await page({ game: "all" })).toContain(manualRow.title);
  expect(await page({ game: "retail" })).toContain(manualRow.title);
  expect(await (await GET()).text()).not.toContain(manualRow.title);
});

afterEach(() => {
  timeline.entries = entries;
  vi.useRealTimers();
});

test("one compact title row: the name Changes, one intro line, the latest build and a small RSS link; no breadcrumb, banner or provenance", async () => {
  const html = await page();
  expect(html).toMatch(/<h1[^>]*>Changes<\/h1>/);
  expect(html).toContain("Blue posts, hotfixes and new game builds, newest first.");
  expect(html).toContain("Latest build: WoW: Forever 1.60.1.70460, first seen by Everloot on 2026-10-17.");
  expect(html).toMatch(/<a href="\/changes\/feed.xml"[^>]*>RSS<\/a>/);
  // Everloot's own write-ups are one click away.
  expect(html).toMatch(/<a href="\/news"[^>]*>Everloot news<\/a>/);
  expect(html).toContain('role="search"');
  expect(html).toContain("data-filter-bar");
  const lower = html.toLowerCase();
  for (const gone of ["robots rules", "data policy", "where these come from", "data-page-banner", 'aria-label="breadcrumb"']) expect(lower).not.toContain(gone);
  for (const word of ["sponsor", "advert", "premium", "subscribe", "buy now"]) expect(lower).not.toContain(word);
});

const cards = (html: string) => [...html.matchAll(/<li [^>]*data-card[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);

test("one column of cards: date, type chip, title linked to the post's page on Everloot, author · where and the excerpt, newest first", async () => {
  const html = await page();
  expect(html).toContain("data-change-feed");
  expect(html).not.toContain("<table");
  expect(rows(html)).toBe(4);
  expect(html.indexOf("1.60.1.70460")).toBeLessThan(html.indexOf("Synthetic beta notice"));
  expect(html).toMatch(/<time dateTime="2026-10-16T22:00:00.000Z"[^>]*>2026-10-16<\/time>/);
  expect(html).toMatch(/<span data-type="true"><span data-badge="neutral"[^>]*>Blue post<\/span><\/span>/);
  expect(html).toMatch(/<span data-type="true"><span data-badge="neutral"[^>]*>Hotfix<\/span><\/span>/);
  expect(html).toMatch(/<a href="\/changes\/us-1-synthetic-beta-notice-b"[^>]*>Synthetic beta notice &lt;b&gt;<\/a>/);
  expect(html).toContain('href="/changes/eu-2-wow-forever-hotfixes"');
  // The original is one click further, on the post's page.
  expect(html).not.toContain("forums.blizzard.com");
  // The excerpt is in the body colour, not the blue of the title.
  expect(html).toContain('<p data-excerpt="true" class="text-cell text-fg">A short excerpt. Second sentence.</p>');
  expect(html).toContain(">Linxy (Community Manager) · US forum</p>");
  expect(html).toContain(">Kaivax (Community Manager) · EU forum</p>");
  expect(html).not.toContain("Classic realm move");
  // The title is each card's only link.
  for (const card of cards(html)) expect(card.match(/<a /g)?.length ?? 0).toBeLessThanOrEqual(1);
});
test("every card carries its own date, whatever the sort", async () => {
  for (const sort of [undefined, "date", "type", "-type", "title", "-title", "author", "source"]) {
    const html = await page(sort ? { sort } : {});
    expect(html.match(/<time dateTime="[^"]+"[^>]*>\d{4}-\d{2}-\d{2}<\/time>/g), sort).toHaveLength(4);
  }
});
test("pages keep the sort: newest first by default, oldest first on request", async () => {
  const firstTitle = (html: string) => /<h2[^>]*><a href="\/changes\/[^"]+"[^>]*>([^<]+)<\/a>/.exec(html)![1];
  timeline.entries = Array.from({ length: 120 }, (_, i) => ({ ...entries[1], id: `forum:${5000 + i}`, title: `Post ${i}`, at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  for (const [params, first] of [[{}, "Post 119"], [{ page: "2" }, "Post 69"], [{ sort: "-date", page: "2" }, "Post 69"], [{ sort: "date" }, "Post 0"], [{ sort: "date", page: "2" }, "Post 50"]] as const) {
    expect(firstTitle(await page(params))).toBe(first);
  }
});
test("markup in a title is escaped, not rendered", async () => {
  const html = await page();
  expect(html).toContain("Synthetic beta notice &lt;b&gt;");
  expect(html).not.toContain("<b>");
});

test("builds say they were first seen by Everloot, link the diff from the title when there is one, and print no empty field when there is not", async () => {
  const html = await page({ show: "builds" });
  expect(rows(html)).toBe(2);
  expect(html).toContain("First seen by Everloot.");
  expect(html).not.toContain("not published yet");
  expect(html).toMatch(/<a href="https:\/\/everloot.app\/changes\/diff\/70450"[^>]*>WoW: Forever build 1.60.1.70450<\/a>/);
  expect(html).not.toContain("Synthetic beta notice");
  expect(html).not.toContain("data-byline");
});
test("the type filter narrows the list, is lit, and unknown values fall back to everything", async () => {
  const hotfixes = await page({ show: "hotfixes" });
  expect(rows(hotfixes)).toBe(1);
  expect(hotfixes).toContain("WoW: Forever Hotfixes");
  expect(hotfixes).toContain("Type: <span");
  expect(hotfixes).toContain('href="/changes"');
  const posts = await page({ show: "posts" });
  expect(posts).toContain("Synthetic beta notice");
  expect(posts).not.toContain("WoW: Forever Hotfixes");
  expect(rows(await page({ show: "nonsense" }))).toBe(4);
});

test("Classic is added only when asked for, and every filter link keeps the others", async () => {
  const both = await page({ game: "all", show: "posts" });
  expect(both).toContain("Classic realm move");
  expect(both).toContain('href="/changes?show=posts"');
  expect(rows(await page({ game: "classic" }))).toBe(1);
  expect(await page({ show: "posts" })).toContain('href="/changes?show=posts&amp;game=all"');
  expect(await page({ show: "posts", region: "us" })).toContain('href="/changes?show=posts&amp;region=us&amp;author=Linxy"');
});

test("region and author narrow to forum posts from that forum or that person", async () => {
  const eu = await page({ region: "eu" });
  expect(rows(eu)).toBe(1);
  expect(eu).toContain("WoW: Forever Hotfixes");
  expect(rows(await page({ region: "mars" }))).toBe(4);
  const linxy = await page({ author: "Linxy" });
  expect(rows(linxy)).toBe(1);
  expect(linxy).toContain("Author: <span");
});

test("the date presets count back from today", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
  expect(rows(await page({ days: "7" }))).toBe(3);
  expect(rows(await page({ days: "90" }))).toBe(4);
  expect(rows(await page({ days: "5" }))).toBe(4);
});

test("the search box matches title, excerpt and author, and keeps the other filters as hidden fields", async () => {
  expect(rows(await page({ q: "excerpt" }))).toBe(1);
  expect(rows(await page({ q: "kaivax" }))).toBe(1);
  const html = await page({ q: "1.60.1", show: "builds" });
  expect(rows(html)).toBe(2);
  expect(html).toContain('<input type="hidden" name="show" value="builds"/>');
  expect(html).toContain('value="1.60.1"');
});

test("sorting is a menu of links above the feed, and a malformed sort or page is a 404", async () => {
  const plain = await page();
  expect(plain).toContain('data-filter="sort"');
  expect(plain).toContain('href="/changes?sort=title"');
  expect(plain).toContain('href="/changes?sort=date"');
  const html = await page({ sort: "title" });
  expect(html).toContain("Sort: <span");
  expect(html.indexOf("Synthetic beta notice")).toBeLessThan(html.indexOf("WoW: Forever build 1.60.1.70460"));
  // Newest first is the reset choice: the plain address.
  expect(html).toContain('href="/changes"');
  await expect(page({ sort: "nope" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page({ page: "0" })).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page({ page: "2" })).rejects.toThrow("NEXT_NOT_FOUND");
});
test("more than a page of entries pages at 50 with a numbered pager", async () => {
  timeline.entries = Array.from({ length: 120 }, (_, i) => ({ ...entries[1], id: `forum:p${i}`, title: `Post ${i}`, at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const first = await page();
  expect(rows(first)).toBe(50);
  expect(first).toContain("1–50");
  expect(first).toContain('href="/changes?page=2"');
  expect(rows(await page({ page: "3" }))).toBe(20);
});

test("empty states: nothing recorded at all, or no match with the filters as removable chips", async () => {
  timeline.entries = [];
  const none = await page();
  expect(none).toContain("Nothing recorded yet.");
  expect(none).not.toContain("data-result-strip");
  timeline.entries = entries;
  const nomatch = await page({ show: "hotfixes", region: "us" });
  expect(nomatch).toContain("No entries match these filters.");
  expect(nomatch).toContain('href="/changes?region=us"');
  expect(nomatch).toContain('href="/changes?show=hotfixes"');
  expect(nomatch).toContain("Clear filters");
});

test("the RSS feed is Forever only, is RSS, and links each post's page on Everloot with the original kept in the item", async () => {
  const response = await GET();
  expect(response.headers.get("content-type")).toContain("application/rss+xml");
  const xml = await response.text();
  expect(xml).toContain("<rss version=\"2.0\"");
  expect(xml).toContain("<link>https://everloot.app/changes/us-1-synthetic-beta-notice-b</link>");
  expect(xml).toContain("Original: https://us.forums.blizzard.com/en/wow/t/x/1</description>");
  expect(xml).toContain("<link>https://everloot.app/changes/eu-2-wow-forever-hotfixes</link>");
  expect(xml).not.toContain("Classic realm move");
  expect((xml.match(/<item>/g) ?? []).length).toBe(4);
});

test("posts and hotfixes have a blue title and edge; builds keep the plain style", async () => {
  const html = await page();
  const card = (text: string) => cards(html).find((c) => c.includes(text))!;
  for (const text of ["Synthetic beta notice", "WoW: Forever Hotfixes"]) {
    expect(card(text)).toContain('data-blue-post=""');
    expect(card(text)).toContain("border-l-blue-post");
    expect(card(text)).toMatch(/<a href="\/changes\/[^"]+" class="[^"]*text-blue-post[^"]*">/);
  }
  for (const text of ["1.60.1.70460", "1.60.1.70450"]) {
    expect(card(text)).not.toContain("data-blue-post");
    expect(card(text)).not.toContain("text-blue-post");
  }
});
test("a build has no page of its own: without a diff its title is plain text", async () => {
  const html = await page({ show: "builds" });
  expect(html).not.toMatch(/href="\/changes\/build/);
  expect(html).toMatch(/<span class="font-semibold text-fg[^"]*">WoW: Forever build 1.60.1.70460<\/span>/);
});
// One announcement on both forums, and twice on the US forum (two threads), as on 2026-10-20.
const raid = "World of Warcraft: Forever Raid Overview—Locations, Raid Sizes, and Attunement";
const copy = (id: string, region: "us" | "eu", topicId: number, at: string, over: Partial<ChangeEntry> = {}): ChangeEntry => ({
  id, type: "post", game: "forever", at, title: raid, url: `https://${region}.forums.blizzard.com/en/wow/t/raid/${topicId}`, author: "Blizzard Entertainment",
  role: "Blizzard News", category: "WoW: Forever General Discussion", source: "forum", region, excerpt: "Raids unlock on December 9.", topicId, postNumber: 1, startedThread: true, ...over,
});
const announcement = [
  copy("forum:eu:6443510", "eu", 636735, "2026-10-20T19:00:16.744Z", { author: "Euro CM" }),
  copy("forum:30552119", "us", 2387821, "2026-10-20T19:00:16.705Z"),
  copy("forum:30552118", "us", 2387820, "2026-10-20T19:00:15.102Z"),
  copy("forum:eu:6443635", "eu", 636749, "2026-10-20T20:31:37.175Z", { title: "Heads Up -- WoW Forever Stress Test on 21 October", author: "Kaivax" }),
  copy("forum:30553354", "us", 2387920, "2026-10-20T20:30:35.322Z", { title: "Heads Up -- WoW Forever Stress Test on October 21", author: "Kaivax" }),
];

test("an announcement posted on both forums is one row, linking the US copy, with every forum it was posted on", async () => {
  timeline.entries = [...entries, ...announcement];
  const html = await page();
  expect(rows(html)).toBe(4 + 2);
  const tableRows = cards(html);
  expect(tableRows.filter((r) => r.includes("Raid Overview—Locations"))).toHaveLength(1);
  expect(tableRows.filter((r) => /Stress Test on (21 October|October 21)/.test(r)).map((r) => /Stress Test on (21 October|October 21)/.exec(r)![1])).toEqual(["October 21"]);
  expect(html).toContain('href="/changes/us-30552118-world-of-warcraft-forever-raid-overview-locations-raid-sizes-and-attunement"');
  expect(html).not.toContain("us-30552119");
  expect(html).not.toContain("eu-6443510");
  expect(tableRows.find((r) => r.includes("Raid Overview"))).toContain(" · US · EU forum</p>");
  // A post on one forum still says just that forum.
  expect(tableRows.find((r) => r.includes("Synthetic beta notice"))).toContain(" · US forum</p>");
});

test("filters and counts count announcements; the region filter finds one posted in that region", async () => {
  timeline.entries = [...entries, ...announcement];
  const eu = await page({ region: "eu" });
  // The EU hotfix and both announcements, each shown by its US copy.
  expect(rows(eu)).toBe(3);
  expect(eu).toContain('href="/changes/us-30552118-');
  expect(eu).toContain("US · EU forum");
  expect(rows(await page({ region: "us" }))).toBe(3);
  const html = await page();
  const count = (label: string) => new RegExp(`>${label}</span><span class="tabular-nums text-muted">(\\d+)<`).exec(html)?.[1];
  expect(count("EU forum")).toBe("3");
  expect(count("US forum")).toBe("3");
  expect(count("Blue posts")).toBe("3");
  expect(html).toContain("Changes, WoW: Forever: 6");
  // The author of the EU copy finds the announcement too, counted once.
  expect(rows(await page({ author: "Euro CM" }))).toBe(1);
  expect(count("Euro CM")).toBe("1");
  expect(count("Kaivax")).toBe("2");
  // The search reads every copy's wording.
  expect(rows(await page({ q: "on 21 October" }))).toBe(1);
});

test("the RSS feed has one item per announcement, linking the US copy's page", async () => {
  timeline.entries = [...entries, ...announcement];
  const xml = await (await GET()).text();
  expect((xml.match(/<item>/g) ?? []).length).toBe(4 + 2);
  expect(xml.match(/<title>Blue post: World of Warcraft: Forever Raid Overview/g)).toHaveLength(1);
  expect(xml).toContain("<link>https://everloot.app/changes/us-30552118-world-of-warcraft-forever-raid-overview-locations-raid-sizes-and-attunement</link>");
  expect(xml).not.toContain("eu-6443635");
});

test("with the game art, a spell a post names gets its icon, its tooltip and a link to where the site shows it", async () => {
  const { siteManifest } = await import("@/lib/game-assets.fixture");
  const base = "https://assets.example.test/wow_classic_beta-70450-84bea423";
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", base);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(siteManifest)));
  timeline.entries = [{ ...entries[1], excerpt: "Battle Shout now reaches the whole raid." }];
  const html = await page();
  expect(html).toMatch(/data-spell-tip[^>]*><img[^>]*icons\/8001\.webp[^>]*alt=""[^>]*\/?><a href="\/tools\/raid"[^>]*aria-describedby="[^"]+"[^>]*>Battle Shout<\/a>/);
  expect(html).toContain("Battle Shout. Raises attack power by 20 for 2 min. found in game files, unconfirmed · build 1.60.1.70450.");
  expect(html).toContain("</span></span> now reaches the whole raid.");
  // The credit is site-wide (footer and /methodology#credits), not a line on the page.
  expect(html).not.toContain("data-game-credit");
  expect(html).not.toContain("data-source-line");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Without the asset URL the same excerpt is plain text.
  expect(await page()).toContain(">Battle Shout now reaches the whole raid.</p>");
});

test("news announcements link to Blizzard from the title and name the news source", async () => {
  timeline.entries = [{ id: "news:24315281", source: "news", type: "hotfix", game: "forever",
    at: "2026-11-17T02:17:13.000Z", title: "Synthetic Forever hotfix announcement", author: "Blizzard Entertainment",
    url: "https://news.blizzard.com/en-us/article/24315281/wow-forever-hotfixes-november-16-2026" }];
  const html = await page();
  expect(html).toMatch(/<a href="https:\/\/news.blizzard.com\/en-us\/article\/24315281\/wow-forever-hotfixes-november-16-2026"[^>]*>Synthetic Forever hotfix announcement<\/a>/);
  expect(html).toContain(">Blizzard Entertainment · Blizzard News</p>");
  // No body: no empty excerpt.
  expect(html).not.toContain("data-excerpt");
  expect(await page({ region: "us" })).not.toContain("Synthetic Forever hotfix announcement");
});
test("builds are plain cards without the blue edge", async () => {
  timeline.entries = [entries[0]];
  const html = await page();
  expect(rows(html)).toBe(1);
  expect(html).toContain("First seen by Everloot.");
  expect(html).not.toContain("border-l-blue-post");
  expect(html).not.toContain("data-blue-post");
});
