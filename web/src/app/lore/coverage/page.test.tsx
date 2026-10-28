import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";
import { spyOnQueries } from "@/test/release-queries";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

let release = "";
beforeAll(async () => { release = await buildLoreRelease(); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); });

async function render(path = release) {
  vi.stubEnv("KB_SNAPSHOT_PATH", path);
  const { default: CoveragePage } = await import("./page");
  return renderToStaticMarkup(await CoveragePage());
}

test("the coverage page reports types, facets, pages, damage and the release date", async () => {
  const html = await render();
  expect(html).toMatch(/Zones and locations<\/a><\/td><td[^>]*>23</);
  expect(html).toMatch(/NPCs and characters<\/a><\/td><td[^>]*>3</);
  expect(html).toContain("Legion");
  expect(html).toContain("Orc");
  expect(html).toMatch(/Full pages[\s\S]{0,120}>28</);
  expect(html).toMatch(/Damaged pages[\s\S]{0,120}>1</);
  expect(html).toContain("2026-10-15");
  expect(html).toContain("not WoW: Forever data");
  expect(html).toContain('href="/lore/zones"');
});

test("a release without type data shows totals only and says it predates classification", async () => {
  const html = await render(await buildLoreRelease({ typed: false }));
  expect(html).toContain("This release predates classification.");
  expect(html).toContain("30"); // wiki pages from the manifest counts
  expect(html).toContain("not measured");
});

test("metadata is indexed with its canonical, and noindex when the release is unavailable", async () => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { generateMetadata } = await import("./page");
  const meta = await generateMetadata();
  expect(meta.alternates).toMatchObject({ canonical: "/lore/coverage" });
  expect(meta.robots).toMatchObject({ index: true });
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("KB_SNAPSHOT_PATH", join(tmpdir(), "missing.sqlite"));
  const mod = await import("./page");
  expect((await mod.generateMetadata()).robots).toMatchObject({ index: false, follow: true });
});

test("an untyped release runs no facet scans", async () => {
  vi.stubEnv("KB_SNAPSHOT_PATH", await buildLoreRelease({ typed: false }));
  const { getRelease } = await import("@/lib/release");
  const spy = spyOnQueries((await getRelease())!.db);
  const { default: CoveragePage } = await import("./page");
  renderToStaticMarkup(await CoveragePage());
  expect(spy.mock.calls.filter(([sql]) => /json_each/.test(String(sql)))).toHaveLength(0);
});

test("an unavailable release renders the unavailable copy", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await render(join(tmpdir(), "missing.sqlite"))).toContain("Lore archive unavailable");
});
