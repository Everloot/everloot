/**
 * Player-observed points on the world map, and "what is near this place".
 *
 * Observed points are NPC pins from `npc_sighting` records, after the same 3-install rule the NPC page
 * applies (world-pages.ts `npcPage`: a pin needs 3 installs on one map, measured at the NPC). A vendor
 * is an NPC with at least one vendor offer that 3 installs agree on (`vendorPage`). Treasures are objects players
 * saw on the minimap, at the object's own position, pinned at 3 installs (object-spawns.ts).
 *
 * Entrances come from the game-file map layer (world-map-data.ts); one is confirmed when 3 installs zoned into its
 * instance from outside (instances.ts). Held-back zones are never used
 * here: the public MCP tool does not carry spoilers.
 */
import { npcPage, vendorPage, worldFactsFromRecords, type NpcSightingRow, type VendorSighting, type WorldFacts } from "./world-pages.js";
import {
  placeEntrances, worldToMap, zoneAt, zoneTable, zoneToWorld, type MapPoint, type WorldPoint, type ZoneEntry,
} from "./world-coords.js";
import type { WorldMapData } from "./world-map-data.js";
import { confirmedEntrances, instanceFactsFromRecords, type InstanceEntranceRow } from "./instances.js";
import { agreedObjectNames, objectSightingRowsFromRecords, objectSpawns, type ObjectSpawnRow } from "./object-spawns.js";
import type { RecheckScope } from "./coverage.js";

/** What the tool reads: NPC positions, vendor offers, the entrances players zoned in from, and objects seen on the minimap. */
export type NearFacts = Pick<WorldFacts, "npcs" | "vendors" | "recheck"> & { entrances?: InstanceEntranceRow[]; sightings?: ObjectSpawnRow[] };

export type ObservedKind = "npc" | "vendor";

export interface ObservedPin {
  kind: ObservedKind;
  npcId: number;
  name: string | null;
  /** The zone's UiMap id and name. */
  mapId: number;
  zoneName: string;
  /** Position on the zone map, 0..100 as the NPC page shows it. */
  x: number;
  y: number;
  world: WorldPoint;
  map: MapPoint;
  reporters: number;
  /** True when the pin lies in a zone the files hold back as possibly unreleased. */
  spoiler: boolean;
}

/** Every zone, with the held-back ones flagged. */
export function allZones(data: Pick<WorldMapData, "zones" | "heldBackZones">): { zones: ZoneEntry[]; held: Set<number> } {
  return {
    zones: zoneTable({ zones: [...data.zones, ...data.heldBackZones] }),
    held: new Set(data.heldBackZones.map((z) => z.uiMapId)),
  };
}

/** Corroborated NPC and vendor pins that fall inside a known zone. Pins in unknown zones are dropped. */
export function observedPins(facts: Pick<WorldFacts, "npcs" | "vendors" | "recheck" | "agreedNpcs">, data: Pick<WorldMapData, "zones" | "heldBackZones">): ObservedPin[] {
  const { zones, held } = allZones(data);
  // With the stored table (world-pages.ts `agreedNpcs`) each NPC's page is read from it; else from its own rows.
  const table = facts.agreedNpcs ? { agreedNpcs: facts.agreedNpcs } : {};
  const npcRows = new Map<number, NpcSightingRow[]>();
  if (facts.agreedNpcs) for (const npcId of facts.agreedNpcs.keys()) npcRows.set(npcId, []);
  else for (const row of facts.npcs) {
    const rows = npcRows.get(row.npcId) ?? [];
    rows.push(row);
    npcRows.set(row.npcId, rows);
  }
  const vendorRows = new Map<number, VendorSighting[]>();
  for (const row of facts.vendors) {
    const rows = vendorRows.get(row.vendorNpcId) ?? [];
    rows.push(row);
    vendorRows.set(row.vendorNpcId, rows);
  }
  const vendors = new Set<number>();
  for (const [id, rows] of vendorRows) if (vendorPage(id, { npcs: facts.npcs, quests: [], vendors: rows, recheck: facts.recheck, ...table }).offers.length > 0) vendors.add(id);

  const pins: ObservedPin[] = [];
  for (const [npcId, rows] of npcRows) {
    const page = npcPage(npcId, { npcs: rows, quests: [], vendors: [], recheck: facts.recheck, ...table });
    for (const pin of page.pins) {
      const zone = zones.find((z) => z.mapId === pin.mapId);
      const world = zoneToWorld(zones, pin.mapId, pin.x / 100, pin.y / 100);
      if (!zone || !world) continue;
      pins.push({
        kind: vendors.has(npcId) ? "vendor" : "npc", npcId, name: page.name, mapId: pin.mapId, zoneName: zone.name,
        x: pin.x, y: pin.y, world, map: worldToMap(world), reporters: pin.reporters, spoiler: held.has(pin.mapId),
      });
    }
  }
  return pins.sort((a, b) => a.npcId - b.npcId || a.mapId - b.mapId);
}

/** Straight-line distance in yards, or Infinity across continents. */
export function distanceYards(a: WorldPoint, b: WorldPoint): number {
  if (a.continentId !== b.continentId) return Infinity;
  return Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY);
}

import { NEAR_DEFAULT_LIMIT, NEAR_DEFAULT_RADIUS, NEAR_MAX_LIMIT, NEAR_MAX_RADIUS } from "@everloot/protocol";
export { NEAR_DEFAULT_LIMIT, NEAR_DEFAULT_RADIUS, NEAR_MAX_LIMIT, NEAR_MAX_RADIUS };
const NAME_MAX = 80;

export interface NearArgs {
  zone?: string;
  x?: number;
  y?: number;
  npcId?: number;
  radius?: number;
  limit?: number;
}

const clip = (s: string) => (s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1)}…` : s);
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** `confirmed`: installs that zoned into one of its instances, once 3 agree on where they stood; absent until then. */
export interface NearEntrance { names: string[]; raid: boolean; zone: string | null; yards: number; confirmed?: number }
export interface NearTreasure { objectId: number; name: string | null; mapId: number; zoneName: string; x: number; y: number; yards: number; reporters: number }
export interface NearPin { npcId: number; name: string | null; mapId: number; zoneName: string; x: number; y: number; yards: number; reporters: number }
/** What is near a spot, as data. A refused query (no spot, a bad radius, an unknown zone) is ok false with the text's message. */
export type NearResult =
  | { ok: false; message: string }
  | { ok: true; origin: string; radius: number; limit: number; entrances: NearEntrance[]; npcs: NearPin[]; vendors: NearPin[]; treasures: NearTreasure[] };

/** A zone by map id or name, case-insensitive. */
function findZone<Z extends { mapId: number; name: string }>(zones: readonly Z[], zone: string): Z | undefined {
  const wanted = zone.trim().toLowerCase();
  return zones.find((z) => String(z.mapId) === wanted) ?? zones.find((z) => z.name.toLowerCase() === wanted);
}

/** The map id and spot a zone query names, for a link to the map there; null for an NPC query or an unknown zone. */
export function nearZoneSpot(args: NearArgs, data: WorldMapData): { mapId: number; x: number; y: number } | null {
  if (typeof args.zone !== "string" || typeof args.x !== "number" || typeof args.y !== "number") return null;
  const found = findZone(zoneTable(data), args.zone);
  return found ? { mapId: found.mapId, x: args.x, y: args.y } : null;
}

/** The result the text is written from. Held-back zones never appear: the public tool carries no spoilers. */
export function nearResult(args: NearArgs, data: WorldMapData, facts: NearFacts): NearResult {
  const no = (message: string): NearResult => ({ ok: false, message });
  const hasSpot = args.zone !== undefined || args.x !== undefined || args.y !== undefined;
  if (hasSpot && args.npcId !== undefined) return no("Give either a zone with x and y, or an npc id, not both.");
  if (!hasSpot && args.npcId === undefined) return no("Give a zone with x and y (0 to 100), or an npc id.");

  const radius = args.radius ?? NEAR_DEFAULT_RADIUS;
  const limit = args.limit ?? NEAR_DEFAULT_LIMIT;
  if (!Number.isFinite(radius) || radius <= 0 || radius > NEAR_MAX_RADIUS) return no(`Radius must be above 0 and at most ${NEAR_MAX_RADIUS} yards.`);
  if (!Number.isInteger(limit) || limit < 1 || limit > NEAR_MAX_LIMIT) return no(`Limit must be a whole number from 1 to ${NEAR_MAX_LIMIT}.`);

  const zones = zoneTable(data);
  const pins = observedPins(facts, data).filter((p) => !p.spoiler);
  let origin: WorldPoint;
  let label: string;
  let selfId: number | null = null;

  if (args.npcId !== undefined) {
    if (!Number.isInteger(args.npcId) || args.npcId < 1) return no("Name an npc id.");
    const own = pins.find((p) => p.npcId === args.npcId);
    if (!own) return no(`NPC ${args.npcId} has no agreed position in a mapped zone. A pin needs 3 installs on the same map.`);
    origin = own.world;
    selfId = own.npcId;
    label = `${own.name ? clip(own.name) : `NPC ${own.npcId}`} in ${own.zoneName} at ${own.x}, ${own.y}`;
  } else {
    const { zone, x, y } = args;
    if (typeof zone !== "string" || !zone.trim() || zone.length > NAME_MAX) return no("Name a zone, by name or map id.");
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
      return no("x and y are needed, each from 0 to 100, as on the zone map.");
    }
    const found = findZone(zones, zone);
    if (!found) return no(`No zone "${clip(zone.trim())}" in the map layer. Held-back zones are not offered here.`);
    const world = zoneToWorld(zones, found.mapId, x / 100, y / 100);
    if (!world) return no("That spot is outside the zone.");
    origin = world;
    label = `${found.name} at ${x}, ${y}`;
  }

  // An entrance the files place is confirmed by players who zoned into one of its instances; no second pin is made.
  const confirmed = new Map<number, number>();
  for (const e of confirmedEntrances(facts.entrances ?? [], new Date(), facts.recheck ?? [])) confirmed.set(e.instanceMapId, Math.max(confirmed.get(e.instanceMapId) ?? 0, e.reporters));
  // An entrance the files put in a held-back zone is left out, like the zone.
  const held = new Set(data.heldBackZones.map((z) => z.uiMapId));
  const entrances = placeEntrances(data)
    .filter((p) => p.uiMapId === undefined || !held.has(p.uiMapId))
    .map((p) => ({ p, d: distanceYards(origin, p.world) }))
    .filter((e) => e.d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ p, d }) => {
      const players = Math.max(0, ...p.mapIds.map((id) => confirmed.get(id) ?? 0));
      return { names: p.names, raid: p.raid, zone: zoneAt(zones, p.world, p.uiMapId)?.name ?? null, yards: oneDecimal(d), ...(players ? { confirmed: players } : {}) };
    });
  const observed = (kind: ObservedKind): NearPin[] => pins
    .filter((p) => p.kind === kind && p.npcId !== selfId)
    .map((p) => ({ p, d: distanceYards(origin, p.world) }))
    .filter((e) => e.d <= radius)
    .sort((a, b) => a.d - b.d || a.p.npcId - b.p.npcId)
    .slice(0, limit)
    .map(({ p, d }) => ({ npcId: p.npcId, name: p.name, mapId: p.mapId, zoneName: p.zoneName, x: p.x, y: p.y, yards: oneDecimal(d), reporters: p.reporters }));
  return { ok: true, origin: label, radius, limit, entrances, npcs: observed("npc"), vendors: observed("vendor"), treasures: nearTreasures(facts.sightings ?? [], data, origin, radius, limit, facts.recheck ?? []) };
}

/**
 * Entrances, NPCs and vendors near a spot, nearest first, with distances in yards. Give either a zone
 * (name or UiMap id) with x and y from 0 to 100, or an NPC id to start from where that NPC stands.
 */
export function handleWorldMapNear(args: NearArgs, data: WorldMapData, facts: NearFacts): string {
  const result = nearResult(args, data, facts);
  if (!result.ok) return result.message;
  const lines = [`Near ${result.origin}, within ${result.radius} yards. Distances are straight lines in yards.`];
  lines.push("Entrances (from the game files, found in game files, unconfirmed):");
  if (!result.entrances.length) lines.push("  none in range");
  for (const e of result.entrances) {
    lines.push(`  ${clip(e.names.join(", "))} (${e.raid ? "raid" : "dungeon"})${e.zone ? ` in ${e.zone}` : ""}  ${e.yards} yards${e.confirmed ? `  confirmed by ${e.confirmed} installs` : ""}`);
  }
  for (const [title, rows] of [["NPCs", result.npcs], ["Vendors", result.vendors]] as const) {
    lines.push(`${title} (players saw them; a pin needs 3 installs on the same map):`);
    if (!rows.length) lines.push("  none in range");
    for (const p of rows) {
      lines.push(`  ${p.name ? clip(p.name) : "unnamed"} (NPC ${p.npcId}) in ${p.zoneName} at ${p.x}, ${p.y}  ${p.yards} yards  ${p.reporters} reporters`);
    }
  }
  lines.push("Treasures (players saw them on the minimap; a pin needs 3 installs at one spot):");
  if (!result.treasures.length) lines.push("  none in range");
  for (const t of result.treasures) {
    lines.push(`  ${t.name ? clip(t.name) : "unnamed"} (object ${t.objectId}) in ${t.zoneName} at ${t.x}, ${t.y}  ${t.yards} yards  ${t.reporters} reporters`);
  }
  return lines.join("\n");
}

/** The facts this tool reads: NPC positions, vendor offers, entrances and minimap objects. Quests are left out. */
export function mapFactsFromRecords(records: unknown[], recheck: readonly RecheckScope[] = []): Required<NearFacts> {
  const { npcs, vendors } = worldFactsFromRecords(records, recheck);
  return { npcs, vendors, recheck, entrances: instanceFactsFromRecords(records).entrances, sightings: objectSightingRowsFromRecords(records) };
}

/** Treasure pins within the radius, nearest first, outside held-back zones. */
function nearTreasures(sightings: ObjectSpawnRow[], data: WorldMapData, origin: WorldPoint, radius: number, limit: number, recheck: readonly RecheckScope[] = []): NearTreasure[] {
  if (!sightings.length) return [];
  const { zones, held } = allZones(data);
  const names = agreedObjectNames(sightings, recheck);
  return objectSpawns(sightings, [], undefined, recheck).pins.flatMap((pin) => {
    const zone = zones.find((z) => z.mapId === pin.mapId);
    const world = zone && !held.has(pin.mapId) ? zoneToWorld(zones, pin.mapId, pin.x / 100, pin.y / 100) : null;
    const d = world ? distanceYards(origin, world) : Infinity;
    return zone && d <= radius ? [{ objectId: pin.objectId, name: names.get(pin.objectId) ?? null, mapId: pin.mapId, zoneName: zone.name, x: pin.x, y: pin.y, yards: oneDecimal(d), reporters: pin.reporters }] : [];
  }).sort((a, b) => a.yards - b.yards || a.objectId - b.objectId).slice(0, limit);
}
