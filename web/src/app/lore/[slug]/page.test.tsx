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
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  permanentRedirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

let release = "";
beforeAll(async () => { release = await buildLoreRelease(); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); });

async function page(path = release) {
  vi.stubEnv("KB_SNAPSHOT_PATH", path);
  return import("./page");
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

test("a Warcraft Wiki copy keeps its name, canonical slug and first sentence, and stays out of search (links followed)", async () => {
  const { generateMetadata } = await page();
  const meta = await generateMetadata(params("1-thrall"));
  expect(meta.title).toBe("Thrall · Lore archive");
  expect(meta.robots).toMatchObject({ index: false, follow: true });
  expect(meta.alternates).toMatchObject({ canonical: "/lore/1-thrall" });
  expect(meta.description).toBe("Thrall is the former Warchief of the Horde.");
  expect(meta.openGraph).toMatchObject({ type: "article", title: "Thrall", description: "Thrall is the former Warchief of the Horde.", url: "/lore/1-thrall" });
  expect(meta.twitter).toMatchObject({ card: "summary", title: "Thrall" });
});

test("stubs and redirects are served but kept out of search engines", async () => {
  const { generateMetadata } = await page();
  expect((await generateMetadata(params("2-stub"))).robots).toMatchObject({ index: false, follow: true });
  expect((await generateMetadata(params("3-old-name"))).robots).toMatchObject({ index: false, follow: true });
});

test("the page shows the body, attribution and the predates-Forever note", async () => {
  const { default: LorePage } = await page();
  const html = renderToStaticMarkup(await LorePage(params("1-thrall")));
  expect(html).toContain("Lore archive · Warcraft Wiki, 2023 dump");
  expect(html).toContain("<h1");
  expect(html).toContain("Thrall is the former Warchief of the Horde.");
  expect(html).toContain("<li>Son of Durotan</li>");
  // The one source line the licence asks for: the page's own source, its authors and the licence.
  expect(html.match(/data-lore-source/g)).toHaveLength(1);
  expect(html).toMatch(/Source: <a href="https:\/\/warcraft\.wiki\.gg\/wiki\/Thrall"[^>]*>Warcraft Wiki<\/a> contributors, /);
  expect(html).toContain("CC BY-SA 4.0");
  expect(html).not.toContain("data-source-line");
  expect(html).toContain("Converted from wikitext with templates, tables and images removed, so some sentences may be missing values.");
  expect(html).toContain("Orcs");
  expect(html).toContain("2023-01-14");
  expect(html).toContain("predates WoW: Forever");
  expect(html).toContain('href="/database"');
});

test("a stale name part redirects to the canonical slug", async () => {
  const { default: LorePage } = await page();
  await expect(LorePage(params("1-wrong"))).rejects.toThrow("REDIRECT:/lore/1-thrall");
});

test("malformed slugs and unknown ids are not found", async () => {
  const { default: LorePage, generateMetadata } = await page();
  for (const slug of ["01-thrall", "abc", "999-x", "1-Thrall"]) {
    await expect(LorePage(params(slug))).rejects.toThrow("NOT_FOUND");
  }
  expect((await generateMetadata(params("abc"))).robots).toMatchObject({ index: false });
});

test("a curated row is labelled with its source and game version", async () => {
  const { default: LorePage } = await page();
  const html = renderToStaticMarkup(await LorePage(params("forever-launch-date")));
  expect(html).toContain("Lore archive · curated · forever");
  expect(html).toContain("November 4, 2026");
  expect(html).not.toContain("Converted from wikitext");
  expect(html).not.toContain("predates WoW: Forever");
  expect(html).toContain("https://news.blizzard.com/example");
  expect(html).toContain('href="/wow-forever"');
});

test("lore pages are cached for a day and built on first request, not at build time", async () => {
  const mod = await page();
  expect((mod as Record<string, unknown>).dynamic).toBeUndefined();
  expect(mod.revalidate).toBe(86400);
  expect(mod.generateStaticParams()).toEqual([]);
});

test("an unavailable release fails the render, which Next never caches, and is not indexed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { default: LorePage, generateMetadata } = await page(join(tmpdir(), "missing.sqlite"));
  await expect(LorePage(params("1-thrall"))).rejects.toThrow("Lore archive unavailable");
  expect((await generateMetadata(params("1-thrall"))).robots).toMatchObject({ index: false });
});

test("type and facets link to the browse views and the infobox renders as a definition list", async () => {
  const { default: LorePage } = await page();
  const html = renderToStaticMarkup(await LorePage(params("1-thrall")));
  expect(html).toContain('href="/lore/npcs"');
  expect(html).toContain('href="/lore/npcs?race=Orc"');
  expect(html).toContain('href="/lore/npcs?class=Shaman"');
  expect(html).toContain("Details from the wiki infobox");
  expect(html).toMatch(/<dt[^>]*>title<\/dt><dd[^>]*>Warchief<\/dd>/);
});

test("an untyped page carries no type links and no infobox section", async () => {
  const { default: LorePage } = await page();
  const html = renderToStaticMarkup(await LorePage(params("2-stub")));
  expect(html).not.toContain('href="/lore/npcs"');
  expect(html).not.toContain("Details from the wiki infobox");
});


test("article navigation is available before the archived text and every jump has a target", async () => {
  const { default: LorePage } = await page();
  const html = renderToStaticMarkup(await LorePage(params("1-thrall")));
  expect(html).toContain('aria-label="Article sections"');
  expect(html.indexOf('aria-label="Article sections"')).toBeLessThan(html.indexOf("Thrall is the former Warchief"));
  for (const id of ["lore-text", "infobox", "categories"]) {
    expect(html).toContain(`href="#${id}"`);
    expect(html).toContain(`id="${id}"`);
  }
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain("Article text");
  // The plain-text archive has no source headings: navigation must not fabricate story sections.
  expect(html).not.toMatch(/>History<|>Biography</);
});
