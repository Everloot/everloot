import { zoneTable, worldToZone } from "@kb/world-coords";
import { CLIENT_PLACES } from "@/data/game-data/client-places";
import { WORLD_MAP } from "./world-map";

// The named places inside a zone, from the game files: its subzones, and the points of interest the world map labels,
// each at its spot on the zone map. Labelled found in game files, unconfirmed. Only zones the map draws are asked
// for, so a held-back zone's places never reach a page.

export interface ZonePoi { id: number; name: string; x: number | null; y: number | null }
export interface ZonePlaces { subzones: { id: number; name: string }[]; pois: ZonePoi[]; build: string }

const zones = zoneTable(WORLD_MAP);
const pct = (v: number) => Math.round(v * 1000) / 10;

/** A zone's subzones (A to Z) and points of interest (A to Z, each at its spot when the zone map holds it); null when the file could not be read. */
export function zonePlaces(uiMapId: number): ZonePlaces | null {
  let file: typeof CLIENT_PLACES;
  try { file = CLIENT_PLACES; } catch { return null; }
  const subzones = file.subzones.filter((s) => s.uiMapId === uiMapId).map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const pois: ZonePoi[] = [];
  for (const p of file.pois) {
    const world = { continentId: p.continentId, worldX: p.worldX, worldY: p.worldY };
    // Only the zone the point's own area leads to: zone rectangles overlap (Darkshire's spot is inside Deadwind Pass's
    // rectangle too), so a point with no area is left out rather than guessed.
    if (p.uiMapId !== uiMapId) continue;
    const at = worldToZone(zones, uiMapId, world);
    pois.push({ id: p.id, name: p.name, x: at ? pct(at.x) : null, y: at ? pct(at.y) : null });
  }
  pois.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return { subzones, pois, build: file.build.version };
}
