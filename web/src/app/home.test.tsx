import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import Home from "./page";
import { loadTimeline } from "@/lib/changes";

const html = renderToStaticMarkup(await Home());

test("no ticker, aurora, scroll reveal or glow", () => {
  expect(html).not.toMatch(/ticker|aurora|reveal|cta-glow/);
});

test("tool status keeps its meaning: a tool still collecting shows the 0-of-3 meter, a planned one says so, a live one carries no label", () => {
  const list = html.slice(html.indexOf('id="tools-title"'), html.indexOf('id="agree"'));
  const row = (href: string) => list.slice(list.indexOf(`href="${href}"`), list.indexOf("</a>", list.indexOf(`href="${href}"`)));
  expect(row("/tools/guild-board")).toContain('aria-label="0 of 3 installs agree"');
  expect(row("/tools/farming-routes")).toMatch(/text-muted[^"]*"[^>]*>Planned</);
  expect(row("/tools/raid")).not.toMatch(/installs agree|Planned/);
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
test("the panel links each blue post to its page on Everloot, in blue, never to Blizzard's site", () => {
  const start = html.indexOf('id="whats-new"');
  const panel = html.slice(start, html.indexOf("</section>", start));
  const posts = [...panel.matchAll(/<a href="([^"]+)" class="([^"]+)">/g)].filter((m) => m[1] !== "/changes");
  expect(posts.length).toBeGreaterThan(0);
  for (const [, href, cls] of posts) {
    expect(href).toMatch(/^\/changes\/(?:us|eu|bsky)-[A-Za-z0-9]+-[a-z0-9-]+$/);
    expect(cls).toContain("text-blue-post");
  }
  expect(panel).not.toMatch(/forums\.blizzard\.com|bsky\.app/);
});
test("the panel shows a post that arrived from two regions once", async () => {
  const start = html.indexOf('id="whats-new"');
  const panel = html.slice(start, html.indexOf("</section>", start));
  const titles = [...panel.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]).filter((t) => !t.startsWith("Every change"));
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