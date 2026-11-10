import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, className, "aria-current": current }: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => (
    <a href={href} aria-current={current} className={className}>{children}</a>
  ),
}));
// AccountControls renders for real: on the server it has not looked the account up yet, so it shows the signed-out
// side (Get the addon), as the static page does.
vi.mock("next/navigation", () => ({ usePathname: () => "/database/items/2589", useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./CookieConsent", () => ({ CookiePreferencesButton: () => <button type="button">Cookie preferences</button> }));

import Header, { PRIMARY, TOOL_GROUPS } from "./Header";
import Footer from "./Footer";
import { toolHref, tools } from "@/data/tools";
import { DATA_SIZE } from "@/design/tokens";

const html = renderToStaticMarkup(<Header />);
const primary = html.match(/<nav aria-label="Primary"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
// The bar's own items carry the underline class; the Tools menu's links do not.
const topItems = () => [...primary.matchAll(/<(?:a|button) [^>]*class="[^"]*border-b-2[^"]*"[^>]*>([^<]+)/g)].map((m) => m[1].trim());

test("the top bar has seven items in the spec's order, Ask after Tools", () => {
  expect(topItems()).toEqual(["Database", "Tools", "Ask", "Map", "Changes", "Lore", "Docs"]);
  expect(PRIMARY.map((l) => l.href)).toEqual(["/database", "/chat", "/map", "/changes", "/lore", "/docs"]);
});

test("no bracket labels", () => {
  expect(html).not.toMatch(/>\[</);
  expect(html).not.toMatch(/>\]</);
});

test("Tools is a disclosure button; its links are in the HTML, hidden until opened", () => {
  expect(primary).toMatch(/<button type="button" aria-expanded="false" aria-controls="tools-menu"/);
  expect(html).toMatch(/<div id="tools-menu" hidden="" class="[^"]*\bhidden\b/);
  for (const href of TOOL_GROUPS.flatMap((g) => g.links.map((l) => l.href))) expect(html, href).toContain(`href="${href}"`);
});

test("the current section is marked", () => {
  expect(primary).toMatch(/<a href="\/database" aria-current="page"/);
});

test("Get the addon is the primary pill and leads to /addon", () => {
  expect(html).toMatch(/<a href="\/addon" class="btn btn-primary[^"]*"><span class="sm:hidden">Download<\/span><span class="hidden sm:inline">Get the addon<\/span><\/a>/);
});

test("the bar is compact: 44 px (two thirds of the old 64), the search centred, the build label kept from 1280 px", () => {
  expect(DATA_SIZE.header).toBe(44);
  const bar = html.match(/<header [^>]*>\s*<div class="([^"]*)"/)?.[1] ?? "";
  expect(bar.split(" ")).toContain("h-header");
  expect(bar).not.toContain("min-h-16");
  // The search sits in its own growing slot, centred between the nav and the account area.
  expect(html).toMatch(/<div class="[^"]*\bflex-1\b[^"]*\bjustify-center\b[^"]*"><form [^>]*role="search"/);
  // Both builds take ~260 px; below xl the right group has no room for them, so the menu panel carries them.
  expect(html).toMatch(/<div class="[^"]*\bhidden shrink-0 xl:block\b[^"]*"><a [^>]*>files read /);
  // Tighter nav items.
  expect(primary).toMatch(/<a href="\/map"[^>]*class="[^"]*\bpx-2\b/);
});

test("search is in the bar: a GET form to the site search, named Search Everloot", () => {
  const form = html.match(/<form [^>]*>/)?.[0] ?? "";
  expect(form).toContain('role="search"');
  expect(form).toContain('action="/search"');
  expect(form).toContain('method="get"');
  expect(html).toContain('name="q"');
  expect(html).toContain('placeholder="Search Everloot"');
  expect(html).toContain(">Search Everloot</label>");
  expect(html).not.toContain("Search the archive");
});

test("Plans on this device is in the Plan group, after the calculator, and private in the catalogue", () => {
  const plan = TOOL_GROUPS.find((g) => g.title === "Plan")!.links;
  expect(plan.slice(0, 2)).toEqual([{ label: "Talent calculator", href: "/tools/talents" }, { label: "Plans on this device", href: "/tools/builds" }]);
  expect(html).toContain('href="/tools/builds"');
  expect(tools.find((t) => toolHref(t) === "/tools/builds")).toMatchObject({ private: true });
});

test("Alts on this device is in the Plan group, after Plans on this device, and private in the catalogue", () => {
  const plan = TOOL_GROUPS.find((g) => g.title === "Plan")!.links;
  expect(plan.slice(1, 3)).toEqual([{ label: "Plans on this device", href: "/tools/builds" }, { label: "Alts on this device", href: "/tools/alts" }]);
  expect(html).toContain('href="/tools/alts"');
  expect(tools.find((t) => toolHref(t) === "/tools/alts")).toMatchObject({ private: true });
});

test("every grouped tool in the catalogue is in the Tools menu, and Database stays in the top bar only", () => {
  const menu = TOOL_GROUPS.flatMap((g) => g.links.map((l) => l.href));
  const grouped = tools.filter((t) => t.group);
  for (const tool of grouped) {
    expect(menu, tool.slug).toContain(toolHref(tool));
    expect(html, tool.slug).toContain(`href="${toolHref(tool)}"`);
  }
  expect(menu).toHaveLength(grouped.length);
  expect(menu).not.toContain("/database");
  expect(tools.filter((t) => !t.group).map((t) => t.slug)).toEqual(["database"]);
  expect(new Set(menu).size).toBe(menu.length);
});

test("every destination the old header linked is still one click from the header or footer", () => {
  const footer = renderToStaticMarkup(<Footer />);
  const reachable = new Set([
    ...PRIMARY.map((l) => l.href),
    ...TOOL_GROUPS.flatMap((g) => g.links.map((l) => l.href)),
    ...[...footer.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
  ]);
  const old = ["/database", "/lore", "/map", "/changes", "/upload", "/addons", "/docs", "/census", "/about", ...tools.map(toolHref)];
  for (const href of old) expect(reachable.has(href), href).toBe(true);
});

test("the wordmark is the diamond and a lowercase everloot", () => {
  const home = html.match(/<a href="\/"[^>]*>(.*?)<\/a>/)?.[1] ?? "";
  expect(home).toContain("<svg aria-hidden=\"true\"");
  expect(home).toContain("everloot");
});

test("no shadows", () => {
  expect(html).not.toContain("shadow-");
});
