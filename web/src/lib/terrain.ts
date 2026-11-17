import { CLIENT_TERRAIN } from "@/data/game-data/client-terrain";
import type { ClientTerrain } from "../../../kb/src/client-terrain";
import { publicZones } from "./zones";

/**
 * Terrain types and the gear bound to them, from data/game-data/client-terrain.json (found in game files,
 * unconfirmed). WoW: Forever gives some item effects a kind of ground to work on, and the files list which areas each
 * kind covers. The pages show it on the released zones and on the instances that have a page; a held-back zone is
 * left out everywhere, as on the map without spoilers.
 */

export const TERRAIN_BUILD = CLIENT_TERRAIN.build.version;
export const TERRAIN_PATH = "/database/terrain";

export type SpeedKind = "run" | "mount" | "swim";

export interface TerrainType {
  groupId: number;
  name: string;
  /** The anchor of its section on the terrain page. */
  slug: string;
  /** Released zones it covers whole, by UiMap id, ascending. */
  zones: number[];
  /** Released zones it covers only part of: UiMap id -> the parts' names. */
  parts: Map<number, string[]>;
  /** Instances (map ids) it covers, ascending; the caller keeps the ones with a page. */
  instances: number[];
}

export interface TerrainGear {
  /** The item, or for a set bonus its first piece. */
  itemId: number;
  spellId: number;
  /** How it fires: on use, while equipped, by chance on hit, or as a set bonus. */
  trigger: "use" | "equip" | "hit" | "set";
  /** A set bonus: the set, how many pieces it needs and its pieces. */
  set: { setId: number; threshold: number; pieces: number[] } | null;
  /** The terrain the effect needs, or null when the files tie it to none. */
  terrain: TerrainType | null;
  /** For an effect bound to a zone list rather than a terrain type: the released zones and instances of the list. */
  places: { zones: number[]; instances: number[] } | null;
  speed: { kind: SpeedKind; percent: number } | null;
}

export const terrainSlug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The terrain types of a terrain file, released zones only, by name. */
export function terrainTypes(data: ClientTerrain = CLIENT_TERRAIN, released: ReadonlySet<number> = releasedZones()): TerrainType[] {
  return Object.entries(data.areaGroups)
    .filter((e): e is [string, ClientTerrain["areaGroups"][string] & { name: string }] => e[1].name !== null)
    .map(([id, g]) => ({
      groupId: Number(id), name: g.name, slug: terrainSlug(g.name),
      zones: g.zones.filter((z) => released.has(z)),
      parts: new Map(Object.entries(g.parts).map(([z, names]) => [Number(z), names] as const).filter(([z]) => released.has(z))),
      instances: g.instances,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function releasedZones(): Set<number> {
  return new Set(publicZones().map((z) => z.mapId));
}

/** Every item effect and set bonus of a terrain file that needs a terrain type or changes speed: items in item order, then sets. */
export function terrainGear(data: ClientTerrain = CLIENT_TERRAIN, released: ReadonlySet<number> = releasedZones()): TerrainGear[] {
  const types = new Map(terrainTypes(data, released).map((t) => [t.groupId, t]));
  const where = (group: number | null) => {
    const list = group === null ? undefined : data.areaGroups[String(group)];
    return {
      terrain: group === null ? null : types.get(group) ?? null,
      places: list && list.name === null ? { zones: list.zones.filter((z) => released.has(z)), instances: list.instances } : null,
    };
  };
  const speedOf = (kind: SpeedKind | null, percent: number | null) => (kind && percent !== null ? { kind, percent } : null);
  return [
    ...data.items.map(([itemId, spellId, trigger, group, kind, percent]): TerrainGear => ({ itemId, spellId, trigger, set: null, ...where(group), speed: speedOf(kind, percent) })),
    ...data.sets.map(([setId, spellId, threshold, group, kind, percent, pieces]): TerrainGear => ({
      itemId: pieces[0]!, spellId, trigger: "set", set: { setId, threshold, pieces }, ...where(group), speed: speedOf(kind, percent),
    })),
  ];
}

/** What the files say of a zone's ground: each terrain type that covers it, whole or in part (with the parts). */
export function zoneTerrain(uiMapId: number, types: readonly TerrainType[] = terrainTypes()): { type: TerrainType; parts: string[] | null }[] {
  return types.flatMap((type): { type: TerrainType; parts: string[] | null }[] =>
    (type.zones.includes(uiMapId) ? [{ type, parts: null }] : type.parts.has(uiMapId) ? [{ type, parts: type.parts.get(uiMapId)! }] : []));
}

export function instanceTerrain(mapId: number, types: readonly TerrainType[] = terrainTypes()): TerrainType[] {
  return types.filter((t) => t.instances.includes(mapId));
}

/** The gear whose effect works in a zone or an instance: bound to a terrain or zone list that covers it. */
export function gearFor(place: { zone: number } | { instance: number }, gear: readonly TerrainGear[] = terrainGear()): TerrainGear[] {
  const covers = (zones: number[], parts: ReadonlyMap<number, string[]> | null, instances: number[]) =>
    "zone" in place ? zones.includes(place.zone) || Boolean(parts?.has(place.zone)) : instances.includes(place.instance);
  return gear.filter((g) => (g.terrain ? covers(g.terrain.zones, g.terrain.parts, g.terrain.instances) : g.places ? covers(g.places.zones, null, g.places.instances) : false));
}

/** The gear that changes speed anywhere or somewhere, fastest first within each kind (run, mount, swim). */
export function speedGear(gear: readonly TerrainGear[] = terrainGear()): TerrainGear[] {
  const order: SpeedKind[] = ["run", "mount", "swim"];
  return gear.filter((g) => g.speed).sort((a, b) => order.indexOf(a.speed!.kind) - order.indexOf(b.speed!.kind) || b.speed!.percent - a.speed!.percent || a.itemId - b.itemId || a.spellId - b.spellId);
}

const SPEED_WORD: Record<SpeedKind, string> = { run: "run speed", mount: "mount speed", swim: "swim speed" };

/** "+7% mount speed", or null for an effect that changes no speed. */
export const speedLabel = (speed: TerrainGear["speed"]): string | null => (speed ? `+${speed.percent}% ${SPEED_WORD[speed.kind]}` : null);

const TRIGGER_WORD: Record<TerrainGear["trigger"], string> = { use: "Use", equip: "Equip", hit: "Chance on hit", set: "Set bonus" };

export const triggerLabel = (gear: Pick<TerrainGear, "trigger" | "set">): string =>
  (gear.set ? `Set bonus (${gear.set.threshold} pieces)` : TRIGGER_WORD[gear.trigger]);

/** What a row says when the files tie an effect to no area. The game may still limit it (Westfall Stew's speed). */
export const NO_AREA = "No area limit in the files";
