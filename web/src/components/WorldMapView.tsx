"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge, Card, LinkTabs, Segmented } from "@/components/ui";
import {
  allCategories, candidateCounts, categoryCounts, CATEGORY_GROUPS, CATEGORY_IDS, continentPath, initialView, mapUrlSearch, openPageLink,
  parseDeepLink, parseZoneLink, pinHref, readPinSet, searchMap, spotBox, viewSearch, visibleItems, wayCommand, zoneSearch, zoneSpot,
  type Box, type Candidate, type CategoryId, type CategoryState, type MapArtLayer, type MapItems, type MapPinSet, type MapUrlState, type SearchHit,
} from "@/lib/map-view";
import type { PoiIcons } from "@/lib/map-marks";
import { confirmedLine } from "@/lib/report-labels";
import MapList, { HELD_LABEL } from "./map/MapList";
import type { FitRequest, MapMarker, MapViewChange } from "./map/LeafletMap";
import "./map/world-map.css";

export type { MapMarker };

// Leaflet is loaded here and nowhere else: the rest of the site never downloads it, and the List tab is rendered
// on the server, so the page reads without it.
const LeafletMap = dynamic(() => import("./map/LeafletMap"), {
  ssr: false,
  loading: () => <p className="grid h-full place-items-center px-4 text-center text-sm text-muted">Loading the map. The same places are in the List tab.</p>,
});

/** Where the desktop sidebar's collapsed state is kept, in this browser only. */
export const SIDEBAR_KEY = "everloot.map.sidebar";

/** The sidebar's two views on a desk; on a phone, which bottom sheet is open. */
type View = MapUrlState["tab"];
type Sheet = View | "search";

/** Each category's mark, the same shape the map draws; a category with nothing on the map yet gets an empty ring. */
/**
 * The mark beside a legend row: the same mark the category's pins carry on the map. The game's own icon where the
 * upload has one; else the glyph the stylesheet draws on the pins, in the same shape and colour.
 */
function Swatch({ category, icon }: { category: CategoryId; icon?: string }) {
  if (icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" aria-hidden="true" width={18} height={18} data-swatch-icon decoding="async" className="h-[18px] w-[18px] shrink-0 object-contain" />;
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      {category === "zone" && <rect x="1.5" y="1.5" width="11" height="11" strokeWidth="1.2" className="fill-fg/10 stroke-edge" />}
      {category === "dungeon" && <circle cx="7" cy="7" r="5" className="fill-accent" />}
      {category === "raid" && <rect x="2" y="2" width="10" height="10" className="fill-warning" />}
      {category === "flight" && <path d="M7 1.5L12.5 12L1.5 12Z" className="fill-fg" />}
      {category === "path" && <path d="M1 11L13 3" strokeWidth="1.5" strokeDasharray="3 2" className="stroke-fg-2" />}
      {category === "npc" && <circle cx="7" cy="7" r="3.5" className="fill-fg-2" />}
      {category === "vendor" && <path d="M7 1.5L12.5 7L7 12.5L1.5 7Z" className="fill-fg" />}
      {category === "chest" && <rect x="3" y="3" width="8" height="8" rx="1" fill="none" strokeWidth="2" className="stroke-fg" />}
      {["trainer", "quest", "service", "herb", "ore"].includes(category) && <circle cx="7" cy="7" r="4" fill="none" strokeWidth="1.2" className="stroke-muted" />}
    </svg>
  );
}

/** Our own line icons for the rail and the phone bar. */
function Icon({ name }: { name: "categories" | "search" | "list" | "open" | "close" }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {name === "categories" && <><path d="M12 3 21 8l-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></>}
      {name === "search" && <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>}
      {name === "list" && <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>}
      {name === "open" && <path d="m9 6 6 6-6 6" />}
      {name === "close" && <path d="m15 6-6 6 6 6" />}
    </svg>
  );
}

const SHEET_LABEL: Record<Sheet, string> = { categories: "Categories", search: "Search", list: "List" };

/** What a pin on the map is, for its card. */
interface Subject {
  id: string;
  kind: "entrance" | "flight" | "npc" | "vendor" | "treasure";
  title: string;
  detail: string;
  x: number;
  y: number;
  /** The NPC, for a player-observed point: its page. */
  npcId?: number;
  /** The object, for a treasure: its page. */
  objectId?: number;
  reporters?: number;
  heldBack?: boolean;
  /** For an entrance: the instances it leads to, whether the files place it, and what players confirmed. */
  instanceMapIds?: number[];
  files?: boolean;
  confirmed?: { installs: number; lastSeen: string | null } | null;
}

export interface WorldMapViewProps {
  /** The page title, for the heading screen readers land on (the sidebar shows the continent tabs instead). */
  title: string;
  name: string;
  continentId: number;
  continents: { id: number; name: string }[];
  /** The continent's box in yards. */
  base: Box;
  /**
   * What the page carries for its List tab: the zones, entrances and flight masters, and the first player points.
   * Held-back zones and their items are in only with spoilers on. The rest comes from `pinsUrl`.
   */
  items: MapItems;
  /** `/api/map/pins` for this continent and spoiler switch: every item the map draws besides the zones. */
  pinsUrl: string;
  /** Until the pins load: the counts in the opening scope, and how many player points there are by kind. */
  seed: { counts: Record<CategoryId, number>; pins: { npc: number; vendor: number } };
  /** Places seen by 1 or 2 installs, as counts per zone and category. */
  candidates: Candidate[];
  /** Each public zone's database page, by zone id, for the card's Open zone page. */
  zonePages: Record<number, string>;
  /** Each instance's page, by instance id, for an entrance card's Open instance page. */
  instancePages?: Record<number, string>;
  /** The sidebar's state from the address: categories shown, the search, the tab. */
  url: MapUrlState;
  spoilers: boolean;
  /** The address that turns the spoiler switch the other way, keeping the zone or spot. */
  spoilerHref: string;
  /** The game's own map pictures, already filtered for spoilers; null without the asset URL. */
  art?: MapArtLayer | null;
  /** Small loading screens by dungeon or raid name, already filtered for spoilers; absent without the asset URL. */
  thumbs?: Record<string, string>;
  /** The game's minimap icons by legend category, for the legend rows and the pins; absent without the asset URL. */
  poi?: PoiIcons;
  /** A spot from a deep link: a ring, and the view opens on it. */
  marker: (MapMarker & { mapId: number }) | null;
  /** The zone a link asked for, to open fitted to the view. */
  zoneId: number | null;
  /** The view the address carries: the centre in yards, the zoom, the selected item. */
  view: { at: [number, number] | null; zoom: number | null; pin: string | null };
  /** A line over the map that the reader can close: a held-back zone asked for, storage out of reach. */
  notice?: ReactNode;
  /** The sidebar's foot: data age, the cross-check, the site's credit line and the guide. */
  meta?: ReactNode;
}

/**
 * The world map, full screen under the site header: Leaflet beside a sidebar with the continent tabs, search, the
 * categories and a List tab. On a desk the sidebar collapses to a rail; on a phone it becomes bottom sheets opened
 * from a bar, and a pin's card is a sheet too.
 */
export default function WorldMapView(props: WorldMapViewProps) {
  const { base, marker, spoilers, art } = props;
  const icons: PoiIcons = props.poi ?? {};
  const [show, setShow] = useState<CategoryState>(props.url.show);
  const [showArt, setShowArt] = useState(true);
  const [query, setQuery] = useState(props.url.q);
  // Everything the map draws besides the zones, once /api/map/pins answers; until then, what the page carried.
  const [pinSet, setPinSet] = useState<MapPinSet | null>(null);
  const [pinsFailed, setPinsFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(props.view.pin);
  const [focusZone, setFocusZone] = useState<number | null>(props.marker?.mapId ?? props.zoneId);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState("");
  const [request, setRequest] = useState<FitRequest | null>(null);
  const [view, setView] = useState<View>(props.url.tab);
  const [collapsed, setCollapsed] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [full, setFull] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(true);
  // Focus asked for after the next render: the search field once its panel shows, the card once it opens.
  const [focusAsk, setFocusAsk] = useState<{ to: "search" | "card" | "panel"; n: number } | null>(null);
  const requestId = useRef(0);
  const camera = useRef<MapViewChange | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const searchInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const barButtons = useRef(new Map<Sheet, HTMLButtonElement>());
  // Where focus goes back to when the card closes: the list row or search result that opened it.
  const returnFocus = useRef<HTMLElement | null>(null);
  const drag = useRef<number | null>(null);

  // The collapsed sidebar is remembered in this browser, and read before the browser paints the mounted map.
  useLayoutEffect(() => {
    try { if (localStorage.getItem(SIDEBAR_KEY) === "collapsed") setCollapsed(true); } catch { /* storage blocked: start open */ }
  }, []);
  const collapse = (on: boolean) => {
    setCollapsed(on);
    try { if (on) localStorage.setItem(SIDEBAR_KEY, "collapsed"); else localStorage.removeItem(SIDEBAR_KEY); } catch { /* not remembered */ }
  };

  // The pins are fetched, not inlined in the page: the CDN keeps one copy per continent between corpus snapshots.
  useEffect(() => {
    let live = true;
    fetch(props.pinsUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (!live) return;
        const set = readPinSet(body);
        if (set) setPinSet(set); else setPinsFailed(true);
      })
      .catch(() => { if (live) setPinsFailed(true); });
    return () => { live = false; };
  }, [props.pinsUrl]);

  const items = useMemo<MapItems>(() => (pinSet ? { zones: props.items.zones, ...pinSet } : props.items), [pinSet, props.items]);
  const shown = useMemo(() => visibleItems(items, show, spoilers), [items, show, spoilers]);
  // Zones the reader may see, whatever the zone category says: coordinates and a click on a zone use them.
  const zones = useMemo(() => items.zones.filter((z) => spoilers || !z.heldBack), [items.zones, spoilers]);
  const focus = focusZone !== null ? items.zones.find((z) => z.mapId === focusZone) : undefined;
  // Counts in the zone in focus, else the continent. Until the pins load, the page's own counts for the opening view.
  const counts = useMemo(() => (pinSet ? categoryCounts(items, spoilers, focus ?? null) : props.seed.counts), [pinSet, items, spoilers, focus, props.seed.counts]);
  const candidates = useMemo(() => candidateCounts(props.candidates, zones, focus ?? null), [props.candidates, zones, focus]);
  const pinTotal = pinSet ? undefined : (show.npc ? props.seed.pins.npc : 0) + (show.vendor ? props.seed.pins.vendor : 0);

  const subjects = useMemo(() => {
    const out = new Map<string, Subject>();
    for (const e of shown.entrances) {
      out.set(`e${e.id}`, {
        id: `e${e.id}`, kind: "entrance", title: e.names.join(", "), detail: e.raid ? "Raid entrance" : "Dungeon entrance", x: e.x, y: e.y,
        instanceMapIds: e.instanceMapIds, files: e.files ?? true, confirmed: e.confirmed ? { installs: e.confirmed, lastSeen: e.lastSeen ?? null } : null,
      });
    }
    for (const f of shown.flightMasters) out.set(f.id, { id: f.id, kind: "flight", title: f.name, detail: "Flight master", x: f.x, y: f.y, heldBack: f.heldBack });
    for (const p of shown.pins) {
      out.set(p.id, {
        id: p.id, kind: p.kind, title: p.name ?? `NPC ${p.npcId}`, detail: p.kind === "vendor" ? "Vendor players saw" : "NPC players saw",
        x: p.x, y: p.y, npcId: p.npcId, reporters: p.reporters, heldBack: p.heldBack,
      });
    }
    for (const t of shown.treasures) {
      out.set(t.id, { id: t.id, kind: "treasure", title: t.name ?? `Object ${t.objectId}`, detail: "Treasure players saw on the minimap", x: t.x, y: t.y, objectId: t.objectId, confirmed: { installs: t.reporters, lastSeen: t.lastSeen ?? null } });
    }
    return out;
  }, [shown]);
  const selected = selectedId ? subjects.get(selectedId) ?? null : null;
  const selectedSpot = selected ? zoneSpot(zones, selected.x, selected.y) : null;
  const here = spot ? zoneSpot(zones, spot.x, spot.y) : null;
  const hovered = hover ? zoneSpot(zones, hover.x, hover.y) : null;

  const ask = (to: "search" | "card" | "panel") => setFocusAsk((f) => ({ to, n: (f?.n ?? 0) + 1 }));
  useEffect(() => {
    if (!focusAsk) return;
    const el = focusAsk.to === "search" ? searchInput.current : focusAsk.to === "card" ? card.current : panel.current;
    el?.focus();
  }, [focusAsk]);

  const openSheet = (s: Sheet) => {
    setSheet(s);
    if (s !== "search") setView(s);
    ask(s === "search" ? "search" : "panel");
  };
  /** Closes a phone's sheet; focus goes back to the bar button that opened it. */
  const closeSheet = () => {
    if (sheet) barButtons.current.get(sheet)?.focus();
    setSheet(null);
    setFull(false);
  };
  /** Opens the sidebar on a desk, from the rail: on a view, or on the search field. */
  const openFromRail = (to: View | "search") => {
    collapse(false);
    if (to === "search") ask("search");
    else { setView(to); ask("panel"); }
  };

  const fit = useCallback((b: Box) => setRequest({ id: ++requestId.current, box: b }), []);
  /** Moving to a zone, or back to the continent (null), is a new history entry: Back returns where the reader was. */
  const pushZone = useCallback((mapId: number | null) => {
    const now = new URLSearchParams(window.location.search);
    if (now.get("zone") === (mapId === null ? null : String(mapId)) && !now.has("x")) return;
    const s = zoneSearch(now, mapId);
    window.history.pushState(window.history.state, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
  }, []);
  const moveZone = useCallback((mapId: number) => {
    const z = props.items.zones.find((s) => s.mapId === mapId);
    if (!z) return false;
    setFocusZone(mapId);
    setSelectedId(null);
    setSpot(null);
    fit(z);
    return true;
  }, [props.items.zones, fit]);
  const moveHome = useCallback(() => {
    setFocusZone(null);
    setSelectedId(null);
    setSpot(null);
    fit(base);
  }, [base, fit]);
  const goZone = useCallback((mapId: number) => { if (moveZone(mapId)) pushZone(mapId); }, [moveZone, pushZone]);
  const goSubject = useCallback((s: Subject) => {
    setSelectedId(s.id);
    setSpot(null);
    setFocusZone(zoneSpot(zones, s.x, s.y)?.zone.mapId ?? null);
    fit(spotBox(s.x, s.y));
  }, [zones, fit]);
  /** From the list or search: the map moves to the item, a phone's sheet makes way, and focus goes to the card. */
  const showItem = (id: string) => {
    const s = subjects.get(id);
    if (!s) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    goSubject(s);
    setSheet(null);
    setFull(false);
    ask("card");
  };
  const showZone = (mapId: number) => {
    goZone(mapId);
    setSheet(null);
    setFull(false);
  };
  const goHit = (hit: SearchHit) => {
    setQuery("");
    if (hit.kind === "zone") showZone(Number(hit.id.slice(1)));
    else showItem(hit.id);
  };
  const goHome = () => {
    moveHome();
    pushZone(null);
  };
  // Back and Forward between zones on this page: the map follows the address. Another page's entry is the router's.
  useEffect(() => {
    const path = window.location.pathname;
    const onPop = () => {
      if (window.location.pathname !== path) return;
      const q = new URLSearchParams(window.location.search);
      const link = { zone: q.get("zone") ?? undefined, x: q.get("x") ?? undefined, y: q.get("y") ?? undefined };
      const mapId = parseDeepLink(link)?.mapId ?? parseZoneLink(link);
      if (mapId === null || !moveZone(mapId)) moveHome();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [moveZone, moveHome]);
  const closeCard = () => {
    setSelectedId(null);
    setSpot(null);
    const back = returnFocus.current;
    returnFocus.current = null;
    // The row that opened the card, when it is still on screen (a phone's sheet has closed since).
    if (back?.isConnected && back.offsetParent !== null) back.focus();
  };

  // The address keeps the zone, spot and spoiler switch it was opened with, and adds where the reader is and what
  // the sidebar shows. Camera moves replace the entry; only zone changes add one (pushZone).
  const urlState = useRef<MapUrlState>({ show, q: query, tab: view });
  urlState.current = { show, q: query, tab: view };
  const sync = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const c = camera.current;
      const withState = mapUrlSearch(new URLSearchParams(window.location.search), urlState.current);
      const search = c ? viewSearch(withState, { x: c.x, y: c.y, zoom: c.zoom, pin: selectedRef.current }) : withState.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
    }, 250);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { sync(); }, [selectedId, show, query, view, sync]);
  const onView = useCallback((v: MapViewChange) => { camera.current = v; sync(); }, [sync]);

  // Read once, when the map opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => initialView({ base, items, view: props.view, marker, zoneId: props.zoneId }), []);
  // A `pin=` for a player point past the first the page carried: the map moves to it once the pins load.
  const pinWaiting = useRef(Boolean(props.view.pin && !(props.view.at && props.view.zoom !== null) && !marker && !subjects.has(props.view.pin)));
  useEffect(() => {
    if (!pinSet || !pinWaiting.current || !props.view.pin) return;
    pinWaiting.current = false;
    const s = subjects.get(props.view.pin);
    if (s) fit(spotBox(s.x, s.y));
  }, [pinSet, subjects, props.view.pin, fit]);

  // Zones are found whether or not their layer is on; everything else only while its layer shows.
  const hits = useMemo(() => searchMap({ ...shown, zones }, query), [shown, zones, query]);

  const target = selected
    ? { name: selected.title, at: selectedSpot }
    : spot ? { name: here?.zone.name ?? "", at: here } : null;
  const command = target?.at ? wayCommand(target.at.x, target.at.y, target.name) : null;
  // The card's own link: the continent's page with the item selected; a held-back item's link keeps spoilers on.
  const permalink = selected ? pinHref(props.continentId, selected.id, spoilers && Boolean(selected.heldBack)) : null;
  const page = selected
    ? openPageLink({ kind: selected.kind, npcId: selected.npcId, objectId: selected.objectId, instanceMapIds: selected.instanceMapIds, x: selected.x, y: selected.y }, zones, props.zonePages, props.instancePages)
    : spot ? openPageLink({ kind: "spot", x: spot.x, y: spot.y }, zones, props.zonePages) : null;
  const copy = async (text: string, failed: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`Copied: ${text}`);
    } catch {
      setCopied(failed);
    }
  };
  useEffect(() => { setCopied(""); }, [command]);

  // The continent tabs keep the spoiler switch, the categories and the tab.
  const tabHref = (id: number) => {
    const s = mapUrlSearch(new URLSearchParams(spoilers ? "spoilers=1" : ""), { show, q: "", tab: view }).toString();
    return `${continentPath(id)}${s ? `?${s}` : ""}`;
  };
  const cardSpot = selected ? selectedSpot : here;
  const allOn = CATEGORY_IDS.every((id) => show[id]);
  const allOff = CATEGORY_IDS.every((id) => !show[id]);
  const railButton = "inline-flex h-11 w-11 items-center justify-center rounded-control text-fg-2 hover:bg-canvas hover:text-accent";

  return (
    <div data-map-shell data-collapsed={collapsed ? "" : undefined} className="fixed inset-x-0 bottom-0 top-header z-30 flex flex-col bg-canvas md:flex-row">
      {/* Without JavaScript there is no map: the List tab shows, in the sheet on a phone. */}
      <noscript><style>{"[data-map-list][hidden]{display:block}@media (max-width:767.98px){[data-map-panel]{display:flex!important}}"}</style></noscript>
      <h1 className="sr-only">{props.title}</h1>

      {/* A desk with the sidebar collapsed: a 48 px rail of buttons that open it again. */}
      <nav aria-label="Map sidebar" data-map-rail className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2 md:flex">
        <button type="button" aria-label="Open the sidebar" title="Open the sidebar" aria-expanded={false} aria-controls="map-panel" onClick={() => openFromRail(view)} className={railButton}><Icon name="open" /></button>
        <button type="button" aria-label="Categories" title="Categories" onClick={() => openFromRail("categories")} className={railButton}><Icon name="categories" /></button>
        <button type="button" aria-label="Search the map" title="Search the map" onClick={() => openFromRail("search")} className={railButton}><Icon name="search" /></button>
        <button type="button" aria-label="List" title="List" onClick={() => openFromRail("list")} className={railButton}><Icon name="list" /></button>
      </nav>

      <aside
        id="map-panel"
        ref={panel}
        tabIndex={-1}
        aria-label={sheet ? SHEET_LABEL[sheet] : "Map sidebar"}
        data-map-panel
        data-open={sheet ? "" : undefined}
        data-full={full ? "" : undefined}
        data-mode={sheet === "search" ? "search" : undefined}
        onKeyDown={(e) => { if (e.key === "Escape" && sheet) { e.stopPropagation(); closeSheet(); } }}
        className="flex min-h-0 flex-col bg-panel focus:outline-none md:w-80 md:shrink-0 md:border-r md:border-line"
      >
        {/* A phone: drag the handle up for the full screen, down to close; tap it to switch. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line pl-4 pr-1 md:hidden">
          <p className="text-h2-sm text-fg">{sheet ? SHEET_LABEL[sheet] : ""}</p>
          <button
            type="button"
            aria-label={full ? "Half height" : "Full height"}
            onPointerDown={(e) => { drag.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); }}
            onPointerUp={(e) => {
              const start = drag.current;
              drag.current = null;
              if (start === null) return;
              const dy = e.clientY - start;
              if (dy < -40) setFull(true);
              else if (dy > 40) { if (full) setFull(false); else closeSheet(); }
              else setFull((f) => !f);
            }}
            // A pointer is handled above; Enter and Space arrive as a click with no pointer (detail 0).
            onClick={(e) => { if (e.detail === 0) setFull((f) => !f); }}
            className="grid h-11 flex-1 touch-none place-items-center"
          >
            <span aria-hidden="true" className="block h-1 w-10 rounded-full bg-edge" />
          </button>
          <button type="button" aria-label="Close" onClick={closeSheet} className="btn min-h-11 min-w-11 border-transparent px-0 text-lg leading-none">&times;</button>
        </div>

        <div className="flex shrink-0 items-end gap-1 pl-3 pr-1 pt-1">
          <div className="min-w-0 flex-1">
            <LinkTabs
              label="Continent"
              tabs={props.continents.map((c) => ({ href: tabHref(c.id), label: c.name, current: c.id === props.continentId }))}
            />
          </div>
          <button
            type="button" aria-label="Collapse the sidebar" title="Collapse the sidebar" aria-expanded={true} aria-controls="map-panel"
            onClick={() => collapse(true)} className={`${railButton} mb-0.5 hidden md:inline-flex`}
          ><Icon name="close" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3">
          {focus && (
            <div data-map-zone className="flex items-center justify-between gap-3 text-sm">
              <p className="min-w-0 font-medium text-fg [overflow-wrap:anywhere]">{focus.name}{focus.heldBack ? " *" : ""}</p>
              <button type="button" onClick={goHome} className="inline-flex min-h-11 shrink-0 items-center text-accent hover:underline underline-offset-4 md:min-h-8">All of {props.name}</button>
            </div>
          )}

          <form role="search" onSubmit={(e) => { e.preventDefault(); if (hits[0]) goHit(hits[0]); }}>
            <label htmlFor="map-search" className="sr-only">Search the map for a zone, entrance, flight master, NPC or treasure</label>
            <input
              id="map-search" ref={searchInput} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" placeholder="Search the map"
              aria-describedby="map-search-count"
              className="w-full rounded-control border border-edge bg-canvas px-3 text-sm text-fg placeholder:text-muted"
            />
            <p id="map-search-count" role="status" className="sr-only">{query.trim() ? `${hits.length} ${hits.length === 1 ? "result" : "results"}` : ""}</p>
            {query.trim() && (
              <ul aria-label="Search results" className="mt-1 overflow-hidden rounded-card border border-line bg-canvas text-sm">
                {hits.length === 0 && <li className="px-3 py-3 text-muted">Nothing on this continent by that name.</li>}
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => goHit(h)} className="flex min-h-11 w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-panel focus-visible:bg-panel">
                      <span className="min-w-0 text-fg [overflow-wrap:anywhere]">{h.label}</span>
                      <span className="shrink-0 text-xs text-muted">{h.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </form>

          <div data-map-view className="space-y-4">
            <div className="hidden md:block">
              <Segmented label="Sidebar view" stretch value={view} onChange={setView} options={[{ value: "categories", label: "Categories" }, { value: "list", label: "List" }]} />
            </div>

            <div data-map-categories hidden={view !== "categories"} className="space-y-4">
              <div className="flex gap-2">
                <button type="button" onClick={() => setShow(allCategories(true))} disabled={allOn} className="btn min-h-11 flex-1 px-3 text-sm md:min-h-8">Show all</button>
                <button type="button" onClick={() => setShow(allCategories(false))} disabled={allOff} className="btn min-h-11 flex-1 px-3 text-sm md:min-h-8">Hide all</button>
              </div>
              {CATEGORY_GROUPS.map((group) => {
                // A waiting category with nothing yet is listed greyed, so a player sees what an upload adds.
                const empty = group.categories.filter((c) => c.status === "waiting" && counts[c.id] === 0);
                return (
                  <fieldset key={group.id} data-category-group={group.id}>
                    <legend className="mb-0.5 text-sm font-medium text-fg">{group.label}</legend>
                    {empty.length > 0 && <p className="text-xs text-muted">Filled by uploads from the <Link href="/addon" className="text-accent hover:underline underline-offset-4">addon</Link> once 3 installs agree on a place.</p>}
                    {group.categories.map((c) => {
                      const idle = c.status === "waiting" && counts[c.id] === 0;
                      const near = candidates[c.id] ?? 0;
                      const note = near > 0
                        ? `${near} ${idle ? (near === 1 ? "place" : "places") : "more"} seen by 1 or 2 installs`
                        : idle ? "waiting for player uploads" : null;
                      return (
                        <div key={c.id}>
                          <label className={`flex min-h-11 items-center gap-2 text-sm md:min-h-9 ${idle ? "text-muted" : "cursor-pointer text-fg-2"}`}>
                            <input
                              type="checkbox" checked={show[c.id]} disabled={idle} aria-describedby={note ? `map-category-${c.id}` : undefined}
                              onChange={() => setShow((s) => ({ ...s, [c.id]: !s[c.id] }))} className="h-4 w-4 accent-accent"
                            />
                            <Swatch category={c.id} icon={icons[c.id]} />
                            <span className={`min-w-0 flex-1 ${idle ? "text-muted" : "text-fg"}`}>{c.label}</span>
                            <span data-count className="tabular-nums text-muted"><span className="sr-only">, </span>{counts[c.id]}</span>
                          </label>
                          {note && <p id={`map-category-${c.id}`} data-category-note className="-mt-1 pb-1 pl-6 text-xs text-muted">{note}</p>}
                        </div>
                      );
                    })}
                  </fieldset>
                );
              })}
              {spoilers && (
                <p className="flex items-center gap-2 text-xs text-muted">
                  <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><rect x="1" y="1" width="16" height="12" strokeWidth="1.2" strokeDasharray="3 2" className="fill-warning/10 stroke-warning" /></svg>
                  * Held-back zone <Badge tone="files">{HELD_LABEL}</Badge>
                </p>
              )}
              <div className="border-t border-line pt-3 text-sm">
                {art && (
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-fg md:min-h-9">
                    <input type="checkbox" checked={showArt} onChange={() => setShowArt((x) => !x)} className="h-4 w-4 accent-accent" />
                    Game map art
                  </label>
                )}
                <Link href={props.spoilerHref} className="inline-flex min-h-11 items-center text-accent hover:underline underline-offset-4 md:min-h-9">
                  {spoilers ? "Hide spoilers" : "Show spoilers"}
                </Link>
              </div>
            </div>

            <div data-map-list hidden={view !== "list"}>
              <MapList zones={zones} shown={shown} show={show} pinTotal={pinTotal} spoilers={spoilers} thumbs={props.thumbs} onZone={showZone} onShow={showItem} />
            </div>
          </div>

          {(props.meta || pinsFailed) && (
            <div data-map-meta className="space-y-1 border-t border-line pt-3 text-xs leading-relaxed text-muted">
              {pinsFailed && <p className="text-warning">Flight paths and player points did not load. Reload the page to try again.</p>}
              {props.meta}
            </div>
          )}
        </div>
      </aside>

      <div className="relative isolate min-h-0 min-w-0 flex-1 bg-panel">
        <LeafletMap
          name={props.name} base={base} items={shown} zones={zones} art={art ?? null} showArt={showArt} icons={icons}
          selectedId={selectedId} marker={marker} initial={initial} request={request}
          onSelect={(id) => { setSelectedId(id); if (id) { setSpot(null); setSheet(null); returnFocus.current = null; } }}
          onZone={goZone}
          onPoint={(x, y) => { setSpot({ x, y }); setSheet(null); returnFocus.current = null; }}
          onHover={setHover}
          onView={onView}
        />
        {props.notice && noticeOpen && (
          <div data-map-notice className="absolute left-16 right-2 top-2 z-[1100] flex items-start gap-2 rounded-card border border-line bg-panel py-1 pl-3 pr-1 text-sm text-warning md:right-auto md:max-w-lg">
            <div className="min-w-0 flex-1 py-2">{props.notice}</div>
            <button type="button" aria-label="Close the notice" onClick={() => setNoticeOpen(false)} className="btn min-h-11 min-w-11 shrink-0 border-transparent px-0 text-lg leading-none text-fg">&times;</button>
          </div>
        )}
        {/* Where the pointer is, on the game's 0 to 100 scale. A phone has no pointer: it reads the card instead. */}
        <p data-coordinates className="pointer-events-none absolute bottom-2 right-2 z-[1100] hidden rounded-control border border-line bg-panel px-3 py-1 font-mono text-xs text-fg-2 md:block">
          {hovered ? `${hovered.zone.name} ${hovered.x}, ${hovered.y}` : "Move over the map for coordinates"}
        </p>
        {/* The card for what was chosen: a sheet along the bottom on a phone, the map's corner on a desk. */}
        {(selected || (spot && here)) && (
          <div
            ref={card} tabIndex={-1} data-map-card aria-labelledby="map-card-title" role="group"
            onKeyDown={(e) => { if (e.key === "Escape") closeCard(); }}
            className="absolute inset-x-2 bottom-2 z-[1100] max-h-[50%] overflow-y-auto rounded-card focus:outline-none focus-visible:outline-2 focus-visible:outline-accent md:bottom-3 md:left-3 md:right-auto md:w-96"
          >
            <Card padding="none" className="space-y-2 bg-panel p-4" unconfirmed={(selected?.kind === "entrance" && !selected.confirmed) || selected?.kind === "flight"}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p id="map-card-title" className="text-base font-semibold text-fg [overflow-wrap:anywhere]">{selected ? selected.title : here?.zone.name}</p>
                  <p className="text-sm text-fg-2">{selected ? selected.detail : "A spot you picked"}</p>
                </div>
                <button type="button" aria-label="Close" onClick={closeCard} className="btn -mr-2 -mt-2 min-h-11 min-w-11 border-transparent px-0 text-lg leading-none">&times;</button>
              </div>
              <p className="font-mono text-sm text-fg-2">{cardSpot ? `${cardSpot.zone.name} ${cardSpot.x}, ${cardSpot.y}` : "Outside every zone"}</p>
              <div className="flex flex-wrap items-center gap-2">
                {selected && ((selected.kind === "entrance" && selected.files) || selected.kind === "flight") && <Badge tone="files" />}
                {selected?.confirmed ? <Badge tone="confirmed">{confirmedLine(selected.confirmed.installs, selected.confirmed.lastSeen)}</Badge> : null}
                {selected?.reporters ? <Badge tone="confirmed">Seen by {selected.reporters} installs</Badge> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {command && <button type="button" onClick={() => copy(command, "Could not copy. Select the line and copy it.")} className="btn min-h-11 px-4 text-sm">Copy /way</button>}
                {permalink && (
                  <button type="button" onClick={() => copy(new URL(permalink, window.location.origin).toString(), "Could not copy. The link is in the address bar.")} className="btn min-h-11 px-4 text-sm">
                    Copy link
                  </button>
                )}
                {page && <Link href={page.href} className="btn min-h-11 px-4 text-sm">{page.label}</Link>}
              </div>
              {command && <p className="font-mono text-xs text-muted" data-way>{command}</p>}
              <p role="status" className="text-xs text-fg-2">{copied}</p>
            </Card>
          </div>
        )}
      </div>

      {/* A phone: the bar that opens the sheets. */}
      <nav aria-label="Map sidebar" data-map-bar className="z-20 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] shrink-0 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden">
        {(["categories", "search", "list"] as const).map((s) => (
          <button
            key={s}
            ref={(el) => { if (el) barButtons.current.set(s, el); else barButtons.current.delete(s); }}
            type="button"
            aria-expanded={sheet === s}
            aria-controls="map-panel"
            onClick={() => (sheet === s ? closeSheet() : openSheet(s))}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors ${sheet === s ? "text-accent" : "text-fg-2 hover:text-fg"}`}
          >
            <Icon name={s} />
            {SHEET_LABEL[s]}
          </button>
        ))}
      </nav>
    </div>
  );
}
