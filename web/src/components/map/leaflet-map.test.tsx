// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MapItems } from "@/lib/map-view";

vi.mock("leaflet/dist/leaflet.css", () => ({}));

// jsdom lays nothing out: the box's size is set here, and the ResizeObserver is called by hand.
const size = { width: 800, height: 600 };
let observed: (() => void) | null = null;
class FakeResizeObserver {
  constructor(cb: () => void) { observed = cb; }
  observe() {}
  disconnect() { observed = null; }
}

import LeafletMap, { type LeafletMapProps } from "./LeafletMap";

const items: MapItems = {
  zones: [{ mapId: 1411, name: "Durotar", x: 0, y: 0, width: 1000, height: 1000, heldBack: false }],
  entrances: [{ id: "x", names: ["Ragefire Chasm"], raid: false, x: 400, y: 300, worldX: 1, worldY: 2 }],
  pins: [], treasures: [], flightMasters: [], flightLines: [],
};

let root: Root, host: HTMLDivElement;
const views: { x: number; y: number; zoom: number }[] = [];

beforeEach(() => {
  size.width = 800; size.height = 600; views.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  for (const [prop, key] of [["clientWidth", "width"], ["clientHeight", "height"]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get() { return size[key]; } });
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const props: LeafletMapProps = {
  name: "Kalimdor", base: { x: 0, y: 0, width: 1000, height: 1000 }, items, zones: items.zones, art: null, showArt: false, icons: {},
  selectedId: null, marker: null, initial: { fit: { x: 0, y: 0, width: 1000, height: 1000 } }, request: null,
  onSelect: () => {}, onZone: () => {}, onPoint: () => {}, onPin: () => {}, onHover: () => {}, onView: (v) => { views.push(v); },
};

test("a map whose box shrinks to nothing (a tab switch) keeps its view and draws no label at NaN", () => {
  act(() => root.render(<LeafletMap {...props} />));
  expect(observed).not.toBeNull();
  // The tab switch hides the map: its box has no size while the observer fires.
  size.width = 0; size.height = 0;
  expect(() => act(() => observed!())).not.toThrow();
  // Back to a size: the map fits again, and every view it reports is a number.
  size.width = 640; size.height = 480;
  expect(() => act(() => observed!())).not.toThrow();
  expect(views.length).toBeGreaterThan(0);
  for (const v of views) expect([v.x, v.y, v.zoom].every(Number.isFinite), JSON.stringify(v)).toBe(true);
});
