/**
 * One coordinate system for zones, maps and pins.
 *
 * World coordinates are the game's own: yards on a continent (0 Eastern Kingdoms, 1 Kalimdor), where
 * x runs north and y runs west. A zone's rectangle in them is read from the game files (UiMapAssignment,
 * see world-map-data.ts), so every zone is placed exactly from day one. Zone coordinates are the 0..1
 * numbers players see on a zone map, with (0, 0) at the top-left corner.
 *
 * Our addon's `map_bounds` reports (map-bounds.ts) are an in-game cross-check, not the source:
 * `checkReportedBounds` says where 3 agreeing installs differ from the game files.
 *
 * The stitched map is the continent drawn north-up in yards: x grows east and y grows south, with
 * the origin at the continent's world origin. It is fixed by the game's coordinates, so a pin never
 * moves; the page chooses its own viewport.
 */
import type { ZoneBounds } from "./map-bounds.js";
import { WORLD_UNIT_TOLERANCE } from "./map-bounds.js";
import type { WorldMapData, WorldRect } from "./world-map-data.js";

export interface WorldPoint { continentId: number; worldX: number; worldY: number }
export interface MapPoint { continentId: number; x: number; y: number }
export interface ZonePoint { mapId: number; x: number; y: number }

export interface ZoneEntry {
  /** The zone's UiMap id: the "map id" the addon reports and players' map APIs use. */
  mapId: number;
  name: string;
  continentId: number;
  bounds: WorldRect;
}

export function zoneTable(data: Pick<WorldMapData, "zones">): ZoneEntry[] {
  return data.zones.map((z) => ({ mapId: z.uiMapId, name: z.name, continentId: z.continentId, bounds: z.bounds })).sort((a, b) => a.mapId - b.mapId);
}

const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
const find = (zones: ZoneEntry[], mapId: number) => zones.find((e) => e.mapId === mapId);

/** A spot on a zone map to world yards, or null for an unknown zone or coordinates outside 0..1. */
export function zoneToWorld(zones: ZoneEntry[], mapId: number, x: number, y: number): WorldPoint | null {
  const z = find(zones, mapId);
  if (!z || !unit(x) || !unit(y)) return null;
  const b = z.bounds;
  return { continentId: z.continentId, worldX: b.top + y * (b.bottom - b.top), worldY: b.left + x * (b.right - b.left) };
}

/** World yards to a spot on one zone's map, or null when the zone is unknown or the point is outside it. */
export function worldToZone(zones: ZoneEntry[], mapId: number, point: WorldPoint): ZonePoint | null {
  const z = find(zones, mapId);
  if (!z || z.continentId !== point.continentId) return null;
  const b = z.bounds;
  const x = (point.worldY - b.left) / (b.right - b.left);
  const y = (point.worldX - b.top) / (b.bottom - b.top);
  return unit(x) && unit(y) ? { mapId, x, y } : null;
}

/**
 * The zone a world point lies in. `uiMapId` is the zone the game files put the point in (see world-map-data.ts);
 * when it is given it decides, and a zone missing from `zones` (a held-back one, say) gives null. Without it the rectangles guess: the smallest one around the point wins. That is right for a city in its
 * zone but wrong where a zone's rectangle reaches over its neighbour, as most do.
 */
export function zoneAt(zones: ZoneEntry[], point: WorldPoint, uiMapId?: number): ZoneEntry | null {
  if (uiMapId !== undefined) return find(zones, uiMapId) ?? null;
  let best: { zone: ZoneEntry; area: number } | null = null;
  for (const zone of zones) {
    if (!worldToZone(zones, zone.mapId, point)) continue;
    const b = zone.bounds;
    const area = Math.abs((b.right - b.left) * (b.bottom - b.top));
    if (!best || area < best.area) best = { zone, area };
  }
  return best?.zone ?? null;
}

/** World yards to the stitched map: north-up, x east, y south, in yards. */
export function worldToMap(point: WorldPoint): MapPoint {
  return { continentId: point.continentId, x: -point.worldY || 0, y: -point.worldX || 0 };
}

export function mapToWorld(point: MapPoint): WorldPoint {
  return { continentId: point.continentId, worldX: -point.y || 0, worldY: -point.x || 0 };
}

/** A spot on a zone map straight to the stitched map. */
export function zoneToMap(zones: ZoneEntry[], mapId: number, x: number, y: number): MapPoint | null {
  const world = zoneToWorld(zones, mapId, x, y);
  return world && worldToMap(world);
}

export interface EntrancePin {
  names: string[];
  /** The instances' map ids, the ids `instance_entrance` rows carry. */
  mapIds: number[];
  raid: boolean;
  world: WorldPoint;
  map: MapPoint;
  /** The zone the game files put the entrance in, when they say (see `zoneAt`). */
  uiMapId?: number;
}

/** Dungeon and raid entrances as pins. Entrances within a yard of each other share one pin. */
export function placeEntrances(data: Pick<WorldMapData, "entrances">): EntrancePin[] {
  const pins: EntrancePin[] = [];
  for (const e of data.entrances) {
    const world = { continentId: e.continentId, worldX: e.worldX, worldY: e.worldY };
    const same = pins.find((p) => p.world.continentId === e.continentId && Math.abs(p.world.worldX - e.worldX) <= 1 && Math.abs(p.world.worldY - e.worldY) <= 1);
    if (same) {
      if (!same.names.includes(e.name)) same.names.push(e.name);
      if (!same.mapIds.includes(e.mapId)) same.mapIds.push(e.mapId);
      same.raid ||= e.raid;
    } else {
      pins.push({ names: [e.name], mapIds: [e.mapId], raid: e.raid, world, map: worldToMap(world), ...(e.uiMapId !== undefined ? { uiMapId: e.uiMapId } : {}) });
    }
  }
  return pins;
}

/** Which side's flight map shows a node or a line; absent when the files do not say. */
export type FlightSide = "alliance" | "horde" | "both";
export interface FlightMasterPin { id: number; name: string; world: WorldPoint; map: MapPoint; heldBack: boolean; faction?: FlightSide }
export interface FlightLine { from: number; to: number; continentId: number; points: MapPoint[]; heldBack: boolean; faction?: FlightSide }

/** A line serves the sides both its ends serve: unknown when either end is, or when they share none. */
export function lineSide(a: FlightSide | undefined, b: FlightSide | undefined): FlightSide | undefined {
  if (!a || !b) return undefined;
  if (a === "both") return b;
  if (b === "both" || a === b) return a;
  return undefined;
}

/**
 * Flight masters and flight lines on the stitched map. One whose zone (`zoneAt`: the game files' zone, else the
 * smallest rectangle) is a held-back one, or whose name names one, is flagged, and so is a line that has such an
 * end, so the spoiler switch can keep them off.
 */
export function placeFlights(data: Pick<WorldMapData, "flightNodes" | "flightPaths" | "zones" | "heldBackZones">): { masters: FlightMasterPin[]; lines: FlightLine[] } {
  const all = zoneTable({ zones: [...data.zones, ...data.heldBackZones] }), held = new Set(data.heldBackZones.map((z) => z.uiMapId));
  const masters = data.flightNodes.map((n): FlightMasterPin => {
    const world = { continentId: n.continentId, worldX: n.worldX, worldY: n.worldY };
    const heldBack = held.has(zoneAt(all, world, n.uiMapId)?.mapId ?? -1) || data.heldBackZones.some((z) => n.name.toLowerCase().includes(z.name.toLowerCase()));
    return { id: n.id, name: n.name, world, map: worldToMap(world), heldBack, ...(n.faction ? { faction: n.faction } : {}) };
  });
  const hidden = new Set(masters.filter((m) => m.heldBack).map((m) => m.id));
  const side = new Map(masters.map((m) => [m.id, m.faction]));
  const lines = data.flightPaths.map((p): FlightLine => {
    const faction = lineSide(side.get(p.from), side.get(p.to));
    return {
      from: p.from, to: p.to, continentId: p.continentId,
      points: p.points.map(([worldX, worldY]) => worldToMap({ continentId: p.continentId, worldX, worldY })),
      heldBack: hidden.has(p.from) || hidden.has(p.to),
      ...(faction ? { faction } : {}),
    };
  });
  return { masters, lines };
}

export interface BoundsCheck {
  mapId: number;
  name: string;
  /** "agrees": within a yard on every edge. "differs": 3 installs agree on other bounds. */
  result: "agrees" | "differs";
  /** Worst edge difference in yards. */
  worstEdge: number;
}

/**
 * Compares the zone rectangles from the game files with those 3 installs agree on. Zones that no
 * agreed report covers are not listed; reports for zones the files do not know are ignored here.
 */
export function checkReportedBounds(zones: ZoneEntry[], reported: ZoneBounds[]): BoundsCheck[] {
  const checks: BoundsCheck[] = [];
  for (const r of reported) {
    const z = r.agreed ? find(zones, r.mapId) : undefined;
    if (!z) continue;
    const edges = (["left", "top", "right", "bottom"] as const).map((e) => Math.abs(z.bounds[e] - r[e]));
    const worstEdge = r.continentId !== z.continentId ? Infinity : Math.max(...edges);
    checks.push({ mapId: z.mapId, name: z.name, result: worstEdge <= WORLD_UNIT_TOLERANCE ? "agrees" : "differs", worstEdge });
  }
  return checks.sort((a, b) => a.mapId - b.mapId);
}
