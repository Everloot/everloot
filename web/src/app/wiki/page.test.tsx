import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));

const FIXTURES = fileURLToPath(new URL("../../test/wiki", import.meta.url));
afterEach(() => { vi.unstubAllEnvs(); });

test("the hub lists published pages by type and the most recent first, with a title filter and the 2023 archive apart", async () => {
  vi.stubEnv("WIKI_DIR", FIXTURES);
  const { default: WikiHub, generateMetadata } = await import("./page");
  const html = renderToStaticMarkup(WikiHub());
  expect(html).toContain('<input id="wiki-q" type="search"');
  expect(html).toMatch(/>Dungeons<\/h2>[\s\S]*href="\/wiki\/test-dungeon"/);
  expect(html).toMatch(/>Zones<\/h2>[\s\S]*href="\/wiki\/test-zone"/);
  // A page with no entrance bound yet is listed like any other.
  expect(html).toMatch(/>Dungeons<\/h2>[\s\S]*href="\/wiki\/test-new-dungeon"/);
  expect(html).not.toContain("test-draft");
  // Recent: reviewed 2026-10-27 before 2026-10-26.
  const recent = html.slice(html.indexOf(">Recent pages<"), html.indexOf('id="wiki-q"'));
  expect(recent.indexOf("Test Dungeon")).toBeLessThan(recent.indexOf("Test Zone"));
  expect(html).toMatch(/>Lore archive, 2023<\/h2>[\s\S]*href="\/lore"/);
  // How a page is proposed: a line under the index to the guide.
  expect(html).toMatch(/<\/h2>[\s\S]*href="\/docs\/guides\/wiki"[^>]*>Write a page</);
  const meta = await generateMetadata();
  expect(meta.robots).toEqual({ index: true, follow: true });
  expect(meta.alternates?.canonical).toBe("/wiki");
  expect(String(meta.description).length).toBeGreaterThanOrEqual(120);
  expect(String(meta.description).length).toBeLessThanOrEqual(160);
});

test("with no published page the hub says so and stays out of search", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wiki-"));
  for (const f of ["test-draft.md", "categories.yaml"]) copyFileSync(join(FIXTURES, f), join(dir, f));
  vi.stubEnv("WIKI_DIR", dir);
  const { default: WikiHub, generateMetadata } = await import("./page");
  const html = renderToStaticMarkup(WikiHub());
  expect(html).toContain("No pages are published yet.");
  expect(html).toContain('href="/lore"');
  expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
});
