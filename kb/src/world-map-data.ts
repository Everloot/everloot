/**
 * The map data the world map page needs, read out of a client snapshot (`npm run kb -- client-extract`):
 * the continents and zones with their rectangles in world coordinates, and where each dungeon and raid
 * is entered. It is game file data: Blizzard's, stamped with the build, labelled "found in game files,
 * unconfirmed", kept apart from our CC BY-SA data (docs/DATA_POLICY.md). Only the fields the page uses
 * are written. Reads only the snapshot file.
 *
 * Tables, with column names from WoWDBDefs:
 * - UiMap: map id, name, type (2 continent, 3 zone), parent.
 * - UiMapAssignment: where a map lies in the world. `Region` is the two opposite corners in world
 *   yards, (x, y, z) then (x, y, z). World x runs north and y runs west, so the north edge is the larger
 *   x and the west edge the larger y. `UiMin`/`UiMax` say which part of the map the rectangle covers;
 *   only whole-map rectangles (0,0 to 1,1) are used.
 * - Map: the continents, and for each dungeon or raid `CorpseMapID` and `Corpse` (x, y), the spot where a
 *   ghost returns, which is the entrance.
 * - TaxiNodes, TaxiPath, TaxiPathNode: flight masters (a node with a flight to or from it), and each
 *   flight's line through its path points. Boats and zeppelins are paths that start or end at "Transport"
 *   stand-in nodes (some hop to another continent), not at a dock, so they are left out for now.
 * - MapDifficulty, ContentTuning, LFGDungeons: the level of each dungeon and raid. MapDifficulty names an instance's
 *   ContentTuning row by `MapID`; ContentTuning holds `MinLevelSquish` and `MaxLevelSquish`. For an instance with no
 *   tuning in MapDifficulty (the raids), the LFGDungeons row with exactly the instance's name gives its tuning
 *   (LFGDungeons has no `MapID` in this build). An instance the files give no level for has none here.
 * - Difficulty: the build's own difficulty names and group sizes, by id ("Normal", "40 Player"); MapDifficulty
 *   joins each instance map to the difficulties it has. Both default to empty in older committed files.
 * - AreaTable and TerrainArea (derived at extraction, terrain-area.ts): the zone each entrance and flight master
 *   is in. An area's `ParentAreaID` chain reaches the area a zone's UiMapAssignment names (`AreaID`). For an
 *   entrance, the area that starts the chain is the outdoor area named after the instance on the entrance's
 *   continent (the game names the ground around a dungeon's doorway after it: "Uldaman" under Badlands,
 *   "Blackfathom Deeps" under Ashenvale), when there is one and it leads to one zone. Otherwise, and for flight
 *   masters, it is the area of the ground under the spot. `Map.Corpse` is where a ghost returns, which can stand
 *   a little way off the doorway and over a zone border, so the named area comes first. Zone rectangles overlap,
 *   so they cannot decide this; they are only the fallback for a spot that neither gives a zone for.
 */
import { z } from "zod";
import { readClientManifest, readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { TERRAIN_AREA_TABLE, terrainAreaAt } from "./terrain-area.js";

export const WORLD_MAP_SCHEMA = "everloot.world-map/1";
/** Tables this file is built from. */
export const WORLD_MAP_TABLES = ["Map", "UiMap", "UiMapAssignment", "TaxiNodes", "TaxiPath", "TaxiPathNode", "AreaTable", "MapDifficulty", "ContentTuning", "LFGDungeons", TERRAIN_AREA_TABLE] as const;

/**
 * Zones of the original world, as numbered by their UiMap ids (1411 to 1458). Zones with later ids are
 * Forever additions that may not be released yet; they stay out until the spoiler switch the data
 * policy describes exists.
 */
export const ORIGINAL_ZONE_UI_MAP_IDS = { min: 1411, max: 1458 } as const;

const Rect = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });
const ZoneRow = z.object({ uiMapId: z.number().int(), name: z.string(), continentId: z.number().int(), bounds: Rect });
export const WorldMapData = z.object({
  schema: z.literal(WORLD_MAP_SCHEMA),
  source: z.object({
    name: z.string(),
    status: z.literal("found in game files, unconfirmed"),
    licence: z.string(),
    licenceUrl: z.string(),
    product: z.string(),
    buildId: z.number().int(),
    version: z.string(),
    buildConfig: z.string(),
    definitions: z.string().nullable(),
    extractedAt: z.string(),
    tables: z.array(z.object({ table: z.string(), rows: z.number().int(), encryptedBlocks: z.number().int().nullable() })),
  }),
  continents: z.array(z.object({ id: z.number().int(), name: z.string(), bounds: Rect })),
  zones: z.array(ZoneRow),
  /** Zones with later UiMap ids: Forever additions that may be unreleased. Shown only when the reader turns spoilers on. */
  heldBackZones: z.array(ZoneRow).default([]),
  /** The difficulties the build's Difficulty table names ("Normal", "40 Player"), by id, with the group size. Older committed files, and tests, may lack the record. */
  difficulties: z.record(z.string(), z.object({
    name: z.string(), minPlayers: z.number().int().optional(), maxPlayers: z.number().int().optional(),
  })).optional(),
  /** `uiMapId`, here and on flight masters: the zone the game files put the spot in (see the header). Absent when they give none. */
  entrances: z.array(z.object({
    mapId: z.number().int(), name: z.string(), raid: z.boolean(), continentId: z.number().int(), worldX: z.number(), worldY: z.number(),
    uiMapId: z.number().int().optional(),
    /** The level range the game files give the instance (ContentTuning); both absent when they give none. Equal when it is one level. */
    minLevel: z.number().int().optional(), maxLevel: z.number().int().optional(),
    /** The difficulties the game files give the instance (MapDifficulty), the files' own names. Absent when they give none. */
    difficultyIds: z.array(z.number().int()).optional(),
  })),
  /** Flight masters: the taxi nodes that a flight starts or ends at (TaxiNodes). World yards, as everything else here. */
  flightNodes: z.array(z.object({
    id: z.number().int(), name: z.string(), continentId: z.number().int(), worldX: z.number(), worldY: z.number(), uiMapId: z.number().int().optional(),
  })).default([]),
  /** One flight line per pair of nodes (TaxiPath, drawn through its TaxiPathNode points), points as [worldX, worldY] yards, thinned. */
  flightPaths: z.array(z.object({
    from: z.number().int(), to: z.number().int(), continentId: z.number().int(), points: z.array(z.tuple([z.number(), z.number()])),
  })).default([]),
  warnings: z.array(z.string()),
});
export type WorldMapData = z.infer<typeof WorldMapData>;
export type WorldRect = z.infer<typeof Rect>;

const UI_MAP_CONTINENT = 2;
const UI_MAP_ZONE = 3;
const WORLD_UI_MAP = 947;
const round = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length >= 2 && num(v[0]) !== null && num(v[1]) !== null ? [v[0] as number, v[1] as number] : null;

/** A UiMapAssignment's rectangle in the page's terms, or null when it is not a whole-map rectangle. */
export function assignmentRect(row: Record<string, unknown>): WorldRect | null {
  const min = pair(row.UiMin), max = pair(row.UiMax);
  const region = Array.isArray(row.Region) ? row.Region.map(num) : [];
  if (!min || !max || region.length < 6 || region.some((n) => n === null)) return null;
  if (min[0] !== 0 || min[1] !== 0 || max[0] !== 1 || max[1] !== 1) return null;
  const [x0, y0, , x1, y1] = region as number[];
  const rect = { top: Math.max(x0, x1), bottom: Math.min(x0, x1), left: Math.max(y0, y1), right: Math.min(y0, y1) };
  return rect.top > rect.bottom && rect.left > rect.right ? { left: round(rect.left), top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom) } : null;
}

type Rows = Map<number, Record<string, unknown>>;

/** The first whole-map assignment of each UiMap (lowest OrderIndex): which game map it lies on, its rectangle and the area it shows. */
export function placeUiMaps(assignments: Record<string, unknown>[]): Map<number, { mapId: number; rect: WorldRect; areaId: number }> {
  const placed = new Map<number, { mapId: number; rect: WorldRect; areaId: number }>();
  for (const a of [...assignments].sort((p, q) => Number(p.OrderIndex) - Number(q.OrderIndex))) {
    const uiMapId = num(a.UiMapID), mapId = num(a.MapID), rect = assignmentRect(a);
    if (uiMapId !== null && mapId !== null && rect && !placed.has(uiMapId)) placed.set(uiMapId, { mapId, rect, areaId: num(a.AreaID) ?? 0 });
  }
  return placed;
}

/**
 * The zone (UiMap id) a spot is in, as the game decides it: the area of the ground under it, or the nearest area up
 * its `ParentAreaID` chain that a zone shows. Null without terrain there, or when no zone shows any of the areas.
 */
export function zoneOfGround(
  terrain: Rows, areas: Rows, zoneOfArea: Map<number, number>, point: { continentId: number; worldX: number; worldY: number },
): number | null {
  return zoneOfAreaChain(terrainAreaAt(terrain, point), areas, zoneOfArea);
}

/** The zone an area belongs to: the first area up its `ParentAreaID` chain that a zone shows, or null. */
export function zoneOfAreaChain(areaId: number | null, areas: Rows, zoneOfArea: Map<number, number>): number | null {
  const seen = new Set<number>();
  for (let id = areaId; id && !seen.has(id); id = num(areas.get(id)?.ParentAreaID)) {
    seen.add(id);
    const zone = zoneOfArea.get(id);
    if (zone !== undefined) return zone;
  }
  return null;
}

/**
 * The zone of the outdoor area named after an instance on the continent it is entered from: an area of that
 * continent whose name is the instance's name, or its own area's name. Null when there is none, or when the named
 * areas lead to more than one zone (or to none).
 */
export function zoneOfNamedArea(instance: Record<string, unknown>, continentId: number, areas: Rows, zoneOfArea: Map<number, number>): number | null {
  const names = new Set([instance.MapName_lang, areas.get(Number(instance.AreaTableID))?.AreaName_lang]
    .filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.trim()));
  const found = new Set<number | null>();
  for (const a of areas.values()) {
    if (Number(a.ContinentID) !== continentId || typeof a.AreaName_lang !== "string" || !names.has(a.AreaName_lang.trim())) continue;
    found.add(zoneOfAreaChain(Number(a.ID), areas, zoneOfArea));
  }
  found.delete(null);
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * The level range of each instance map (by map id) the game files give: its ContentTuning row, named by MapDifficulty
 * or, failing that, by the LFGDungeons row with exactly the map's name. A map whose rows name different ranges, or whose
 * range is not 1 to 255, has none.
 */
export function instanceLevels(maps: Rows, difficulties: Rows | undefined, tuning: Rows | undefined, lfg: Rows | undefined): Map<number, { min: number; max: number }> {
  const out = new Map<number, { min: number; max: number }>();
  if (!tuning) return out;
  const rangeOf = (ids: Iterable<unknown>): { min: number; max: number } | null => {
    const seen = new Map<string, { min: number; max: number }>();
    for (const id of ids) {
      const t = tuning.get(Number(id)), min = num(t?.MinLevelSquish), max = num(t?.MaxLevelSquish);
      if (min !== null && max !== null && min >= 1 && max >= min && max <= 255) seen.set(`${min}-${max}`, { min, max });
    }
    return seen.size === 1 ? [...seen.values()][0]! : null;
  };
  const byMap = new Map<number, unknown[]>();
  for (const d of difficulties?.values() ?? []) if (d.ContentTuningID) byMap.set(Number(d.MapID), [...(byMap.get(Number(d.MapID)) ?? []), d.ContentTuningID]);
  const byName = new Map<string, unknown[]>();
  for (const l of lfg?.values() ?? []) if (l.ContentTuningID && typeof l.Name_lang === "string") byName.set(l.Name_lang.trim(), [...(byName.get(l.Name_lang.trim()) ?? []), l.ContentTuningID]);
  for (const m of maps.values()) {
    const name = typeof m.MapName_lang === "string" ? m.MapName_lang.trim() : "";
    const range = rangeOf(byMap.get(Number(m.ID)) ?? []) ?? (name ? rangeOf(byName.get(name) ?? []) : null);
    if (range) out.set(Number(m.ID), range);
  }
  return out;
}

export function buildWorldMapData(
  get: (table: string) => Rows | undefined,
  source: WorldMapData["source"],
): WorldMapData {
  const warnings: string[] = [];
  const need = (table: string): Rows => {
    const rows = get(table);
    if (!rows) throw new Error(`the snapshot has no ${table} table; run client-extract first`);
    return rows;
  };
  const maps = need("Map"), uiMaps = need("UiMap"), assignments = [...need("UiMapAssignment").values()];

  // The first whole-map assignment of each UiMap gives its continent and rectangle.
  const placed = placeUiMaps(assignments);

  const continents: WorldMapData["continents"] = [];
  for (const u of uiMaps.values()) {
    const at = placed.get(Number(u.ID));
    if (u.Type !== UI_MAP_CONTINENT || Number(u.ParentUiMapID) !== WORLD_UI_MAP || !at) continue;
    const name = maps.get(at.mapId)?.MapName_lang;
    continents.push({ id: at.mapId, name: typeof name === "string" ? name : String(u.Name_lang), bounds: at.rect });
  }
  continents.sort((a, b) => a.id - b.id);
  const continentIds = new Set(continents.map((c) => c.id));
  if (!continents.length) warnings.push("no continents found");

  const zones: WorldMapData["zones"] = [];
  const heldBackZones: WorldMapData["zones"] = [];
  for (const u of uiMaps.values()) {
    const id = Number(u.ID), at = placed.get(id);
    if (u.Type !== UI_MAP_ZONE || !at || !continentIds.has(at.mapId) || typeof u.Name_lang !== "string") continue;
    const row = { uiMapId: id, name: u.Name_lang, continentId: at.mapId, bounds: at.rect };
    if (id < ORIGINAL_ZONE_UI_MAP_IDS.min || id > ORIGINAL_ZONE_UI_MAP_IDS.max) heldBackZones.push(row);
    else zones.push(row);
  }
  zones.sort((a, b) => a.uiMapId - b.uiMapId);
  heldBackZones.sort((a, b) => a.uiMapId - b.uiMapId);
  if (heldBackZones.length) warnings.push(`${heldBackZones.length} zone(s) with later UiMap ids are held back as possibly unreleased`);

  // The build's own difficulty names and group sizes, by id (Difficulty; 22 rows in the 70630 build).
  const difficulties: WorldMapData["difficulties"] = {};
  for (const d of get("Difficulty")?.values() ?? []) {
    const id = num(d.ID);
    const name = typeof d.Name_lang === "string" ? d.Name_lang.trim() : "";
    if (id === null || !name) continue;
    const min = num(d.MinPlayers) ?? undefined, max = num(d.MaxPlayers) ?? undefined;
    difficulties[id] = { name, ...(min !== undefined || max !== undefined ? { minPlayers: min, maxPlayers: max } : {}) };
  }
  // Each instance's difficulties: the MapDifficulty rows of its map id, distinct and ordered.
  const difficultiesOfMap = new Map<number, number[]>();
  for (const d of get("MapDifficulty")?.values() ?? []) {
    const mapId = num(d.MapID), difficultyId = num(d.DifficultyID);
    if (mapId === null || difficultyId === null) continue;
    const list = difficultiesOfMap.get(mapId);
    if (list && !list.includes(difficultyId)) list.push(difficultyId);
    else if (!list) difficultiesOfMap.set(mapId, [difficultyId]);
  }
  for (const list of difficultiesOfMap.values()) list.sort((a, b) => a - b);

  const levels = instanceLevels(maps, get("MapDifficulty"), get("ContentTuning"), get("LFGDungeons"));
  const entrances: WorldMapData["entrances"] = [];
  for (const m of maps.values()) {
    const kind = m.InstanceType, at = pair(m.Corpse), name = m.MapName_lang;
    if ((kind !== 1 && kind !== 2) || !at || typeof name !== "string" || /^<unused>/i.test(name.trim())) continue;
    if (!continentIds.has(Number(m.CorpseMapID)) || (at[0] === 0 && at[1] === 0)) continue;
    const level = levels.get(Number(m.ID));
    const difficultyIds = difficultiesOfMap.get(Number(m.ID));
    entrances.push({
      mapId: Number(m.ID), name, raid: kind === 2, continentId: Number(m.CorpseMapID), worldX: round(at[0]), worldY: round(at[1]),
      ...(level ? { minLevel: level.min, maxLevel: level.max } : {}),
      ...(difficultyIds?.length ? { difficultyIds } : {}),
    });
  }
  entrances.sort((a, b) => a.mapId - b.mapId);

  const { flightNodes, flightPaths } = buildFlights(get("TaxiNodes"), get("TaxiPath"), get("TaxiPathNode"), continentIds);
  if (!flightNodes.length) warnings.push("no flight tables in the snapshot: no flight masters or flight lines");

  // The zone each spot is in: for an entrance the outdoor area named after its instance, else the ground under the
  // spot. A zone shows the area its whole-map assignment names.
  const terrain = get(TERRAIN_AREA_TABLE), areas = get("AreaTable");
  if (terrain && areas) {
    const zoneOfArea = new Map<number, number>();
    for (const z of [...zones, ...heldBackZones]) {
      const areaId = placed.get(z.uiMapId)?.areaId;
      if (areaId) zoneOfArea.set(areaId, z.uiMapId);
    }
    const continentOf = new Map([...zones, ...heldBackZones].map((z) => [z.uiMapId, z.continentId]));
    const onContinent = (zone: number | null, continentId: number) => (zone !== null && continentOf.get(zone) === continentId ? zone : null);
    let unresolved = 0;
    for (const e of entrances) {
      const zone = onContinent(zoneOfNamedArea(maps.get(e.mapId)!, e.continentId, areas, zoneOfArea), e.continentId)
        ?? onContinent(zoneOfGround(terrain, areas, zoneOfArea, e), e.continentId);
      if (zone !== null) e.uiMapId = zone;
      else unresolved++;
    }
    for (const n of flightNodes) {
      const zone = onContinent(zoneOfGround(terrain, areas, zoneOfArea, n), n.continentId);
      if (zone !== null) n.uiMapId = zone;
      else unresolved++;
    }
    if (unresolved) warnings.push(`${unresolved} entrance(s) or flight master(s) have no zone from the terrain; the zone rectangles place them`);
  } else {
    warnings.push("no terrain areas in the snapshot: entrances and flight masters are placed by zone rectangles, which overlap");
  }

  return WorldMapData.parse({ schema: WORLD_MAP_SCHEMA, source, continents, zones, heldBackZones, difficulties, entrances, flightNodes, flightPaths, warnings });
}

/** Taxi nodes that are not flight masters: test targets, transport (boat and zeppelin) stand-ins, a ferry, quest-only paths, retired rows. */
const NOT_A_FLIGHT_MASTER = /^(generic|transport|quest path|zzold|programmer)|\bferry\b/i;
/** How far a thinned flight line may stray from the full one, in yards. */
export const FLIGHT_LINE_TOLERANCE = 20;

/** Douglas-Peucker: the fewest points that keep the line within `tolerance` of the original. */
export function thinLine(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0]!, [bx, by] = points[points.length - 1]!;
  const len = Math.hypot(bx - ax, by - ay);
  let far = 0, at = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]!;
    const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > far) { far = d; at = i; }
  }
  if (far <= tolerance) return [points[0]!, points[points.length - 1]!];
  return [...thinLine(points.slice(0, at + 1), tolerance).slice(0, -1), ...thinLine(points.slice(at), tolerance)];
}

/**
 * Flight masters and flight lines from the taxi tables. A node counts when a flight starts or ends at it and
 * it lies on one of the continents; a line is kept once for a pair of nodes (the return trip runs the same
 * way), from the path with the lower id, drawn through its own points. A table the snapshot lacks gives none.
 */
export function buildFlights(nodes: Rows | undefined, paths: Rows | undefined, pathNodes: Rows | undefined, continentIds: Set<number>) {
  const flightNodes: WorldMapData["flightNodes"] = [], flightPaths: WorldMapData["flightPaths"] = [];
  if (!nodes || !paths || !pathNodes) return { flightNodes, flightPaths };
  const used = new Set<number>();
  for (const p of paths.values()) used.add(Number(p.FromTaxiNode)), used.add(Number(p.ToTaxiNode));
  const kept = new Map<number, WorldMapData["flightNodes"][number]>();
  for (const n of nodes.values()) {
    const id = Number(n.ID), at = Array.isArray(n.Pos) ? n.Pos.map(num) : [];
    if (!used.has(id) || typeof n.Name_lang !== "string" || NOT_A_FLIGHT_MASTER.test(n.Name_lang.trim()) || !continentIds.has(Number(n.ContinentID))) continue;
    if (at.length < 2 || at[0] === null || at[1] === null) continue;
    kept.set(id, { id, name: n.Name_lang.trim(), continentId: Number(n.ContinentID), worldX: round(at[0]), worldY: round(at[1]) });
  }
  const byPath = new Map<number, { index: number; x: number; y: number }[]>();
  for (const q of pathNodes.values()) {
    const at = Array.isArray(q.Loc) ? q.Loc.map(num) : [];
    if (at.length < 2 || at[0] === null || at[1] === null) continue;
    const list = byPath.get(Number(q.PathID)) ?? [];
    list.push({ index: Number(q.NodeIndex), x: at[0], y: at[1] });
    byPath.set(Number(q.PathID), list);
  }
  const done = new Set<string>();
  for (const p of [...paths.values()].sort((a, b) => Number(a.ID) - Number(b.ID))) {
    const from = kept.get(Number(p.FromTaxiNode)), to = kept.get(Number(p.ToTaxiNode));
    const key = [Number(p.FromTaxiNode), Number(p.ToTaxiNode)].sort((a, b) => a - b).join("-");
    const line = byPath.get(Number(p.ID));
    if (!from || !to || from.continentId !== to.continentId || done.has(key) || !line || line.length < 2) continue;
    done.add(key);
    const points = thinLine(line.sort((a, b) => a.index - b.index).map((q) => [Math.round(q.x), Math.round(q.y)] as [number, number]), FLIGHT_LINE_TOLERANCE);
    flightPaths.push({ from: from.id, to: to.id, continentId: from.continentId, points });
  }
  const drawn = new Set(flightPaths.flatMap((p) => [p.from, p.to]));
  for (const n of kept.values()) if (drawn.has(n.id)) flightNodes.push(n);
  flightNodes.sort((a, b) => a.id - b.id);
  return { flightNodes, flightPaths };
}

export function writeWorldMapData(snapshotPath: string): WorldMapData {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const manifest = new Map((readClientManifest(snapshotPath)?.tables ?? []).map((t) => [t.table, t]));
  const cache = new Map<string, Rows>();
  const get = (table: string) => {
    if (!present.has(table)) return undefined;
    if (!cache.has(table)) cache.set(table, readClientRows(snapshotPath, table));
    return cache.get(table);
  };
  return buildWorldMapData(get, {
    name: "Everloot client extract",
    status: "found in game files, unconfirmed",
    licence: "Blizzard game data, not under our licence",
    licenceUrl: "https://github.com/Everloot/everloot/blob/main/docs/DATA_POLICY.md",
    product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig,
    definitions: meta.definitions, extractedAt: meta.extractedAt,
    tables: WORLD_MAP_TABLES.filter((t) => present.has(t)).map((table) => ({
      table, rows: get(table)!.size, encryptedBlocks: manifest.get(table)?.encryptedBlocks ?? null,
    })),
  });
}
