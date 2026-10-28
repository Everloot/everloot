// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: (props: { href: string; children: ReactNode; className?: string; "aria-current"?: "page" }) => <a {...props} />,
}));

import ClassPicker, { type ClassChoice } from "./ClassPicker";

// jsdom has no layout, so the phone strip is pinned by its classes; the row's width and scrolling are measured in a
// browser.
const SLUGS = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
const named: ClassChoice[] = SLUGS.map((slug) => ({ slug, name: slug[0].toUpperCase() + slug.slice(1) }));
const withIcons: ClassChoice[] = named.map((c) => ({ ...c, icon: `https://assets.example.test/icons/${c.slug}.webp` }));
const strip = (classes: ClassChoice[], current = "druid") =>
  new DOMParser().parseFromString(renderToStaticMarkup(<ClassPicker variant="strip" classes={classes} current={current} />), "text/html");
const classes = (el: Element | null) => el!.className.split(" ");

test("without class icons a phone gets one row of full class names that scrolls sideways, nine across from 640 px (class proxy)", () => {
  const page = strip(named);
  const list = page.querySelector('nav[aria-label="Classes"] ul')!;
  expect(classes(list)).toEqual(expect.arrayContaining(["flex", "overflow-x-auto", "sm:grid", "sm:grid-cols-9", "sm:overflow-visible"]));
  expect(classes(list)).not.toContain("grid-cols-3");
  // Inset, with a scroll padding of the same, so a name brought into view keeps its focus ring inside the row.
  expect(classes(list)).toEqual(expect.arrayContaining(["max-sm:-m-1", "max-sm:p-1", "max-sm:scroll-px-1"]));
  const links = [...list.querySelectorAll("a")];
  expect(links.map((a) => a.textContent)).toEqual(named.map((c) => c.name));
  for (const a of links) {
    // Each name is whole, on a target at least 44 px tall, and its item keeps its width in the row.
    expect(a.querySelector(".sr-only")).toBeNull();
    expect(classes(a)).toEqual(expect.arrayContaining(["min-h-11", "max-sm:px-3"]));
    expect(classes(a.closest("li"))).toContain("shrink-0");
  }
});

test("the class being planned is the current page, and the row starts scrolled to it where the browser can", () => {
  const page = strip(named, "druid");
  const current = page.querySelectorAll('a[aria-current="page"]');
  expect(current).toHaveLength(1);
  expect(current[0].getAttribute("href")).toBe("/tools/talents/druid");
  // Only on a phone, where the row is the scroller: anywhere else the nearest scroller is the page itself.
  expect(classes(current[0])).toContain("max-sm:[scroll-initial-target:nearest]");
  expect(page.querySelectorAll("[class*='scroll-initial-target']")).toHaveLength(1);
});

test("with class icons the strip is nine icons across as before, the names kept for screen readers", () => {
  const page = strip(withIcons, "mage");
  const list = page.querySelector("ul")!;
  expect(classes(list)).toEqual(expect.arrayContaining(["grid", "grid-cols-9"]));
  expect(classes(list)).not.toContain("overflow-x-auto");
  expect([...list.querySelectorAll("a")].map((a) => a.querySelector(".sr-only")?.textContent)).toEqual(named.map((c) => c.name));
  expect(page.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/tools/talents/mage");
  // This row does not scroll, so nothing in it may set where the page starts.
  expect(page.querySelector("[class*='scroll-initial-target']")).toBeNull();
});

test("a name that takes keyboard focus is brought into the row's view, and one focused by a press is left in place", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ClassPicker variant="strip" classes={named} current="druid" />));
    const link = (name: string) => [...container.querySelectorAll("a")].find((a) => a.textContent === name)!;
    // jsdom has no layout, no scrollIntoView, and counts every focus as keyboard focus; the browser answers all three.
    const row = container.querySelector("ul")!;
    const widths = (scroll: number, client: number) => {
      Object.defineProperty(row, "scrollWidth", { configurable: true, get: () => scroll });
      Object.defineProperty(row, "clientWidth", { configurable: true, get: () => client });
    };
    // From 640 px the nine names fit and the row does not scroll: focus leaves the page alone, as before.
    widths(608, 608);
    const hunter = link("Hunter");
    hunter.scrollIntoView = vi.fn();
    vi.spyOn(hunter, "matches").mockImplementation((selector) => selector === ":focus-visible");
    await act(async () => hunter.focus());
    expect(hunter.scrollIntoView).not.toHaveBeenCalled();
    // On a phone the row is 693 px of names in 358 px.
    widths(693, 358);
    const priest = link("Priest");
    priest.scrollIntoView = vi.fn();
    vi.spyOn(priest, "matches").mockImplementation((selector) => selector === ":focus-visible");
    await act(async () => priest.focus());
    expect(priest.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "nearest", inline: "nearest" });
    const shaman = link("Shaman");
    shaman.scrollIntoView = vi.fn();
    vi.spyOn(shaman, "matches").mockReturnValue(false);
    await act(async () => shaman.focus());
    expect(shaman.scrollIntoView).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("with class icons nothing is scrolled on focus: the nine fit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ClassPicker variant="strip" classes={withIcons} current="mage" />));
    const warlock = container.querySelector<HTMLAnchorElement>('a[href="/tools/talents/warlock"]')!;
    warlock.scrollIntoView = vi.fn();
    await act(async () => warlock.focus());
    expect(warlock.scrollIntoView).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

test("the talent hub's tiles keep their three-then-nine grid", () => {
  const page = new DOMParser().parseFromString(renderToStaticMarkup(<ClassPicker variant="tiles" classes={withIcons} />), "text/html");
  expect(classes(page.querySelector("ul"))).toEqual(expect.arrayContaining(["grid", "grid-cols-3", "sm:grid-cols-9"]));
  expect(page.querySelectorAll("a")).toHaveLength(9);
});
