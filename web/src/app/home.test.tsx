import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import Home from "./page";
import { loadTimeline } from "@/lib/changes";

const html = renderToStaticMarkup(await Home());

test("no ticker, aurora, scroll reveal or glow", () => {
  expect(html).not.toMatch(/ticker|aurora|reveal|cta-glow/);
});

test("one job per screen: no tool grid, no database card, no agreement steps, MCP block or lore search repeat the header or the trust band", () => {
  for (const id of ['id="tools-title"', 'id="database"', 'id="agree"', 'id="ask"', 'id="lore-search"']) expect(html, id).not.toContain(id);
  // The hero's box is the page's only search; the header has its own.
  expect(html.match(/role="search"/g)).toHaveLength(1);
  expect(html).not.toContain('name="ask"');
});

test("no emoji or pictographs", () => {
  expect(html).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}]/u);
});

test("the home page says what is new, with the kind and the date of each entry", () => {
  const text = html.replace(/&#x27;|&apos;/g, "'").replace(/&middot;/g, "·").replace(/&amp;/g, "&");
  expect(text).toContain("What&#x27;s new".replace("&#x27;", "'"));
  expect(html).toContain('id="whats-new"');
  // The newest entries carry their kind and their date.
  expect(html).toMatch(/(Blue post|Hotfix|Build)<\/span>/);
  expect(text).toMatch(/· (January|February|March|April|May|June|July|August|September|October|November|December) \d+, \d{4}/);
});
test("the panel links each blue post to its page on Everloot, in blue, never to Blizzard's site", async () => {
  const start = html.indexOf('id="whats-new"');
  const panel = html.slice(start, html.indexOf("</section>", start));
  const posts = [...panel.matchAll(/<a href="([^"]+)" class="([^"]+)">/g)].filter((m) => m[1] !== "/changes");
  // A day with several new builds can fill the four lines with builds alone, so the count comes from the data.
  expect(posts.length).toBe((await loadTimeline()).slice(0, 4).filter((e) => e.type !== "build").length);
  for (const [, href, cls] of posts) {
    expect(href).toMatch(/^\/changes\/(?:us|eu|bsky)-[A-Za-z0-9]+-[a-z0-9-]+$/);
    expect(cls).toContain("text-blue-post");
  }
  expect(panel).not.toMatch(/forums\.blizzard\.com|bsky\.app/);
});
test("the panel shows a post that arrived from two regions once", async () => {
  const start = html.indexOf('id="whats-new"');
  const panel = html.slice(start, html.indexOf("</section>", start));
  // Every entry's title, linked (a post) or not (a game build): on a day with several new builds the panel
  // can hold a single post, so counting links alone fails on the data, not the page.
  const titles = [...panel.matchAll(/<li [^>]*>.*?<(?:a|span class="text-fg")[^>]*>([^<]+)<\/(?:a|span)>/g)].map((m) => m[1]);
  expect(titles.length).toBeGreaterThan(1);
  // No title is on two lines: the panel takes the folded timeline, where the regional copies are one entry.
  expect(new Set(titles).size).toBe(titles.length);
  // The fold itself: an announcement that arrived from two regions is one entry, with the other region's
  // copy under it rather than beside it. Which announcement that is changes with the day's posts, so the
  // test finds it in the data instead of naming one.
  const timeline = await loadTimeline();
  const twoRegions = timeline.find((e) => (e.copies ?? []).some((c) => (c.region ?? "us") !== (e.region ?? "us")));
  expect(twoRegions).toBeDefined();
  for (const copy of twoRegions!.copies ?? []) {
    expect(timeline.some((e) => e.id === copy.id)).toBe(false);
  }
});
test("the home page states the promise with its numbers; with no stored score every figure says unrecorded", () => {
  const block = html.slice(html.indexOf('id="promise"'), html.indexOf('id="whats-new"'));
  expect(block).toContain("Every fact shows how many players saw it, and when.");
  expect(block.match(/>unrecorded</g)).toHaveLength(3);
  expect(block).toContain("Data age unrecorded");
  expect(block).toContain('href="/addon"');
});

test("the hero searches with the header's field, a GET form to /search, the one primary button there, with three example chips", () => {
  const hero = html.slice(html.indexOf('id="hero-title"'), html.indexOf('aria-labelledby="start-here"'));
  const form = hero.match(/<form [^>]*>/)?.[0] ?? "";
  for (const attr of ['action="/search"', 'method="get"', 'role="search"']) expect(form).toContain(attr);
  const input = hero.match(/<input [^>]*id="home-search"[^>]*>/)?.[0] ?? "";
  expect(input).toContain('name="q"');
  expect(input).toContain('role="combobox"');
  expect(hero).toMatch(/<label for="home-search" class="sr-only">/);
  expect(hero.match(/btn-primary/g)).toHaveLength(1);
  const chips = hero.slice(hero.indexOf('aria-label="Examples"'));
  expect([...chips.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/database/items", "/database/quests", "/chat"]);
});


test("Start here follows the hero with server-rendered job links and no new images or draft quiz", () => {
  const start = html.indexOf('aria-labelledby="start-here"');
  const block = html.slice(start, html.indexOf("</section>", start));
  expect(start).toBeGreaterThan(html.indexOf('id="hero-title"'));
  expect(start).toBeLessThan(html.indexOf('id="promise"'));
  expect(block.match(/<li /g)).toHaveLength(9);
  expect(block.match(/<a /g)).toHaveLength(9);
  expect(block).toContain('href="/tools/talents"');
  expect(block).toContain('href="/classes"');
  expect(block).not.toContain("/classes/choose");
  expect(block).not.toContain("<img");
});
