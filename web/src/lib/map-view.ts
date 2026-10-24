/**
 * The map page's layer rules, search, links and label placement, kept apart from the component so they can
 * be tested. Everything is in yards on the stitched map (x east, y south), the frame world-map.ts builds.
 */

export interface Box { x: number; y: number; width: number; height: number }
/** A camera over a base box: zoom 1 shows the whole box, a view is the box divided by zoom, centred on (cx, cy). */
export interface Camera { zoom: number; cx: number; cy: number }

/** The view a camera shows over a base box. */
export function cameraBox(base: Box, camera: Camera): Box {
  const width = base.width / camera.zoom, height = base.height / camera.zoom;
  return { x: camera.cx - width / 2, y: camera.cy - height / 2, width, height };
}

// --- Categories ---

/**
 * What the sidebar can show, in groups. A live category has data on the map today. A waiting one ships empty
 * and fills from player uploads once 3 installs agree on a place; its row stays listed with its zero, so a
 * player sees what an upload would add. Categories with no honest source (boats, game-file object spawns)
 * are not listed at all.
 */
export const CATEGORY_IDS = ["flight", "path", "dungeon", "raid", "zone", "vendor", "trainer", "quest", "service", "npc", "herb", "ore", "chest"] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
export type CategoryState = Record<CategoryId, boolean>;
export type CategoryStatus = "live" | "waiting";
export interface Category { id: CategoryId; label: string; status: CategoryStatus }
export interface CategoryGroup { id: string; label: string; categories: Category[] }

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  { id: "travel", label: "Travel", categories: [
    { id: "flight", label: "Flight masters", status: "live" },
    { id: "path", label: "Flight paths", status: "live" },
  ] },
  { id: "instances", label: "Instances", categories: [
    { id: "dungeon", label: "Dungeon entrances", status: "live" },
    { id: "raid", label: "Raid entrances", status: "live" },
  ] },
  { id: "places", label: "Places", categories: [{ id: "zone", label: "Zones", status: "live" }] },
  { id: "services", label: "Services", categories: [
    { id: "vendor", label: "Vendors", status: "waiting" },
    { id: "trainer", label: "Trainers", status: "waiting" },
    { id: "quest", label: "Quest givers", status: "waiting" },
    { id: "service", label: "Innkeepers, banks and more", status: "waiting" },
    { id: "npc", label: "Other NPCs", status: "waiting" },
  ] },
  { id: "gathering", label: "Gathering", categories: [
    { id: "herb", label: "Herbs", status: "waiting" },
    { id: "ore", label: "Ore", status: "waiting" },
    { id: "chest", label: "Chests and treasure", status: "waiting" },
  ] },
];

/** Every category on, or every category off: the sidebar's Show all and Hide all. */
export const allCategories = (on: boolean): CategoryState => Object.fromEntries(CATEGORY_IDS.map((id) => [id, on])) as CategoryState;

/** Every category starts on; the spoiler switch is separate and starts off. */
export const DEFAULT_CATEGORIES: CategoryState = allCategories(true);
/** Held-back zones, and anything in them, stay hidden until the reader turns this on. */
export const DEFAULT_SPOILERS = false;

export interface MapZone { mapId: number; name: string; x: number; y: number; width: number; height: number; heldBack: boolean }
/**
 * A dungeon or raid entrance. `files` is false for one only players place (absent: the game files place it);
 * `confirmed` is how many installs zoned in from it once 3 agree, and `lastSeen` the latest time one did (absent:
 * not confirmed). `instanceMapIds` come with the pins answer, not the page.
 */
export interface MapEntrance {
  id: string; names: string[]; raid: boolean; x: number; y: number; worldX: number; worldY: number;
  instanceMapIds?: number[]; files?: boolean; confirmed?: number | null; lastSeen?: string | null;
}
/** A treasure players saw on the minimap, at its own position, where 3 installs agree on the spot. */
export interface MapTreasure {
  id: string; objectId: number; name: string | null; mapId: number; zoneName: string;
  x: number; y: number; zoneX: number; zoneY: number; reporters: number;
  /** The latest time an install saw it; absent on an answer cached before treasures had dates. */
  lastSeen?: string | null;
}
export interface MapFlightMaster { id: string; name: string; x: number; y: number; heldBack: boolean }
export interface MapFlightLine { id: string; from: string; to: string; points: [number, number][]; heldBack: boolean }
export interface MapPin {
  id: string; kind: "npc" | "vendor"; npcId: number; name: string | null; mapId: number; zoneName: string;
  x: number; y: number; zoneX: number; zoneY: number; reporters: number; heldBack: boolean;
}
export interface MapItems {
  zones: MapZone[]; entrances: MapEntrance[]; pins: MapPin[]; treasures: MapTreasure[];
  flightMasters: MapFlightMaster[]; flightLines: MapFlightLine[];
}
/** What the map draws besides the zones: the body of `/api/map/pins`, which the page fetches instead of inlining it. */
export type MapPinSet = Omit<MapItems, "zones">;

/** The pin set in a `/api/map/pins` answer, or null when the answer is not one. */
export function readPinSet(body: unknown): MapPinSet | null {
  const b = body as Partial<Record<keyof MapPinSet, unknown>> | null;
  if (!b || typeof b !== "object") return null;
  const { entrances, flightMasters, flightLines, pins, treasures } = b;
  if (![entrances, flightMasters, flightLines, pins].every(Array.isArray)) return null;
  // An answer cached before treasures were drawn has none; it is still a pin set.
  return { entrances, flightMasters, flightLines, pins, treasures: Array.isArray(treasures) ? treasures : [] } as MapPinSet;
}

/** What the categories and the spoiler switch let through. Pure: the same inputs always give the same list. */
export function visibleItems(items: MapItems, show: CategoryState, spoilers: boolean): MapItems {
  return {
    zones: show.zone ? items.zones.filter((z) => spoilers || !z.heldBack) : [],
    entrances: items.entrances.filter((e) => (e.raid ? show.raid : show.dungeon)),
    pins: items.pins.filter((p) => (p.kind === "npc" ? show.npc : show.vendor) && (spoilers || !p.heldBack)),
    treasures: show.chest ? items.treasures : [],
    flightMasters: show.flight ? items.flightMasters.filter((f) => spoilers || !f.heldBack) : [],
    flightLines: show.path ? items.flightLines.filter((l) => spoilers || !l.heldBack) : [],
  };
}

const inside = (scope: Box, x: number, y: number) => x >= scope.x && x <= scope.x + scope.width && y >= scope.y && y <= scope.y + scope.height;
/** A zone counts in a scope when it lies within it: the zone itself, and a city inside it. */
const within = (scope: Box, z: Box) => inside(scope, z.x, z.y) && inside(scope, z.x + z.width, z.y + z.height);

/**
 * How many items each category holds in a scope (the zone in focus, or the whole continent when null), whether or
 * not it is switched on, counting only what the spoiler switch lets through. Flight masters count by name, as the
 * list and search show them: a few names have two nodes on one spot. A flight path counts when either end is in
 * scope. Waiting categories have no items yet, so they count 0.
 */
export function categoryCounts(items: MapItems, spoilers: boolean, scope: Box | null = null): Record<CategoryId, number> {
  const all = visibleItems(items, DEFAULT_CATEGORIES, spoilers);
  const at = (x: number, y: number) => !scope || inside(scope, x, y);
  const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<CategoryId, number>;
  counts.zone = all.zones.filter((z) => !scope || within(scope, z)).length;
  counts.flight = new Set(all.flightMasters.filter((f) => at(f.x, f.y)).map((f) => f.name)).size;
  counts.path = all.flightLines.filter((l) => {
    const a = l.points[0], b = l.points[l.points.length - 1];
    return Boolean(a && b) && (at(a![0], a![1]) || at(b![0], b![1]));
  }).length;
  counts.dungeon = all.entrances.filter((e) => !e.raid && at(e.x, e.y)).length;
  counts.raid = all.entrances.filter((e) => e.raid && at(e.x, e.y)).length;
  counts.npc = all.pins.filter((p) => p.kind === "npc" && at(p.x, p.y)).length;
  counts.vendor = all.pins.filter((p) => p.kind === "vendor" && at(p.x, p.y)).length;
  counts.chest = all.treasures.filter((t) => at(t.x, t.y)).length;
  return counts;
}

/**
 * Places that 1 or 2 installs reported and 3 have not yet agreed on, counted per category and zone. Only the
 * number reaches the page: no position, no NPC, nothing that could be drawn.
 */
export interface Candidate { category: CategoryId; mapId: number; count: number }

/** The candidates in a scope (zones lying within it), or on the whole continent when the scope is null. */
export function candidateCounts(candidates: readonly Candidate[], zones: readonly MapZone[], scope: Box | null = null): Partial<Record<CategoryId, number>> {
  const ids = scope ? new Set(zones.filter((z) => within(scope, z)).map((z) => z.mapId)) : null;
  const out: Partial<Record<CategoryId, number>> = {};
  for (const c of candidates) if (!ids || ids.has(c.mapId)) out[c.category] = (out[c.category] ?? 0) + c.count;
  return out;
}

// --- Zone coordinates ---

export interface ZoneSpot { zone: MapZone; x: number; y: number }

/**
 * The zone a point on the map lies in, and where in it, on the game's 0 to 100 scale (one decimal, (0, 0) at
 * the top-left corner). Where zones overlap (a city inside its zone) the smallest wins. Null outside every zone.
 */
export function zoneSpot(zones: readonly MapZone[], x: number, y: number): ZoneSpot | null {
  let best: MapZone | null = null;
  for (const z of zones) {
    if (x < z.x || x > z.x + z.width || y < z.y || y > z.y + z.height) continue;
    if (!best || z.width * z.height < best.width * best.height) best = z;
  }
  if (!best) return null;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { zone: best, x: r(((x - best.x) / best.width) * 100), y: r(((y - best.y) / best.height) * 100) };
}

/** The line a player pastes into the game chat to put a waypoint on a spot (the zone's 0 to 100 scale). */
export const wayCommand = (x: number, y: number, name: string) => `/way ${x} ${y} ${name}`.trim();

// --- Search ---

export type SearchKind = "zone" | "entrance" | "flight" | "npc" | "vendor" | "treasure";
export interface SearchHit { kind: SearchKind; id: string; label: string; detail: string; x: number; y: number }

const RANK_LIMIT = 8;

/**
 * Zones, entrances, flight masters and player-observed NPCs whose name has every word of the query, names that
 * start with the query first. Only what the layers let through is searched, so a held-back zone never turns up.
 */
export function searchMap(items: MapItems, query: string, limit = RANK_LIMIT): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const hits: (SearchHit & { rank: number })[] = [];
  const add = (hit: SearchHit, names: string[]) => {
    const lower = names.map((n) => n.toLowerCase());
    if (!words.every((w) => lower.some((n) => n.includes(w)))) return;
    hits.push({ ...hit, rank: lower.some((n) => n.startsWith(q)) ? 0 : 1 });
  };
  const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  for (const z of items.zones) add({ kind: "zone", id: `z${z.mapId}`, label: z.name, detail: z.heldBack ? "Zone, unconfirmed" : "Zone", ...centre(z) }, [z.name]);
  for (const e of items.entrances) add({ kind: "entrance", id: `e${e.id}`, label: e.names.join(", "), detail: e.raid ? "Raid entrance" : "Dungeon entrance", x: e.x, y: e.y }, e.names);
  const seen = new Set<string>();
  for (const f of items.flightMasters) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    add({ kind: "flight", id: f.id, label: f.name, detail: "Flight master", x: f.x, y: f.y }, [f.name]);
  }
  for (const p of items.pins) add({ kind: p.kind, id: p.id, label: p.name ?? `NPC ${p.npcId}`, detail: `${p.kind === "vendor" ? "Vendor" : "NPC"} in ${p.zoneName}`, x: p.x, y: p.y }, [p.name ?? `NPC ${p.npcId}`]);
  for (const t of items.treasures) add({ kind: "treasure", id: t.id, label: t.name ?? `Object ${t.objectId}`, detail: `Treasure in ${t.zoneName}`, x: t.x, y: t.y }, [t.name ?? `Object ${t.objectId}`]);
  return hits.sort((a, b) => a.rank - b.rank || a.label.length - b.label.length || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)).slice(0, limit).map(({ rank: _rank, ...hit }) => hit);
}

// --- Map pictures ---

/** A picture placed in the same yards as the zones: the game's own continent or zone map. */
export interface ArtImage { uiMapId: number; name: string; url: string; smallUrl: string | null; x: number; y: number; width: number; height: number }
export interface MapArtLayer { continent: ArtImage | null; zones: ArtImage[] }

/**
 * From this zoom in, zone pictures are drawn at full size. The continent picture is one 1002 px painting over
 * the whole continent, so past this zoom it is stretched; a zone's own picture is the same size over one zone,
 * several times sharper.
 */
export const ZONE_ART_ZOOM = 2;

const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Which zone pictures to draw, and at which size. Only pictures that reach into the view are drawn.
 * With a continent picture, a zone's own picture is laid over it only once the reader has zoomed in to
 * ZONE_ART_ZOOM, and only for the smallest zone under the middle of the view: each zone's painting reaches
 * into its neighbours and paints them differently, so laying every zone in view side by side makes a quilt
 * of seams. One zone at a time is also how the game's own map behaves. Without a continent picture, every
 * zone in view shows, largest first so the smaller sit on top, from its small copy until zoomed in. Pure,
 * so the choice is tested without a browser.
 */
export function zoneArtShown(art: MapArtLayer, camera: Camera, view: Box): ArtImage[] {
  const bySize = [...art.zones].filter((z) => intersects(view, z)).sort((a, b) => b.width * b.height - a.width * a.height);
  if (!art.continent) return camera.zoom < ZONE_ART_ZOOM ? bySize.map((z) => ({ ...z, url: z.smallUrl ?? z.url })) : bySize;
  if (camera.zoom < ZONE_ART_ZOOM) return [];
  const under = bySize.filter((z) => camera.cx >= z.x && camera.cx <= z.x + z.width && camera.cy >= z.y && camera.cy <= z.y + z.height);
  return under.length ? [under[under.length - 1]!] : [];
}

// --- Links ---

export interface DeepLink { mapId: number; x: number; y: number }

/** `/map?zone=<UiMap id>&x=<0..100>&y=<0..100>`, as the NPC, vendor, quest and item pages link it. */
export function mapHref(link: DeepLink): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return `/map?zone=${link.mapId}&x=${r(link.x)}&y=${r(link.y)}`;
}

/** `/map?zone=<UiMap id>`: the zone fitted to the view, as the zone pages link it. */
export const zoneHref = (mapId: number, spoilers = false) => `/map?zone=${mapId}${spoilers ? "&spoilers=1" : ""}`;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const numeric = (v: string | undefined) => (v !== undefined && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN);

/** Reads the query. Anything missing, not a number or outside 0..100 gives null: a bad link opens the plain map. */
export function parseDeepLink(query: { zone?: string | string[]; x?: string | string[]; y?: string | string[] }): DeepLink | null {
  const mapId = numeric(first(query.zone)), x = numeric(first(query.x)), y = numeric(first(query.y));
  if (!Number.isInteger(mapId) || mapId < 1 || !(x >= 0 && x <= 100) || !(y >= 0 && y <= 100)) return null;
  return { mapId, x, y };
}

/** `?zone=<UiMap id>` with no spot: the id of the zone to fit to the view, or null. */
export function parseZoneLink(query: { zone?: string | string[]; x?: string | string[]; y?: string | string[] }): number | null {
  if (parseDeepLink(query)) return null;
  const mapId = numeric(first(query.zone));
  return Number.isInteger(mapId) && mapId >= 1 ? mapId : null;
}

/** Where the reader was last: the centre in yards, the zoom, the selected item. The address carries it so a link opens the same view. */
export interface ViewState { x: number; y: number; zoom: number; pin: string | null }

/** Reads `at=<x>,<y>`, `z=<zoom>` and `pin=<id>`; a part that is missing or malformed is left out. */
export function parseViewState(query: { at?: string | string[]; z?: string | string[]; pin?: string | string[] }): { at: [number, number] | null; zoom: number | null; pin: string | null } {
  const [ax, ay] = (first(query.at) ?? "").split(",").map((s) => numeric(s));
  const zoom = numeric(first(query.z));
  const pin = first(query.pin);
  return {
    at: Number.isFinite(ax) && Number.isFinite(ay) && Math.abs(ax!) < 1e6 && Math.abs(ay!) < 1e6 ? [ax!, ay!] : null,
    zoom: Number.isFinite(zoom) && zoom >= -12 && zoom <= 8 ? zoom : null,
    pin: pin && /^[a-z][A-Za-z0-9_.-]{0,40}$/.test(pin) ? pin : null,
  };
}

/** How many yards across the view is when it opens on a spot or a pin. */
export const SPOT_SPAN = 1200;
export const spotBox = (x: number, y: number): Box => ({ x: x - SPOT_SPAN / 2, y: y - SPOT_SPAN / 2, width: SPOT_SPAN, height: SPOT_SPAN });

/** Where the map opens: a box to fit, or a centre and a zoom. */
export type InitialView = { fit: Box } | { x: number; y: number; zoom: number };

/**
 * Where a link opens the map, first match wins: the camera in the address (`at` with `z`), the deep link's spot,
 * the pin in the address, the zone the link asked for, else the whole continent. A pin that is not on this
 * continent, or not shown, falls through.
 */
export function initialView(input: {
  base: Box; items: MapItems; view: { at: [number, number] | null; zoom: number | null; pin: string | null };
  marker: { x: number; y: number } | null; zoneId: number | null;
}): InitialView {
  const { base, items, view, marker, zoneId } = input;
  if (view.at && view.zoom !== null) return { x: view.at[0], y: view.at[1], zoom: view.zoom };
  if (marker) return { fit: spotBox(marker.x, marker.y) };
  const pinned = view.pin
    ? [...items.entrances.map((e) => ({ id: `e${e.id}`, x: e.x, y: e.y })), ...items.flightMasters, ...items.pins, ...items.treasures].find((p) => p.id === view.pin)
    : undefined;
  if (pinned) return { fit: spotBox(pinned.x, pinned.y) };
  const zone = zoneId !== null ? items.zones.find((z) => z.mapId === zoneId) : undefined;
  return { fit: zone ?? base };
}

/** The address for the reader's view: the fixed parts of the page's own address, then where the camera is. */
export function viewSearch(base: URLSearchParams, state: ViewState): string {
  const q = new URLSearchParams(base);
  for (const k of ["at", "z", "pin"]) q.delete(k);
  q.set("at", `${Math.round(state.x)},${Math.round(state.y)}`);
  q.set("z", String(Math.round(state.zoom * 100) / 100));
  if (state.pin) q.set("pin", state.pin);
  return q.toString();
}

// --- Continent pages and the rest of the address ---

/** Each continent's own page. `/map` alone opens the first. */
export const CONTINENT_PATHS: Readonly<Record<number, string>> = { 0: "/map/eastern-kingdoms", 1: "/map/kalimdor" };
export const continentPath = (continentId: number): string => CONTINENT_PATHS[continentId] ?? "/map";
/** The continent a `/map/<slug>` segment names, or null. */
export function continentFromSlug(slug: string): number | null {
  const hit = Object.entries(CONTINENT_PATHS).find(([, path]) => path === `/map/${slug}`);
  return hit ? Number(hit[0]) : null;
}

export type SidebarTab = "categories" | "list";
/** What the sidebar shows, kept in the address: `show` (only when not every category), `q` (while a search is open), `view=list`. */
export interface MapUrlState { show: CategoryState; q: string; tab: SidebarTab }
export const DEFAULT_URL_STATE: MapUrlState = { show: DEFAULT_CATEGORIES, q: "", tab: "categories" };
const QUERY_MAX = 80;

/** Reads `show`, `q` and `view`. Anything unknown is dropped, so a bad link opens the plain sidebar. */
export function parseMapUrl(query: { show?: string | string[]; q?: string | string[]; view?: string | string[] }): MapUrlState {
  const raw = first(query.show);
  let show = DEFAULT_CATEGORIES;
  if (raw === "none") show = allCategories(false);
  else if (raw) {
    const ids = raw.split(",").map((s) => s.trim()).filter((s): s is CategoryId => (CATEGORY_IDS as readonly string[]).includes(s));
    if (ids.length) show = Object.fromEntries(CATEGORY_IDS.map((id) => [id, ids.includes(id)])) as CategoryState;
  }
  return { show, q: (first(query.q) ?? "").trim().slice(0, QUERY_MAX), tab: first(query.view) === "list" ? "list" : "categories" };
}

/** `show` for a set of categories: null when every one is on, `none` when none is, else the ids in the sidebar's order. */
export function showParam(show: CategoryState): string | null {
  const on = CATEGORY_IDS.filter((id) => show[id]);
  if (on.length === CATEGORY_IDS.length) return null;
  return on.length ? on.join(",") : "none";
}

/** The address with the sidebar's state written in; the default state leaves no trace. */
export function mapUrlSearch(base: URLSearchParams, state: MapUrlState): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const k of ["show", "q", "view"]) q.delete(k);
  const show = showParam(state.show);
  if (show) q.set("show", show);
  const text = state.q.trim().slice(0, QUERY_MAX);
  if (text) q.set("q", text);
  if (state.tab === "list") q.set("view", "list");
  return q;
}

/**
 * The address after moving to a zone (or back to the whole continent with null): a new history entry, so Back
 * returns where the reader was. The spot, the camera and the selected item belong to the old view and go.
 */
export function zoneSearch(base: URLSearchParams, mapId: number | null): string {
  const q = new URLSearchParams(base);
  for (const k of ["zone", "x", "y", "at", "z", "pin"]) q.delete(k);
  if (mapId !== null) q.set("zone", String(mapId));
  return q.toString();
}

/** A link to one item on the map, as the card's Copy link gives it: the continent's page with `pin=`. */
export const pinHref = (continentId: number, id: string, spoilers = false): string =>
  `${continentPath(continentId)}?pin=${encodeURIComponent(id)}${spoilers ? "&spoilers=1" : ""}`;

/** What a card can open: the item's own page on the site. */
export interface PageLink { href: string; label: string }

/**
 * The page for an item on the map, by kind: an NPC's or a vendor's database page, a treasure's object page, an
 * entrance's instance page when it leads to one instance with a page, else the zone page that holds it, and the zone
 * page for a spot. Flight masters have no page, so no link. `zonePages` and `instancePages` map an id to its page;
 * one without (a held-back zone) gets no link.
 */
export function openPageLink(
  item: { kind: "entrance" | "flight" | "npc" | "vendor" | "treasure" | "spot"; npcId?: number; objectId?: number; instanceMapIds?: number[]; x: number; y: number },
  zones: readonly MapZone[], zonePages: Readonly<Record<number, string>>, instancePages: Readonly<Record<number, string>> = {},
): PageLink | null {
  if (item.kind === "npc" && item.npcId) return { href: `/database/npcs/${item.npcId}`, label: "Open NPC page" };
  if (item.kind === "vendor" && item.npcId) return { href: `/database/vendors/${item.npcId}`, label: "Open vendor page" };
  if (item.kind === "treasure" && item.objectId) return { href: `/database/objects/${item.objectId}`, label: "Open object page" };
  const instance = item.kind === "entrance" && item.instanceMapIds?.length === 1 ? instancePages[item.instanceMapIds[0]!] : undefined;
  if (instance) return { href: instance, label: "Open instance page" };
  if (item.kind === "entrance" || item.kind === "spot") {
    const zone = zoneSpot(zones, item.x, item.y)?.zone;
    const href = zone ? zonePages[zone.mapId] : undefined;
    return href ? { href, label: "Open zone page" } : null;
  }
  return null;
}

// --- Labels ---

/** Label text size in pixels: 11 zoomed out, growing a little as the reader zooms in, never above 14. */
export function labelFontPx(zoom: number): number {
  return Math.min(14, Math.max(11, 11 + Math.log2(Math.max(zoom, 1)) * 0.6));
}

export interface LabelCandidate { id: string; text: string; x: number; y: number; priority: number; align: "middle" | "start" }

/**
 * Which labels to draw. Greedy by priority: a label is drawn when it lies wholly inside the view and does
 * not overlap one already drawn, so a lower-priority label gives way. (x, y) is the anchor in yards.
 */
export function placeLabels(candidates: LabelCandidate[], view: Box, widthPx: number, fontPx: number): LabelCandidate[] {
  const k = widthPx / view.width, heightPx = view.height * k, h = fontPx * 1.4, pad = 2;
  const taken: { l: number; r: number; t: number; b: number }[] = [];
  const placed: LabelCandidate[] = [];
  for (const c of [...candidates].sort((a, b) => b.priority - a.priority || a.text.length - b.text.length || a.id.localeCompare(b.id))) {
    const sx = (c.x - view.x) * k, sy = (c.y - view.y) * k, w = c.text.length * fontPx * 0.58 + 6;
    const l = c.align === "middle" ? sx - w / 2 : sx, r = l + w, t = sy - h / 2, b = sy + h / 2;
    if (l < 0 || t < 0 || r > widthPx || b > heightPx) continue;
    if (taken.some((o) => l < o.r + pad && o.l < r + pad && t < o.b + pad && o.t < b + pad)) continue;
    taken.push({ l, r, t, b });
    placed.push(c);
  }
  return placed;
}
