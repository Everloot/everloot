import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { TOOL_GROUPS, TOOL_LINES, getTool } from "@/data/tools";
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

test("the catalogue keeps the old slugs with the current names and destinations", () => {
  expect(getTool("completionist")).toMatchObject({ title: "Collections", shortTitle: "Collections", href: "/tools/collections" });
  expect(getTool("guild-tracker")).toMatchObject({ title: "Guild board", shortTitle: "Guild board", href: "/tools/guild-board" });
});

test("/tools lists every tool the header offers, under the header's group names, in the menus' order", async () => {
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  const headings = [...html.matchAll(/<h2 [^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  expect(headings).toEqual(["Lookup", "Tools", "Guides", "Profile"]);
  expect(hrefs(html)).toEqual(TOOL_GROUPS.flatMap((g) => g.links.map((l) => l.href)));
  for (const href of ["/tools/auctions", "/tools/bags", "/tools/disenchanting", "/tools/guild-board", "/tools/raid", "/tools/talents", "/tools/professions", "/tools/legacy", "/tools/gold-ledger", "/tools/builds", "/tools/alts"]) {
    expect(hrefs(html), href).toContain(href);
  }
  // Each card under its own group's heading, with its one line.
  const section = (title: string) => html.slice(html.indexOf(`>${title}</h2>`), html.indexOf("</section>", html.indexOf(`>${title}</h2>`)));
  for (const group of TOOL_GROUPS) {
    for (const link of group.links) {
      expect(section(group.title), link.label).toContain(`>${link.label}</a>`);
      expect(section(group.title), link.href).toContain(TOOL_LINES[link.href].replaceAll("'", "&#x27;"));
    }
  }
  expect(TOOL_GROUPS.find((g) => g.title === "Tools")!.links.map((l) => l.label)).toEqual(["Raid builder", "Talent calculator", "Professions"]);
});

test("/tools leaves out the tools hidden until polished, and the top bar's own items (Database, Chat)", async () => {
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  expect(getTool("farming-routes")).toMatchObject({ group: "Tools", hidden: true });
  for (const href of ["/tools/farming-routes", "/tools/collections", "/upload", "/chat", "/database", "/guilds"]) {
    expect(html, href).not.toContain(`href="${href}"`);
  }
});

test("with the guild switch on, /tools offers Guilds in place of the guild board", async () => {
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  expect(html).toContain('<a href="/guilds"');
  expect(html).toContain(">Guilds</a>");
  expect(html).not.toContain('href="/tools/guild-board"');
});

test("/about names the tools as the menu does and no longer uses the old names", async () => {
  const { default: About } = await import("../about/page");
  const html = renderToStaticMarkup(<About />);
  for (const name of ["Guild board", "Professions"]) expect(html).toContain(`>${name}</a>`);
  // Hidden until polished.
  expect(hrefs(html)).not.toContain("/tools/collections");
  for (const old of ["Completionist Tracker", "Forever Guild Tracker", "Profession Hubs", "Thottbot"]) expect(html).not.toContain(old);
  expect(hrefs(html)).toContain("/tools");
  expect(hrefs(html)).not.toContain("/guilds");
});

test("the sitemap lists /tools", async () => {
  expect((await sitemap())!.map((e) => new URL(e.url).pathname)).toContain("/tools");
});

test("Plans and Alts on this device are in Profile, keep their lines, and the sitemap leaves the private lists out", async () => {
  const profile = TOOL_GROUPS.find((g) => g.title === "Profile")!.links.map((l) => l.href);
  const paths = (await sitemap())!.map((e) => new URL(e.url).pathname);
  for (const href of ["/tools/alts", "/tools/builds"]) {
    expect(profile, href).toContain(href);
    expect(TOOL_LINES[href], href).toBeTruthy();
    expect(paths, href).not.toContain(href);
  }
});

test("/tools gives each tool the game icon the asset upload has, and its initial when the upload has none", async () => {
  const { siteManifest } = await import("@/lib/game-assets.fixture");
  vi.stubEnv("NEXT_PUBLIC_GAME_ASSETS_URL", "https://assets.example.test/wow_classic_beta-70450-84bea423");
  // The fixture plus a paladin icon, which the raid builder falls back to when the upload has no raid legend icon.
  const manifest = { ...siteManifest, classes: { ...siteManifest.classes, paladin: { classId: 2, name: "Paladin", icon: "6201.webp", trees: [] } } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(manifest)));
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(await ToolsPage());
  vi.unstubAllGlobals();
  const card = (href: string) => html.slice(html.lastIndexOf("<li", html.indexOf(`href="${href}"`)), html.indexOf("</li>", html.indexOf(`href="${href}"`)));
  expect(card("/tools/raid")).toContain("icons/6201.webp");
  // The fixture has no mage icon: the talent calculator shows its initial instead of an image.
  expect(card("/tools/talents")).not.toContain("<img");
  expect(card("/tools/talents")).toContain(">T</span>");
});
