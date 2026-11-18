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

import Header, { TOOL_GROUPS, currentItem, navItems, phoneGroups } from "./Header";
import Footer from "./Footer";
import { toolHref, tools } from "@/data/tools";
import { DATA_SIZE } from "@/design/tokens";

const html = renderToStaticMarkup(<Header />);
const primary = html.match(/<nav aria-label="Primary"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
// The bar's own items carry the underline class; the menus' links do not.
const topItems = () => [...primary.matchAll(/<(?:a|button) [^>]*class="[^"]*border-b-2[^"]*"[^>]*>([^<]+)/g)].map((m) => m[1].trim());
const menuHrefs = (label: string, items = navItems()) => items.find((i) => i.label === label)!.links!.map((l) => l.href);
const hidden = tools.filter((t) => t.hidden).map(toolHref);

test("the top bar is Lookup, Database, Tools, Guides, Chat and Profile; Chat is a link, the rest open menus", () => {
  expect(topItems()).toEqual(["Lookup", "Database", "Tools", "Guides", "Chat", "Profile"]);
  expect(navItems().map((i) => i.label)).toEqual(["Lookup", "Database", "Tools", "Guides", "Chat", "Profile"]);
  expect(primary).toMatch(/<a href="\/chat"[^>]*>Chat<\/a>/);
  for (const id of ["lookup", "database", "tools", "guides", "profile"]) {
    expect(primary).toMatch(new RegExp(`<button id="${id}-menu-button" type="button" aria-expanded="false" aria-controls="${id}-menu"`));
  }
});

test("Lookup holds the live data: census, rankings, the guild board, the Auction House, bag prices and addons", () => {
  expect(menuHrefs("Lookup")).toEqual(["/census", "/rankings", "/tools/guild-board", "/tools/auctions", "/tools/bags", "/addons"]);
  // The switches put the character search first and Guilds in place of the guild board.
  expect(menuHrefs("Lookup", navItems({ players: true, guilds: true }))).toEqual(["/players", "/census", "/rankings", "/guilds", "/tools/auctions", "/tools/bags", "/addons"]);
});

test("Database holds the reference pages and the map", () => {
  expect(menuHrefs("Database")).toEqual(["/database", "/database/items", "/database/npcs", "/database/quests", "/database/zones", "/database/spells", "/map"]);
});

test("Tools holds the planners, most used first, then the card page", () => {
  expect(menuHrefs("Tools")).toEqual(["/tools/raid", "/tools/talents", "/tools/professions", "/tools"]);
});

test("Guides holds the guides, Legacy perks, lore and changes", () => {
  expect(menuHrefs("Guides")).toEqual(["/guides", "/tools/legacy", "/lore", "/changes"]);
});

test("Profile holds the account pages and the lists kept on this device; Settings and My builds follow their switches", () => {
  expect(menuHrefs("Profile")).toEqual(["/account", "/tools/gold-ledger", "/tools/builds", "/tools/alts"]);
  expect(menuHrefs("Profile", navItems({ profiles: true, savedBuilds: true }))).toEqual(["/account", "/settings", "/me", "/tools/gold-ledger", "/tools/builds", "/tools/alts"]);
});

test("Farming, Collections and Upload are hidden until polished: no menu, phone menu or footer links them", () => {
  expect([...hidden].sort()).toEqual(["/tools/collections", "/tools/farming-routes", "/upload"]);
  const footer = renderToStaticMarkup(<Footer />);
  const everything = [true, false].flatMap((on) => phoneGroups(navItems({ guilds: on, players: on, profiles: on, savedBuilds: on })).flatMap((g) => g.links.map((l) => l.href)));
  for (const href of hidden) {
    expect(everything, href).not.toContain(href);
    expect(html, href).not.toContain(`href="${href}"`);
    expect(footer, href).not.toContain(`href="${href}"`);
  }
});

test("the phone menu has the same groups in the same order, then More with Chat, Docs and About", () => {
  const groups = phoneGroups(navItems());
  expect(groups.map((g) => g.label)).toEqual(["Lookup", "Database", "Tools", "Guides", "Profile", "More"]);
  for (const g of groups.slice(0, -1)) expect(g.links).toEqual(navItems().find((i) => i.label === g.label)!.links);
  expect(groups.at(-1)!.links.map((l) => l.href)).toEqual(["/chat", "/docs", "/about"]);
});

test("the item holding the page is marked, by its longest matching link", () => {
  expect(currentItem("/database/items/2589")).toBe("Database");
  expect(currentItem("/map/kalimdor")).toBe("Database");
  expect(currentItem("/tools")).toBe("Tools");
  expect(currentItem("/tools/talents/mage")).toBe("Tools");
  expect(currentItem("/tools/gold-ledger")).toBe("Profile");
  expect(currentItem("/tools/builds")).toBe("Profile");
  expect(currentItem("/tools/auctions/nightslayer")).toBe("Lookup");
  expect(currentItem("/guilds")).toBe("Lookup");
  expect(currentItem("/players")).toBe("Lookup");
  expect(currentItem("/lore/npcs")).toBe("Guides");
  expect(currentItem("/chat")).toBe("Chat");
  expect(currentItem("/about")).toBeUndefined();
});

test("no bracket labels", () => {
  expect(html).not.toMatch(/>\[</);
  expect(html).not.toMatch(/>\]</);
});

test("each menu's links are in the HTML, hidden until opened", () => {
  for (const item of navItems()) {
    if (!item.links) continue;
    expect(html).toMatch(new RegExp(`<div id="${item.label.toLowerCase()}-menu" hidden="" class="[^"]*\\bhidden\\b`));
    for (const link of item.links) expect(html, link.href).toContain(`href="${link.href}"`);
  }
});

test("the current section is marked", () => {
  // The page is an item under Database: its button carries the underline; the others do not.
  expect(primary).toMatch(/<button id="database-menu-button"[^>]*class="[^"]*border-accent text-fg/);
  expect(primary).toMatch(/<button id="tools-menu-button"[^>]*class="[^"]*border-transparent/);
  // In the menu, the longest matching link is the current one: Items, not Overview.
  expect(primary).toMatch(/<a href="\/database\/items" aria-current="page"/);
  expect(primary).toMatch(/<a href="\/database" class=/);
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
  expect(html).toMatch(/<div class="[^"]*\bhidden shrink-0 xl:block\b[^"]*"><div class="[^"]*rounded-full[^"]*"><a [^>]*>files read /);
  // Tighter nav items.
  expect(primary).toMatch(/<a href="\/chat"[^>]*class="[^"]*\bpx-2\b/);
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

test("Plans and Alts on this device are in Profile, not Tools, and private in the catalogue", () => {
  const profile = TOOL_GROUPS.find((g) => g.title === "Profile")!.links;
  expect(profile).toContainEqual({ label: "Plans on this device", href: "/tools/builds" });
  expect(profile).toContainEqual({ label: "Alts on this device", href: "/tools/alts" });
  expect(menuHrefs("Tools")).not.toContain("/tools/builds");
  expect(menuHrefs("Tools")).not.toContain("/tools/alts");
  for (const href of ["/tools/builds", "/tools/alts"]) expect(tools.find((t) => toolHref(t) === href)).toMatchObject({ private: true });
});

test("every shown catalogue tool with a group is in its menu, and Database and Chat are top bar items", () => {
  for (const tool of tools.filter((t) => t.group && !t.hidden)) {
    expect(menuHrefs(tool.group!), tool.slug).toContain(toolHref(tool));
    expect(html, tool.slug).toContain(`href="${toolHref(tool)}"`);
  }
  expect(tools.filter((t) => !t.group).map((t) => t.slug)).toEqual(["database", "chat"]);
  const all = navItems().flatMap((i) => (i.links ? i.links.map((l) => l.href) : [i.href]));
  expect(new Set(all).size).toBe(all.length);
});

test("every destination the old header linked is still one click from the header or footer", () => {
  const footer = renderToStaticMarkup(<Footer />);
  const reachable = new Set([
    ...phoneGroups(navItems()).flatMap((g) => g.links.map((l) => l.href)),
    ...[...footer.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
  ]);
  // Less the tools hidden until polished, which keep their routes but lose their links.
  const old = ["/database", "/lore", "/map", "/changes", "/addons", "/docs", "/census", "/about", ...tools.map(toolHref)].filter((href) => !hidden.includes(href));
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
