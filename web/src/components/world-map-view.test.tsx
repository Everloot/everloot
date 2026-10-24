// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { categoryCounts, CATEGORY_IDS, DEFAULT_URL_STATE, spotBox, type MapItems } from "@/lib/map-view";
import type { LeafletMapProps } from "./map/LeafletMap";

// The map itself needs a real browser; a stand-in records what the view hands it.
const leaflet = vi.hoisted(() => ({ props: null as unknown as LeafletMapProps }));
vi.mock("next/dynamic", () => ({
  default: () => (props: LeafletMapProps) => { leaflet.props = props; return <div data-leaflet-stub />; },
}));
vi.mock("next/link", () => ({
  default: ({ children, onClick, onNavigate: _n, prefetch: _p, ...props }: { children: ReactNode; onClick?: (e: MouseEvent) => void; href: string; onNavigate?: unknown; prefetch?: unknown }) => (
    <a {...props} onClick={(e) => { onClick?.(e.nativeEvent); e.preventDefault(); }}>{children}</a>
  ),
}));

import WorldMapView, { SIDEBAR_KEY, type WorldMapViewProps } from "./WorldMapView";

const items: MapItems = {
  zones: [
    { mapId: 1411, name: "Durotar", x: 0, y: 0, width: 1000, height: 1000, heldBack: false },
    { mapId: 1413, name: "The Barrens", x: 1000, y: 0, width: 1000, height: 2000, heldBack: false },
  ],
  entrances: [{ id: "x", names: ["Ragefire Chasm"], raid: false, x: 400, y: 300, worldX: 1, worldY: 2 }],
  pins: [],
  treasures: [],
  flightMasters: [
    { id: "f1", name: "Orgrimmar, Durotar", x: 500, y: 100, heldBack: false },
    { id: "f2", name: "Crossroads, The Barrens", x: 1500, y: 800, heldBack: false },
  ],
  flightLines: [{ id: "l1", from: "f1", to: "f2", points: [[500, 100], [1500, 800]], heldBack: false }],
};
const base = { x: 0, y: 0, width: 2000, height: 2000 };
// The page carries no flight paths and only the first player points; the rest comes from the pins route.
const seedItems: MapItems = { ...items, flightLines: [] };
const pinSet = { entrances: items.entrances, flightMasters: items.flightMasters, flightLines: items.flightLines, pins: items.pins };
const props: WorldMapViewProps = {
  title: "WoW Forever World Map", name: "Kalimdor", continentId: 1,
  continents: [{ id: 0, name: "Eastern Kingdoms" }, { id: 1, name: "Kalimdor" }],
  base, items: seedItems, pinsUrl: "/api/map/pins?continent=1",
  seed: { counts: categoryCounts(items, false), pins: { npc: 0, vendor: 0 } }, candidates: [],
  zonePages: { 1411: "/database/zones/1411-durotar" }, url: DEFAULT_URL_STATE,
  spoilers: false, spoilerHref: "/map/kalimdor?spoilers=1", marker: null, zoneId: null,
  view: { at: null, zoom: null, pin: null },
};
const answer = (body: unknown) => vi.fn(async (_url: string) => ({ ok: true, json: async () => body }));
let fetcher = answer({ ok: true, ...pinSet });

let container: HTMLDivElement;
let root: Root;
const mount = async (p: Partial<WorldMapViewProps> = {}) => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<WorldMapView {...props} {...p} />));
  // The pins route answers.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};
const unmount = async () => {
  await act(async () => root.unmount());
  container.remove();
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  window.history.replaceState(null, "", "/map");
  fetcher = answer({ ok: true, ...pinSet });
  vi.stubGlobal("fetch", fetcher);
  // jsdom lays nothing out; anything rendered counts as on screen.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.isConnected ? document.body : null; } });
});
afterEach(async () => {
  if (container?.isConnected) await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// jsdom's import.meta.url is not a file URL; vitest runs from web/.
const source = (path: string) => resolve(process.cwd(), "src", path);

const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel)!;
const button = (label: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label)!;
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const shell = () => $("[data-map-shell]");
const panel = () => $("#map-panel");
const listRows = (id: string) => Array.from(container.querySelectorAll(`[aria-labelledby="${id}"] li`)).map((li) => li.textContent ?? "");

test("the desk sidebar collapses to a rail, and this browser remembers it", async () => {
  await mount();
  expect(shell().hasAttribute("data-collapsed")).toBe(false);
  await click(button("Collapse the sidebar"));
  expect(shell().hasAttribute("data-collapsed")).toBe(true);
  expect(localStorage.getItem(SIDEBAR_KEY)).toBe("collapsed");

  // A new visit opens collapsed.
  await unmount();
  await mount();
  expect(shell().hasAttribute("data-collapsed")).toBe(true);

  // The rail's buttons open it again: Search opens it on the field.
  await click(button("Search the map", $("[data-map-rail]")));
  expect(shell().hasAttribute("data-collapsed")).toBe(false);
  expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull();
  expect(document.activeElement).toBe($("#map-search"));
});

test("Show all and Hide all switch every category; the map and the list follow the same switches", async () => {
  await mount();
  const boxes = () => Array.from(container.querySelectorAll<HTMLInputElement>("fieldset input[type=checkbox]"));
  expect(boxes()).toHaveLength(CATEGORY_IDS.length);
  expect(boxes().every((b) => b.checked)).toBe(true);
  expect(button("Show all").disabled).toBe(true);

  await click(button("Hide all"));
  expect(boxes().every((b) => !b.checked)).toBe(true);
  expect(leaflet.props.items).toEqual({ zones: [], entrances: [], pins: [], treasures: [], flightMasters: [], flightLines: [] });
  expect(listRows("map-list-entrances")).toEqual([]);
  expect($("[aria-labelledby=map-list-entrances]").textContent).toContain("This category is off.");

  await click(button("Show all"));
  expect(boxes().every((b) => b.checked)).toBe(true);
  expect(leaflet.props.items.flightMasters).toHaveLength(2);
});

test("the List tab lists what the map draws, layer by layer, with counts to match", async () => {
  await mount();
  expect($("[data-map-list]").hidden).toBe(true);
  await click(button("List"));
  expect($("[data-map-list]").hidden).toBe(false);
  expect($("[data-map-categories]").hidden).toBe(true);

  const names = (rows: string[]) => rows.map((r) => r.replace(/Show on map$/, "").split(" · ")[0]!.trim());
  expect(names(listRows("map-list-flights"))).toEqual(leaflet.props.items.flightMasters.map((f) => f.name));
  expect(names(listRows("map-list-entrances"))).toEqual(leaflet.props.items.entrances.map((e) => e.names.join(", ")));
  expect(listRows("map-list-zones")).toEqual(["Durotar", "The Barrens"]);

  // Switch a layer off: it leaves the map and the list together.
  await click(button("Categories"));
  const entrances = Array.from(container.querySelectorAll("fieldset label")).find((l) => l.textContent?.startsWith("Dungeon entrances"))!;
  expect(entrances.textContent).toBe("Dungeon entrances, 1");
  await click(entrances.querySelector("input")!);
  expect(leaflet.props.items.entrances).toEqual([]);
  expect(listRows("map-list-entrances")).toEqual([]);
});

test("Show on map moves the map, opens the card with focus on it, and closing it gives focus back", async () => {
  await mount();
  await click(button("List"));
  const show = Array.from(container.querySelectorAll("[aria-labelledby=map-list-flights] button"))[0] as HTMLButtonElement;
  show.focus();
  await click(show);
  expect(leaflet.props.selectedId).toBe("f1");
  expect(leaflet.props.request?.box).toEqual(spotBox(500, 100));
  const card = $("[data-map-card]");
  expect(card.textContent).toContain("Orgrimmar, Durotar");
  expect(card.textContent).toContain("Durotar 50, 10");
  expect(document.activeElement).toBe(card);
  // The zone in view is named in the sidebar, with a way back to the whole continent.
  expect($("[data-map-zone]").textContent).toContain("Durotar");

  await click(button("Close", card));
  expect(container.querySelector("[data-map-card]")).toBeNull();
  expect(document.activeElement).toBe(show);
});

test("a phone's bar opens each sheet; Escape closes it and focus goes back to the bar", async () => {
  await mount();
  const bar = $("[data-map-bar]");
  expect(panel().hasAttribute("data-open")).toBe(false);

  await click(button("List", bar));
  expect(panel().hasAttribute("data-open")).toBe(true);
  expect(button("List", bar).getAttribute("aria-expanded")).toBe("true");
  expect($("[data-map-list]").hidden).toBe(false);
  expect(document.activeElement).toBe(panel());

  await act(async () => { panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(panel().hasAttribute("data-open")).toBe(false);
  expect(document.activeElement).toBe(button("List", bar));

  // Search: the field alone, focused.
  await click(button("Search", bar));
  expect(panel().getAttribute("data-mode")).toBe("search");
  expect(document.activeElement).toBe($("#map-search"));

  // The handle: tapped (or Enter) it goes full height, again back to half.
  const handle = button("Full height");
  await act(async () => { handle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })); });
  expect(panel().hasAttribute("data-full")).toBe(true);

  // Choosing a result makes way for the card.
  await act(async () => {
    const input = $<HTMLInputElement>("#map-search");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, "ragefire");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button("Ragefire ChasmDungeon entrance"));
  expect(panel().hasAttribute("data-open")).toBe(false);
  expect(leaflet.props.selectedId).toBe("ex");
});

test("the address keeps an old link's parts and adds the camera; an old at/z link opens where it says", async () => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/map?zone=1411&spoilers=1");
  await mount({ view: { at: [-512, 1830], zoom: 1.5, pin: "f1" } });
  expect(leaflet.props.initial).toEqual({ x: -512, y: 1830, zoom: 1.5 });
  await act(async () => { leaflet.props.onView({ x: 640.4, y: 320.6, zoom: 2.123 }); vi.advanceTimersByTime(300); });
  expect(window.location.search).toBe("?zone=1411&spoilers=1&at=640%2C321&z=2.12&pin=f1");
});

test("the pins come from the pins route, not the page: flight paths and points appear once it answers", async () => {
  let reply!: (v: unknown) => void;
  fetcher = vi.fn(() => new Promise((resolve) => { reply = resolve; }) as never);
  vi.stubGlobal("fetch", fetcher);
  await mount();
  expect(fetcher).toHaveBeenCalledWith("/api/map/pins?continent=1");
  // Until then the page's own items: entrances and flight masters, no flight paths; the counts are the page's.
  expect(leaflet.props.items.flightLines).toEqual([]);
  expect(leaflet.props.items.flightMasters).toHaveLength(2);
  const count = (name: string) => Array.from(container.querySelectorAll("fieldset label")).find((l) => l.textContent?.startsWith(name))!.textContent;
  expect(count("Flight paths")).toBe("Flight paths, 1");
  await act(async () => { reply({ ok: true, json: async () => ({ ok: true, ...pinSet }) }); await Promise.resolve(); await Promise.resolve(); });
  expect(leaflet.props.items.flightLines.map((l) => l.id)).toEqual(["l1"]);
  expect(container.textContent).not.toContain("did not load");
});

test("a pins route that fails says so and keeps the page's items", async () => {
  fetcher = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
  vi.stubGlobal("fetch", fetcher);
  await mount();
  expect($("[data-map-meta]").textContent).toContain("Flight paths and player points did not load.");
  expect(leaflet.props.items.flightMasters).toHaveLength(2);
});

test("categories that wait for uploads are listed with their zero, greyed, with the addon named once per group", async () => {
  await mount({ candidates: [{ category: "npc", mapId: 1411, count: 2 }] });
  const row = (name: string) => Array.from(container.querySelectorAll("fieldset label")).find((l) => l.textContent?.startsWith(name))!;
  for (const name of ["Herbs", "Ore", "Chests and treasure", "Trainers", "Vendors"]) {
    expect(row(name).querySelector("input")!.disabled, name).toBe(true);
    const note = document.getElementById(row(name).querySelector("input")!.getAttribute("aria-describedby")!)!;
    expect(note.textContent, name).toBe("waiting for player uploads");
  }
  // Seen by 1 or 2 installs: a count, never a pin.
  const npc = row("Other NPCs").querySelector("input")!;
  expect(document.getElementById(npc.getAttribute("aria-describedby")!)!.textContent).toBe("2 places seen by 1 or 2 installs");
  expect(leaflet.props.items.pins).toEqual([]);
  expect(row("Flight masters").querySelector("input")!.disabled).toBe(false);
  for (const group of ["services", "gathering"]) expect($(`[data-category-group=${group}] a[href="/addon"]`)).not.toBeNull();
  for (const group of ["travel", "instances", "places"]) expect(container.querySelector(`[data-category-group=${group}] a[href="/addon"]`)).toBeNull();
});

test("the sidebar's state goes into the address and comes back from it", async () => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/map/kalimdor?spoilers=1");
  await mount();
  const row = (name: string) => Array.from(container.querySelectorAll("fieldset label")).find((l) => l.textContent?.startsWith(name))!.querySelector("input")!;
  await click(row("Flight paths"));
  await act(async () => { vi.advanceTimersByTime(300); });
  expect(new URLSearchParams(window.location.search).get("show")).toBe(CATEGORY_IDS.filter((id) => id !== "path").join(","));
  await click(button("List"));
  await act(async () => {
    const input = $<HTMLInputElement>("#map-search");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "orgri");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { vi.advanceTimersByTime(300); });
  const q = new URLSearchParams(window.location.search);
  expect(q.get("view")).toBe("list");
  expect(q.get("q")).toBe("orgri");
  expect(q.get("spoilers")).toBe("1");
  // The continent tabs carry it along.
  expect(container.querySelector('a[href^="/map/eastern-kingdoms?"]')!.getAttribute("href")).toBe(`/map/eastern-kingdoms?show=${encodeURIComponent(CATEGORY_IDS.filter((id) => id !== "path").join(","))}&view=list`);

  // A link with that state opens the same sidebar.
  await unmount();
  await mount({ url: { show: { ...DEFAULT_URL_STATE.show, path: false }, q: "orgri", tab: "list" } });
  expect(row("Flight paths").checked).toBe(false);
  expect($("[data-map-list]").hidden).toBe(false);
  expect($<HTMLInputElement>("#map-search").value).toBe("orgri");
  expect(container.querySelector('[aria-label="Search results"]')!.textContent).toContain("Orgrimmar, Durotar");
});

test("going to a zone adds a history entry; Back returns to the whole continent", async () => {
  window.history.replaceState(null, "", "/map/kalimdor");
  const before = window.history.length;
  await mount();
  await click(button("List"));
  const durotar = Array.from(container.querySelectorAll("[aria-labelledby=map-list-zones] a")).find((a) => a.textContent === "Durotar")!;
  await click(durotar);
  expect(window.history.length).toBe(before + 1);
  expect(window.location.search).toBe("?zone=1411");
  expect($("[data-map-zone]").textContent).toContain("Durotar");
  expect(leaflet.props.request?.box).toMatchObject({ x: 0, y: 0, width: 1000, height: 1000 });

  await act(async () => {
    window.history.replaceState(window.history.state, "", "/map/kalimdor");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(container.querySelector("[data-map-zone]")).toBeNull();
  expect(leaflet.props.request?.box).toEqual(base);

  // And Forward to the zone again.
  await act(async () => {
    window.history.replaceState(window.history.state, "", "/map/kalimdor?zone=1413");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect($("[data-map-zone]").textContent).toContain("The Barrens");
  // "All of Kalimdor" is a new entry too.
  const length = window.history.length;
  await click(button("All of Kalimdor"));
  expect(window.history.length).toBe(length + 1);
  expect(window.location.search).toBe("");
});

test("the card: Copy link for the pin, and Open page by kind", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const vendor = { id: "vendor-9-1411", kind: "vendor" as const, npcId: 9, name: "Trader", mapId: 1411, zoneName: "Durotar", x: 300, y: 300, zoneX: 30, zoneY: 30, reporters: 3, heldBack: false };
  fetcher = answer({ ok: true, ...pinSet, pins: [vendor] });
  vi.stubGlobal("fetch", fetcher);
  await mount();
  const pick = async (id: string) => { await act(async () => leaflet.props.onSelect(id)); return $("[data-map-card]"); };

  let card = await pick("vendor-9-1411");
  expect(card.querySelector('a[href="/database/vendors/9"]')!.textContent).toBe("Open vendor page");
  await click(button("Copy link", card));
  expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/map/kalimdor?pin=vendor-9-1411`);
  expect(card.textContent).toContain(`Copied: ${window.location.origin}/map/kalimdor?pin=vendor-9-1411`);

  // An entrance opens the page of the zone that holds it; a flight master has no page.
  card = await pick("ex");
  expect(card.querySelector('a[href="/database/zones/1411-durotar"]')!.textContent).toBe("Open zone page");
  card = await pick("f1");
  expect(Array.from(card.querySelectorAll("a")).map((a) => a.textContent)).toEqual([]);
  expect(button("Copy link", card)).toBeDefined();
});

test("a pin link to a point past what the page carried opens on it once the pins load", async () => {
  const far = { id: "npc-5-1413", kind: "npc" as const, npcId: 5, name: "Far Guard", mapId: 1413, zoneName: "The Barrens", x: 1500, y: 1500, zoneX: 50, zoneY: 75, reporters: 3, heldBack: false };
  fetcher = answer({ ok: true, ...pinSet, pins: [far] });
  vi.stubGlobal("fetch", fetcher);
  await mount({ view: { at: null, zoom: null, pin: "npc-5-1413" } });
  expect(leaflet.props.request?.box).toEqual(spotBox(1500, 1500));
  expect($("[data-map-card]").textContent).toContain("Far Guard");
  expect($("[data-map-card]").querySelector('a[href="/database/npcs/5"]')).not.toBeNull();
});

test("the legend's marks are the map's: the game's icon where the upload has one, the glyph elsewhere, and the map gets the same icons", async () => {
  const poi = { dungeon: "https://assets.example.test/b/poi/Dungeon.webp", flight: "https://assets.example.test/b/poi/TaxiNode_Neutral.webp" };
  await mount({ poi });
  const row = (name: string) => [...container.querySelectorAll("label")].find((l) => l.textContent?.includes(name))!;
  expect(row("Dungeon entrances").querySelector("img[data-swatch-icon]")?.getAttribute("src")).toBe(poi.dungeon);
  expect(row("Flight masters").querySelector("img[data-swatch-icon]")?.getAttribute("src")).toBe(poi.flight);
  // Raids have no piece in this upload: the glyph stays, and so does the pin's.
  expect(row("Raid entrances").querySelector("img")).toBeNull();
  expect(row("Raid entrances").querySelector("svg")).not.toBeNull();
  expect(leaflet.props.icons).toEqual(poi);
  await act(async () => root.unmount());
  await mount();
  expect(container.querySelector("img[data-swatch-icon]")).toBeNull();
  expect(leaflet.props.icons).toEqual({});
});

test("reduced motion: the sheet slides only when motion is welcome, and the global rule stops the rest", () => {
  const css = readFileSync(source("components/map/world-map.css"), "utf8").replace(/\r\n/g, "\n");
  const motionBlock = css.slice(css.indexOf("@media (max-width: 767.98px) and (prefers-reduced-motion: no-preference)"));
  // Every transition on the sheet lives inside the no-preference block.
  const sheetRules = css.split("\n").filter((l) => /transition:/.test(l) && /var\(--dur-(sheet|panel)\)/.test(l));
  expect(sheetRules.length).toBeGreaterThan(0);
  for (const rule of sheetRules) expect(motionBlock).toContain(rule);
  const globals = readFileSync(source("app/globals.css"), "utf8");
  expect(globals).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, ::before, ::after \{\s*animation: none !important;\s*transition: none !important;/);
  // Leaflet's own zoom and the fit to a chosen place skip their animation too.
  const leafletSource = readFileSync(source("components/map/LeafletMap.tsx"), "utf8");
  expect(leafletSource).toContain("zoomAnimation: !reducedMotion()");
  expect(leafletSource).toContain("animate: !reducedMotion()");
});
