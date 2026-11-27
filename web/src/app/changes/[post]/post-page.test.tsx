import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { BlueWriteup, ChangeEntry } from "@/lib/changes";
import { MAX_EXCERPT_CHARS } from "@kb/text-safety";

const data = vi.hoisted((): { entries: ChangeEntry[]; writeups: Map<string, BlueWriteup> } => ({ entries: [], writeups: new Map() }));
vi.mock("@/lib/changes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/changes")>();
  // The real loadTimeline groups the bundled posts; the fixtures go through the same grouping.
  return { ...real, loadTimeline: () => real.groupAnnouncements(data.entries), loadWriteups: () => data.writeups };
});
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); },
}));

import BluePostPage, { generateMetadata } from "./page";

const post: ChangeEntry = {
  id: "forum:30553826", type: "post", game: "forever", at: "2026-10-20T21:00:12.897Z", title: "Claim Your World of Warcraft: Forever Character Names",
  url: "https://us.forums.blizzard.com/en/wow/t/claim-your-world-of-warcraft-forever-character-names/2387945", author: "Blizzard Entertainment", role: "Blizzard News",
  category: "WoW: Forever General Discussion", source: "forum", region: "us", excerpt: "Get ready to make your mark in Azeroth! Name reservations open soon.",
};
const eu: ChangeEntry = { ...post, id: "forum:eu:6443686", region: "eu", at: "2026-10-20T21:00:15.083Z", url: "https://eu.forums.blizzard.com/en/wow/t/x/636753" };
const sky: ChangeEntry = {
  id: "bluesky:3mydklukhq22f", type: "post", game: "forever", at: "2026-10-20T21:16:09.013Z", title: "Good News, Everyone!", url: "https://bsky.app/profile/worldofwarcraft.blizzard.com/post/3mydklukhq22f",
  author: "World of Warcraft", role: "Official account", category: "Bluesky", source: "bluesky", excerpt: "Reserve your first three names.",
};
const euOnly: ChangeEntry = { ...post, id: "forum:eu:6400001", region: "eu", at: "2026-10-14T10:00:00.000Z", title: "EU realm maintenance", url: "https://eu.forums.blizzard.com/en/wow/t/m/1" };
const older: ChangeEntry = { ...post, id: "forum:30000001", at: "2026-10-12T10:00:00.000Z", title: "An older notice", excerpt: "Old." };
const build: ChangeEntry = { id: "build:wow_classic_beta:aaa", type: "build", game: "forever", at: "2026-10-20T06:00:00.000Z", title: "WoW: Forever build 1.60.1.70460", url: null, version: "1.60.1.70460" };
const writeup: BlueWriteup = { postId: "forum:30553826", reviewed: { by: "Maintainer", on: "2026-10-21" }, body: "Name reservations are a week long. Three names per account.\n\n- Pick names early.\n- See [every change](/changes)." };

const CANONICAL = "us-30553826-claim-your-world-of-warcraft-forever-character-names";
data.entries = [sky, eu, post, build, older, euOnly];

const page = async (segment: string) => renderToStaticMarkup(await BluePostPage({ params: Promise.resolve({ post: segment }) }));
const meta = (segment: string) => generateMetadata({ params: Promise.resolve({ post: segment }) });

afterEach(() => {
  data.writeups = new Map();
});

test("the canonical address renders the post: blue title and author, date, source, category, the excerpt as Blizzard's words, and the original", async () => {
  const html = await page(CANONICAL);
  expect(html).toMatch(/<h1 class="[^"]*text-blue-post[^"]*">Claim Your World of Warcraft: Forever Character Names<\/h1>/);
  expect(html).toMatch(/data-author="true" class="[^"]*text-blue-post[^"]*">Blizzard Entertainment</);
  expect(html).toContain(", Blizzard News");
  expect(html).toContain('<time dateTime="2026-10-20T21:00:12.897Z" title="2026-10-20 21:00 UTC">October 20, 2026</time>');
  expect(html).toContain("US forum");
  expect(html).toContain("WoW: Forever General Discussion");
  expect(html).toMatch(/<figure data-excerpt="true" class="[^"]*border-blue-post[^"]*"><blockquote cite="https:\/\/us\.forums[^"]*" class="text-fg"><p>Get ready to make your mark in Azeroth! Name reservations open soon\.<\/p><\/blockquote><figcaption[^>]*>Blizzard(&#x27;|')s words, an excerpt\.<\/figcaption>/);
  expect(html).toMatch(/<a data-original="true" href="https:\/\/us\.forums\.blizzard\.com\/en\/wow\/t\/claim-your-world-of-warcraft-forever-character-names\/2387945" rel="noopener"[^>]*>Read the full post on Blizzard(&#x27;|')s forums<\/a>/);
  // Nothing above the title: what kind of post it is leads the line under it.
  expect(html).toContain('<header class="mb-6"><h1 ');
  expect(html).toMatch(/<\/h1><div class="[^"]*"><span data-badge="neutral"[^>]*>Blue post · WoW: Forever<\/span><p/);
  // No visible breadcrumb or provenance prose; the trail is JSON-LD only.
  expect(html).not.toContain('aria-label="breadcrumb"');
  expect(html).toContain('"@type":"BreadcrumbList"');
  for (const gone of ["data policy", "licence", "license", "robots"]) expect(html.toLowerCase()).not.toContain(gone);
});

test("a wrong or missing slug moves to the canonical address; an unknown id, a build or a malformed segment is a 404", async () => {
  await expect(page("us-30553826")).rejects.toThrow(`NEXT_REDIRECT /changes/${CANONICAL}`);
  await expect(page("us-30553826-old-title")).rejects.toThrow(`NEXT_REDIRECT /changes/${CANONICAL}`);
  await expect(page("us-99999999-nothing")).rejects.toThrow("NEXT_NOT_FOUND");
  await expect(page("eu-30553826")).rejects.toThrow("NEXT_NOT_FOUND");
  for (const bad of ["build-1", "1.60.1.70460", "forum:30553826", ""]) await expect(page(bad)).rejects.toThrow("NEXT_NOT_FOUND");
  expect(await meta("us-99999999")).toEqual({ robots: { index: false, follow: true } });
});

test("Bluesky and EU posts get their own source line and link", async () => {
  const s = await page("bsky-3mydklukhq22f-good-news-everyone");
  expect(s).toContain("Bluesky");
  expect(s).not.toContain("· Bluesky · Bluesky");
  expect(s).toMatch(/href="https:\/\/bsky\.app\/profile\/worldofwarcraft\.blizzard\.com\/post\/3mydklukhq22f" rel="noopener"[^>]*>Read the full post on Bluesky<\/a>/);
  expect(await page("eu-6400001-eu-realm-maintenance")).toContain("EU forum");
});

test("the excerpt on the page is never longer than the policy allows, whatever the data says", async () => {
  const long = `${"Word ".repeat(200)}ends here. A second sentence. A third one that must not show.`;
  data.entries = [{ ...post, excerpt: long }];
  try {
    const html = await page(CANONICAL);
    const quoted = /<blockquote[^>]*><p>([^<]*)<\/p>/.exec(html)![1];
    expect(quoted.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS);
    expect(html).not.toContain("must not show");
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});

test("without a write-up the page says noindex, follow, carries no Article, and is self-canonical", async () => {
  const m = await meta(CANONICAL);
  expect(m.robots).toEqual({ index: false, follow: true });
  expect(m.alternates?.canonical).toBe(`/changes/${CANONICAL}`);
  expect((m.description ?? "").length).toBeLessThanOrEqual(160);
  const html = await page(CANONICAL);
  expect(html).not.toContain('"@type":"Article"');
  expect(html).not.toContain("data-writeup");
});

test("with a reviewed write-up: our notes with lists and links, the page is indexable, and it carries an Article dated by the review", async () => {
  data.writeups = new Map([[writeup.postId, writeup]]);
  const m = await meta(CANONICAL);
  expect(m.robots).toEqual({ index: true, follow: true });
  expect(m.alternates?.canonical).toBe(`/changes/${CANONICAL}`);
  expect(m.description).toBe("Name reservations are a week long. Three names per account. Pick names early. See every change.");
  const html = await page(CANONICAL);
  expect(html).toContain('<h2 id="notes"');
  expect(html).toContain("<p>Name reservations are a week long. Three names per account.</p>");
  expect(html).toMatch(/<li>See <a href="\/changes" class="[^"]*">every change<\/a>\.<\/li>/);
  expect(html).toContain('Reviewed <time dateTime="2026-10-21">October 21, 2026</time>');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((x) => JSON.parse(x[1]));
  const article = ld.find((d) => d["@type"] === "Article");
  expect(article).toMatchObject({
    headline: post.title, url: `https://everloot.app/changes/${CANONICAL}`, datePublished: "2026-10-21", dateModified: "2026-10-21",
    author: { "@id": "https://everloot.app/#organization" }, isBasedOn: { url: post.url, datePublished: post.at },
  });
  expect(JSON.stringify(article)).not.toContain('"Person"');
});

// A post between this one and the Bluesky post: it is Newer, so the Bluesky post is left for Same day.
const between: ChangeEntry = { ...sky, id: "bluesky:3mydklbetween", at: "2026-10-20T21:05:00.000Z", title: "Names go live soon", url: "https://bsky.app/profile/worldofwarcraft.blizzard.com/post/3mydklbetween" };
const withBetween = async (run: () => Promise<void>) => {
  data.entries = [sky, between, eu, post, build, older, euOnly];
  try {
    await run();
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
};

test("More from the author and Same day link to the other posts' pages, never to builds, the post itself or its copies", () => withBetween(async () => {
  const html = await page(CANONICAL);
  const more = html.slice(html.indexOf('id="more-from"'), html.indexOf('id="same-day"'));
  expect(more).toContain("More from Blizzard Entertainment");
  expect(html).not.toContain("/changes/eu-6443686");
  expect(more).toContain('href="/changes/us-30000001-an-older-notice"');
  expect(more).toContain('href="/changes?author=Blizzard+Entertainment"');
  expect(more).not.toContain(`href="/changes/${CANONICAL}"`);
  const day = html.slice(html.indexOf('id="same-day"'));
  expect(day).toContain('href="/changes/bsky-3mydklukhq22f-good-news-everyone"');
  expect(day).not.toContain("an-older-notice");
  expect(html).not.toContain("1.60.1.70460");
}));

test("the related lists sit in a column beside the post, after it on a phone, with long dates that never break", async () => {
  let html = "";
  await withBetween(async () => { html = await page(CANONICAL); });
  expect(html).toMatch(/<div data-container="wide" class="[^"]*lg:grid-cols-\[minmax\(0,48rem\)_minmax\(0,1fr\)\]"><article data-blue-post="true"/);
  const aside = html.slice(html.indexOf('<aside aria-label="More Blizzard posts"'));
  expect(aside).toContain('id="more-from"');
  expect(aside).toContain('id="same-day"');
  expect(aside).toContain('<time dateTime="2026-10-12T10:00:00.000Z" class="whitespace-nowrap">October 12, 2026</time>');
  // The post comes first: its original, then newer and older, then the lists.
  expect(html.indexOf("data-original")).toBeLessThan(html.indexOf("data-nearby"));
  expect(html.indexOf("data-nearby")).toBeLessThan(html.indexOf("<aside"));
  // Nothing beside the post when there is nothing to list.
  data.entries = [post];
  try {
    expect(await page(CANONICAL)).not.toContain("<aside");
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});

test("newer and older step through the same game's posts, skipping builds and copies; the ends have one card", async () => {
  const html = await page(CANONICAL);
  const nearby = html.slice(html.indexOf('data-nearby'), html.indexOf('id="more-from"'));
  expect(nearby).toContain('aria-label="Nearby posts"');
  expect(nearby).toContain('href="/changes/bsky-3mydklukhq22f-good-news-everyone"');
  expect(nearby).toContain(">Newer</span>");
  expect(nearby).toContain('href="/changes/eu-6400001-eu-realm-maintenance"');
  expect(nearby).toContain(">Older</span>");
  expect(nearby).not.toContain("1.60.1.70460");
  expect(nearby).not.toContain("eu-6443686");
  expect(nearby).not.toContain("sm:col-span-2");
  // The newest post has no newer neighbour: the older card takes the whole row, no empty cell beside it.
  const newest = await page("bsky-3mydklukhq22f-good-news-everyone");
  const top = newest.slice(newest.indexOf('data-nearby'), newest.indexOf('id="same-day"'));
  expect(top).not.toContain(">Newer</span>");
  expect(top).toContain(`href="/changes/${CANONICAL}"`);
  expect(top).toMatch(/<a href="\/changes\/[^"]+" class="[^"]*sm:col-span-2[^"]*"><span class="text-meta text-muted">Older<\/span>/);
  expect(top).not.toContain('aria-hidden="true"');
});

test("without a write-up there is no notes card at all, and the original is the one button", async () => {
  const html = await page(CANONICAL);
  expect(html).not.toContain("data-no-notes");
  expect(html).not.toContain("Our notes");
  expect(html).not.toContain("None yet");
  expect(html).toMatch(/<a data-original="true" href="[^"]+" rel="noopener" class="btn">/);
  expect(html).toContain('href="/changes"');
  data.writeups = new Map([[writeup.postId, writeup]]);
  const written = await page(CANONICAL);
  expect(written).toContain("data-writeup");
  expect(written).toContain("Our notes");
});

test("a regional copy's address moves (308) to the announcement's page", async () => {
  await expect(page("eu-6443686-claim-your-world-of-warcraft-forever-character-names")).rejects.toThrow(`NEXT_REDIRECT /changes/${CANONICAL}`);
  await expect(page("eu-6443686")).rejects.toThrow(`NEXT_REDIRECT /changes/${CANONICAL}`);
  expect((await meta("eu-6443686")).alternates?.canonical).toBe(`/changes/${CANONICAL}`);
});

test("the page says where else the announcement was posted, linking each copy", async () => {
  const html = await page(CANONICAL);
  expect(html).toMatch(/<p data-also-posted="true"[^>]*>Also posted <span><a href="https:\/\/eu\.forums\.blizzard\.com\/en\/wow\/t\/x\/636753" rel="noopener"[^>]*>on the EU forum<\/a><\/span>\.<\/p>/);
  expect(await page("eu-6400001-eu-realm-maintenance")).not.toContain("data-also-posted");
  // A repeat thread on the same forum says so.
  const again: ChangeEntry = { ...post, id: "forum:30553827", at: "2026-10-20T21:00:13.000Z", url: "https://us.forums.blizzard.com/en/wow/t/y/2387946" };
  data.entries = [eu, post, again];
  try {
    const both = await page(CANONICAL);
    expect(both).toContain('>in a second thread on the US forum</a></span><span> and <a href="https://eu.forums.blizzard.com/en/wow/t/x/636753"');
    await expect(page("us-30553827")).rejects.toThrow(`NEXT_REDIRECT /changes/${CANONICAL}`);
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});

test("a Blizzard News twin of the post is linked as published on Blizzard News, not as a forum", async () => {
  const news: ChangeEntry = { ...post, id: "news:24315281", source: "news", region: undefined, at: "2026-10-20T20:00:00.000Z", url: "https://news.blizzard.com/en-us/article/24315281/x", excerpt: "" };
  data.entries = [post, news];
  try {
    expect(await page(CANONICAL)).toMatch(/Also posted <span><a href="https:\/\/news\.blizzard\.com\/en-us\/article\/24315281\/x" rel="noopener"[^>]*>on Blizzard News<\/a><\/span>\./);
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});

test("a write-up filed under a regional copy shows on the announcement's page, which is then indexable", async () => {
  data.writeups = new Map([["forum:eu:6443686", { ...writeup, postId: "forum:eu:6443686" }]]);
  expect((await meta(CANONICAL)).robots).toEqual({ index: true, follow: true });
  const html = await page(CANONICAL);
  expect(html).toContain("<p>Name reservations are a week long. Three names per account.</p>");
  expect(html).toContain('"@type":"Article"');
});
// November 11, 12 and 25, as stored on 2026-11-27 (titles already the posts' own, as buildTimeline gives them).
const kaivax = (id: string, region: "us" | "eu", n: number, at: string, title: string, excerpt: string, type: "hotfix" | "post" = "hotfix"): ChangeEntry => ({
  id, type, game: "forever", at, title, url: `https://${region}.forums.blizzard.com/en/wow/t/h/${region === "us" ? 2403040 : 639885}/${n}`,
  author: "Kaivax", role: "Community Manager", category: "WoW: Forever", source: "forum", region, topicId: region === "us" ? 2403040 : 639885, postNumber: n, startedThread: n === 1, excerpt,
});
const NOV12 = "WoW: Forever Hotfixes - November 12, 2026";
const NOV11 = "WoW: Forever Hotfixes - November 11, 2026";
const AV = "Alterac Valley Adjustments - November 25";
const thread = [
  kaivax("forum:31066214", "us", 567, "2026-11-25T23:04:33.000Z", AV, "With additional hotfixes that are now live, we have further increased reputation.", "post"),
  { ...kaivax("forum:31062986", "us", 1, "2026-11-25T19:42:28.000Z", AV, "We’ve seen that players in Alterac Valley were frequently completing the battleground.", "post"), topicId: 2429074 },
  kaivax("forum:eu:6497741", "eu", 8, "2026-11-12T19:10:54.868Z", NOV12, "Please note: Due to an unexpected delay in deployment, the following changes went live to all regions at 19:45 CET today. Classes Shaman Weapon imbues and Weapon totems can now be used at the same time."),
  kaivax("forum:30876030", "us", 9, "2026-11-12T19:10:52.697Z", NOV12, "Please note: Due to an unexpected delay in deployment, the following changes went live to all regions at 10:45 a.m. PST today."),
  kaivax("forum:eu:6495278", "eu", 7, "2026-11-12T00:50:13.708Z", NOV11, "November 11, 2026 Classes Druid Feral Rend and Tear now works on Pounce Bleed."),
  kaivax("forum:eu:6495276", "eu", 6, "2026-11-12T00:49:22.321Z", NOV11, "We’ve temporarily removed Auction House changes from yesterday’s update, as they will go live with scheduled weekly maintenance on 18 November."),
  kaivax("forum:30863849", "us", 8, "2026-11-12T00:48:47.076Z", NOV11, "November 11, 2026 Classes Druid Feral Rend and Tear now works on Pounce Bleed."),
  kaivax("forum:30863846", "us", 7, "2026-11-12T00:48:41.201Z", NOV11, "We’ve temporarily removed Auction House changes from yesterday’s update, as they will go live with scheduled weekly maintenance on November 17."),
];
const NOV12_PAGE = "us-30876030-wow-forever-hotfixes-november-12-2026";

test("a copy whose stored text stops early shows its twin's fuller text, labelled; Newer is never the same post on the other forum", async () => {
  data.entries = thread;
  try {
    const html = await page(NOV12_PAGE);
    expect(html).toContain("Shaman Weapon imbues and Weapon totems can now be used at the same time.");
    expect(html).toMatch(/<figcaption[^>]*>Excerpt from the EU forum post \(it has more text than the US copy\)\.<\/figcaption>/);
    // The line under the title names the forum the shown words come from, with that copy's time.
    expect(html).toContain('<span data-forum="true">EU forum</span>');
    expect(html).toContain('<time dateTime="2026-11-12T19:10:54.868Z"');
    expect(html).toMatch(/<blockquote cite="https:\/\/eu\.forums[^"]*" class="text-fg">/);
    const nearby = html.slice(html.indexOf("data-nearby"), html.indexOf("<aside"));
    expect(nearby).not.toContain(NOV12);
    expect(nearby).not.toContain("eu-6497741");
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});

test("a post shown in one list around the page is not repeated in another: Older, then Same day, then More from", async () => {
  const podcast: ChangeEntry = { ...kaivax("forum:30874280", "us", 1, "2026-11-12T17:46:04.799Z", "The WoW Forever Podcast: Episode 7", "", "post"), topicId: 2412856, author: "Blizzard Entertainment" };
  const noon: ChangeEntry = { ...kaivax("forum:30870000", "us", 1, "2026-11-12T12:00:00.000Z", "Realm restarts", "Realms restart at noon.", "post"), topicId: 2412000 };
  data.entries = [...thread, podcast, noon];
  try {
    const html = await page(NOV12_PAGE);
    const nearby = html.slice(html.indexOf("data-nearby"), html.indexOf("<aside"));
    expect(nearby).toContain("The WoW Forever Podcast: Episode 7");
    const more = html.slice(html.indexOf('id="more-from"'), html.indexOf('id="same-day"'));
    const day = html.slice(html.indexOf('id="same-day"'));
    expect(day).not.toContain("Podcast");
    expect(day).toContain("Realm restarts");
    expect(more).not.toContain("Realm restarts");
    expect(more).not.toContain("Podcast");
    for (const title of ["Podcast", "Realm restarts", NOV11, AV]) expect(html.slice(html.indexOf("data-nearby")).split(title).length - 1, title).toBeLessThanOrEqual(1);
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});

test("a reply posted after midnight UTC is dated by the day its title names, in the header and the lists", async () => {
  data.entries = thread;
  try {
    expect(await page("us-30863849-wow-forever-hotfixes-november-11-2026"))
      .toMatch(/<time dateTime="2026-11-12T00:48:47.076Z" title="2026-11-12 00:48 UTC">November 11, 2026<\/time>/);
    // From November 12's page, the older card and the lists date November 11's replies the 11th.
    const html = await page(NOV12_PAGE);
    const nearby = html.slice(html.indexOf("data-nearby"), html.indexOf("<aside"));
    expect(nearby).toMatch(new RegExp(`${NOV11}</span><time dateTime="2026-11-12T00:48:47.076Z"[^>]*>November 11, 2026</time>`));
    expect(html.slice(html.indexOf("<aside"))).not.toContain(NOV11);
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});

test("Same day and More from list one row per title and day, saying how many posts it holds", async () => {
  // Newer and Older are other people's posts, so the rows below are not taken by them.
  const other = (id: string, at: string, title: string, topicId: number) => ({ ...kaivax(id, "us", 1, at, title, `${title}.`, "post"), topicId, author: "Blizzard Entertainment" });
  const restart = (id: string, n: number, at: string) => ({ ...other(id, at, "Realm restarts", 2412000), postNumber: n, startedThread: n === 1 });
  data.entries = [...thread, other("forum:31100000", "2026-11-13T12:00:00.000Z", "A later notice", 2430000), other("forum:30874280", "2026-11-12T17:46:04.799Z", "Podcast", 2412856),
    restart("forum:30870001", 1, "2026-11-12T12:00:00.000Z"), restart("forum:30870002", 2, "2026-11-12T13:00:00.000Z")];
  try {
    const html = await page(NOV12_PAGE);
    const more = html.slice(html.indexOf('id="more-from"'), html.indexOf('id="same-day"'));
    expect(more.match(new RegExp(AV, "g"))).toHaveLength(1);
    expect(more).toMatch(new RegExp(`${AV}</a>(?:<[^>]*>)*\\s*·\\s*2 posts`));
    const day = html.slice(html.indexOf('id="same-day"'));
    expect(day.match(/Realm restarts/g)).toHaveLength(1);
    expect(day).toMatch(/Realm restarts<\/a>(?:<[^>]*>)*\s*·\s*2 posts/);
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});

test("Newer and Older step through the list's rows, in the order of the day shown, never to this post's own row", async () => {
  // The page's card and Newer/Older: [label, address] in the order they show.
  const steps = (html: string) => [...html.slice(html.indexOf("data-nearby"), html.indexOf("<aside")).matchAll(/<a href="([^"]+)"[^>]*><span class="text-meta text-muted">(Newer|Older)<\/span>/g)].map((m) => [m[2], m[1]]);
  const reply = (id: string, n: number, at: string, title: string, topicId: number): ChangeEntry => ({ ...kaivax(id, "us", n, at, title, `${title} ${n}.`, "post"), topicId });
  const PVP = "PvP Faction Balance Updates - November 10";
  const pvp = [reply("forum:30830227", 1, "2026-11-10T02:05:13.558Z", PVP, 2408781), reply("forum:30830930", 170, "2026-11-10T03:30:00.000Z", PVP, 2408781)];
  // Posted after PvP's reply, but dated the 9th by its title.
  const nov9 = { ...kaivax("forum:30831500", "us", 3, "2026-11-10T04:00:00.000Z", "WoW: Forever Hotfixes - November 9, 2026", "Fixed a thing."), topicId: 2402000 };
  data.entries = [...thread, ...pvp, nov9, older];
  try {
    // November 11's second reply: its twin under the same title and day is its own row, not Older.
    expect(steps(await page("us-30863849-wow-forever-hotfixes-november-11-2026"))).toEqual([
      ["Newer", `/changes/${NOV12_PAGE}`],
      ["Older", "/changes/us-30830930-pvp-faction-balance-updates-november-10"],
    ]);
    expect(steps(await page("us-30830930-pvp-faction-balance-updates-november-10"))).toEqual([
      ["Newer", "/changes/us-30863849-wow-forever-hotfixes-november-11-2026"],
      ["Older", "/changes/us-30831500-wow-forever-hotfixes-november-9-2026"],
    ]);
  } finally {
    data.entries = [sky, eu, post, build, older, euOnly];
  }
});
