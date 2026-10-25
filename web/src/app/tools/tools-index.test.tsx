import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { TOOL_GROUPS, TOOL_LINES } from "@/data/tools";
import sitemap from "../sitemap";

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
  const html = renderToStaticMarkup(<ToolsPage />);
  for (const link of TOOL_GROUPS.flatMap((g) => g.links)) {
    expect(html, link.href).toContain(`href="${link.href}"`);
    expect(html, link.label).toContain(`>${link.label}</a>`);
  }
  expect(html).not.toContain('href="/guilds"');
});

test("/tools offers Guilds in place of the guild board with EVERLOOT_GUILDS on, as the header does", async () => {
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  const { default: ToolsPage } = await import("./page");
  const html = renderToStaticMarkup(<ToolsPage />);
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
  expect((await sitemap()).map((e) => new URL(e.url).pathname)).toContain("/tools");
});
