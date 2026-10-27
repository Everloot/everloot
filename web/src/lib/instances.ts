import { agreedDifficulties, bossLabel, confirmedEntrances, instanceBosses, type InstanceBoss } from "../../../kb/src/instances";
import { dayLabel } from "./report-labels";
import type { WorldMapData } from "../../../kb/src/world-map-data";
import { slugify } from "../../../kb/src/lore-slug";
import { objectNames } from "./names";
import { RECHECK_SCOPES } from "./recheck-scopes";
import { loadInstanceFacts, loadItemFacts } from "./rollup-compute";
import { WORLD_MAP } from "./world-map";
import { placedEntrances, publicZones, type PlacedEntrance, type ZoneSightings } from "./zones";

/** A place an instance is entered from: the released zone it lies in and where, on the zone's 0 to 100 scale. */
export interface InstancePlace { mapId: number; zoneName: string; x: number; y: number }

/**
 * One dungeon or raid, by its instance map id: the row its page and the index show. The files entrance is the game
 * files' (unconfirmed); each confirmed entrance is where 3 installs zoned in from, with how many and when last.
 * `reported` counts the installs that zoned in when no place has 3 yet: a number, never a place.
 */
export interface InstanceRow {
  instanceMapId: number;
  /** The game files' name, else the name 3 installs agree on, else null. */
  name: string | null;
  /** Raid or dungeon from the files, else as 3 installs agree; null when neither says. */
  raid: boolean | null;
  /** The difficulty id 3 installs agree on, or null. */
  difficulty: number | null;
  /** The level range the game files give it (ContentTuning), or null: never worked out another way. */
  level: { min: number; max: number } | null;
  /** The difficulty id / names the game files give it (MapDifficulty), ids in file order; empty when they give none. */
  difficulties: number[];
  files: InstancePlace[];
  confirmed: (InstancePlace & { installs: number; lastSeen: string | null })[];
  reported: number;
  bosses: InstanceBoss[];
}

/**
 * The difficulty ids a classic client reports, by the names the game gives them (the Classic DifficultyID list on
 * warcraft.wiki.gg). Kept as the fallback for ids the committed map.json does not carry yet; the build's own
 * Difficulty names take over as the build watch merges them into map.json.
 */
const DIFFICULTY_NAMES: Readonly<Record<number, string>> = {
  1: "Normal", 2: "Heroic", 3: "10 Player", 4: "25 Player", 5: "10 Player (Heroic)", 6: "25 Player (Heroic)",
  9: "40 Player", 148: "20 Player",
  173: "Normal", 174: "Heroic", 175: "10 Player", 176: "25 Player", 193: "10 Player (Heroic)", 194: "25 Player (Heroic)",
};

/** A name that prefers the files' Difficulty row, keeps the wiki fallback for ids map.json does not carry yet. */
export const difficultyLabelIn =
  (data: Pick<WorldMapData, "difficulties">) =>
  (id: number): string =>
    data.difficulties?.[id]?.name ?? DIFFICULTY_NAMES[id] ?? `Difficulty ${id}`;
/** The site's name for a difficulty id, from the build's own files when map.json carries them. */
export const difficultyLabel = (id: number): string => difficultyLabelIn(WORLD_MAP)(id);
export const instanceTitle = (row: Pick<InstanceRow, "instanceMapId" | "name">): string => row.name ?? `Instance ${row.instanceMapId}`;

/** "17–24" for a range, "60" for one level, null when the game files give none. */
export const levelLabel = (level: InstanceRow["level"]): string | null =>
  level === null ? null : level.min === level.max ? String(level.min) : `${level.min}–${level.max}`;

/** The list's order: lowest level first, instances with no level last, then by name and id. */
export const compareInstances = (a: InstanceRow, b: InstanceRow): number =>
  (a.level?.min ?? Infinity) - (b.level?.min ?? Infinity) || (a.level?.max ?? Infinity) - (b.level?.max ?? Infinity)
  || instanceTitle(a).localeCompare(instanceTitle(b)) || a.instanceMapId - b.instanceMapId;

/**
 * The instance page's meta description: what the page shows, in its order. No zone, because a files entrance is
 * unconfirmed until players zone in from it.
 */
export const instanceDescription = (row: Pick<InstanceRow, "instanceMapId" | "name" | "raid">): string =>
  `${instanceTitle(row)}, a WoW: Forever ${row.raid === null ? "instance" : row.raid ? "raid" : "dungeon"}: where its entrance is, the bosses players have reported killing, the kills for each and when each was last seen.`;

/** "Edwin VanCleef (12 kills) from 3 installs, last seen 2026-10-20". */
export const bossLine = (boss: InstanceBoss): string => `${bossLabel(boss)} from ${boss.reporters} installs, last seen ${dayLabel(boss.lastSeen)}`;

/**
 * The instances an entrance leads to, each name with its instance id: a files pin can hold two, and its names and
 * ids are kept apart, so each name is matched to the files row that carries it. A player entrance has one of each.
 */
export function entranceLinks(e: Pick<PlacedEntrance, "names" | "instanceMapIds" | "files">, data: Pick<WorldMapData, "entrances"> = WORLD_MAP): { name: string; id: number | null }[] {
  return e.names.map((name) => ({
    name,
    id: e.files
      ? data.entrances.find((f) => f.name === name && e.instanceMapIds.includes(f.mapId))?.mapId ?? null
      : e.instanceMapIds[0] ?? null,
  }));
}

/** An instance's own address segment, `36-the-deadmines`, the way zone pages build theirs. */
export function instanceHref(id: number, name: string | null): string {
  const words = name ? slugify(name) : "";
  return `/database/instances/${words ? `${id}-${words}` : id}`;
}

/** The instance id in an `<id>-<slug>` segment, or null. */
export function parseInstanceSegment(segment: string): number | null {
  const m = /^([1-9]\d{0,9})(?:-[a-z0-9-]*)?$/.exec(segment);
  return m ? Number(m[1]) : null;
}

/**
 * Every instance the site shows, by id. An instance is listed when the files place its entrance in a released zone,
 * when 3 installs confirm an entrance in one, or when 3 installs report a boss in it: an instance known only from an
 * entrance in a held-back zone has no row, as on the map without spoilers. Entrances come from `placedEntrances`, the
 * list the zone pages and the map read, so the three never disagree.
 */
export function instanceRows(seen: ZoneSightings = {}, data: Pick<WorldMapData, "zones" | "continents" | "entrances"> = WORLD_MAP): Map<number, InstanceRow> {
  const zoneName = new Map(publicZones(data).map((z) => [z.mapId, z.name]));
  const place = (mapId: number, x: number, y: number): InstancePlace | null => (zoneName.has(mapId) ? { mapId, zoneName: zoneName.get(mapId)!, x, y } : null);
  const asOf = seen.asOf ?? new Date();
  const facts = seen.instances ?? { entrances: [], encounters: [] };
  const difficulty = agreedDifficulties(facts);
  const out = new Map<number, InstanceRow>();
  const row = (id: number): InstanceRow => {
    const lv = data.entrances.find((f) => f.mapId === id);
    const level = lv?.minLevel !== undefined && lv.maxLevel !== undefined ? { min: lv.minLevel, max: lv.maxLevel } : null;
    const r = out.get(id) ?? { instanceMapId: id, name: null, raid: null, difficulty: difficulty.get(id) ?? null, level, difficulties: lv?.difficultyIds ?? [], files: [], confirmed: [], reported: 0, bosses: [] };
    out.set(id, r);
    return r;
  };

  for (const e of placedEntrances(data, seen)) {
    const at = e.files && e.zone ? place(e.zone.mapId, e.zone.x, e.zone.y) : null;
    if (!at) continue;
    for (const id of e.instanceMapIds) {
      const r = row(id);
      // A files pin can hold two instances: each takes its own name and kind from the files' rows.
      const own = data.entrances.find((f) => f.mapId === id);
      r.name ??= own?.name ?? null;
      r.raid ??= own?.raid ?? e.raid;
      r.files.push(at);
    }
  }
  for (const e of confirmedEntrances(facts.entrances, asOf, RECHECK_SCOPES)) {
    const at = place(e.mapId, e.x, e.y);
    if (!at) continue;
    const r = row(e.instanceMapId);
    r.name ??= e.name;
    if (r.raid === null && e.instanceType) r.raid = e.instanceType === "raid";
    r.confirmed.push({ ...at, installs: e.reporters, lastSeen: e.lastSeen });
  }
  for (const [id, list] of instanceBosses(facts.encounters, asOf, RECHECK_SCOPES, facts.entrances)) row(id).bosses = list;
  for (const r of out.values()) {
    if (r.confirmed.length) continue;
    const installs = new Set(facts.entrances.filter((e) => e.instanceMapId === r.instanceMapId).map((e) => e.installId));
    // No place has 3 installs agreeing: the count is shown, never a place.
    r.reported = installs.size;
  }
  return new Map([...out].sort(([a], [b]) => a - b));
}

/**
 * What players' clients saw of dungeons and treasures, with the agreed object names and the corpus's own date, for
 * the zone pages, the instance pages and the map; nothing when storage is down.
 */
export async function loadSightings(): Promise<ZoneSightings & { unreachable: boolean }> {
  const [instances, items] = await Promise.all([loadInstanceFacts(), loadItemFacts()]);
  if (instances.unreachable || items.unreachable) return { unreachable: true };
  const asOf = instances.dataAsOf && Number.isFinite(Date.parse(instances.dataAsOf)) ? new Date(instances.dataAsOf) : undefined;
  return { instances, sightings: instances.sightings, objectNames: objectNames(items), ...(asOf ? { asOf } : {}), unreachable: false };
}
