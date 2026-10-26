// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, onNavigate: _onNavigate, ...props }: { children: React.ReactNode; onNavigate?: () => void; href: string }) => <a {...props}>{children}</a>,
}));

import FilterBar, { type FilterBarProps } from "./FilterBar";

// The filter dropdowns are native <details>, so they open without JavaScript. These tests pin the dismissal that
// needs it, as the header and account menus already behave: Escape closes the menu you are in and returns focus
// to its button, a press outside closes it, and the phone's outer "Filters" sheet is never closed by either.

const props: FilterBarProps = {
  label: "Item filters",
  active: 1,
  clearHref: "/database/items",
  search: { action: "/database/items", placeholder: "Item name", label: "Search items", keep: {} },
  controls: [
    { type: "menu", key: "quality", label: "Quality", options: [{ label: "Epic", href: "/database/items?quality=epic", on: false }, { label: "Rare", href: "/database/items?quality=rare", on: false }] },
    { type: "menu", key: "class", label: "Class", options: [{ label: "Mage", href: "/database/items?class=mage", on: false }] },
    { type: "toggle", key: "crafted", label: "Crafted", href: "/database/items?crafted=1", on: false },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <>
      <FilterBar {...props} />
      <details id="elsewhere" open><summary>Elsewhere</summary><input id="elsewhere-field" /></details>
      <button id="outside" type="button">Outside</button>
    </>,
  ));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const bar = () => container.querySelector<HTMLElement>("[data-filter-bar]")!;
const menu = (name: "filters" | "filters-phone", key: string, scope: ParentNode = bar()) =>
  scope.querySelector<HTMLDetailsElement>(`details[name="${name}"][data-filter="${key}"]`)!;
const summaryOf = (d: HTMLDetailsElement) => d.querySelector("summary")!;
const sheet = () => bar().querySelector<HTMLDetailsElement>(":scope > details")!;
const open = (...details: HTMLDetailsElement[]) => { for (const d of details) d.open = true; };

const press = (target: Element, key = "Escape") =>
  act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const pointerdown = (target: Element | Document) =>
  act(async () => { target.dispatchEvent(new Event("pointerdown", { bubbles: true })); });

test("Escape inside an open dropdown closes it and returns focus to its button", async () => {
  const quality = menu("filters", "quality");
  open(quality);
  const link = quality.querySelector("a")!;
  link.focus();
  await press(link);
  expect(quality.open).toBe(false);
  expect(document.activeElement).toBe(summaryOf(quality));
});

test("Escape on the button of an open dropdown closes it too", async () => {
  const quality = menu("filters", "quality");
  open(quality);
  summaryOf(quality).focus();
  await press(summaryOf(quality));
  expect(quality.open).toBe(false);
  expect(document.activeElement).toBe(summaryOf(quality));
});

test("Escape closes only the dropdown it is in", async () => {
  const quality = menu("filters", "quality");
  const klass = menu("filters", "class");
  open(quality, klass);
  const link = quality.querySelector("a")!;
  link.focus();
  await press(link);
  expect([quality.open, klass.open]).toEqual([false, true]);
});

test("in the phone sheet, Escape closes the dropdown but not the Filters sheet", async () => {
  open(sheet());
  const quality = menu("filters-phone", "quality");
  open(quality);
  const link = quality.querySelector("a")!;
  link.focus();
  await press(link);
  expect([quality.open, sheet().open]).toEqual([false, true]);
  expect(document.activeElement).toBe(summaryOf(quality));
});

test("Escape that closes a dropdown goes no further, so it does not also close something behind it", async () => {
  const quality = menu("filters", "quality");
  open(quality);
  const seen = vi.fn();
  document.addEventListener("keydown", seen);
  await press(quality.querySelector("a")!);
  document.removeEventListener("keydown", seen);
  expect(quality.open).toBe(false);
  expect(seen).not.toHaveBeenCalled();
});

test("Escape outside a dropdown touches nothing: not the dropdowns, the sheet, or another disclosure", async () => {
  open(sheet());
  const quality = menu("filters", "quality");
  const phoneClass = menu("filters-phone", "class");
  open(quality, phoneClass);
  const seen = vi.fn();
  document.addEventListener("keydown", seen);
  for (const target of [
    bar().querySelector<HTMLElement>("input[type=search]")!,
    summaryOf(sheet()),
    container.querySelector("#elsewhere-field")!,
    container.querySelector("#outside")!,
    document.body,
  ]) await press(target);
  document.removeEventListener("keydown", seen);
  expect([quality.open, phoneClass.open, sheet().open, container.querySelector<HTMLDetailsElement>("#elsewhere")!.open]).toEqual([true, true, true, true]);
  expect(seen).toHaveBeenCalledTimes(5);
});

test("other keys inside a dropdown leave it open", async () => {
  const quality = menu("filters", "quality");
  open(quality);
  await press(quality.querySelector("a")!, "ArrowDown");
  expect(quality.open).toBe(true);
});

test("a press outside closes every open dropdown in the bar, and keeps the phone Filters sheet open", async () => {
  open(sheet());
  const desktop = menu("filters", "quality");
  const phone = menu("filters-phone", "class");
  open(desktop, phone);
  await pointerdown(container.querySelector("#outside")!);
  expect([desktop.open, phone.open]).toEqual([false, false]);
  expect(sheet().open).toBe(true);
});

test("a press on the page itself, or on a disclosure elsewhere, also closes a dropdown and leaves that disclosure alone", async () => {
  const quality = menu("filters", "quality");
  open(quality);
  await pointerdown(document.body);
  expect(quality.open).toBe(false);
  open(quality);
  await pointerdown(container.querySelector("#elsewhere > summary")!);
  expect(quality.open).toBe(false);
  expect(container.querySelector<HTMLDetailsElement>("#elsewhere")!.open).toBe(true);
});

test("a press inside a dropdown, on its panel, a choice or its own button, does not close it", async () => {
  const quality = menu("filters", "quality");
  open(quality);
  await pointerdown(quality.querySelector("ul")!);
  await pointerdown(quality.querySelector("a")!);
  await pointerdown(summaryOf(quality));
  expect(quality.open).toBe(true);
});

test("a press inside the phone sheet but outside its dropdown closes the dropdown, not the sheet", async () => {
  open(sheet());
  const phone = menu("filters-phone", "quality");
  open(phone);
  await pointerdown(sheet().querySelector("form")!);
  expect([phone.open, sheet().open]).toEqual([false, true]);
});

test("with several filter bars, each closes only its own dropdowns for a press that is outside them", async () => {
  const second = document.createElement("div");
  document.body.append(second);
  const secondRoot = createRoot(second);
  await act(async () => secondRoot.render(<FilterBar {...props} label="Other filters" />));
  const first = menu("filters", "quality");
  const other = menu("filters", "quality", second);
  open(first, other);
  // Escape in the second bar leaves the first alone.
  await press(other.querySelector("a")!);
  expect([first.open, other.open]).toEqual([true, false]);
  // A press inside the first bar's dropdown is outside the second's.
  open(other);
  await pointerdown(first.querySelector("a")!);
  expect([first.open, other.open]).toEqual([true, false]);
  await act(async () => secondRoot.unmount());
  second.remove();
});

test("each bar adds one document listener and removes it when it goes, however often it re-renders", async () => {
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  const probe = document.createElement("div");
  document.body.append(probe);
  const probeRoot = createRoot(probe);
  const count = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === "pointerdown").length;
  await act(async () => probeRoot.render(<FilterBar {...props} />));
  await act(async () => probeRoot.render(<FilterBar {...props} active={2} />));
  await act(async () => probeRoot.render(<FilterBar {...props} active={3} />));
  expect(count(added) - count(removed)).toBe(1);
  await act(async () => probeRoot.unmount());
  probe.remove();
  expect(count(added) - count(removed)).toBe(0);
});

test("on the server it is still plain markup: the same bar, native <details> menus in two exclusive groups", () => {
  const html = renderToStaticMarkup(<FilterBar {...props} />);
  expect(html).toMatch(/^<div role="group" aria-label="Item filters" data-filter-bar="true" class="flex flex-wrap items-center gap-2"><details class="w-full sm:hidden">/);
  expect(html.match(/<details name="filters" /g)).toHaveLength(2);
  expect(html.match(/<details name="filters-phone" /g)).toHaveLength(2);
  expect(html).not.toContain("open=");
});

test("a choice that matches nothing is left out unless selected, and a menu with nothing left to pick is not drawn", () => {
  const side = (on: string | null) => ({
    type: "menu" as const, key: "side", label: "Side", options: [
      { label: "Any side", href: "/q", on: on === null, reset: true },
      { label: "Alliance", href: "/q?side=alliance", on: on === "alliance", count: 0 },
      { label: "Horde", href: "/q?side=horde", on: on === "horde", count: 3 },
    ],
  });
  const html = (controls: FilterBarProps["controls"]) => renderToStaticMarkup(<FilterBar {...props} controls={controls} />);
  const some = html([side(null)]);
  expect(some).toContain('data-filter="side"');
  expect(some).toContain("Horde");
  expect(some).not.toContain("Alliance");
  // Selected, an empty choice stays, so the reader can see and undo it.
  expect(html([side("alliance")])).toContain("Alliance");
  // Every choice empty: no menu at all, rather than a list of zeros.
  const empty = { ...side(null), options: side(null).options.map((o) => (o.reset ? o : { ...o, count: 0 })) };
  expect(html([empty])).not.toContain('data-filter="side"');
});
