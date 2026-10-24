"use client";

// The map itself: Leaflet on a flat, non-geographic grid (L.CRS.Simple). One unit is one yard on the stitched map
// (x east, y south), so Leaflet's latitude is minus y. Loaded only on /map, through next/dynamic with ssr off.
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import {
  labelFontPx, placeLabels, zoneArtShown, type ArtImage, type Box, type InitialView, type LabelCandidate, type MapArtLayer, type MapItems, type MapZone,
} from "@/lib/map-view";
import { pinIconUrl, pinMarkHtml, type PinKind, type PoiIcons } from "@/lib/map-marks";
import { reducedMotion } from "@/lib/motion";

/** Where the reader's deep link points: a ring on the spot. */
export interface MapMarker { x: number; y: number; label: string }
/** Ask the map to fit a box (yards) in view. `id` changes with every request, so the same box can be asked twice. */
export interface FitRequest { id: number; box: Box }
export interface MapViewChange { x: number; y: number; zoom: number }

export interface LeafletMapProps {
  name: string;
  /** The continent's box: the map cannot be moved or zoomed out beyond it. */
  base: Box;
  /** What the layers and the spoiler switch let through. */
  items: MapItems;
  /** Every zone the reader may see, for the coordinates and for a click on a zone, whatever the zone layer says. */
  zones: MapZone[];
  art: MapArtLayer | null;
  showArt: boolean;
  /** The game's minimap icons by legend category; a pin whose category has none is drawn as a glyph. */
  icons: PoiIcons;
  selectedId: string | null;
  marker: MapMarker | null;
  /** Where to open: a box to fit, or a centre and a zoom from the address. */
  initial: InitialView;
  request: FitRequest | null;
  onSelect: (id: string | null) => void;
  onZone: (mapId: number) => void;
  onPoint: (x: number, y: number) => void;
  onHover: (point: { x: number; y: number } | null) => void;
  onView: (view: MapViewChange) => void;
}

const MAX_ZOOM = 3;
/** A click on a zone zooms to it while the view is wider than this many zone widths; closer in, it drops a point. */
const ZONE_CLICK_SPAN = 1.6;
const ll = (x: number, y: number) => L.latLng(-y, x);
const bounds = (b: Box) => L.latLngBounds(ll(b.x, b.y + b.height), ll(b.x + b.width, b.y));
const box = (b: L.LatLngBounds): Box => ({ x: b.getWest(), y: -b.getNorth(), width: b.getEast() - b.getWest(), height: b.getNorth() - b.getSouth() });

function pinIcon(kind: PinKind, selected: boolean, icons: PoiIcons) {
  const image = pinIconUrl(kind, icons) !== null;
  return L.divIcon({
    className: `wm-pin wm-pin-${kind}${image ? " wm-pin-img" : ""}${selected ? " wm-selected" : ""}`,
    html: pinMarkHtml(kind, icons), iconSize: [26, 26], iconAnchor: [13, 13],
  });
}

/** The name a pin shows on hover (and on a tap, before its card). Text, never markup: names come from uploads too. */
function tooltipFor(name: string): HTMLElement {
  const el = document.createElement("span");
  el.textContent = name;
  return el;
}

function labelIcon(l: LabelCandidate) {
  const el = document.createElement("span");
  el.textContent = l.text;
  const held = l.text.endsWith("*");
  const kind = l.id.startsWith("z") ? (held ? "held" : "zone") : "poi";
  return L.divIcon({ className: `wm-label wm-label-${kind} wm-label-${l.align}`, html: el, iconSize: [0, 0] });
}

/** Plus and minus buttons, our own so they match the site (Leaflet's carry a drop shadow). */
function zoomButtons(m: L.Map) {
  const control = new L.Control({ position: "topleft" });
  control.onAdd = () => {
    const bar = L.DomUtil.create("div", "wm-zoom");
    const make = (label: string, text: string, by: number) => {
      const b = L.DomUtil.create("button", "", bar);
      b.type = "button";
      b.textContent = text;
      b.setAttribute("aria-label", label);
      L.DomEvent.on(b, "click", () => m.setZoom(m.getZoom() + by));
      return b;
    };
    const plus = make("Zoom in", "+", 1), minus = make("Zoom out", "\u2212", -1);
    const state = () => { plus.disabled = m.getZoom() >= m.getMaxZoom(); minus.disabled = m.getZoom() <= m.getMinZoom(); };
    m.on("zoomend zoomlevelschange", state);
    state();
    L.DomEvent.disableClickPropagation(bar);
    return bar;
  };
  return control;
}

export default function LeafletMap(props: LeafletMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const live = useRef(props);
  live.current = props;
  const groups = useRef<{ art: L.LayerGroup; zones: L.LayerGroup; flights: L.LayerGroup; pins: L.LayerGroup; labels: L.LayerGroup; marker: L.LayerGroup } | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const artLayers = useRef(new Map<string, L.ImageOverlay>());
  const relabel = useRef<() => void>(() => {});
  const resync = useRef<() => void>(() => {});

  // Create the map once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const p = live.current, pins = markers.current, art = artLayers.current;
    const m = L.map(el, {
      crs: L.CRS.Simple, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, maxZoom: MAX_ZOOM, minZoom: -8,
      attributionControl: false, zoomControl: false, maxBoundsViscosity: 1, zoomAnimation: !reducedMotion(), markerZoomAnimation: false,
    });
    map.current = m;
    const pad = Math.max(p.base.width, p.base.height) * 0.02;
    const limit = bounds({ x: p.base.x - pad, y: p.base.y - pad, width: p.base.width + 2 * pad, height: p.base.height + 2 * pad });
    m.setMaxBounds(limit);
    zoomButtons(m).addTo(m);
    m.getContainer().setAttribute("role", "group");
    m.getContainer().setAttribute("aria-label", `${p.name} map. Arrow keys pan, plus and minus zoom. The same items are in the List tab.`);
    for (const [pane, z] of [["art", 210], ["flights", 420], ["labels", 650]] as const) {
      const pn = m.createPane(pane);
      pn.style.zIndex = String(z);
      if (pane !== "art") pn.style.pointerEvents = "none";
    }
    // The picture drawn on the map is for the eyes; every item on it is in the List tab.
    for (const pane of ["overlayPane", "markerPane", "labels", "flights", "art"]) m.getPane(pane)?.setAttribute("aria-hidden", "true");
    groups.current = {
      art: L.layerGroup().addTo(m), zones: L.layerGroup().addTo(m), flights: L.layerGroup().addTo(m),
      pins: L.layerGroup().addTo(m), labels: L.layerGroup().addTo(m), marker: L.layerGroup().addTo(m),
    };

    const fitMin = () => {
      m.invalidateSize();
      const { x, y } = m.getSize();
      // A box with no size yet (hidden, or mid-resize) has no zoom that fits.
      if (!x || !y) return m.getMinZoom();
      const min = m.getBoundsZoom(limit, false);
      if (Number.isFinite(min)) m.setMinZoom(min);
      return m.getMinZoom();
    };
    // Open on the box asked for, or on the centre and zoom in the address.
    const first = fitMin();
    if ("fit" in p.initial) m.fitBounds(bounds(p.initial.fit), { animate: false, padding: [12, 12] });
    else m.setView(ll(p.initial.x, p.initial.y), Math.min(MAX_ZOOM, Math.max(first, p.initial.zoom)), { animate: false });

    const view = () => box(m.getBounds());
    const size = () => m.getSize();

    relabel.current = () => {
      const g = groups.current, now = live.current;
      if (!g) return;
      g.labels.clearLayers();
      const v = view(), zoom = Math.max(1, now.base.width / v.width), px = size().x, fontPx = labelFontPx(zoom);
      const biggest = Math.max(1, ...now.items.zones.map((z) => z.width * z.height));
      const out: LabelCandidate[] = [];
      for (const z of now.items.zones) {
        const x0 = Math.max(z.x, v.x), x1 = Math.min(z.x + z.width, v.x + v.width), y0 = Math.max(z.y, v.y), y1 = Math.min(z.y + z.height, v.y + v.height);
        if (x1 <= x0 || y1 <= y0) continue;
        out.push({ id: `z${z.mapId}`, text: z.heldBack ? `${z.name} *` : z.name, x: (x0 + x1) / 2, y: (y0 + y1) / 2, align: "middle", priority: 10 + 20 * (1 - (z.width * z.height) / biggest) });
      }
      const yards = v.width / px;
      for (const e of now.items.entrances) out.push({ id: `e${e.id}`, text: e.names[0]!, x: e.x + yards * 14, y: e.y, align: "start", priority: 60 });
      for (const f of now.items.flightMasters) if (zoom >= 3) out.push({ id: `f${f.id}`, text: f.name, x: f.x + yards * 14, y: f.y, align: "start", priority: 55 });
      if (zoom >= 6) for (const pin of now.items.pins) out.push({ id: `p${pin.id}`, text: pin.name ?? `NPC ${pin.npcId}`, x: pin.x + yards * 14, y: pin.y, align: "start", priority: 70 });
      if (zoom >= 6) for (const t of now.items.treasures) out.push({ id: `p${t.id}`, text: t.name ?? `Object ${t.objectId}`, x: t.x + yards * 14, y: t.y, align: "start", priority: 65 });
      if (now.marker) out.push({ id: "marker", text: now.marker.label, x: now.marker.x + yards * 26, y: now.marker.y, align: "start", priority: 100 });
      for (const l of placeLabels(out, v, px, fontPx)) L.marker(ll(l.x, l.y), { icon: labelIcon(l), interactive: false, keyboard: false }).addTo(g.labels);
    };

    // Which of the game's zone pictures to show at this zoom and place; the continent's own is laid once.
    resync.current = () => {
      const g = groups.current, now = live.current;
      if (!g) return;
      const wanted = new Map<string, ArtImage>();
      if (now.art && now.showArt) {
        const v = view();
        const camera = { zoom: Math.max(1, now.base.width / v.width), cx: v.x + v.width / 2, cy: v.y + v.height / 2 };
        if (now.art.continent) wanted.set(`c-${now.art.continent.url}`, now.art.continent);
        for (const z of zoneArtShown(now.art, camera, v)) wanted.set(`${z.uiMapId}-${z.url}`, z);
      }
      for (const [key, layer] of artLayers.current) if (!wanted.has(key)) { g.art.removeLayer(layer); artLayers.current.delete(key); }
      for (const [key, a] of wanted) {
        if (artLayers.current.has(key)) continue;
        const layer = L.imageOverlay(a.url, bounds(a), { pane: "art", interactive: false, alt: "" });
        layer.addTo(g.art);
        artLayers.current.set(key, layer);
      }
    };

    m.on("moveend zoomend", () => {
      relabel.current();
      resync.current();
      const c = m.getCenter();
      live.current.onView({ x: c.lng, y: -c.lat, zoom: m.getZoom() });
    });
    m.on("resize", () => { fitMin(); relabel.current(); resync.current(); });
    m.on("mousemove", (e: L.LeafletMouseEvent) => live.current.onHover({ x: e.latlng.lng, y: -e.latlng.lat }));
    m.on("mouseout", () => live.current.onHover(null));
    m.on("click", (e: L.LeafletMouseEvent) => {
      const now = live.current, x = e.latlng.lng, y = -e.latlng.lat;
      // The smallest zone under the click: zoom to it from afar, drop a point once already close.
      let zone: MapZone | null = null;
      for (const z of now.zones) if (x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height && (!zone || z.width * z.height < zone.width * zone.height)) zone = z;
      if (zone && view().width > zone.width * ZONE_CLICK_SPAN) now.onZone(zone.mapId);
      else { now.onSelect(null); now.onPoint(x, y); }
    });

    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(el);
    relabel.current();
    resync.current();
    const c = m.getCenter();
    p.onView({ x: c.lng, y: -c.lat, zoom: m.getZoom() });
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
      groups.current = null;
      pins.clear();
      art.clear();
    };
    // The map is made once; everything else reaches it through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zones, flight lines and pins follow the layers and the spoiler switch.
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.zones.clearLayers();
    g.flights.clearLayers();
    g.pins.clearLayers();
    markers.current.clear();
    // Smaller zones last, so an inner zone (a city in its zone) lies on top of the one around it.
    for (const z of [...props.items.zones].sort((a, b) => b.width * b.height - a.width * a.height)) {
      L.rectangle(bounds(z), { pane: "overlayPane", weight: 1, className: z.heldBack ? "wm-zone wm-zone-held" : "wm-zone", interactive: true }).addTo(g.zones);
    }
    for (const l of props.items.flightLines) {
      L.polyline(l.points.map(([x, y]) => ll(x, y)), { pane: "flights", weight: 1.5, className: "wm-flight-line", interactive: false, smoothFactor: 0 }).addTo(g.flights);
    }
    const add = (id: string, x: number, y: number, kind: PinKind, name: string) => {
      const mk = L.marker(ll(x, y), { icon: pinIcon(kind, id === live.current.selectedId, props.icons), keyboard: false, riseOnHover: true });
      mk.bindTooltip(tooltipFor(name), { direction: "top", offset: [0, -12], className: "wm-tooltip", opacity: 1 });
      mk.on("click", () => live.current.onSelect(id));
      mk.addTo(g.pins);
      markers.current.set(id, mk);
    };
    for (const e of props.items.entrances) add(`e${e.id}`, e.x, e.y, e.raid ? "raid" : "dungeon", e.names.join(", "));
    for (const f of props.items.flightMasters) add(f.id, f.x, f.y, "flight", f.name);
    for (const p of props.items.pins) add(p.id, p.x, p.y, p.kind, p.name ?? `NPC ${p.npcId}`);
    for (const t of props.items.treasures) add(t.id, t.x, t.y, "chest", t.name ?? `Object ${t.objectId}`);
    relabel.current();
  }, [props.items, props.icons]);

  // The selected pin is drawn bigger.
  useEffect(() => {
    for (const [id, mk] of markers.current) mk.getElement()?.classList.toggle("wm-selected", id === props.selectedId);
  }, [props.selectedId, props.items]);

  useEffect(() => { resync.current(); }, [props.art, props.showArt]);

  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.marker.clearLayers();
    if (props.marker) {
      L.marker(ll(props.marker.x, props.marker.y), {
        icon: L.divIcon({ className: "wm-pin wm-pin-spot", html: "<span></span>", iconSize: [40, 40], iconAnchor: [20, 20] }), interactive: false, keyboard: false,
      }).addTo(g.marker);
    }
    relabel.current();
  }, [props.marker]);

  // Asked to fit a box: the zone clicked, a search hit, a list item.
  useEffect(() => {
    const m = map.current;
    if (!m || !props.request) return;
    m.fitBounds(bounds(props.request.box), { animate: !reducedMotion(), padding: [24, 24], maxZoom: MAX_ZOOM });
  }, [props.request]);

  return <div ref={host} className="wm-map h-full w-full" />;
}
