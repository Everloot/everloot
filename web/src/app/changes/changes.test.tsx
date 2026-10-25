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
  expect(html).toContain('role="search"');
  expect(html).toContain("data-filter-bar");
  const lower = html.toLowerCase();
  for (const gone of ["robots rules", "data policy", "where these come from", "data-page-banner", 'aria-label="breadcrumb"']) expect(lower).not.toContain(gone);
  for (const word of ["sponsor", "advert", "premium", "subscribe", "buy now"]) expect(lower).not.toContain(word);
});

test("dense rows: date, type badge, title linked to the post's page on Everloot, author, region and a short excerpt, newest first", async () => {
  const html = await page();
  expect(html).toContain("data-dense");
  expect(rows(html)).toBe(4);
  expect(html.indexOf("1.60.1.70460")).toBeLessThan(html.indexOf("Synthetic beta notice"));
  expect(html).toMatch(/<time dateTime="2026-10-16T22:00:00.000Z"[^>]*>2026-10-16<\/time>/);
  expect(html).toMatch(/data-badge="neutral"[^>]*>Blue post</);
  expect(html).toMatch(/data-badge="neutral"[^>]*>Hotfix</);
  expect(html).toMatch(/<a href="\/changes\/us-1-synthetic-beta-notice-b"[^>]*>Synthetic beta notice &lt;b&gt;<\/a>/);
  expect(html).toContain('href="/changes/eu-2-wow-forever-hotfixes"');
  // The original is one click further, on the post's page.
  expect(html).not.toContain("forums.blizzard.com");
  expect(html).toContain("A short excerpt. Second sentence.");
  expect(html).toMatch(/title="Community Manager"[^>]*>Linxy</);
  expect(html).toContain("US forum");
  expect(html).toContain("EU forum");
  expect(html).not.toContain("Classic realm move");
});

test("on a phone the first column carries the title once, and the date sits in the muted line, not as the heading", async () => {
  const html = await page();
  const phone = [...html.matchAll(/<div data-phone-title[^>]*>(.*?)<\/div>(<div class="[^"]*sm:hidden">.*?<\/div>)/g)];
  expect(phone).toHaveLength(4);
  expect(phone[0][1]).toContain("WoW: Forever build 1.60.1.70460");
  expect(phone[0][2]).toContain("2026-10-17 · Build");
  expect(phone[1][1]).toContain('href="/changes/us-1-synthetic-beta-notice-b"');
  expect(phone[1][1]).toContain("Synthetic beta notice &lt;b&gt;");
  expect(phone[1][1]).not.toContain("2026-10-16");
  // The date is a table-cell time hidden on phones, so only the muted line shows it there.
  expect(html).toMatch(/<time dateTime="2026-10-16T22:00:00.000Z"[^>]*class="hidden [^"]*sm:inline"/);
});

test("markup in a title is escaped, not rendered", async () => {
  const html = await page();
  expect(html).toContain("Synthetic beta notice &lt;b&gt;");
  expect(html).not.toContain("<b>");
});

test("builds say they were first seen by Everloot, and link the diff when there is one", async () => {
  const html = await page({ show: "builds" });
  expect(rows(html)).toBe(2);
  expect(html).toContain("First seen by Everloot.");
  expect(html).toContain("What changed: not published yet.");
  expect(html).toContain('href="https://everloot.app/changes/diff/70450"');
  expect(html).not.toContain("Synthetic beta notice");
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

test("sorting is a link, and a malformed sort or page is a 404", async () => {
  const html = await page({ sort: "title" });
  expect(html).toContain('aria-sort="ascending"');
  expect(html.indexOf("Synthetic beta notice")).toBeLessThan(html.indexOf("WoW: Forever build 1.60.1.70460"));
  expect(html).toContain('href="/changes?sort=-title"');
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

test("posts and hotfixes are blue (title and author); builds keep the plain style", async () => {
  const html = await page();
  const rowsHtml = html.split("<tr").slice(1);
  const row = (text: string) => rowsHtml.find((r) => r.includes(text))!;
  for (const text of ["Synthetic beta notice", "WoW: Forever Hotfixes"]) {
    expect(row(text)).toContain('data-blue-post=""');
    expect(row(text)).toMatch(/<a href="\/changes\/[^"]+" class="text-blue-post[^"]*font-medium">/);
    expect(row(text)).toMatch(/class="text-blue-post[^"]*"[^>]*>(Linxy|Kaivax)</);
  }
  for (const text of ["1.60.1.70460", "1.60.1.70450"]) {
    expect(row(text)).not.toContain("data-blue-post");
    expect(row(text)).not.toContain("text-blue-post");
    expect(row(text)).toContain('<span class="font-medium">WoW: Forever build');
  }
});

test("a build has no page of its own: its title is plain text", async () => {
  const html = await page({ show: "builds" });
  expect(html).not.toMatch(/href="\/changes\/build/);
  expect(html).toContain('<span class="font-medium">WoW: Forever build 1.60.1.70460</span>');
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
  const tableRows = html.split("<tr").slice(1);
  expect(tableRows.filter((r) => r.includes("Raid Overview—Locations"))).toHaveLength(1);
  expect(tableRows.filter((r) => /Stress Test on (21 October|October 21)/.test(r)).map((r) => /Stress Test on (21 October|October 21)/.exec(r)![1])).toEqual(["October 21"]);
  expect(html).toContain('href="/changes/us-30552118-world-of-warcraft-forever-raid-overview-locations-raid-sizes-and-attunement"');
  expect(html).not.toContain("us-30552119");
  expect(html).not.toContain("eu-6443510");
  expect(tableRows.find((r) => r.includes("Raid Overview"))).toContain(">US · EU forum</span>");
  // A post on one forum still says just that forum.
  expect(tableRows.find((r) => r.includes("Synthetic beta notice"))).toContain(">US forum</span>");
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
