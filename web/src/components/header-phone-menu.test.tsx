// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/players", useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./AccountControls", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void; href: string }) => (
    <a {...props} onClick={(e) => { e.preventDefault(); onClick?.(); }}>{children}</a>
  ),
}));

import Header from "./Header";

// The layout: the header, then the page and the footer beside it.
let shell: HTMLDivElement;
let main: HTMLElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  shell = document.createElement("div");
  main = document.createElement("main");
  main.innerHTML = '<a href="/x" id="behind">A link on the page</a>';
  document.body.append(shell, main);
  root = createRoot(shell);
  await act(async () => root.render(<Header players guilds />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  shell.remove();
  main.remove();
});

const toggle = () => shell.querySelector<HTMLButtonElement>('button[aria-controls="site-navigation"]')!;
const panel = () => shell.querySelector("#site-navigation");
const open = async () => act(async () => toggle().click());

test("Escape closes the phone menu wherever focus is, and focus returns to Menu", async () => {
  await open();
  const behind = document.getElementById("behind")!;
  behind.focus();
  await act(async () => behind.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(toggle());
});

test("while the phone menu is open the page behind is inert and does not scroll; closing gives both back", async () => {
  await open();
  expect(main.hasAttribute("inert")).toBe(true);
  expect(shell.hasAttribute("inert")).toBe(false);
  expect(document.documentElement.style.overflow).toBe("hidden");
  await open();
  expect(main.hasAttribute("inert")).toBe(false);
  expect(document.documentElement.style.overflow).toBe("");
});

test("focus that lands outside the header while the menu is open goes back to Menu", async () => {
  await open();
  const behind = document.getElementById("behind")!;
  await act(async () => { behind.removeAttribute("inert"); behind.focus(); });
  expect(document.activeElement).toBe(toggle());
});

test("the phone menu draws the current page differently from the other links", async () => {
  await open();
  const current = panel()!.querySelector<HTMLAnchorElement>('a[aria-current="page"]')!;
  expect(current.getAttribute("href")).toBe("/players");
  const other = panel()!.querySelector<HTMLAnchorElement>('a[href="/rankings"]')!;
  expect(current.className).not.toBe(other.className);
  expect(current.className).toMatch(/(?:^|\s)border-accent(?:\s|$)/);
});

test("Menu keeps a 44 px touch area on its 32 px pill", () => {
  expect(toggle().className).toMatch(/(?:^|\s)tap-44(?:\s|$)/);
});
