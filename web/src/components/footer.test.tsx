import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("./CookieConsent", () => ({ CookiePreferencesButton: () => <button type="button">Cookie preferences</button> }));

import Footer from "./Footer";
import { TRADEMARK_LINE } from "@/lib/jsonld";

afterEach(() => { vi.unstubAllEnvs(); });

const html = () => renderToStaticMarkup(<Footer />);

test("links the four verified social profiles on desktop and mobile", () => {
  const markup = html();
  for (const href of ["https://x.com/WowEverloot", "https://www.facebook.com/WowEverloot", "https://www.instagram.com/woweverloot/", "https://www.pinterest.com/woweverloot/"]) {
    expect(markup.split(`href="${href}"`).length - 1, href).toBe(2);
  }
});
const text = () => html().replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function sourceHref(): string | undefined {
  return html().match(/<a href="([^"]+)"[^>]*>Source<\/a>/)?.[1];
}

test("links Source to the deployed commit", () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc1234");
  expect(sourceHref()).toBe("https://github.com/Everloot/everloot/tree/abc1234");
});

test("links Source to the repository when no commit is known", () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  expect(sourceHref()).toBe("https://github.com/Everloot/everloot");
});

test("ignores a malformed sha", () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "../x");
  expect(sourceHref()).toBe("https://github.com/Everloot/everloot");
});

test("names the deployed build only when one is known", () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc1234def5678");
  expect(text()).toContain("Build abc1234");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  expect(text()).not.toContain("Build ");
});

test("states the code and data licences", () => {
  expect(text()).toContain("R21 Media Group, LLC. ");
  expect(text()).toContain("Code AGPL-3.0.");
  expect(text()).toContain("Everloot data CC BY-SA 4.0");
});

test("one site-wide credit line, linked to the full credits on /methodology", () => {
  expect(text()).toContain("Game data and art © Blizzard Entertainment · Everloot data CC BY-SA 4.0 · Item and quest names from the Warcraft Wiki (CC BY-SA 4.0) · Credits");
  expect(html()).toMatch(/<p data-site-credit[^>]*>[\s\S]*href="\/methodology#credits"[\s\S]*<\/p>/);
});

test("carries the full Blizzard trademark sentence", () => {
  expect(text()).toContain(TRADEMARK_LINE);
  expect(TRADEMARK_LINE).toContain("registered trademarks of Blizzard Entertainment, Inc.");
});

test("links How we count and the Discord invite", () => {
  expect(html()).toContain('href="/methodology"');
  expect(html()).toContain('href="https://discord.gg/9CKsbHTRu3"');
});

test("links every legal page and the privacy choices anchor", () => {
  const markup = html();
  for (const href of ["/privacy", "/terms", "/security", "/privacy#choices", "/terms#takedown", "/contact"]) {
    expect(markup, href).toContain(`href="${href}"`);
  }
  expect(markup).toContain("Cookie preferences");
});

test("groups the links under their names: one line each on a wide screen, a disclosure each on a phone", () => {
  const markup = html();
  expect(markup).toContain('aria-label="Footer"');
  for (const heading of ["Browse", "Data and API", "Project"]) {
    expect(markup).toMatch(new RegExp(`<h2[^>]*>${heading}</h2>`));
    expect(markup).toMatch(new RegExp(`<summary[^>]*>${heading}<svg`));
  }
  expect(markup.match(/<details/g)).toHaveLength(3);
  expect(markup).toContain('<h2 class="sr-only">Legal</h2>');
});

test("is compact: two rows, no four-column block", () => {
  const markup = html();
  expect(markup).not.toMatch(/grid-cols-\[2fr/);
  expect(markup).not.toContain("pt-12");
  // Row one: the wordmark, the tagline, the groups and the icons; row two: the legal links over the small print.
  expect(text()).toContain("The WoW: Forever database, written by its players.");
  expect(markup).toMatch(/aria-label="Discord"[\s\S]*aria-label="GitHub"/);
});

test("keeps every link the four-column footer had", () => {
  const markup = html();
  const before = [
    "/database", "/map", "/changes", "/news", "/lore", "/addons",
    "/addon", "/upload", "/docs", "/methodology", "https://github.com/Everloot/everloot/blob/main/docs/DATA_POLICY.md", "/changes/feed.xml", "/news/feed.xml",
    "/about", "/contact", "https://discord.gg/9CKsbHTRu3", "https://github.com/Everloot/everloot",
    "https://github.com/Everloot/everloot/blob/main/CONTRIBUTING.md", "/security",
    "/privacy", "/terms", "/privacy#choices", "/terms#takedown", "/terms#trademarks", "/accessibility",
    "/methodology#credits", "mailto:hello@everloot.app", "/",
  ];
  for (const href of before) expect(markup, href).toContain(`href="${href}"`);
});

test("Glint perches on the footer's edge as a labelled button, his drawing hidden from screen readers", () => {
  const markup = html();
  expect(markup).toMatch(/data-footer-glint[\s\S]*<button[^>]*aria-label="Glint, the loot raven"[^>]*>\s*<svg[^>]*aria-hidden="true"/);
  expect(markup).toMatch(/data-footer-glint[\s\S]*aria-live="polite"/);
});

test("says when the beta ends and when the game launches", () => {
  const t = text();
  // The beta's last day has passed, so the sentence is in the past; the launch is still ahead.
  expect(t).toContain("The beta ran until October 23, 2026");
  expect(t).toContain("the game launches November 4, 2026");
});
