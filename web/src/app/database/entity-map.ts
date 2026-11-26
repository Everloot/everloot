import { mapHref, zoneHref } from "@/lib/map-view";
import { WORLD_MAP } from "@/lib/world-map";

/**
 * The positions an entity page draws in its map slot, one zone at a time on the zone's own map art. Pages pass only
 * what they already list in their pin tables (3 installs agreeing, or read from the game files), so the map shows
 * nothing the tables do not.
 */

/** What a mark on an entity's map is; each kind has its colour and shape in the legend. */
export type MarkKind = "npc" | "vendor" | "giver" | "turnin" | "object" | "entrance" | "place";

/**
 * One position on a zone map, x and y from 0 to 100 as the pin tables print them. `agreed` is true for a position 3
 * installs agree on (or, for an entrance, zoned in from), false for one only the game files give: drawn hollow.
 */
export interface MapMark { kind: MarkKind; mapId: number; x: number; y: number; label: string; agreed: boolean }

/** The fields of the asset upload's map art this reads; the page passes its own `assets.maps`. */
export interface ZoneArt { uiMapId: number; kind: string; heldBack: boolean; url: string }

/** One zone the map can show: its art, its shape, its marks, and the world map's link for it. */
export interface MapZoneView { mapId: number; name: string; art: string; ratio: string; href: string; marks: MapMark[] }

/**
 * The zones to draw, the zone with the most marks first. A zone needs its map art in the asset upload and must be one
 * the world map draws (no held-back zone, by the art's flag or by the map data), so there is never a broken or
 * spoiling picture. Marks outside 0 to 100 are left off. The link opens one mark as its spot, several as the zone.
 */
export function entityMapZones(marks: readonly MapMark[], maps: readonly ZoneArt[] | null | undefined): MapZoneView[] {
  const byZone = new Map<number, MapMark[]>();
  for (const m of marks) {
    if (!(m.x >= 0 && m.x <= 100 && m.y >= 0 && m.y <= 100)) continue;
    byZone.set(m.mapId, [...(byZone.get(m.mapId) ?? []), m]);
  }
  const out: MapZoneView[] = [];
  for (const [mapId, here] of byZone) {
    const shape = WORLD_MAP.zones.find((z) => z.uiMapId === mapId);
    const art = maps?.find((a) => a.kind === "zone" && a.uiMapId === mapId && !a.heldBack);
    if (!shape || !art) continue;
    const ratio = `${Math.abs(shape.bounds.left - shape.bounds.right)} / ${Math.abs(shape.bounds.top - shape.bounds.bottom)}`;
    const href = here.length === 1 ? mapHref({ mapId, x: here[0]!.x, y: here[0]!.y }) : zoneHref(mapId);
    out.push({ mapId, name: shape.name, art: art.url, ratio, href, marks: here });
  }
  // A stable sort: zones with as many marks keep the order the page listed them in.
  return out.sort((a, b) => b.marks.length - a.marks.length);
}
