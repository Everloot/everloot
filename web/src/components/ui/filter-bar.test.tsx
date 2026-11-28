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
// The controls are drawn once: the phone sheet is a checkbox-driven CSS toggle around the same row the desktop
// shows, so the sheet's state is the checkbox, not a <details>.

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
const menu = (key: string, scope: ParentNode = bar()) =>
  scope.querySelector<HTMLDetailsElement>(`details[name="filters"][data-filter="${key}"]`)!;
const summaryOf = (d: HTMLDetailsElement) => d.querySelector("summary")!;
const sheet = () => bar().querySelector<HTMLInputElement>("input[data-filter-sheet]")!;
const open = (...details: (HTMLDetailsElement | HTMLInputElement)[]) => {
  for (const d of details) if (d instanceof HTMLInputElement) d.checked = true; else d.open = true;
};
const isOpen = (d: HTMLDetailsElement | HTMLInputElement) => (d instanceof HTMLInputElement ? d.checked : d.open);

const press = (target: Element, key = "Escape") =>
  act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const pointerdown = (target: Element | Document) =>
  act(async () => { target.dispatchEvent(new Event("pointerdown", { bubbles: true })); });

test("Escape inside an open dropdown closes it and returns focus to its button", async () => {
  const quality = menu("quality");
  open(quality);
  const link = quality.querySelector("a")!;
  link.focus();
  await press(link);
  expect(quality.open).toBe(false);
  expect(document.activeElement).toBe(summaryOf(quality));
});

test("Escape on the button of an open dropdown closes it too", async () => {
  const quality = menu("quality");
  open(quality);
  summaryOf(quality).focus();
  await press(summaryOf(quality));
  expect(quality.open).toBe(false);
  expect(document.activeElement).toBe(summaryOf(quality));
});

test("Escape closes only the dropdown it is in", async () => {
  const quality = menu("quality");
  const klass = menu("class");
  open(quality, klass);
  const link = quality.querySelector("a")!;
  link.focus();
  await press(link);
  expect([quality.open, klass.open]).toEqual([false, true]);
});

test("in the phone sheet, Escape closes the dropdown but not the Filters sheet", async () => {
  open(sheet());
  const quality = menu("quality");
  open(quality);
  const link = quality.querySelector("a")!;
  link.focus();
  await press(link);
  expect([quality.open, isOpen(sheet())]).toEqual([false, true]);
  expect(document.activeElement).toBe(summaryOf(quality));
});

test("Escape that closes a dropdown goes no further, so it does not also close something behind it", async () => {
  const quality = menu("quality");
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
  const quality = menu("quality");
  const phoneClass = menu("class");
  open(quality, phoneClass);
  const seen = vi.fn();
  document.addEventListener("keydown", seen);
  for (const target of [
    bar().querySelector<HTMLElement>("input[type=search]")!,
    bar().querySelector("label[for]")!,
    container.querySelector("#elsewhere-field")!,
    container.querySelector("#outside")!,
    document.body,
  ]) await press(target);
  document.removeEventListener("keydown", seen);
  expect([quality.open, phoneClass.open, isOpen(sheet()), container.querySelector<HTMLDetailsElement>("#elsewhere")!.open]).toEqual([true, true, true, true]);
  expect(seen).toHaveBeenCalledTimes(5);
});

test("other keys inside a dropdown leave it open", async () => {
  const quality = menu("quality");
  open(quality);
  await press(quality.querySelector("a")!, "ArrowDown");
  expect(quality.open).toBe(true);
});

test("a press outside closes every open dropdown in the bar, and keeps the phone Filters sheet open", async () => {
  open(sheet());
  const desktop = menu("quality");
  const phone = menu("class");
  open(desktop, phone);
  await pointerdown(container.querySelector("#outside")!);
  expect([desktop.open, phone.open]).toEqual([false, false]);
  expect(isOpen(sheet())).toBe(true);
});

test("a press on the page itself, or on a disclosure elsewhere, also closes a dropdown and leaves that disclosure alone", async () => {
  const quality = menu("quality");
  open(quality);
  await pointerdown(document.body);
  expect(quality.open).toBe(false);
  open(quality);
  await pointerdown(container.querySelector("#elsewhere > summary")!);
  expect(quality.open).toBe(false);
  expect(container.querySelector<HTMLDetailsElement>("#elsewhere")!.open).toBe(true);
});

test("a press inside a dropdown, on its panel, a choice or its own button, does not close it", async () => {
  const quality = menu("quality");
  open(quality);
  await pointerdown(quality.querySelector("ul")!);
  await pointerdown(quality.querySelector("a")!);
  await pointerdown(summaryOf(quality));
  expect(quality.open).toBe(true);
});

test("a press inside the phone sheet but outside its dropdown closes the dropdown, not the sheet", async () => {
  open(sheet());
  const phone = menu("quality");
  open(phone);
  await pointerdown(bar().querySelector("[data-filter-sheet-panel] form")!);
  expect([phone.open, isOpen(sheet())]).toEqual([false, true]);
});

test("with several filter bars, each closes only its own dropdowns for a press that is outside them", async () => {
  const second = document.createElement("div");
  document.body.append(second);
  const secondRoot = createRoot(second);
  await act(async () => secondRoot.render(<FilterBar {...props} label="Other filters" />));
  const first = menu("quality");
  const other = menu("quality", second);
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

// Before, the bar drew every control twice (a phone sheet and a desktop row), about 61 kB of /database/items' RSC.
test("on the server it is still plain markup: one copy of the controls, native <details> menus in one exclusive group", () => {
  const html = renderToStaticMarkup(<FilterBar {...props} />);
  expect(html).toMatch(/^<div role="group" aria-label="Item filters" data-filter-bar="true" class="flex flex-wrap items-center gap-2"><input type="checkbox"/);
  expect(html.match(/<details name="filters" /g)).toHaveLength(2);
  expect(html).not.toContain("filters-phone");
  expect(html.match(/type="search"/g)).toHaveLength(1);
  expect(html.match(/>Crafted</g)).toHaveLength(1);
  expect(html).not.toContain("open=");
  expect(html).not.toContain("checked=");
});

test("the phone Filters button is a label for the sheet's checkbox, and the row shows on its own from 640 px", () => {
  const html = renderToStaticMarkup(<FilterBar {...props} />);
  const id = html.match(/<input type="checkbox" id="([^"]+)"/)![1];
  expect(html).toMatch(new RegExp(`<label for="${id}"[^>]*class="[^"]*sm:hidden[^"]*">Filters(?:<[^>]*>)* \\(1\\)`));
  expect(html).toMatch(/data-filter-sheet-panel="true" class="[^"]*hidden[^"]*peer-checked:flex[^"]*sm:contents/);
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

test("the name box is a search landmark named for what it searches, apart from the site's own search", () => {
  const html = renderToStaticMarkup(<FilterBar {...props} />);
  // The bar sends its controls once (phone sheet and desktop row share them), so there is one search form.
  expect(html.match(/<form [^>]*role="search"[^>]*>/g)).toEqual([
    expect.stringContaining('aria-label="Search items"'),
  ]);
});

test("a dropdown choice is a 44 px tap target on a phone and keeps the dense 32 px row from 640 px", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8").replace(/\r\n/g, "\n");
  const rule = css.match(/\.fm-opt \{\n\s*@apply ([^;]*);/)![1].split(/\s+/);
  expect(rule).toContain("min-h-11");
  expect(rule).toContain("sm:min-h-8");
  expect(rule).not.toContain("min-h-8");
});

// QA round 12: Tab past the last choice of an open Class menu moved focus to Slot while the Class list stayed open
// over "Sort" and the "Not listed" line.
test("tabbing out of an open dropdown closes it; focus moving within it, or Escape, keeps the old behaviour", async () => {
  const quality = menu("quality");
  const klass = menu("class");
  open(quality);
  const [epic, rare] = quality.querySelectorAll("a");
  await act(async () => epic.focus());
  await act(async () => rare.focus());
  expect(quality.open).toBe(true);
  await act(async () => summaryOf(klass).focus());
  expect(quality.open).toBe(false);
  // Focus leaving for another field on the page closes it too.
  open(quality);
  await act(async () => rare.focus());
  await act(async () => container.querySelector<HTMLInputElement>("#elsewhere-field")!.focus());
  expect(quality.open).toBe(false);
  expect(container.querySelector<HTMLDetailsElement>("#elsewhere")!.open).toBe(true);
});

test("the window losing focus leaves an open dropdown open", async () => {
  const quality = menu("quality");
  open(quality);
  const link = quality.querySelector("a")!;
  await act(async () => link.focus());
  await act(async () => { link.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null })); });
  expect(quality.open).toBe(true);
});

// QA round 13: the button showed only under keyboard focus, so a mouse user on /database/achievements never saw it.
test("the name box's Filter button is in the tab order and always shown", () => {
  const html = renderToStaticMarkup(<FilterBar {...props} />);
  const button = html.match(/<button type="submit"[^>]*>Filter<\/button>/)![0];
  expect(button).not.toContain("tabindex");
  expect(button).not.toMatch(/\bsr-only\b/);
  expect(button).toMatch(/class="[^"]*\bborder\b/);
});

test("a menu's note is a plain line under its choices, not a link, and a menu without one draws none", () => {
  const withNote: FilterBarProps = { ...props, controls: [{ ...props.controls[0] as Extract<FilterBarProps["controls"][number], { type: "menu" }>, note: "Not recorded: 2,829" }] };
  const html = renderToStaticMarkup(<FilterBar {...withNote} />);
  expect(html).toMatch(/<li class="[^"]*"[^>]*>Not recorded: 2,829<\/li><\/ul>/);
  expect(html).not.toMatch(/<a[^>]*>[^<]*Not recorded/);
  expect(renderToStaticMarkup(<FilterBar {...props} />)).not.toContain("Not recorded");
});
