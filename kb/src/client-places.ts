/**
 * The named places inside each zone, from the game files:
 * - subzones: the `AreaTable` areas whose `ParentAreaID` chain reaches the area a zone's whole-map `UiMapAssignment`
 *   shows (Goldshire in Elwynn Forest), with the zone's UiMap id;
 * - points of interest: the `AreaPOI` rows (towns, landmarks and the like the world map labels), with their world
 *   position and continent, and the zone their `AreaID` leads to when it leads to one. A point with no area is placed
 *   by the pages from its position.
 * Names that mark a development leftover are left out. Which zones are released is the map layer's business
 * (map.json, heldBackZones): a page shows only the places of the zones it draws.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed". Ids, names and positions only. The build watch
 * regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";
import { placeUiMaps, zoneOfAreaChain } from "./world-map-data.js";

export const PLACES_SCHEMA = "everloot.client-places/1";

const Subzone = z.object({ id: z.number().int(), name: z.string(), uiMapId: z.number().int() });
const Poi = z.object({
  id: z.number().int(), name: z.string(), continentId: z.number().int(), worldX: z.number(), worldY: z.number(),
  /** The zone the point's area leads to; absent when it has no area or the area leads to no zone. */
  uiMapId: z.number().int().optional(),
});
export type ClientSubzone = z.infer<typeof Subzone>;
export type ClientPoi = z.infer<typeof Poi>;

export const ClientPlaces = z.object({
  schema: z.literal(PLACES_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  subzones: z.array(Subzone),
  pois: z.array(Poi),
});
export type ClientPlaces = z.infer<typeof ClientPlaces>;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const round = (n: number) => Math.round(n * 10) / 10;

export function buildClientPlaces(snapshotPath: string): ClientPlaces {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string) => (present.has(t) ? readClientRows(snapshotPath, t) : new Map<number, Record<string, unknown>>());
  const areas = get("AreaTable");
  // The area each zone shows: a top-level area (no parent) a whole-map assignment names.
  const zoneOfArea = new Map<number, number>();
  for (const [uiMapId, placed] of [...placeUiMaps([...get("UiMapAssignment").values()])].sort(([a], [b]) => a - b)) {
    const area = areas.get(placed.areaId);
    if (area && !Number(area.ParentAreaID) && !zoneOfArea.has(placed.areaId)) zoneOfArea.set(placed.areaId, uiMapId);
  }

  const subzones: ClientPlaces["subzones"] = [];
  for (const [id, row] of [...areas].sort(([a], [b]) => a - b)) {
    const name = text(row.AreaName_lang);
    if (!name || isDevelopmentItemName(name) || zoneOfArea.has(id)) continue;
    const uiMapId = zoneOfAreaChain(id, areas, zoneOfArea);
    if (uiMapId !== null) subzones.push({ id, name, uiMapId });
  }

  const pois: ClientPlaces["pois"] = [];
  for (const [id, row] of [...get("AreaPOI")].sort(([a], [b]) => a - b)) {
    const name = text(row.Name_lang);
    const pos = Array.isArray(row.Pos) ? row.Pos.map(Number) : [];
    if (!name || isDevelopmentItemName(name) || pos.length < 2 || !pos.slice(0, 2).every(Number.isFinite)) continue;
    const area = Number(row.AreaID);
    const uiMapId = area > 0 ? zoneOfAreaChain(area, areas, zoneOfArea) : null;
    pois.push({ id, name, continentId: Number(row.ContinentID) || 0, worldX: round(pos[0]!), worldY: round(pos[1]!), ...(uiMapId !== null ? { uiMapId } : {}) });
  }

  return ClientPlaces.parse({
    schema: PLACES_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    subzones, pois,
  });
}

/** One place per line, so a new build's file reads as a line diff in review. */
export function serializeClientPlaces(table: ClientPlaces): string {
  const { subzones, pois, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  const list = (key: string, rows: unknown[]) => ` ${JSON.stringify(key)}: [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n ]`;
  return `${top},\n${list("subzones", subzones)},\n${list("pois", pois)}\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-places.json). */
export function writeClientPlaces(snapshotPath: string, path: string): ClientPlaces {
  const table = buildClientPlaces(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientPlaces(table));
  return table;
}
