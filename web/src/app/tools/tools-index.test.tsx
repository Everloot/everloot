import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { TOOL_GROUPS, TOOL_LINES } from "@/data/tools";
import sitemap from "@/lib/site-sitemap";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => <a href={href} className={className}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/tools" }));

afterEach(() => vi.unstubAllEnvs());

const hrefs = (html: string) => [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);

test("every Tools menu link has a one-line description", () => {
  for (const href of TOOL_GROUPS.flatMap((g) => g.links.map((l) => l.href))) expect(TOOL_LINES[href], href).toBeTruthy();
  expect(TOOL_LINES["/guilds"]).toBeTruthy();
});

test("/tools lists the menu's names and links, with the guild board while the guild switch is off", async () => {
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  for (const link of TOOL_GROUPS.flatMap((g) => g.links)) {
    expect(html, link.href).toContain(`href="${link.href}"`);
    expect(html, link.label).toContain(`>${link.label}</a>`);
  }
  expect(html).not.toContain('href="/guilds"');
});

test("/tools offers Guilds in place of the guild board with EVERLOOT_GUILDS on, as the header does", async () => {
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  expect(hrefs(html)).toContain("/guilds");
  expect(html).not.toContain('href="/tools/guild-board"');
});

test("/about names the tools as the menu does and no longer uses the old names", async () => {
  const { default: About } = await import("../about/page");
  const html = renderToStaticMarkup(<About />);
  for (const name of ["Collections", "Guild board", "Professions"]) expect(html).toContain(`>${name}</a>`);
  for (const old of ["Completionist Tracker", "Forever Guild Tracker", "Profession Hubs", "Thottbot"]) expect(html).not.toContain(old);
  expect(hrefs(html)).toContain("/tools");
  expect(hrefs(html)).not.toContain("/guilds");
});

test("the sitemap lists /tools", async () => {
  expect((await sitemap())!.map((e) => new URL(e.url).pathname)).toContain("/tools");
});

test("Alts on this device is listed on /tools with its line, and the sitemap leaves it out too", async () => {
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  expect(html).toContain('href="/tools/alts"');
  expect(html).toContain(TOOL_LINES["/tools/alts"]);
  expect((await sitemap())!.map((e) => new URL(e.url).pathname)).not.toContain("/tools/alts");
});

test("Plans on this device is listed on /tools, and the sitemap leaves the private list out", async () => {
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  expect(html).toContain('href="/tools/builds"');
  expect(html).toContain(TOOL_LINES["/tools/builds"]);
  expect((await sitemap())!.map((e) => new URL(e.url).pathname)).not.toContain("/tools/builds");
});

test("/tools gives each tool the game icon the asset upload has, and its initial when the upload has none", async () => {
  const { siteManifest } = await import("@/lib/game-assets.fixture");
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.example.test/wow_classic_beta-70450-84bea423");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(siteManifest)));
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  vi.unstubAllGlobals();
  const card = (href: string) => html.slice(html.lastIndexOf("<li", html.indexOf(`href="${href}"`)), html.indexOf("</li>", html.indexOf(`href="${href}"`)));
  // The warrior's class icon for Plans on this device; the flight legend icon for uploads; a faction crest for the census.
  expect(card("/tools/builds")).toContain("icons/6001.webp");
  expect(card("/upload")).toContain("poi/TaxiNode_Neutral.webp");
  expect(card("/census")).toMatch(/<img[^>]*src="[^"]+"/);
  // The fixture has no mage icon: the talent calculator shows its initial instead of an image.
  expect(card("/tools/talents")).not.toContain("<img");
  expect(card("/tools/talents")).toContain(">T</span>");
});
