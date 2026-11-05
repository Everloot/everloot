/**
 * Dungeons and raids from what players' clients saw: the entrance a player zoned in from (`instance_entrance`, the
 * last position outside) and the boss encounters that ended inside (`encounter`). Each fact is public under the
 * 3-install rule of world-pages.ts. An entrance is placed on an outdoor map when 3 installs zoned in from it there,
 * at the median of their positions, as an NPC pin is. An encounter is listed for an instance when 3 installs
 * report it there; its name, and each boss id, need 3 installs agreeing too. Names come in the client's language,
 * so a name is shown only when they agree. Instance ids are the game's map ids, the ids the game files' entrances
 * carry (`WorldMapData.entrances[].mapId`). Each agreed fact carries when it was last seen: the latest `capturedAt` among
 * its rows, leaving out any time after `asOf`, so one install with a clock set ahead cannot move it. An entrance or a
 * boss under a recheck scope that was agreed before the scope's date counts only the rows captured after it.
 */
import { INSTANCE_TYPES } from "@everloot/protocol";
import type { RecheckScope } from "./coverage.js";
import { recheckRows } from "./fact-states.js";
import { busiestMap, scopeSince } from "./recheck-scopes.js";
import { agreedLabelsById, WORLD_AGREEMENT } from "./world-pages.js";

export type InstanceType = (typeof INSTANCE_TYPES)[number];

export interface InstanceEntranceRow {
  installId: string; instanceMapId: number; name: string; instanceType: InstanceType; mapId: number; x: number; y: number;
  /** When the client recorded it; absent on rows that carry none. */
  capturedAt?: string;
  /** The difficulty id `GetInstanceInfo` reports, when the source recorded it. */
  difficulty?: number;
}
export interface EncounterRow {
  installId: string; encounterId: number; name: string; instanceMapId: number; success: boolean; npcIds: number[];
  capturedAt?: string;
  difficulty?: number;
}
export interface InstanceFacts { entrances: InstanceEntranceRow[]; encounters: EncounterRow[] }

/** One instance's agreed entrance on one outdoor map. */
export interface ConfirmedEntrance {
  instanceMapId: number;
  /** The instance's name 3 installs agree on, or null. */
  name: string | null;
  /** Dungeon or raid, when 3 installs agree. */
  instanceType: InstanceType | null;
  mapId: number;
  x: number;
  y: number;
  reporters: number;
  /** The latest time an install zoned in from here, as ISO; null when no row carries a time. */
  lastSeen: string | null;
}

/** A boss encounter 3 installs report in one instance. */
export interface InstanceBoss {
  encounterId: number;
  name: string | null;
  /** Kills reported, every install's together; wipes are not kills. */
  kills: number;
  /** Boss creature ids 3 installs agree the encounter lists. */
  npcIds: number[];
  reporters: number;
  /** The latest time an install reported the encounter, a kill or a wipe, as ISO; null when no row carries a time. */
  lastSeen: string | null;
}

const valid = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const at = (r: { capturedAt?: string }) => (r.capturedAt ? { capturedAt: r.capturedAt } : {});

/** The latest of the rows' times that is not after `asOf`, as ISO, or null. */
export function latest(rows: readonly { capturedAt?: string }[], asOf: Date): string | null {
  let best = -Infinity;
  for (const r of rows) {
    const t = r.capturedAt === undefined ? NaN : Date.parse(r.capturedAt);
    if (Number.isFinite(t) && t <= asOf.getTime() && t > best) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

/** The time and difficulty a row carries, each kept only when it is well formed. */
function extras(r: Record<string, unknown>): { capturedAt?: string; difficulty?: number } {
  return {
    ...(typeof r.capturedAt === "string" && Number.isFinite(Date.parse(r.capturedAt)) ? { capturedAt: r.capturedAt } : {}),
    ...(typeof r.difficulty === "number" && Number.isInteger(r.difficulty) && r.difficulty >= 0 ? { difficulty: r.difficulty } : {}),
  };
}

export function instanceFactsFromRecords(records: unknown[]): InstanceFacts {
  const facts: InstanceFacts = { entrances: [], encounters: [] };
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.installId !== "string" || !r.installId.trim()) continue;
    if (r.kind === "instance_entrance" && valid(r.instanceMapId) && typeof r.name === "string" && INSTANCE_TYPES.includes(r.instanceType as InstanceType)
      && typeof r.mapId === "number" && Number.isInteger(r.mapId) && r.mapId >= 0 && typeof r.x === "number" && typeof r.y === "number"
      && r.x >= 0 && r.x <= 100 && r.y >= 0 && r.y <= 100) {
      facts.entrances.push({ installId: r.installId.trim(), instanceMapId: r.instanceMapId, name: r.name, instanceType: r.instanceType as InstanceType, mapId: r.mapId, x: r.x, y: r.y, ...extras(r) });
    }
    if (r.kind === "encounter" && valid(r.encounterId) && typeof r.name === "string" && valid(r.instanceMapId) && typeof r.success === "boolean") {
      const npcIds = Array.isArray(r.npcIds) ? [...new Set(r.npcIds.filter(valid))] : [];
      facts.encounters.push({ installId: r.installId.trim(), encounterId: r.encounterId, name: r.name, instanceMapId: r.instanceMapId, success: r.success, npcIds, ...extras(r) });
    }
  }
  return facts;
}

/** The outdoor map most installs zoned in from, per instance: where the score counts its entrance and its bosses. */
export function entranceZones(rows: readonly InstanceEntranceRow[]): Map<number, number | null> {
  const maps = new Map<number, Map<number, Set<string>>>();
  for (const r of rows) {
    const byMap = maps.get(r.instanceMapId) ?? new Map<number, Set<string>>();
    byMap.set(r.mapId, (byMap.get(r.mapId) ?? new Set<string>()).add(r.installId));
    maps.set(r.instanceMapId, byMap);
  }
  return new Map([...maps].map(([id, byMap]) => [id, busiestMap(byMap)]));
}

/**
 * Every instance's agreed entrances, one per instance and outdoor map, by instance id then map id. `recheck`: the
 * scopes in `kb/curated/recheck.json`.
 */
export function confirmedEntrances(rows: readonly InstanceEntranceRow[], asOf: Date = new Date(), recheck: readonly RecheckScope[] = []): ConfirmedEntrance[] {
  const zones = recheck.length ? entranceZones(rows) : new Map<number, number | null>();
  const since = (instanceMapId: number, zone: number | null) => (recheck.length ? scopeSince(recheck, { types: ["entrances"], zones: [zone], ids: [instanceMapId] }) : null);
  const sinceOf = (instanceMapId: number) => since(instanceMapId, zones.get(instanceMapId) ?? null);
  const names = agreedLabelsById(rows.map((r) => ({ id: r.instanceMapId, installId: r.installId, label: r.name, ...at(r) })), sinceOf);
  const types = agreedLabelsById(rows.map((r) => ({ id: r.instanceMapId, installId: r.installId, label: r.instanceType, ...at(r) })), sinceOf);
  // A place 3 installs zoned in from before its scope's date counts only the rows after it.
  const places = new Map<string, InstanceEntranceRow[]>();
  for (const r of rows) {
    const key = `${r.instanceMapId}|${r.mapId}`;
    const list = places.get(key);
    if (list) list.push(r); else places.set(key, [r]);
  }
  const counted = [...places.values()].flatMap((list) => recheckRows(list, since(list[0]!.instanceMapId, list[0]!.mapId)).rows);
  // One position per install and place: an install that zoned in many times counts once, at its median.
  const groups = new Map<string, Map<string, { x: number[]; y: number[] }>>();
  const byPlace = new Map<string, InstanceEntranceRow[]>();
  for (const r of counted) {
    const key = `${r.instanceMapId}|${r.mapId}`;
    const installs = groups.get(key) ?? new Map<string, { x: number[]; y: number[] }>();
    const at = installs.get(r.installId) ?? { x: [], y: [] };
    at.x.push(r.x); at.y.push(r.y);
    installs.set(r.installId, at);
    groups.set(key, installs);
    byPlace.set(key, [...(byPlace.get(key) ?? []), r]);
  }
  const out: ConfirmedEntrance[] = [];
  for (const [key, installs] of groups) {
    if (installs.size < WORLD_AGREEMENT) continue;
    const [instanceMapId, mapId] = key.split("|").map(Number) as [number, number];
    const each = [...installs.values()];
    out.push({
      instanceMapId, name: names.get(instanceMapId) ?? null, instanceType: (types.get(instanceMapId) as InstanceType | undefined) ?? null, mapId,
      x: median(each.map((at) => median(at.x))), y: median(each.map((at) => median(at.y))), reporters: installs.size,
      lastSeen: latest(byPlace.get(key) ?? [], asOf),
    });
  }
  return out.sort((a, b) => a.instanceMapId - b.instanceMapId || a.mapId - b.mapId);
}

/**
 * Each encounter's rows in one instance, with its recheck cut-off, the rows that cut-off leaves and how many installs
 * those rows come from: the count the 3-install bar reads.
 */
function encounterTallies(rows: readonly EncounterRow[], recheck: readonly RecheckScope[], entrances: readonly InstanceEntranceRow[]) {
  const byEncounter = new Map<string, EncounterRow[]>();
  for (const r of rows) {
    const key = `${r.instanceMapId}|${r.encounterId}`;
    byEncounter.set(key, [...(byEncounter.get(key) ?? []), r]);
  }
  const zones = recheck.length ? entranceZones(entrances) : new Map<number, number | null>();
  return [...byEncounter].map(([key, all]) => {
    const [instanceMapId, encounterId] = key.split("|").map(Number) as [number, number];
    const s = recheck.length
      ? scopeSince(recheck, { types: ["bosses"], zones: [zones.get(instanceMapId) ?? null], ids: [instanceMapId, encounterId, ...new Set(all.flatMap((r) => r.npcIds))] })
      : null;
    // Listed, kills and last seen read the rows the cut-off leaves; the name and each boss id are cut on their own.
    const list = recheckRows(all, s).rows;
    return { instanceMapId, encounterId, all, s, list, reporters: new Set(list.map((r) => r.installId)).size };
  });
}

/**
 * The encounters fewer than 3 installs report in each instance: instance id -> encounter id -> how many installs
 * reported it, counted as `instanceBosses` counts them. A count only: no name, kill or date is agreed yet.
 */
export function reportedBosses(rows: readonly EncounterRow[], recheck: readonly RecheckScope[] = [], entrances: readonly InstanceEntranceRow[] = []): Map<number, Map<number, number>> {
  const short = encounterTallies(rows, recheck, entrances)
    .filter((t) => t.reporters > 0 && t.reporters < WORLD_AGREEMENT)
    .sort((a, b) => a.instanceMapId - b.instanceMapId || a.encounterId - b.encounterId);
  const out = new Map<number, Map<number, number>>();
  for (const t of short) out.set(t.instanceMapId, (out.get(t.instanceMapId) ?? new Map<number, number>()).set(t.encounterId, t.reporters));
  return out;
}

/**
 * The bosses 3 installs report in each instance, by instance id, each instance's in encounter id order. `recheck`: the
 * scopes in `kb/curated/recheck.json`; `entrances` place an instance for a scope that names zones.
 */
export function instanceBosses(rows: readonly EncounterRow[], asOf: Date = new Date(), recheck: readonly RecheckScope[] = [], entrances: readonly InstanceEntranceRow[] = []): Map<number, InstanceBoss[]> {
  const out = new Map<number, InstanceBoss[]>();
  for (const { instanceMapId, encounterId, all, s, list, reporters } of encounterTallies(rows, recheck, entrances)) {
    if (reporters < WORLD_AGREEMENT) continue;
    const name = agreedLabelsById(all.map((r) => ({ id: encounterId, installId: r.installId, label: r.name, ...at(r) })), () => s).get(encounterId) ?? null;
    const npcRows = new Map<number, EncounterRow[]>();
    for (const r of all) for (const npcId of r.npcIds) {
      const voters = npcRows.get(npcId);
      if (voters) voters.push(r); else npcRows.set(npcId, [r]);
    }
    const npcIds = [...npcRows].filter(([, voters]) => new Set(recheckRows(voters, s).rows.map((r) => r.installId)).size >= WORLD_AGREEMENT).map(([npcId]) => npcId).sort((a, b) => a - b);
    const boss = { encounterId, name, kills: list.filter((r) => r.success).length, npcIds, reporters, lastSeen: latest(list, asOf) };
    out.set(instanceMapId, [...(out.get(instanceMapId) ?? []), boss].sort((a, b) => a.encounterId - b.encounterId));
  }
  return out;
}

/**
 * The difficulty id 3 installs agree on for each instance, from its entrance and encounter rows together, by the same
 * tally as names (`agreedLabelsById`). Rows without one do not count.
 */
export function agreedDifficulties(facts: InstanceFacts): Map<number, number> {
  const rows = [...facts.entrances, ...facts.encounters].filter((r) => r.difficulty !== undefined);
  const agreed = agreedLabelsById(rows.map((r) => ({ id: r.instanceMapId, installId: r.installId, label: String(r.difficulty) })));
  return new Map([...agreed].map(([id, label]) => [id, Number(label)]));
}

/** "Edwin VanCleef (12 kills)": a boss as a line, by its agreed name or its encounter id. */
export function bossLabel(boss: InstanceBoss): string {
  return `${boss.name ?? `Encounter ${boss.encounterId}`} (${boss.kills.toLocaleString("en-US")} ${boss.kills === 1 ? "kill" : "kills"})`;
}
