import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { BlueWriteup, ChangeEntry } from "@/lib/changes";
import { MAX_EXCERPT_CHARS } from "../../../../../kb/src/text-safety";

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
  expect(html).toMatch(/<figure data-excerpt="true" class="[^"]*border-blue-post[^"]*"><blockquote cite="https:\/\/us\.forums[^"]*" class="text-blue-post"><p>Get ready to make your mark in Azeroth! Name reservations open soon\.<\/p><\/blockquote><figcaption[^>]*>Blizzard(&#x27;|')s words, an excerpt\.<\/figcaption>/);
  expect(html).toMatch(/<a data-original="true" href="https:\/\/us\.forums\.blizzard\.com\/en\/wow\/t\/claim-your-world-of-warcraft-forever-character-names\/2387945" rel="noopener"[^>]*>Read the full post on Blizzard(&#x27;|')s forums<\/a>/);
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

test("More from the author and Same day link to the other posts' pages, never to builds, the post itself or its copies", async () => {
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
  // The newest post has no newer neighbour: its card is an empty cell, the older one stays.
  const newest = await page("bsky-3mydklukhq22f-good-news-everyone");
  const top = newest.slice(newest.indexOf('data-nearby'), newest.indexOf('id="same-day"'));
  expect(top).not.toContain(">Newer</span>");
  expect(top).toContain(`href="/changes/${CANONICAL}"`);
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

test("a write-up filed under a regional copy shows on the announcement's page, which is then indexable", async () => {
  data.writeups = new Map([["forum:eu:6443686", { ...writeup, postId: "forum:eu:6443686" }]]);
  expect((await meta(CANONICAL)).robots).toEqual({ index: true, follow: true });
  const html = await page(CANONICAL);
  expect(html).toContain("<p>Name reservations are a week long. Three names per account.</p>");
  expect(html).toContain('"@type":"Article"');
});