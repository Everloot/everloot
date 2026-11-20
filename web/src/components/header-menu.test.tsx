// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/tools/raid" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./AccountControls", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void; href: string }) => (
    <a {...props} onClick={(e) => { e.preventDefault(); onClick?.(); }}>{children}</a>
  ),
}));

import Header from "./Header";
import { REPORT_BUG_EVENT } from "./BugReport";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Header />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const toolsButton = () => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Tools")!;
const menu = () => container.querySelector("#tools-menu:not([hidden])");

test("the menu keeps both build links reachable below the desktop build chip breakpoint", async () => {
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="site-navigation"]')!;
  expect(toggle.className).toContain("2xl:hidden");
  await act(async () => toggle.click());
  const nav = container.querySelector("#site-navigation")!;
  expect(nav.className).toContain("2xl:hidden");
  expect(nav.querySelector('a[href^="/changes?show=builds"]')).not.toBeNull();
  expect(nav.querySelector('a[title^="The newest WoW"]')).not.toBeNull();
});

test("the menu's search box is the same suggesting field as the bar's: a combobox over its own suggestion list, in a GET form", async () => {
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="site-navigation"]')!;
  await act(async () => toggle.click());
  const field = container.querySelector<HTMLInputElement>("#site-navigation #menu-search")!;
  expect(field).not.toBeNull();
  expect(field.getAttribute("role")).toBe("combobox");
  expect(field.getAttribute("aria-controls")).toBe("menu-search-suggestions");
  expect(field.getAttribute("name")).toBe("q");
  expect(field.closest("form")?.getAttribute("action")).toBe("/search");
});

test("a page change closes the open menu, so a suggestion picked in it never leaves the menu over the new page", async () => {
  nav.path = "/tools/raid";
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="site-navigation"]')!;
  await act(async () => toggle.click());
  expect(container.querySelector("#site-navigation")).not.toBeNull();
  nav.path = "/database/npcs/448";
  await act(async () => root.render(<Header />));
  expect(container.querySelector("#site-navigation")).toBeNull();
  nav.path = "/tools/raid";
});

test("Tools opens its menu and says so; opening another menu closes it", async () => {
  await act(async () => toolsButton().click());
  expect(toolsButton().getAttribute("aria-expanded")).toBe("true");
  expect(Array.from(menu()!.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(["/tools/raid", "/tools/talents", "/tools/professions", "/tools"]);
  const profile = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Profile")!;
  await act(async () => profile.click());
  expect(menu()).toBeNull();
  expect(container.querySelector("#profile-menu:not([hidden]) a[href=\"/tools/builds\"]")).not.toBeNull();
});

test("Tools is marked current on a tool page, and the tool is current in the menu", async () => {
  expect(toolsButton().className).toContain("border-accent");
  await act(async () => toolsButton().click());
  expect(menu()!.querySelector('a[href="/tools/raid"]')!.getAttribute("aria-current")).toBe("page");
});

test("Escape closes the menu and returns focus to Tools", async () => {
  await act(async () => toolsButton().click());
  const link = menu()!.querySelector("a")!;
  link.focus();
  await act(async () => link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(toolsButton());
});

const key = async (target: Element, key: string, init: KeyboardEventInit = {}) =>
  act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
const links = () => Array.from(menu()!.querySelectorAll("a"));

test("the open menu walks its links with the arrow keys, wrapping, and Home/End jump to the ends", async () => {
  await act(async () => toolsButton().click());
  toolsButton().focus();
  await key(toolsButton(), "ArrowDown");
  expect(document.activeElement).toBe(links()[0]);
  await key(links()[0], "ArrowDown");
  expect(document.activeElement).toBe(links()[1]);
  await key(links()[1], "ArrowUp");
  expect(document.activeElement).toBe(links()[0]);
  await key(links()[0], "ArrowUp");
  expect(document.activeElement).toBe(links().at(-1));
  await key(links().at(-1)!, "ArrowDown");
  expect(document.activeElement).toBe(links()[0]);
  await key(links()[0], "End");
  expect(document.activeElement).toBe(links().at(-1));
  await key(links().at(-1)!, "Home");
  expect(document.activeElement).toBe(links()[0]);
  expect(menu()).not.toBeNull();
});

test("ArrowDown on a closed trigger opens its menu on the first link; the trigger says it opens a popup", async () => {
  expect(toolsButton().getAttribute("aria-haspopup")).toBe("true");
  expect(toolsButton().getAttribute("aria-controls")).toBe("tools-menu");
  toolsButton().focus();
  await key(toolsButton(), "ArrowDown");
  expect(menu()).not.toBeNull();
  expect(document.activeElement).toBe(links()[0]);
});

test("Tab past the last link, or Shift+Tab from the trigger, closes the menu; Tab between its links keeps it open", async () => {
  await act(async () => toolsButton().click());
  links()[0].focus();
  await key(links()[0], "Tab");
  expect(menu()).not.toBeNull();
  links().at(-1)!.focus();
  await key(links().at(-1)!, "Tab");
  expect(menu()).toBeNull();
  await act(async () => toolsButton().click());
  toolsButton().focus();
  await key(toolsButton(), "Tab", { shiftKey: true });
  expect(menu()).toBeNull();
});

test("ArrowRight and ArrowLeft move along the bar's items, wrapping, and close the open menu", async () => {
  const top = (label: string) => Array.from(container.querySelectorAll<HTMLElement>('nav[aria-label="Primary"] a, nav[aria-label="Primary"] button')).find((el) => el.textContent === label)!;
  await act(async () => toolsButton().click());
  toolsButton().focus();
  await key(toolsButton(), "ArrowRight");
  expect(document.activeElement).toBe(top("Guides"));
  expect(menu()).toBeNull();
  await key(top("Guides"), "ArrowRight");
  expect(document.activeElement).toBe(top("Chat"));
  top("Rankings").focus();
  await key(top("Rankings"), "ArrowLeft");
  expect(document.activeElement).toBe(top("Profile"));
  // Inside a panel the keys leave the links alone.
  await act(async () => toolsButton().click());
  links()[0].focus();
  await key(links()[0], "ArrowRight");
  expect(document.activeElement).toBe(links()[0]);
});

test("a click outside closes the menu", async () => {
  await act(async () => toolsButton().click());
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(menu()).toBeNull();
});

test("choosing a tool closes the menu", async () => {
  await act(async () => toolsButton().click());
  await act(async () => (menu()!.querySelector('a[href="/tools/talents"]') as HTMLAnchorElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  expect(menu()).toBeNull();
});

test("the phone menu lists the same places", async () => {
  const toggle = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Menu")!;
  await act(async () => toggle.click());
  const panel = container.querySelector("#site-navigation")!;
  for (const href of ["/database", "/map", "/changes", "/lore", "/database/instances", "/chat", "/docs", "/tools/talents", "/census", "/settings", "/tools/builds", "/tools/alts", "/about"])
    expect(panel.querySelector(`a[href="${href}"]`), href).not.toBeNull();
  for (const href of ["/upload", "/tools/farming-routes", "/tools/collections"]) expect(panel.querySelector(`a[href="${href}"]`), href).toBeNull();
  expect(panel.querySelector('form[action="/search"]')).not.toBeNull();
});

test("the phone menu shows both builds, which the bar shows inline from 1536 px", async () => {
  const toggle = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Menu")!;
  await act(async () => toggle.click());
  const links = Array.from(container.querySelector("#site-navigation")!.querySelectorAll("a")).map((a) => a.textContent ?? "");
  expect(links.some((t) => t.startsWith("files read "))).toBe(true);
  expect(links.some((t) => t.startsWith("newest seen "))).toBe(true);
});

test("/ focuses the search field unless the visitor is typing", async () => {
  const field = container.querySelector<HTMLInputElement>("#site-search")!;
  // jsdom has no layout, so offsetParent is null; stand in for a visible field.
  Object.defineProperty(field, "offsetParent", { get: () => document.body });
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true })));
  expect(document.activeElement).toBe(field);
  field.blur();
  const other = document.createElement("input");
  document.body.append(other);
  other.focus();
  await act(async () => other.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true })));
  expect(document.activeElement).toBe(other);
  other.remove();
});

test("Tools stays in the page while closed (hidden), so it can leave by transition, and rapid toggling ends where the last click left it", async () => {
  const panel = () => container.querySelector<HTMLElement>("#tools-menu")!;
  expect(panel().className).toMatch(/(?:^|\s)pop(?:\s|$)/);
  expect(panel().hidden).toBe(true);
  for (let i = 0; i < 5; i++) await act(async () => toolsButton().click());
  expect([toolsButton().getAttribute("aria-expanded"), panel().hidden]).toEqual(["true", false]);
  await act(async () => toolsButton().click());
  expect([toolsButton().getAttribute("aria-expanded"), panel().hidden]).toEqual(["false", true]);
});

test("the phone menu enters with the menu motion", async () => {
  const toggle = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Menu")!;
  await act(async () => toggle.click());
  expect(container.querySelector("#site-navigation")!.className).toMatch(/^pop /);
});

test("the phone menu's More group reports a bug: the menu closes, focus goes to Menu and the report dialog is asked to open", async () => {
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="site-navigation"]')!;
  await act(async () => toggle.click());
  const report = Array.from(container.querySelectorAll<HTMLButtonElement>("#site-navigation button")).find((b) => b.textContent === "Report a bug")!;
  expect(report).toBeTruthy();
  expect(report.getAttribute("aria-haspopup")).toBe("dialog");
  const heard = vi.fn();
  window.addEventListener(REPORT_BUG_EVENT, heard);
  await act(async () => report.click());
  window.removeEventListener(REPORT_BUG_EVENT, heard);
  expect(heard).toHaveBeenCalledTimes(1);
  expect(container.querySelector("#site-navigation")).toBeNull();
  expect(document.activeElement).toBe(toggle);
});

test("on a phone each group shows three links and More… for the rest; the open menu covers the page", async () => {
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="site-navigation"]')!;
  await act(async () => toggle.click());
  const nav = container.querySelector("#site-navigation")!;
  expect(nav.className).toContain("fixed");
  expect(nav.className).toContain("bottom-0");
  const guides = container.querySelector("#guides-menu-phone")!;
  const items = Array.from(guides.querySelectorAll("li"));
  const links = items.filter((li) => li.querySelector("a"));
  // Every link stays in the HTML, in its order; past the third they wait for More… below md.
  expect(links.length).toBeGreaterThan(3);
  expect(links.slice(0, 3).every((li) => !li.className.includes("hidden"))).toBe(true);
  expect(links.slice(3).every((li) => li.className === "hidden md:block")).toBe(true);
  const more = Array.from(guides.querySelectorAll("button")).find((b) => b.textContent === "More…")!;
  expect(more.closest("li")!.className).toBe("md:hidden");
  await act(async () => more.click());
  expect(Array.from(guides.querySelectorAll("li")).every((li) => !li.className.includes("hidden"))).toBe(true);
  expect(Array.from(guides.querySelectorAll("button")).some((b) => b.textContent === "More…")).toBe(false);
  // Opening one group leaves the others folded.
  const tools = container.querySelector("#tools-menu-phone")!;
  expect(Array.from(tools.querySelectorAll("button")).some((b) => b.textContent === "More…")).toBe(true);
});
