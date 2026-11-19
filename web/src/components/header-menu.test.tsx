// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/tools/raid", useRouter: () => ({ refresh: () => {} }) }));
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
  expect(toggle.className).toContain("xl:hidden");
  await act(async () => toggle.click());
  const nav = container.querySelector("#site-navigation")!;
  expect(nav.className).toContain("xl:hidden");
  expect(nav.querySelector('a[href^="/changes?show=builds"]')).not.toBeNull();
  expect(nav.querySelector('a[title^="The newest WoW"]')).not.toBeNull();
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

test("the phone menu shows both builds, which the bar only has room for from 1280 px", async () => {
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
