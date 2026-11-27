import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { emptyStore, loadStore, mergePosts, parseBlueskyFeed, type BluePost } from "../src/blue-posts.js";
import { blueThreads, buildTimeline, filterTimeline, foldTitleDay, forumRegions, fullerCopy, groupAnnouncements, handleRecentChanges, manualEntries, parseFilter, postDay, renderFeed, sameAnnouncement, sameBody, type BuildLike } from "../src/changes.js";
import { clampExcerpt, safeHttpUrl } from "../src/text-safety.js";
import { postPath } from "../src/changes.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/blue/${name}`, import.meta.url), "utf8"));
const seen = new Date("2026-10-17T12:00:00Z");
const forumPosts = fixture("stored-forum-posts.json").posts as BluePost[];
const posts = mergePosts(mergePosts(emptyStore(), forumPosts).store, parseBlueskyFeed(fixture("bluesky-feed.json"), seen)).store.posts;
const builds: BuildLike[] = [
  { key: "wow_classic_beta:aaa", product: "wow_classic_beta", buildId: 70450, version: "1.60.1.70450", firstSeen: "2026-10-16T20:00:00.000Z" },
  { key: "wow_classic_beta:bbb", product: "wow_classic_beta", buildId: 70460, version: "1.60.1.70460", firstSeen: "2026-10-17T06:00:00.000Z", diffUrl: "https://everloot.app/changes/diff/70460" },
  { key: "wow_classic_era:ccc", product: "wow_classic_era", buildId: 70001, version: "1.15.9.70001", firstSeen: "2026-10-10T06:00:00.000Z" },
  { key: "wow_retail:ddd", product: "wow", buildId: 99999, version: "12.0.0.99999", firstSeen: "2026-10-17T07:00:00.000Z" },
];
const timeline = buildTimeline(posts, builds);

test("the timeline merges posts and builds, newest first, and leaves out products that are not Forever or Classic", () => {
  expect(timeline.map((e) => e.at)).toEqual([...timeline.map((e) => e.at)].sort().reverse());
  expect(timeline.some((e) => e.version === "12.0.0.99999")).toBe(false);
  expect(timeline[0]).toMatchObject({ type: "build", version: "1.60.1.70460" });
  expect(timeline).toHaveLength(5 + 3 + 3);
});

test("a build is labelled as first seen by Everloot and carries an empty diff slot until one exists", () => {
  const early = timeline.find((e) => e.version === "1.60.1.70450")!;
  expect(early).toMatchObject({ game: "forever", title: "WoW: Forever build 1.60.1.70450", url: null, diffUrl: null });
  expect(timeline.find((e) => e.version === "1.60.1.70460")!.diffUrl).toBe("https://everloot.app/changes/diff/70460");
  expect(timeline.find((e) => e.version === "1.15.9.70001")!.game).toBe("classic");
});

test("a build of WoW Forever's own product (wowf) is a WoW: Forever build", () => {
  const build = { key: "wowf:eee", product: "wowf", buildId: 70630, version: "1.60.1.70630", firstSeen: "2026-10-27T05:12:02.000Z" };
  expect(buildTimeline([], [build])).toMatchObject([{ id: "build:wowf:eee", type: "build", game: "forever", title: "WoW: Forever build 1.60.1.70630" }]);
});

test("filters: blue posts, hotfixes, builds, and a game", () => {
  expect(filterTimeline(timeline, "builds").every((e) => e.type === "build")).toBe(true);
  expect(filterTimeline(timeline, "builds")).toHaveLength(3);
  expect(filterTimeline(timeline, "hotfixes").map((e) => e.type)).toEqual(["hotfix", "hotfix"]);
  expect(filterTimeline(timeline, "posts").every((e) => e.type === "post")).toBe(true);
  expect(filterTimeline(timeline, "all", "forever").every((e) => e.game === "forever")).toBe(true);
  expect(filterTimeline(timeline, "all")).toHaveLength(timeline.length);
  expect(parseFilter("builds")).toBe("builds");
  expect(parseFilter("nonsense")).toBe("all");
  expect(parseFilter(undefined)).toBe("all");
});

test("RSS: valid shape, newest first, every post item links to its Everloot page and names Blizzard's original", () => {
  const xml = renderFeed(timeline, { baseUrl: "https://everloot.app/", now: seen });
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true);
  expect(xml).toContain("<link>https://everloot.app/changes</link>");
  expect(xml).toContain('<atom:link href="https://everloot.app/changes/feed.xml" rel="self"');
  expect((xml.match(/<item>/g) ?? []).length).toBe(timeline.length);
  // A post links to its page on Everloot; the original stays in the item.
  expect(xml).toContain("<link>https://everloot.app/changes/us-70000001-synthetic-beta-realm-maintenance-restart</link>");
  expect(xml).toContain("Original: https://us.forums.blizzard.com/en/wow/t/synthetic-beta-maintenance/9000001</description>");
  expect(xml).toMatch(/<link>https:\/\/everloot\.app\/changes\/bsky-3synthetic1(?:-[a-z0-9-]+)?<\/link>/);
  expect(xml).toContain("Original: https://bsky.app/profile/worldofwarcraft.blizzard.com/post/3synthetic1</description>");
  expect(xml).toContain('<guid isPermaLink="false">build:wow_classic_beta:aaa</guid>');
  expect(xml).toContain("<link>https://everloot.app/changes/diff/70460</link>");
  expect(xml).toContain("<link>https://everloot.app/changes?show=builds</link>");
  expect(xml).toContain("<pubDate>Fri, 16 Oct 2026 22:42:05 GMT</pubDate>");
  // Only the excerpt, never more.
  expect(xml).not.toContain("should never be kept");
  expect(xml.indexOf("1.60.1.70460")).toBeLessThan(xml.indexOf("1.60.1.70450"));
});

test("RSS: markup in titles and excerpts is escaped and control characters are dropped", () => {
  const nasty = { ...posts[0], title: "A <b>bold</b> & \"quoted\" \u0007 title", excerpt: "x < y & z" };
  const xml = renderFeed(buildTimeline([nasty], []), { baseUrl: "https://everloot.app", now: seen });
  // Titles are plain text, so the tags go; what is left is escaped.
  expect(xml).toContain("A bold &amp; &quot;quoted&quot;  title");
  expect(xml).not.toContain("<b>");
  expect(xml).toContain("x &lt; y &amp; z");
  expect(xml).not.toContain("\u0007");
});

test("RSS: an empty timeline is still a valid feed", () => {
  const xml = renderFeed([], { baseUrl: "https://everloot.app", now: seen });
  expect(xml).toContain("<lastBuildDate>Sat, 17 Oct 2026 12:00:00 GMT</lastBuildDate>");
  expect(xml).not.toContain("<item>");
});

test("a maintainer's summary is shown in front of the excerpt, and only a maintainer writes it", () => {
  const withSummary = posts.map((p) => (p.id === "forum:70000001" ? { ...p, summary: "Beta restarts tonight." } : p));
  const entry = buildTimeline(withSummary, []).find((e) => e.id === "forum:70000001")!;
  expect(entry.summary).toBe("Beta restarts tonight.");
  expect(posts.every((p) => p.summary === undefined)).toBe(true);
});

test("recent_changes text: filter, limit, source link and the honesty lines", () => {
  const text = handleRecentChanges(timeline, { filter: "hotfixes" });
  expect(text).toContain("[Hotfix, WoW: Forever] WoW: Forever Hotfixes - October 16");
  expect(text).toContain("Original: https://us.forums.blizzard.com/en/wow/t/synthetic-forever-hotfixes/9000002/14");
  expect(text).toContain("Blizzard's");
  const builds3 = handleRecentChanges(timeline, { filter: "builds", limit: 1 });
  expect(builds3).toContain("1.60.1.70460");
  expect(builds3).not.toContain("1.60.1.70450");
  expect(builds3).toContain("First seen by Everloot, not Blizzard's release time. Diff: https://everloot.app/changes/diff/70460");
});

test("recent_changes text: not connected is not the same as nothing", () => {
  expect(handleRecentChanges(null, {})).toMatch(/not connected/);
  expect(handleRecentChanges([], {})).toMatch(/No changes recorded/);
});

const onePost = () => ({ ...posts[0] });

test("safeHttpUrl keeps http and https and drops everything else", () => {
  expect(safeHttpUrl("https://us.forums.blizzard.com/en/wow/t/x/1")).toBe("https://us.forums.blizzard.com/en/wow/t/x/1");
  expect(safeHttpUrl("http://example.test/a")).toBe("http://example.test/a");
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>", "ftp://x.test/a", "//x.test/a", "/relative", "not a url", "", null, 5, `https://x.test/${"a".repeat(2100)}`]) {
    expect(safeHttpUrl(bad), String(bad)).toBeNull();
  }
});

test("clampExcerpt enforces two sentences and 300 characters on anything it is given", () => {
  expect(clampExcerpt("Alpha. Beta. Gamma. Delta.")).toBe("Alpha. Beta.");
  expect(clampExcerpt("x".repeat(1000)).length).toBeLessThanOrEqual(300);
  expect(clampExcerpt("<script>alert(1)</script>Hello. World. More.")).toBe("alert(1) Hello. World.");
  expect(clampExcerpt(undefined)).toBe("");
  expect(clampExcerpt({ not: "text" })).toBe("");
});

test("a hand-edited post is clamped in the timeline: excerpt, link, title and summary", () => {
  const edited = { ...onePost(), excerpt: "One. Two. Three. Four.", url: "javascript:alert(1)", title: "T".repeat(500), summary: "S".repeat(900) };
  const [entry] = buildTimeline([edited], []);
  expect(entry.excerpt).toBe("One. Two.");
  expect(entry.url).toBeNull();
  expect(entry.title.length).toBeLessThanOrEqual(200);
  expect(entry.summary!.length).toBeLessThanOrEqual(280);
});

test("a post with a bad date, no title or an unknown game is skipped, not a failure", () => {
  const timelineOf = (over: object) => buildTimeline([{ ...onePost(), ...over }, onePost()], []);
  expect(timelineOf({ id: "x1", postedAt: "tomorrow-ish" })).toHaveLength(1);
  expect(timelineOf({ id: "x2", postedAt: 12345 })).toHaveLength(1);
  expect(timelineOf({ id: "x3", title: "" })).toHaveLength(1);
  expect(timelineOf({ id: "x4", game: "retail" })).toHaveLength(1);
  expect(buildTimeline([null, 7, "x", []], [null, "x"])).toEqual([]);
});

test("a build with a bad date or an unsafe diff link is skipped or has the link dropped", () => {
  const good = { key: "wow_classic_beta:zzz", product: "wow_classic_beta", buildId: 1, version: "1.60.1.1", firstSeen: "2026-10-17T06:00:00.000Z" };
  expect(buildTimeline([], [{ ...good, firstSeen: "nope" }])).toEqual([]);
  expect(buildTimeline([], [{ ...good, diffUrl: "javascript:alert(1)" }])[0].diffUrl).toBeNull();
  expect(buildTimeline([], [{ ...good, diffUrl: "https://everloot.app/d/1" }])[0].diffUrl).toBe("https://everloot.app/d/1");
});

test("the feed and the MCP text stay safe when the stored link is bad", () => {
  const entries = buildTimeline([{ ...onePost(), url: "javascript:alert(1)" }], []);
  const xml = renderFeed(entries, { baseUrl: "https://everloot.app", now: seen });
  expect(xml).not.toContain("javascript:");
  expect(xml).toContain("<link>https://everloot.app/changes</link>");
  expect(handleRecentChanges(entries, {})).toContain("Original: link unavailable");
});

test("thread fields reach the timeline: region, topic, post number, and whether the blue started the thread", () => {
  const entry = timeline.find((e) => e.id === "forum:70000002")!;
  expect(entry).toMatchObject({ region: "us", topicId: 9000002, topicSlug: "synthetic-forever-hotfixes", postNumber: 14, startedThread: false });
  expect(timeline.find((e) => e.id === "forum:70000001")!.startedThread).toBe(true);
  // Bluesky posts and builds have no thread.
  expect(timeline.filter((e) => e.source === "bluesky").every((e) => e.topicId === undefined && e.region === undefined)).toBe(true);
});

test("stored thread fields are checked: a bad topic id, number or slug is dropped, startedThread follows the post number", () => {
  const [entry] = buildTimeline([{ ...onePost(), topicId: -4, postNumber: 2, topicSlug: "x", region: "mars" }], []);
  expect(entry.topicId).toBeUndefined();
  expect(entry.postNumber).toBeUndefined();
  expect(entry.region).toBeUndefined();
  const [other] = buildTimeline([{ ...onePost(), topicSlug: "../../evil", postNumber: 3, startedThread: true }], []);
  expect(other.topicSlug).toBeUndefined();
  expect(other.startedThread).toBe(false);
});

test("blueThreads groups forum posts per region and topic, oldest reply first, newest thread first", () => {
  const reply = { ...forumPosts[0], id: "forum:70000099", postNumber: 7, startedThread: false, postedAt: "2026-10-17T09:00:00.000Z", url: "https://us.forums.blizzard.com/en/wow/t/synthetic-beta-maintenance/9000001/7" };
  // Same topic id on the EU forum is a different thread.
  const eu = { ...forumPosts[0], id: "forum:eu:5", region: "eu", url: "https://eu.forums.blizzard.com/en/wow/t/synthetic-beta-maintenance/9000001", postedAt: "2026-10-10T09:00:00.000Z" };
  const threads = blueThreads(buildTimeline([...posts, reply, eu], []));
  expect(threads[0]).toMatchObject({
    key: "us:9000001", region: "us", topicId: 9000001, startedByBlue: true, latestAt: "2026-10-17T09:00:00.000Z",
    url: "https://us.forums.blizzard.com/en/wow/t/synthetic-beta-maintenance/9000001", title: "Synthetic Beta Realm Maintenance & Restart",
  });
  expect(threads[0].posts.map((p) => p.postNumber)).toEqual([1, 7]);
  expect(threads.find((t) => t.key === "eu:9000001")?.url).toBe("https://eu.forums.blizzard.com/en/wow/t/synthetic-beta-maintenance/9000001");
  expect(threads.find((t) => t.key === "us:9000002")?.startedByBlue).toBe(false);
  expect(threads.every((t) => t.posts.every((p) => p.source === "forum"))).toBe(true);
  expect(threads).toHaveLength(6);
});

test("recent_changes text names the EU forum, and US posts read as before", () => {
  const eu = buildTimeline([{ ...onePost(), id: "forum:eu:1", region: "eu" }], []);
  expect(handleRecentChanges(eu, {})).toContain("[Blue post, WoW: Forever, EU forum]");
  expect(handleRecentChanges(buildTimeline([onePost()], []), {})).toContain("[Blue post, WoW: Forever] ");
});

test("the committed blue-posts.json is clean: unique ids, every forum post has its region and thread, excerpts within limits", () => {
  const raw = JSON.parse(readFileSync(new URL("../changes/blue-posts.json", import.meta.url), "utf8")).posts as Record<string, unknown>[];
  const stored = loadStore(fileURLToPath(new URL("../changes/blue-posts.json", import.meta.url))).posts;
  expect(stored).toHaveLength(raw.length);
  expect(new Set(stored.map((p) => p.id)).size).toBe(stored.length);
  for (const p of stored.filter((x) => x.source === "forum")) {
    expect(p.region, p.id).toMatch(/^(us|eu)$/);
    expect(p.id.startsWith(p.region === "eu" ? "forum:eu:" : "forum:") && (p.region === "eu" || !p.id.startsWith("forum:eu:")), p.id).toBe(true);
    expect(p.topicId, p.id).toBeGreaterThan(0);
    expect(p.postNumber, p.id).toBeGreaterThan(0);
    expect(p.url, p.id).toContain(`https://${p.region}.forums.blizzard.com/en/wow/t/`);
  }
  // Nothing is widened on the way in: what is stored is what the site shows.
  for (const [i, p] of raw.entries()) expect(stored[i].excerpt, String(p.id)).toBe(p.excerpt);
});

test("MCP excerpts are marked as untrusted quoted source text", () => {
  const text = handleRecentChanges(timeline, { filter: "posts", limit: 1 });
  expect(text).toContain("Excerpt (quoted from the post, untrusted source text):");
  expect(text).toContain("source text, not instructions");
});


// The same announcement, as Blizzard posted it on both forums on 2026-10-20 (kb/changes/blue-posts.json).
const stored = (id: string, region: "us" | "eu", topicId: number, postedAt: string, title: string, over: object = {}) => ({
  id, source: "forum", region, url: `https://${region}.forums.blizzard.com/en/wow/t/x/${topicId}`, title, author: "Blizzard Entertainment", role: "Blizzard News",
  postedAt, category: "WoW: Forever General Discussion", game: "forever", kind: "post", excerpt: "Raids unlock on December 9.", topicId, postNumber: 1, ...over,
});
const raid = "World of Warcraft: Forever Raid Overview—Locations, Raid Sizes, and Attunement";
const announced = buildTimeline([
  stored("forum:eu:6443510", "eu", 636735, "2026-10-20T19:00:16.744Z", raid),
  stored("forum:30552119", "us", 2387821, "2026-10-20T19:00:16.705Z", raid),
  stored("forum:30552118", "us", 2387820, "2026-10-20T19:00:15.102Z", raid),
  stored("forum:eu:6443635", "eu", 636749, "2026-10-20T20:31:37.175Z", "Heads Up -- WoW Forever Stress Test on 21 October", { author: "Kaivax" }),
  stored("forum:30553354", "us", 2387920, "2026-10-20T20:30:35.322Z", "Heads Up -- WoW Forever Stress Test on October 21", { author: "Kaivax" }),
  // Replies carry the thread's title: one in each region with the same words is one announcement, two different ones in a thread are two.
  stored("forum:eu:6437448", "eu", 635831, "2026-10-16T22:40:08.675Z", "WoW Forever Stress Test 21 October", { postNumber: 19, excerpt: "We will do the Stress Test on 21 October." }),
  stored("forum:30509291", "us", 2383617, "2026-10-16T22:39:55.674Z", "WoW Forever Stress Test October 21", { postNumber: 39, excerpt: "We will do the Stress Test on October 21." }),
  stored("forum:30509300", "us", 2383617, "2026-10-16T23:10:00.000Z", "WoW Forever Stress Test October 21", { postNumber: 41, excerpt: "Realms are back up." }),
  // Same title on another day is a new announcement.
  stored("forum:30600000", "us", 2390000, "2026-10-21T19:00:00.000Z", raid),
], []);

test("sameAnnouncement: the day said two ways is the same announcement, a different day or title is not", () => {
  expect(sameAnnouncement("Heads Up -- Stress Test on 21 October", "Heads Up -- Stress Test on October 21")).toBe(true);
  expect(sameAnnouncement("WoW Forever Stress Test 21 October", "WoW Forever Stress Test October 21")).toBe(true);
  expect(sameAnnouncement("Names from 27 October through 3 November", "Names from October 27 through November 3")).toBe(true);
  expect(sameAnnouncement("Stress Test on 21 October", "Stress Test on 22 October")).toBe(false);
  expect(sameAnnouncement("Good News, Everyone!", "Heads Up -- Stress Test")).toBe(false);
});

test("groupAnnouncements: one entry per announcement, the US copy first, the rest kept as copies", () => {
  const grouped = groupAnnouncements(announced);
  expect(grouped.map((e) => e.id)).toEqual(["forum:30600000", "forum:30553354", "forum:30552118", "forum:30509300", "forum:30509291"]);
  const overview = grouped.find((e) => e.id === "forum:30552118")!;
  // Two US threads, same category and words, 1.6 seconds apart: a repeat, not a second announcement.
  expect(overview.copies!.map((c) => c.id)).toEqual(["forum:30552119", "forum:eu:6443510"]);
  expect(forumRegions(overview)).toEqual(["us", "eu"]);
  expect(grouped.find((e) => e.id === "forum:30553354")!.copies!.map((c) => c.id)).toEqual(["forum:eu:6443635"]);
  expect(grouped.find((e) => e.id === "forum:30509291")!.copies!.map((c) => c.id)).toEqual(["forum:eu:6437448"]);
  expect(grouped.find((e) => e.id === "forum:30509300")!.copies).toBeUndefined();
  expect(grouped.find((e) => e.id === "forum:30600000")!.copies).toBeUndefined();
  expect(forumRegions(grouped.find((e) => e.id === "forum:30600000")!)).toEqual(["us"]);
});

test("groupAnnouncements: without a US copy the earliest is the entry; the choice does not depend on the input order", () => {
  const eu = announced.filter((e) => e.region === "eu");
  const both = [stored("forum:eu:2", "eu", 2, "2026-10-20T19:00:02.000Z", raid), stored("forum:eu:1", "eu", 1, "2026-10-20T19:00:01.000Z", raid)];
  const [first] = groupAnnouncements(buildTimeline(both, []));
  expect(first.id).toBe("forum:eu:1");
  expect(groupAnnouncements([...announced].reverse())).toEqual(groupAnnouncements(announced));
  expect(groupAnnouncements(eu).every((e) => !e.copies)).toBe(true);
  // Bluesky posts and builds pass through untouched.
  expect(groupAnnouncements(timeline)).toHaveLength(timeline.length);
});

// The rolling hotfix thread, as stored on 2026-11-27: Blizzard renames it every day, and every reply took the new title.
const rolling = "WoW: Forever Hotfixes - November 25, 2026";
const hotfix = (id: string, region: "us" | "eu", topicId: number, postNumber: number, postedAt: string, title: string, excerpt: string) =>
  stored(id, region, topicId, postedAt, title, { kind: "hotfix", postNumber, excerpt, author: "Kaivax", role: "Community Manager" });
const hotfixes = [
  hotfix("forum:30941234", "us", 2403040, 11, "2026-11-17T02:17:43.000Z", rolling, "November 16, 2026 Camping The Fishing Rack now provides lures for everyone."),
  hotfix("forum:eu:6511114", "eu", 639885, 10, "2026-11-17T02:18:53.000Z", "WoW: Forever Hotfixes - November 23, 2026", "November 16, 2026 Camping The Fishing Rack now provides lures for everyone."),
  hotfix("forum:31066529", "us", 2403040, 16, "2026-11-25T23:25:08.000Z", rolling, "November 25, 2026 Classes Druid Hurricane now correctly lands its final hit."),
  // A reply in the thread that does not open with a date: its own day (Pacific, as Blizzard dates them) names it.
  hotfix("forum:30899768", "us", 2403040, 10, "2026-11-14T01:30:00.000Z", rolling, "We've also fixed the camping bug."),
  { id: "news:24315281", source: "news", url: "https://news.blizzard.com/en-us/article/24315281/wow-forever-hotfixes-november-25-2026", title: rolling,
    author: "Blizzard Entertainment", role: "Blizzard News", category: "Blizzard News", game: "forever", kind: "hotfix", postedAt: "2026-11-25T23:19:16.000Z", excerpt: "" },
];

test("a hotfix reply keeps the date of its own hotfixes, not the date the thread was renamed to", () => {
  const titles = new Map(buildTimeline(hotfixes, []).map((e) => [e.id, e.title]));
  expect(titles.get("forum:30941234")).toBe("WoW: Forever Hotfixes - November 16, 2026");
  expect(titles.get("forum:eu:6511114")).toBe("WoW: Forever Hotfixes - November 16, 2026");
  expect(titles.get("forum:31066529")).toBe(rolling);
  expect(titles.get("forum:30899768")).toBe("WoW: Forever Hotfixes - November 13, 2026");
  // A dated title on an ordinary post is the post's own; a reply that opens with no date keeps it.
  const av = stored("forum:31066214", "us", 2429074, "2026-11-26T23:04:33.000Z", "Alterac Valley Adjustments - November 25", { postNumber: 567, excerpt: "With additional hotfixes that are now live." });
  expect(buildTimeline([av], [])[0].title).toBe("Alterac Valley Adjustments - November 25");
});

test("groupAnnouncements: the US and EU copies of one day's hotfixes and its Blizzard News twin are one entry", () => {
  const grouped = groupAnnouncements(buildTimeline(hotfixes, []));
  expect(grouped.map((e) => e.id)).toEqual(["forum:31066529", "forum:30941234", "forum:30899768"]);
  expect(grouped.find((e) => e.id === "forum:30941234")!.copies!.map((c) => c.id)).toEqual(["forum:eu:6511114"]);
  // The news card has no text of its own: it is folded into the forum post, which links it.
  expect(grouped[0].copies!.map((c) => c.id)).toEqual(["news:24315281"]);
  expect(forumRegions(grouped[0])).toEqual(["us"]);
});

// November 11 and 12, as stored on 2026-11-27: the replies Kaivax posted on both forums, worded per region.
const twins = [
  hotfix("forum:eu:6497741", "eu", 639885, 8, "2026-11-12T19:10:54.868Z", "WoW: Forever Hotfixes - November 23, 2026",
    "Please note: Due to an unexpected delay in deployment, the following changes went live to all regions at 19:45 CET today. Classes Shaman Weapon imbues and Weapon totems can now be used at the same time."),
  // The US copy's stored text stops after its first sentence.
  hotfix("forum:30876030", "us", 2403040, 9, "2026-11-12T19:10:52.697Z", rolling,
    "Please note: Due to an unexpected delay in deployment, the following changes went live to all regions at 10:45 a.m. PST today."),
  hotfix("forum:eu:6495278", "eu", 639885, 7, "2026-11-12T00:50:13.708Z", "WoW: Forever Hotfixes - November 23, 2026",
    "November 11, 2026 Classes Druid Feral Rend and Tear now works on Pounce Bleed. Hunter Fixed an issue where Volley was activating procs."),
  hotfix("forum:eu:6495276", "eu", 639885, 6, "2026-11-12T00:49:22.321Z", "WoW: Forever Hotfixes - November 23, 2026",
    "We’ve temporarily removed Auction House changes from yesterday’s update, as they will go live with scheduled weekly maintenance on 18 November. They will appear again in the hotfixes update thereafter."),
  hotfix("forum:30863849", "us", 2403040, 8, "2026-11-12T00:48:47.076Z", rolling,
    "November 11, 2026 Classes Druid Feral Rend and Tear now works on Pounce Bleed. Hunter Fixed an issue where Volley was activating procs."),
  hotfix("forum:30863846", "us", 2403040, 7, "2026-11-12T00:48:41.201Z", rolling,
    "We’ve temporarily removed Auction House changes from yesterday’s update, as they will go live with scheduled weekly maintenance on November 17. They will appear again in the hotfixes update thereafter."),
];

test("sameBody: clock times, dates in either order and a copy cut short are the same text; other words are not", () => {
  const [eu12, us12, , euAh, , usAh] = twins;
  expect(sameBody(us12.excerpt, eu12.excerpt)).toBe(true);
  expect(sameBody(eu12.excerpt, us12.excerpt)).toBe(true);
  expect(sameBody(usAh.excerpt, euAh.excerpt)).toBe(true);
  expect(sameBody("Realms are back up.", "Realms are back up. The queue is closed.")).toBe(false);
  expect(sameBody(usAh.excerpt, us12.excerpt)).toBe(false);
  expect(sameBody("", "")).toBe(false);
});

test("groupAnnouncements: replies posted on both forums are one entry even when the time zone or the date's wording differ", () => {
  const grouped = groupAnnouncements(buildTimeline(twins, []));
  expect(grouped.map((e) => [e.id, (e.copies ?? []).map((c) => c.id)])).toEqual([
    ["forum:30876030", ["forum:eu:6497741"]],
    ["forum:30863849", ["forum:eu:6495278"]],
    ["forum:30863846", ["forum:eu:6495276"]],
  ]);
});

test("fullerCopy: the copy whose text runs past this one's, or null", () => {
  const [us12, , feral] = groupAnnouncements(buildTimeline(twins, []));
  expect(fullerCopy(us12)?.id).toBe("forum:eu:6497741");
  expect(fullerCopy(feral)).toBeNull();
});

test("foldTitleDay: different posts under one title on one day are one row, newest first, holding every post", () => {
  const rows = foldTitleDay(groupAnnouncements(buildTimeline([...twins, ...hotfixes], [{ key: "b", product: "wowf", buildId: 1, version: "1.60.1.1", firstSeen: "2026-11-25T12:00:00Z" }])));
  expect(rows.map((r) => [r.entry.title, r.posts.length])).toEqual([
    ["WoW: Forever Hotfixes - November 25, 2026", 1],
    ["WoW: Forever build 1.60.1.1", 1],
    ["WoW: Forever Hotfixes - November 16, 2026", 1],
    ["WoW: Forever Hotfixes - November 13, 2026", 1],
    ["WoW: Forever Hotfixes - November 12, 2026", 1],
    ["WoW: Forever Hotfixes - November 11, 2026", 2],
  ]);
  expect(rows.at(-1)!.posts.map((p) => p.id)).toEqual(["forum:30863849", "forum:30863846"]);
});

// November 10, as stored on 2026-11-27: one announcement, its title naming the day per region (Europe's is a day later).
const PVP_TEXT = "It’s vitally important that the PvP rulesets in WoW: Forever have balanced factions where both factions vie for supremacy, creating memories of epic victories a";
const pvp = [
  stored("forum:30830227", "us", 2408781, "2026-11-10T02:05:13.558Z", "PvP Faction Balance Updates - November 10", { excerpt: PVP_TEXT, author: "Kaivax" }),
  stored("forum:eu:6488007", "eu", 641169, "2026-11-10T02:06:08.484Z", "PvP Faction Balance Updates - 11 November", { excerpt: PVP_TEXT, author: "Kaivax" }),
  stored("forum:30830868", "us", 2408781, "2026-11-10T03:04:13.020Z", "PvP Faction Balance Updates - November 10",
    { postNumber: 158, author: "Kaivax", excerpt: "We did significant investigation into that, and there is no evidence that trial characters had any impact at all." }),
];

test("groupAnnouncements: US and EU titles that name the day differently, a day apart, are one announcement when the text is the same", () => {
  const grouped = groupAnnouncements(buildTimeline(pvp, []));
  expect(grouped.map((e) => [e.id, (e.copies ?? []).map((c) => c.id)])).toEqual([
    ["forum:30830868", []],
    ["forum:30830227", ["forum:eu:6488007"]],
  ]);
  const rows = foldTitleDay(grouped);
  expect(rows.map((r) => [r.entry.title, r.posts.length])).toEqual([["PvP Faction Balance Updates - November 10", 2]]);
  // Different text, or days further apart, stay apart.
  const other = stored("forum:eu:2", "eu", 9, "2026-11-10T02:06:08.484Z", "PvP Faction Balance Updates - 11 November", { excerpt: "Something else entirely, said only in Europe this time around." });
  expect(groupAnnouncements(buildTimeline([pvp[0], other], []))).toHaveLength(2);
  const far = stored("forum:eu:3", "eu", 9, "2026-11-10T02:06:08.484Z", "PvP Faction Balance Updates - 13 November", { excerpt: PVP_TEXT });
  expect(groupAnnouncements(buildTimeline([pvp[0], far], []))).toHaveLength(2);
});

test("postDay: the day a title names when it is within a day of the post, else the UTC day", () => {
  const [, , feral] = groupAnnouncements(buildTimeline(twins, []));
  expect(feral.at.slice(0, 10)).toBe("2026-11-12");
  expect(postDay(feral)).toBe("2026-11-11");
  expect(postDay({ type: "post", title: "PvP Faction Balance Updates - 11 November", at: "2026-11-10T02:06:08.484Z" })).toBe("2026-11-11");
  expect(postDay({ type: "post", title: "Raids open December 9", at: "2026-11-10T02:06:08.484Z" })).toBe("2026-11-10");
  expect(postDay({ type: "post", title: "Happy New Year - December 31", at: "2027-01-01T03:00:00.000Z" })).toBe("2026-12-31");
  expect(postDay({ type: "build", title: "WoW: Forever build 1.60.1.1", at: "2026-11-12T00:00:00.000Z" })).toBe("2026-11-12");
  // The card for a day's replies posted after midnight UTC folds under the day its title names.
  const rows = foldTitleDay(groupAnnouncements(buildTimeline(twins, [])));
  expect(rows.map((r) => postDay(r.entry))).toEqual(["2026-11-12", "2026-11-11"]);
});

test("the timeline is newest day first by the day each entry shows (postDay), then by posting time", () => {
  // November 11's hotfix reply went up at 00:48 UTC on the 12th; the screenshot thread at 00:30 is the 12th's.
  const hotfix = stored("forum:30863849", "us", 2403040, "2026-11-12T00:48:47.076Z", "WoW: Forever Hotfixes - November 11, 2026", { kind: "hotfix", excerpt: "Druid Feral." });
  const shots = stored("forum:30863700", "us", 2403500, "2026-11-12T00:30:00.000Z", "Share your screenshots", { excerpt: "Post them here." });
  const evening = stored("forum:30860000", "us", 2403400, "2026-11-11T20:00:00.000Z", "Realm restarts", { excerpt: "Realms restart." });
  const build = { key: "b", product: "wowf", buildId: 1, version: "1.60.1.70888", firstSeen: "2026-11-11T22:00:00Z" };
  const want = ["Share your screenshots", "WoW: Forever Hotfixes - November 11, 2026", "WoW: Forever build 1.60.1.70888", "Realm restarts"];
  const timeline = buildTimeline([evening, hotfix, shots], [build]);
  expect(timeline.map((e) => e.title)).toEqual(want);
  const grouped = groupAnnouncements(timeline);
  expect(grouped.map((e) => e.title)).toEqual(want);
  // The feed keeps the order; its build date is still the newest posting time.
  const xml = renderFeed(grouped, { baseUrl: "https://everloot.app", now: seen });
  expect(xml).toContain("<lastBuildDate>Thu, 12 Nov 2026 00:48:47 GMT</lastBuildDate>");
  expect([...xml.matchAll(/<item>\s*<title>[^:]+: ([^<]+)<\/title>/g)].map((m) => m[1])).toEqual(want);
});

test("groupAnnouncements: a news article with no forum twin stays its own entry", () => {
  const news = hotfixes.filter((p) => p.source === "news").map((p) => ({ ...p, title: "Don't Miss the WoW: Forever Comic" }));
  expect(groupAnnouncements(buildTimeline([...hotfixes.slice(0, 3), ...news], [])).some((e) => e.id === "news:24315281")).toBe(true);
});

test("the RSS feed of the grouped timeline has one item per announcement", () => {
  const xml = renderFeed(groupAnnouncements(announced), { baseUrl: "https://everloot.app", now: seen });
  expect((xml.match(/<item>/g) ?? []).length).toBe(5);
  expect(xml).not.toContain("eu-6443510");
  expect(xml.match(/Raid Overview/g)).toHaveLength(2);
});
test("hand-written entries carry a manual source and id, may be retail, and are kept out of the Forever filter", () => {
  const manual = manualEntries({ entries: [
    { id: "retail-hotfix", type: "hotfix", game: "retail", at: "2026-10-23T00:00:00Z", title: "Retail hotfixes", summary: "Fixes.", url: "https://example.com/x" },
    { id: "Bad Id", game: "retail", at: "2026-10-23T00:00:00Z", title: "Skipped" },
    { id: "no-game", at: "2026-10-23T00:00:00Z", title: "Skipped" },
  ] });
  expect(manual).toEqual([expect.objectContaining({ id: "manual:retail-hotfix", source: "manual", type: "hotfix", game: "retail", url: "https://example.com/x" })]);
  expect(filterTimeline([...timeline, ...manual], "all", "forever").some((e) => e.source === "manual")).toBe(false);
  expect(groupAnnouncements([...timeline, ...manual]).some((e) => e.id === "manual:retail-hotfix")).toBe(true);
  expect(manualEntries(null)).toEqual([]);
});

const manualFixture = { id: "source-fixture", type: "post", game: "retail", at: "2026-10-23", title: "A summary", summary: "Our words.", url: "https://us.forums.blizzard.com/en/wow/t/example/123/4" };
test("manual file rejects unknown top-level publication flags", () => {
  expect(manualEntries({ entries: [manualFixture], private: true })).toEqual([]);
});
test.each(["private", "spoiler", "published", "unknown"])("manual parser rejects unknown or private field %s", (key) => {
  expect(manualEntries({ entries: [{ ...manualFixture, [key]: true }] })).toEqual([]);
});
test.each([undefined, "build", "typo", null])("manual parser rejects invalid type %s", (type) => {
  expect(manualEntries({ entries: [{ ...manualFixture, type }] })).toEqual([]);
});
test.each([undefined, "", "javascript:alert(1)", "not a URL", "https://user:secret@example.com/x"])("manual parser requires safe original URL %s", (url) => {
  expect(manualEntries({ entries: [{ ...manualFixture, url }] })).toEqual([]);
});
test("manual duplicate ids reject every conflicting entry regardless of order", () => {
  expect(manualEntries({ entries: [manualFixture, { ...manualFixture, title: "Conflicting claim" }] })).toEqual([]);
});
test("manual source fixture keeps sanitized source and text, with no detail page", () => {
  const [entry] = manualEntries({ entries: [{ ...manualFixture, title: "<b>Our</b> summary", summary: "<i>Our</i> words." }] });
  expect(entry).toMatchObject({ title: "Our summary", summary: "Our words.", url: manualFixture.url, source: "manual" });
  expect(postPath(entry)).toBeNull();
});
