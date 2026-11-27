// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("./PendingLink", () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => <a {...props}>{children}</a>,
}));

import LinkTabs from "./LinkTabs";
import Tabs, { type TabItem } from "./Tabs";

// Nine 100 px tabs in a 300 px row, as the armory's character sheet on a phone.
const IDS = ["talents", "stats", "pvp", "achievements", "professions", "reputations", "quests", "history", "progress"];
const TABS: TabItem[] = IDS.map((id) => ({ id, label: id, panel: <p>{id}</p> }));
const WIDTH = 300;
const TAB = 100;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/armory/us/kaz-sneaks");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** jsdom has no layout: give the scrolling row and its items the sizes a phone would, with a clamped scrollLeft. */
function layOut(row: HTMLElement, items: HTMLElement[]) {
  let left = 0;
  const max = items.length * TAB - WIDTH;
  Object.defineProperty(row, "clientWidth", { configurable: true, get: () => WIDTH });
  Object.defineProperty(row, "scrollWidth", { configurable: true, get: () => items.length * TAB });
  Object.defineProperty(row, "scrollLeft", { configurable: true, get: () => left, set: (v: number) => { left = Math.max(0, Math.min(max, v)); } });
  row.getBoundingClientRect = () => ({ left: 0, right: WIDTH, top: 0, bottom: 40, width: WIDTH, height: 40, x: 0, y: 0, toJSON: () => ({}) });
  items.forEach((item, i) => {
    item.getBoundingClientRect = () => ({ left: i * TAB - left, right: (i + 1) * TAB - left, top: 0, bottom: 40, width: TAB, height: 40, x: 0, y: 0, toJSON: () => ({}) });
  });
}

const tablist = () => container.querySelector<HTMLElement>('[role="tablist"]')!;
const tabs = () => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
const arrow = (side: "start" | "end") => container.querySelector<HTMLButtonElement>(`[data-scroll="${side}"]`);
const relayout = () => act(async () => window.dispatchEvent(new Event("resize")));
const visible = (el: HTMLElement, row: HTMLElement) => {
  const t = el.getBoundingClientRect();
  const l = row.getBoundingClientRect();
  return t.left >= l.left && t.right <= l.right;
};

test("a row that scrolls says so with an arrow at the cut edge, and the arrow scrolls it", async () => {
  await act(async () => root.render(<Tabs label="Character sheet" tabs={TABS} />));
  layOut(tablist(), tabs());
  await relayout();
  expect(arrow("start")).toBeNull();
  const end = arrow("end")!;
  expect(end).not.toBeNull();
  // A pointer aid only: the tabs' own arrow keys and focus already scroll the row.
  expect(end.getAttribute("aria-hidden")).toBe("true");
  expect(end.tabIndex).toBe(-1);
  // A flat edge, no gradient or fade (the design guard).
  expect(end.className).toMatch(/(?:^|\s)border-l(?:\s|$)/);
  await act(async () => end.click());
  expect(tablist().scrollLeft).toBeGreaterThan(0);
  expect(arrow("start")).not.toBeNull();
});

test("a row that fits draws no arrows", async () => {
  await act(async () => root.render(<Tabs label="Character sheet" tabs={TABS.slice(0, 3)} />));
  layOut(tablist(), tabs());
  await relayout();
  expect(arrow("start")).toBeNull();
  expect(arrow("end")).toBeNull();
});

test("a deep tab named in the address is scrolled fully into view, clear of the arrow", async () => {
  window.history.replaceState(null, "", "#reputations");
  await act(async () => root.render(<Tabs label="Character sheet" tabs={TABS} />));
  layOut(tablist(), tabs());
  // The row laid out again after the first pass (a font arriving, the window turning): it is kept in view.
  await relayout();
  const open = tabs().find((t) => t.getAttribute("aria-selected") === "true")!;
  expect(open.textContent).toBe("reputations");
  expect(visible(open, tablist())).toBe(true);
  // Not under the end arrow (40 px) either.
  expect(open.getBoundingClientRect().right).toBeLessThanOrEqual(WIDTH - 40);
});

test("LinkTabs keeps the current link in view too", async () => {
  const links = IDS.map((id, i) => ({ href: `/x?show=${id}`, label: id, current: i === 7 }));
  await act(async () => root.render(<LinkTabs label="Views" tabs={links} />));
  const row = container.querySelector<HTMLElement>("[data-scroll-row]")!;
  layOut(row, Array.from(row.querySelectorAll<HTMLElement>("li")));
  await relayout();
  const current = container.querySelector<HTMLElement>('a[aria-current="page"]')!.closest("li")!;
  expect(visible(current, row)).toBe(true);
  expect(arrow("start")).not.toBeNull();
});
