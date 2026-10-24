import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { buildLoreRelease } from "@/test/lore-release";

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
  const { default: LoreLanding } = await import("./page");
  return renderToStaticMarkup(await LoreLanding());
}

test("the landing page states the archive's size, date, licence and notice from the manifest", async () => {
  const html = await render();
  expect(html).toContain("30 pages");
  expect(html).not.toContain("31 pages");
  expect(html).not.toContain("32 pages");
  expect(html).toContain("13 November 2023");
  expect(html).toContain("CC BY-SA 4.0");
  expect(html).toContain("Data licensed CC BY-SA 4.0.");
  expect(html).toContain('name="q"');
  expect(html).toContain("predates WoW: Forever");
  expect(html).toContain('href="/database"');
  expect(html).toContain('href="/lore/npcs"');
  expect(html).toContain('href="/lore/coverage"');
});

test("the landing page is indexed with its canonical", async () => {
  vi.stubEnv("KB_SNAPSHOT_PATH", release);
  const { metadata } = await import("./page");
  expect(metadata.alternates).toMatchObject({ canonical: "/lore" });
  expect(metadata.openGraph).toMatchObject({ title: "Lore archive · Everloot", url: "/lore" });
  expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: "Lore archive · Everloot" });
  expect(metadata.robots ?? { index: true }).toMatchObject({ index: true });
});

test("an unavailable release renders the unavailable copy, not a zero", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const html = await render(join(tmpdir(), "missing.sqlite"));
  expect(html).toContain("Lore archive unavailable");
  expect(html).not.toContain("0 pages");
  expect(html).not.toContain("Start here");
  expect(html).not.toContain('id="zones"');
});

test("the landing offers a start-here path with each page's opening sentence, and a zone list", async () => {
  const html = await render(await buildLoreRelease({ landing: true }));
  expect(html).toContain("Start here");
  expect(html).toContain('href="/lore/481380-alliance"');
  expect(html).toContain("The Alliance is one of two major factions.");
  expect(html).not.toContain("A quote set as a list.");
  expect(html).toContain('href="/lore/19317-orc"');
  // Start-here ids the release lacks are skipped, never linked.
  expect(html).not.toContain('href="/lore/360548');
  expect(html).toContain('id="zones"');
  expect(html).toContain('href="/lore/zones"');
  expect(html.indexOf('href="/lore/201-ashenvale"')).toBeGreaterThan(-1);
  expect(html.indexOf('href="/lore/201-ashenvale"')).toBeLessThan(html.indexOf('href="/lore/200-durotar"'));
  // A town has a zone type but not the zone infobox.
  expect(html).not.toContain("202-razor-hill");
  // A "(Classic)" page is dropped only when its twin without the suffix is listed.
  expect(html).not.toContain("203-durotar-classic");
  expect(html).toContain('href="/lore/204-silithus-classic"');
  expect(html).toContain("3 pages carry the wiki");
  // The full list sits in a closed disclosure; the browse link stays outside it.
  const details = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
  expect(details).toContain("All zone pages");
  expect(details).toContain('href="/lore/200-durotar"');
  expect(details).not.toMatch(/^<details[^>]*\sopen/);
  expect(details).not.toContain('href="/lore/zones"');
  expect(html.indexOf('href="/lore/zones"')).toBeLessThan(html.indexOf("<details"));
  // The zone rows the shared fixture has without an infobox stay out.
  expect(html).not.toContain('href="/lore/100-zone-1"');
});

test("without the landing rows the new sections are left out, not shown empty", async () => {
  const html = await render();
  expect(html).not.toContain("Start here");
  expect(html).not.toContain('id="zones"');
});

test("a release without type data keeps Start here and leaves out the zone list", async () => {
  const html = await render(await buildLoreRelease({ typed: false, landing: true }));
  expect(html).toContain("Start here");
  expect(html).toContain('href="/lore/481380-alliance"');
  expect(html).not.toContain('id="zones"');
  expect(html).not.toContain('href="/lore/npcs"');
});
