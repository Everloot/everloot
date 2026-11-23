import { placeEntrances, worldToZone, zoneAt, zoneTable, zoneToWorld, type WorldPoint } from "@kb/world-coords";
import type { WorldMapData } from "@kb/world-map-data";
import { observedPins } from "@kb/world-map-near";
import { questPage, type WorldFacts } from "@kb/world-pages";
import { confirmedEntrances, instanceBosses, type InstanceBoss, type InstanceFacts } from "@kb/instances";
import { objectSpawns, type ObjectSpawnPin, type ObjectSpawnRow } from "@kb/object-spawns";
import { slugify } from "@kb/lore-slug";
import { RECHECK_SCOPES } from "./recheck-scopes";
import { WORLD_MAP } from "./world-map";

/** The zone's own address segment: `1411-durotar`. A name with no letters or digits leaves the bare id. */
export function zoneSlug(id: number, name: string): string {
  const words = slugify(name);
  return words ? `${id}-${words}` : String(id);
}

/** Where a zone's page is. The one place a zone link is built, so the address can change in one line. */
export function zoneHref(id: number, name: string): string {
  return `/database/zones/${zoneSlug(id, name)}`;
}

/** The map for a zone. The map keeps its own links; this one is for the "Open on the map" button. */
export const zoneMapHref = (id: number): string => `/map?zone=${id}`;

/** The UiMap id in a `<id>-<slug>` segment, or null when the segment does not start with one. */
export function parseZoneSegment(segment: string): number | null {
  const m = /^([1-9]\d*)(?:-[a-z0-9-]*)?$/.exec(segment);
  return m ? Number(m[1]) : null;
}

export interface ZoneSummary { mapId: number; name: string; continentId: number; continentName: string }

/**
 * The zones the site shows: the released ones only. A zone found only in the game files (UiMap id above
 * 1458, kept in `heldBackZones`) never gets a page or a line in the index, as on the map without spoilers.
 */
export function publicZones(data: Pick<WorldMapData, "zones" | "continents"> = WORLD_MAP): ZoneSummary[] {
  return zoneTable(data).map((z) => ({
    mapId: z.mapId, name: z.name, continentId: z.continentId,
    continentName: data.continents.find((c) => c.id === z.continentId)?.name ?? `Continent ${z.continentId}`,
  }));
}

export function zoneByMapId(mapId: number, data: Pick<WorldMapData, "zones" | "continents"> = WORLD_MAP): ZoneSummary | undefined {
  return publicZones(data).find((z) => z.mapId === mapId);
}

export interface ZoneNpc { npcId: number; name: string | null; x: number; y: number; reporters: number; vendor: boolean }
export interface ZoneQuest { questId: number; title: string | null; level: number | null; giverNpcId: number | null; turnInNpcId: number | null }
/**
 * A dungeon or raid entrance. `files` is true for one the game files place; `confirmed` is the installs that zoned
 * in there, once 3 agree, else null, and `lastSeen` the latest time one did; `bosses` are the encounters 3 installs
 * report inside. `instanceMapIds` are the instances entered here, each with its own page.
 */
export interface ZoneEntrance {
  names: string[]; instanceMapIds: number[]; raid: boolean; x: number; y: number;
  files: boolean; confirmed: number | null; lastSeen: string | null; bosses: InstanceBoss[];
}
/** An object players saw on the minimap here, at its own position, once 3 installs agree on the spot. */
export interface ZoneTreasure { objectId: number; name: string | null; x: number; y: number; reporters: number; lastSeen: string | null }
export interface ZoneContents { npcs: ZoneNpc[]; quests: ZoneQuest[]; entrances: ZoneEntrance[]; treasures: ZoneTreasure[] }

/**
 * What players' clients saw of dungeons and objects, for `zoneContents`. Names are the agreed object names. `asOf` is
 * when the corpus was current: a report dated after it does not set "last seen".
 */
export interface ZoneSightings { instances?: InstanceFacts; sightings?: ObjectSpawnRow[]; objectNames?: ReadonlyMap<number, string>; asOf?: Date }

/**
 * A dungeon or raid entrance in the world, with what players confirmed of it: the one list the zone pages, the
 * instance pages and the map read, so a marker and a row never disagree. `zone` is the released zone it lies in and
 * where, or null outside every released zone; `world` is null for a player entrance on a map we cannot place.
 */
export interface PlacedEntrance extends Omit<ZoneEntrance, "x" | "y"> {
  world: WorldPoint | null;
  zone: { mapId: number; x: number; y: number } | null;
}

/**
 * Every entrance the game files place, then one per place players confirmed for an instance the files place
 * nowhere, so no entrance has two pins. A files entrance is confirmed when 3 installs zoned into one of its
 * instances; it carries the most installs and the latest time among them.
 */
export function placedEntrances(data: Pick<WorldMapData, "zones" | "entrances">, seen: ZoneSightings = {}): PlacedEntrance[] {
  const zones = zoneTable(data);
  const asOf = seen.asOf ?? new Date();
  const confirmed = confirmedEntrances(seen.instances?.entrances ?? [], asOf, RECHECK_SCOPES);
  const bosses = instanceBosses(seen.instances?.encounters ?? [], asOf, RECHECK_SCOPES, seen.instances?.entrances ?? []);
  const out: PlacedEntrance[] = [];
  const placed = new Set<number>();
  for (const pin of placeEntrances(data)) {
    for (const id of pin.mapIds) placed.add(id);
    const zone = zoneAt(zones, pin.world, pin.uiMapId);
    const at = zone && worldToZone(zones, zone.mapId, pin.world);
    const mine = confirmed.filter((e) => pin.mapIds.includes(e.instanceMapId));
    const players = Math.max(0, ...mine.map((e) => e.reporters));
    const seenAt = mine.map((e) => e.lastSeen).filter((t): t is string => t !== null).sort().at(-1) ?? null;
    out.push({
      names: pin.names, instanceMapIds: pin.mapIds, raid: pin.raid, world: pin.world,
      zone: zone && at ? { mapId: zone.mapId, x: Math.round(at.x * 1000) / 10, y: Math.round(at.y * 1000) / 10 } : null,
      files: true, confirmed: players || null, lastSeen: players ? seenAt : null, bosses: pin.mapIds.flatMap((id) => bosses.get(id) ?? []),
    });
  }
  for (const e of confirmed) {
    if (placed.has(e.instanceMapId)) continue;
    const released = zones.some((z) => z.mapId === e.mapId);
    out.push({
      names: [e.name ?? `Instance ${e.instanceMapId}`], instanceMapIds: [e.instanceMapId], raid: e.instanceType === "raid",
      world: released ? zoneToWorld(zones, e.mapId, e.x / 100, e.y / 100) : null,
      zone: released ? { mapId: e.mapId, x: e.x, y: e.y } : null,
      files: false, confirmed: e.reporters, lastSeen: e.lastSeen, bosses: bosses.get(e.instanceMapId) ?? [],
    });
  }
  return out;
}

/** Treasure pins: objects seen on the minimap where 3 installs agree on the spot, with their agreed names and last seen. */
export function treasurePins(seen: ZoneSightings): (ObjectSpawnPin & { name: string | null; lastSeen: string | null })[] {
  return objectSpawns(seen.sightings ?? [], [], seen.asOf ?? new Date(), RECHECK_SCOPES)
    .pins.map((pin) => ({ ...pin, name: seen.objectNames?.get(pin.objectId) ?? null, lastSeen: pin.lastSeen ?? null }));
}

/**
 * What is known to be in each released zone. NPC and vendor positions come through `observedPins`, so the
 * 3-install rule holds as everywhere else. A quest is in the zone where its agreed giver or turn-in NPC
 * stands. Dungeon and raid entrances are read from the game files and go to the zone the files put them in (world-map-data.ts); one is
 * confirmed when 3 installs zoned into its instance, and an instance the files place nowhere gets the players'
 * entrance instead, so no entrance has two pins. Treasures are objects seen on the minimap, pinned at 3 installs.
 */
export function zoneContents(
  facts: Pick<WorldFacts, "npcs" | "quests" | "vendors" | "recheck" | "agreedNpcs">, data: Pick<WorldMapData, "zones" | "heldBackZones" | "continents" | "entrances"> = WORLD_MAP,
  seen: ZoneSightings = {},
): Map<number, ZoneContents> {
  const zones = zoneTable(data);
  const out = new Map<number, ZoneContents>(zones.map((z) => [z.mapId, { npcs: [], quests: [], entrances: [], treasures: [] }]));

  const npcsHere = new Map<number, Set<number>>();
  for (const pin of observedPins(facts, data)) {
    const here = out.get(pin.mapId);
    if (!here) continue;
    here.npcs.push({ npcId: pin.npcId, name: pin.name, x: pin.x, y: pin.y, reporters: pin.reporters, vendor: pin.kind === "vendor" });
    npcsHere.set(pin.mapId, (npcsHere.get(pin.mapId) ?? new Set()).add(pin.npcId));
  }

  const byQuest = new Map<number, WorldFacts["quests"]>();
  for (const q of facts.quests) byQuest.set(q.questId, [...(byQuest.get(q.questId) ?? []), q]);
  for (const [questId, rows] of byQuest) {
    const q = questPage(questId, { npcs: facts.npcs, quests: rows, vendors: [], recheck: facts.recheck, ...(facts.agreedNpcs ? { agreedNpcs: facts.agreedNpcs } : {}) });
    for (const [mapId, npcs] of npcsHere) {
      if ((q.giverNpcId !== null && npcs.has(q.giverNpcId)) || (q.turnInNpcId !== null && npcs.has(q.turnInNpcId))) {
        out.get(mapId)!.quests.push({ questId, title: q.title, level: q.level, giverNpcId: q.giverNpcId, turnInNpcId: q.turnInNpcId });
      }
    }
  }

  for (const e of placedEntrances(data, seen)) {
    const here = e.zone && out.get(e.zone.mapId);
    if (!here || !e.zone) continue;
    here.entrances.push({
      names: e.names, instanceMapIds: e.instanceMapIds, raid: e.raid, x: e.zone.x, y: e.zone.y,
      files: e.files, confirmed: e.confirmed, lastSeen: e.lastSeen, bosses: e.bosses,
    });
  }

  for (const pin of treasurePins(seen)) {
    out.get(pin.mapId)?.treasures.push({ objectId: pin.objectId, name: pin.name, x: pin.x, y: pin.y, reporters: pin.reporters, lastSeen: pin.lastSeen });
  }

  for (const here of out.values()) {
    here.npcs.sort((a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿") || a.npcId - b.npcId);
    here.quests.sort((a, b) => (a.level ?? 999) - (b.level ?? 999) || a.questId - b.questId);
    here.treasures.sort((a, b) => a.objectId - b.objectId || a.x - b.x || a.y - b.y);
  }
  return out;
}

/** Players' reports or the game files put something on the page beyond the zone's name. */
export const hasContent = (c: ZoneContents | undefined): boolean => Boolean(c && (c.npcs.length || c.quests.length || c.entrances.length || c.treasures.length));

/** Players put something on it: an entrance read only from the game files has no player behind it. */
export const hasConfirmed = (c: ZoneContents | undefined): boolean =>
  Boolean(c && (c.npcs.length || c.quests.length || c.treasures.length || c.entrances.some((e) => e.confirmed !== null)));
