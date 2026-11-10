import { agreedDifficulties, bossLabel, confirmedEntrances, instanceBosses, latest, reportedBosses, type InstanceBoss } from "../../../kb/src/instances";
import type { ClientAchievements } from "../../../kb/src/client-achievements";
import type { ClientEncounter } from "../../../kb/src/client-encounters";
import type { WorldFacts } from "../../../kb/src/world-pages";
import { CLIENT_ACHIEVEMENTS } from "@/data/game-data/client-achievements";
import { CLIENT_ENCOUNTERS } from "@/data/game-data/client-encounters";
import { publicQuests, type QuestRow } from "./world-lists";
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
  /** The game files' name, else the name 3 installs agree on, else the name the files' kill statistics give it, else null. */
  name: string | null;
  /** When the name is a kill statistic's: the boss that statistic counts. */
  statisticBoss?: string;
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
  /** Encounters fewer than 3 installs report here: encounter id -> how many installs did. A count, never a boss. */
  reportedBosses: Map<number, number>;
  /** The encounters the game files list for it (DungeonEncounter), in the files' order; empty when they list none. */
  encounters: ClientEncounter[];
}

/**
 * One line of an instance's boss table, player-first: every boss 3 installs report, in the reports' order, then the
 * encounters the files list that no report has confirmed. A reported boss the installs have not named borrows the
 * files' name (`filesName`); a files-only encounter has no `boss`.
 */
export interface BossRow {
  encounterId: number;
  name: string | null;
  /** True when the name shown is the files', not one 3 installs agreed on. */
  filesName: boolean;
  boss: InstanceBoss | null;
  /** For an encounter the files list and no boss confirms: how many installs reported it so far, short of 3. */
  reported: number;
}

export function bossRows(row: Pick<InstanceRow, "bosses" | "encounters"> & Partial<Pick<InstanceRow, "reportedBosses">>): BossRow[] {
  const files = new Map(row.encounters.map((e) => [e.id, e.name]));
  const out: BossRow[] = row.bosses.map((b) => ({
    encounterId: b.encounterId,
    name: b.name ?? files.get(b.encounterId) ?? null,
    filesName: b.name === null && files.has(b.encounterId),
    boss: b,
    reported: 0,
  }));
  const reported = new Set(row.bosses.map((b) => b.encounterId));
  for (const e of row.encounters) if (!reported.has(e.id)) out.push({ encounterId: e.id, name: e.name, filesName: true, boss: null, reported: row.reportedBosses?.get(e.id) ?? 0 });
  return out;
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
/** "Normal, Infinite" for ids [1, 201, 213]: the files carry several ids under one name, and each name prints once. */
export const difficultyList = (ids: readonly number[], label: (id: number) => string = difficultyLabel): string =>
  [...new Set(ids.map(label))].join(", ");
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

const KILLS_STATISTIC = /^(.+) Kills \((.+)\)$/;

/**
 * The instance names the game files' own kill statistics give: a statistic titled "Rath'mael Kills (Ruins of
 * Lordaeron)" that counts Rath'mael names the instance whose encounter list holds Rath'mael. An instance is named
 * only when the statistics for its encounters give one name between them; with none or two, it has none.
 */
export function statisticNames(
  encounters: Readonly<Record<string, ClientEncounter[]>> = CLIENT_ENCOUNTERS.instances,
  achievements: Pick<ClientAchievements, "achievements"> = CLIENT_ACHIEVEMENTS,
): Map<number, { name: string; boss: string }> {
  const byBoss = new Map<string, Set<string>>();
  for (const a of Object.values(achievements.achievements)) {
    const m = a.statistic ? KILLS_STATISTIC.exec(a.title) : null;
    if (!m) continue;
    byBoss.set(m[1]!, (byBoss.get(m[1]!) ?? new Set()).add(m[2]!));
  }
  const out = new Map<number, { name: string; boss: string }>();
  for (const [id, list] of Object.entries(encounters)) {
    const named = list.flatMap((e) => [...(byBoss.get(e.name) ?? [])].map((name) => ({ name, boss: e.name })));
    if (named.length && named.every((n) => n.name === named[0]!.name)) out.set(Number(id), named[0]!);
  }
  return out;
}

let statistics: Map<number, { name: string; boss: string }> | null = null;
/** Read once; when the achievements file cannot be read, no instance takes a name from it. */
function filesStatisticNames(): Map<number, { name: string; boss: string }> {
  try { return (statistics ??= statisticNames()); } catch { return new Map(); }
}

/** One quest of an instance: its list row, how many installs reported it and when one last did. */
export interface InstanceQuest extends QuestRow { installs: number; lastSeen: string | null }

/**
 * The quests whose quest-log header 3 installs agree is this instance's name, as the game files it under the dungeon
 * it is for. Lowest level first; none for an instance with no name.
 */
export function instanceQuests(facts: Pick<WorldFacts, "npcs" | "quests" | "recheck">, name: string | null, asOf: Date = new Date()): InstanceQuest[] {
  const key = name?.trim().toLowerCase();
  if (!key) return [];
  const ids = new Set(facts.quests.filter((r) => r.category?.trim().toLowerCase() === key).map((r) => r.questId));
  if (ids.size === 0) return [];
  const rows = facts.quests.filter((r) => ids.has(r.questId));
  return publicQuests({ ...facts, quests: rows, vendors: [] })
    .filter((q) => q.category?.trim().toLowerCase() === key)
    .map((q) => {
      // Only the installs that filed it under this header count, so the meter shows the agreement the listing rests on.
      const own = rows.filter((r) => r.questId === q.questId && r.installId.trim() && r.category?.trim().toLowerCase() === key);
      return { ...q, installs: new Set(own.map((r) => r.installId.trim())).size, lastSeen: latest(own, asOf) };
    })
    .sort((a, b) => (a.level ?? 999) - (b.level ?? 999) || a.questId - b.questId);
}

/**
 * Every instance the site shows, by id. An instance is listed when the files place its entrance in a released zone,
 * when 3 installs confirm an entrance in one, or when 3 installs report a boss in it: an instance known only from an
 * entrance in a held-back zone has no row, as on the map without spoilers, and the files' encounter list never adds
 * a row by itself. Entrances come from `placedEntrances`, the
 * list the zone pages and the map read, so the three never disagree. A row with no name from either takes the one
 * the files' kill statistics give it (`statisticNames`).
 */
export function instanceRows(
  seen: ZoneSightings = {},
  data: Pick<WorldMapData, "zones" | "continents" | "entrances"> = WORLD_MAP,
  encounters: Readonly<Record<string, ClientEncounter[]>> = CLIENT_ENCOUNTERS.instances,
  statistics: ReadonlyMap<number, { name: string; boss: string }> = filesStatisticNames(),
): Map<number, InstanceRow> {
  const zoneName = new Map(publicZones(data).map((z) => [z.mapId, z.name]));
  const place = (mapId: number, x: number, y: number): InstancePlace | null => (zoneName.has(mapId) ? { mapId, zoneName: zoneName.get(mapId)!, x, y } : null);
  const asOf = seen.asOf ?? new Date();
  const facts = seen.instances ?? { entrances: [], encounters: [] };
  const difficulty = agreedDifficulties(facts);
  const out = new Map<number, InstanceRow>();
  const row = (id: number): InstanceRow => {
    const lv = data.entrances.find((f) => f.mapId === id);
    const level = lv?.minLevel !== undefined && lv.maxLevel !== undefined ? { min: lv.minLevel, max: lv.maxLevel } : null;
    const r = out.get(id) ?? { instanceMapId: id, name: null, raid: null, difficulty: difficulty.get(id) ?? null, level, difficulties: lv?.difficultyIds ?? [], files: [], confirmed: [], reported: 0, bosses: [], reportedBosses: new Map(), encounters: encounters[String(id)] ?? [] };
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
  // A count joins a row the files or 3 installs already give; it never adds an instance of its own.
  for (const [id, counts] of reportedBosses(facts.encounters, RECHECK_SCOPES, facts.entrances)) {
    const r = out.get(id);
    if (r) r.reportedBosses = counts;
  }
  for (const r of out.values()) {
    const named = r.name === null ? statistics.get(r.instanceMapId) : undefined;
    if (named) { r.name = named.name; r.statisticBoss = named.boss; }
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
