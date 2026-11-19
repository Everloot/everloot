/**
 * Where game objects (herbs, ore, chests) stand, from the loot windows players opened on them. The addon
 * records the player's position when the window opens, a few yards from the object, with how it was opened
 * (`gatherKind`) and the object's name. One object id has many spawn points, so an id's positions within a
 * map are grouped into clusters: a position closer than `SPAWN_RADIUS` (on the 0..100 map scale) to a
 * cluster's centre joins it. A cluster is a pin at 3 distinct installs; 1 or 2 installs are only counted,
 * never placed. Fishing is left out: the window reports the bobber, not the pool. A cluster's centre is the
 * mean of its installs' mean positions, so many rows from one install do not move it.
 *
 * A pin's key is `obj<objectId>-<mapId>-<x>_<y>`, its first agreed median rounded to 0.5. Pass the keys
 * already published back in and each keeps its place: positions near it join it before any new cluster
 * forms, so found marks and links do not break when later reports move the median.
 *
 * A treasure under a recheck scope (`kb/curated/recheck.json`) counts, in a cluster 3 installs placed before the
 * scope's date, only the rows captured after it; so does its name. Loot rows carry no capture time and are never cut.
 */
import { GATHER_KINDS } from "@everloot/protocol";
import type { RecheckScope } from "./coverage.js";
import { recheckRows } from "./fact-states.js";
import { latest } from "./instances.js";
import { busiestMap, scopeSince } from "./recheck-scopes.js";
import { agreedLabelsById, WORLD_AGREEMENT } from "./world-pages.js";

export type GatherKind = (typeof GATHER_KINDS)[number];

/** How close, on the 0..100 map scale, a position must be to a cluster's centre to join it. */
export const SPAWN_RADIUS = 1.0;

export interface ObjectSpawnRow {
  installId: string;
  objectId: number;
  /** Where the player stood; absent on rows from older addons, which still count for names and kinds. */
  mapId?: number;
  x?: number;
  y?: number;
  gatherKind?: GatherKind;
  name?: string;
  /** The player's own rank in the skill the cast used (Herbalism or Mining), on loot rows from newer addons. */
  gatherSkill?: number;
  /** When the client recorded it; kept on minimap sightings only. */
  capturedAt?: string;
}

type PlacedRow = ObjectSpawnRow & { mapId: number; x: number; y: number };

export interface ObjectSpawnPin {
  key: string;
  objectId: number;
  mapId: number;
  /** The median of the cluster's positions now, to one decimal. The key keeps the first one. */
  x: number;
  y: number;
  reporters: number;
  /** With `asOf` only: the latest time among the pin's rows that is not after it, or null. */
  lastSeen?: string | null;
}

export interface ObjectSpawns {
  pins: ObjectSpawnPin[];
  /** Clusters seen by 1 or 2 installs, per object id and map: a count, never a place. */
  unconfirmed: { objectId: number; mapId: number; clusters: number }[];
}

const KEY = /^obj([1-9]\d*)-(\d+)-(\d+(?:\.\d)?)_(\d+(?:\.\d)?)$/;

export function spawnKey(objectId: number, mapId: number, x: number, y: number): string {
  const half = (v: number) => (Math.round(v * 2) / 2).toFixed(1);
  return `obj${objectId}-${mapId}-${half(x)}_${half(y)}`;
}

export function parseSpawnKey(key: string): { objectId: number; mapId: number; x: number; y: number } | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const [objectId, mapId, x, y] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return x <= 100 && y <= 100 ? { objectId, mapId, x, y } : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

interface Cluster { key?: string; cx: number; cy: number; rows: PlacedRow[] }

/** Clusters one object id's positions on one map. Rows come sorted, so the result does not depend on input order. */
function clusterGroup(rows: PlacedRow[], anchors: { key: string; x: number; y: number }[]): Cluster[] {
  const clusters: Cluster[] = anchors.map((a) => ({ key: a.key, cx: a.x, cy: a.y, rows: [] }));
  const nearest = (row: PlacedRow, pool: Cluster[]) => {
    let best: Cluster | undefined;
    let bestDistance = SPAWN_RADIUS;
    for (const c of pool) {
      const d = distance(row.x, row.y, c.cx, c.cy);
      if (d < bestDistance) { best = c; bestDistance = d; }
    }
    return best;
  };
  const loose: PlacedRow[] = [];
  // Published places first, around their fixed keys.
  for (const row of rows) {
    const home = nearest(row, clusters);
    if (home) home.rows.push(row); else loose.push(row);
  }
  // Then new clusters. Each is centred on the mean of its installs' own mean positions, so one install that
  // sent many rows weighs as much as one that sent a single row and cannot drag the centre away.
  const fresh: Cluster[] = [];
  const recentre = (c: Cluster) => {
    const byInstall = new Map<string, { x: number; y: number; n: number }>();
    for (const r of c.rows) {
      const s = byInstall.get(r.installId.trim()) ?? { x: 0, y: 0, n: 0 };
      s.x += r.x; s.y += r.y; s.n += 1;
      byInstall.set(r.installId.trim(), s);
    }
    const means = [...byInstall.values()];
    c.cx = means.reduce((sum, s) => sum + s.x / s.n, 0) / means.length;
    c.cy = means.reduce((sum, s) => sum + s.y / s.n, 0) / means.length;
  };
  for (const row of loose) {
    const home = nearest(row, fresh);
    if (home) {
      home.rows.push(row);
      recentre(home);
    } else {
      fresh.push({ cx: row.x, cy: row.y, rows: [row] });
    }
  }
  return [...clusters, ...fresh];
}

/** The fishing bobber: every fishing window reports it, wherever the pool is. */
export const FISHING_BOBBER = 35591;

/**
 * Pins for every object id and map with positions. `published` is the list of keys already shown; each
 * keeps its key while it still has 3 installs. A new pin's key is its median rounded to 0.5; if that key is
 * already taken in this pass, the cluster joins that pin. With `asOf`, each pin also says when it was last seen.
 * `recheck`: the scopes in `kb/curated/recheck.json`.
 */
export function objectSpawns(rows: ObjectSpawnRow[], published: readonly string[] = [], asOf?: Date, recheck: readonly RecheckScope[] = []): ObjectSpawns {
  // Fishing is never a pin: a fishing row, the bobber, or an object installs agree is fished.
  const kinds = agreedGatherKinds(rows);
  const groups = new Map<string, PlacedRow[]>();
  for (const row of rows) {
    if (row.gatherKind === "fishing" || row.objectId === FISHING_BOBBER || kinds.get(row.objectId) === "fishing" || !placed(row)) continue;
    const id = `${row.objectId}|${row.mapId}`;
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  const anchorsByGroup = new Map<string, { key: string; x: number; y: number }[]>();
  for (const key of [...new Set(published)].sort()) {
    const at = parseSpawnKey(key);
    if (!at) continue;
    const id = `${at.objectId}|${at.mapId}`;
    const list = anchorsByGroup.get(id) ?? [];
    list.push({ key, x: at.x, y: at.y });
    anchorsByGroup.set(id, list);
  }

  const pins: ObjectSpawnPin[] = [];
  const unconfirmed: ObjectSpawns["unconfirmed"] = [];
  for (const [id, list] of groups) {
    const [objectId, mapId] = id.split("|").map(Number) as [number, number];
    const sorted = [...list].sort((a, b) => a.x - b.x || a.y - b.y || (a.installId < b.installId ? -1 : a.installId > b.installId ? 1 : 0));
    const byKey = new Map<string, PlacedRow[]>();
    let few = 0;
    const since = recheck.length ? scopeSince(recheck, { types: ["treasures"], zones: [mapId], ids: [objectId] }) : null;
    for (const cluster of clusterGroup(sorted, anchorsByGroup.get(id) ?? [])) {
      const members = recheckRows(cluster.rows, since).rows;
      const installs = new Set(members.map((r) => r.installId.trim()));
      if (installs.size === 0) continue;
      if (installs.size < WORLD_AGREEMENT) { few += 1; continue; }
      const key = cluster.key ?? spawnKey(objectId, mapId, median(members.map((r) => r.x)), median(members.map((r) => r.y)));
      byKey.set(key, [...(byKey.get(key) ?? []), ...members]);
    }
    for (const [key, members] of byKey) {
      pins.push({
        key, objectId, mapId,
        x: median(members.map((r) => r.x)), y: median(members.map((r) => r.y)),
        reporters: new Set(members.map((r) => r.installId.trim())).size,
        ...(asOf ? { lastSeen: latest(members, asOf) } : {}),
      });
    }
    if (few > 0) unconfirmed.push({ objectId, mapId, clusters: few });
  }
  pins.sort((a, b) => a.objectId - b.objectId || a.mapId - b.mapId || (a.key < b.key ? -1 : 1));
  unconfirmed.sort((a, b) => a.objectId - b.objectId || a.mapId - b.mapId);
  return { pins, unconfirmed };
}

function placed(row: ObjectSpawnRow): row is PlacedRow {
  const { mapId, x, y } = row;
  return Boolean(row.installId.trim()) && Number.isInteger(row.objectId) && row.objectId > 0 &&
    typeof mapId === "number" && Number.isInteger(mapId) && mapId >= 0 &&
    typeof x === "number" && typeof y === "number" && x >= 0 && x <= 100 && y >= 0 && y <= 100;
}

/**
 * Object names 3 installs agree on, by object id. Ids without one are left out: show "Object <id>". Under `recheck`,
 * an object is placed on the map most installs saw it on.
 */
export function agreedObjectNames(rows: ObjectSpawnRow[], recheck: readonly RecheckScope[] = []): Map<number, string> {
  let sinceOf: ((id: number) => string | null) | undefined;
  if (recheck.length) {
    const maps = new Map<number, Map<number, Set<string>>>();
    for (const r of rows) {
      if (typeof r.mapId !== "number") continue;
      const byMap = maps.get(r.objectId) ?? new Map<number, Set<string>>();
      byMap.set(r.mapId, (byMap.get(r.mapId) ?? new Set<string>()).add(r.installId.trim()));
      maps.set(r.objectId, byMap);
    }
    sinceOf = (id) => scopeSince(recheck, { types: ["treasures"], zones: [busiestMap(maps.get(id) ?? new Map())], ids: [id] });
  }
  return agreedLabelsById(rows.filter((r) => r.name !== undefined).map((r) => ({ id: r.objectId, installId: r.installId, label: r.name!, ...(r.capturedAt ? { capturedAt: r.capturedAt } : {}) })), sinceOf);
}

/** How each object is opened, by object id, when 3 installs agree on one kind. */
export function agreedGatherKinds(rows: ObjectSpawnRow[]): Map<number, GatherKind> {
  return agreedLabelsById(rows.filter((r) => r.gatherKind !== undefined).map((r) => ({ id: r.objectId, installId: r.installId, label: r.gatherKind! }))) as Map<number, GatherKind>;
}

/** The gathering skill installs had: `installs` counts those that reported one. */
export interface SkillRange { min: number; median: number; installs: number }

/**
 * The skill players had on these rows: each install's lowest `gatherSkill` among them, then the lowest of those and
 * their median (the lower middle one when the count is even, so it is always a rank someone had). Null until 3
 * installs reported a skill, the same agreement a spot or a kind needs.
 */
export function skillRange(rows: readonly ObjectSpawnRow[]): SkillRange | null {
  const lowest = new Map<string, number>();
  for (const r of rows) {
    const id = r.installId.trim();
    if (r.gatherSkill === undefined || !id) continue;
    lowest.set(id, Math.min(lowest.get(id) ?? Infinity, r.gatherSkill));
  }
  if (lowest.size < WORLD_AGREEMENT) return null;
  const sorted = [...lowest.values()].sort((a, b) => a - b);
  return { min: sorted[0]!, median: sorted[Math.floor((sorted.length - 1) / 2)]!, installs: sorted.length };
}

/**
 * The skill players had when they gathered each herb or ore, by object id: only objects 3 installs agree are of
 * `kind`, and only the rows of installs that opened them that way. An object with fewer than 3 such installs
 * reporting a skill is left out.
 */
export function gatherSkillRanges(rows: readonly ObjectSpawnRow[], kind: "herb" | "ore"): Map<number, SkillRange> {
  const kinds = agreedGatherKinds([...rows]);
  const byObject = new Map<number, ObjectSpawnRow[]>();
  for (const r of rows) {
    if (r.gatherKind !== kind || kinds.get(r.objectId) !== kind) continue;
    const list = byObject.get(r.objectId) ?? [];
    list.push(r);
    byObject.set(r.objectId, list);
  }
  const out = new Map<number, SkillRange>();
  for (const [objectId, list] of [...byObject].sort((a, b) => a[0] - b[0])) {
    const range = skillRange(list);
    if (range) out.set(objectId, range);
  }
  return out;
}

/**
 * Objects players saw on the minimap (`object_sighting`), such as treasure chests. Their position is the object's
 * own, from the game's vignette API, not the player's, so they are kept apart from the loot rows below: pass them
 * to `objectSpawns` alone for treasure pins, under the same clusters and 3-install rule.
 */
export function objectSightingRowsFromRecords(records: unknown[]): ObjectSpawnRow[] {
  const out: ObjectSpawnRow[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.kind !== "object_sighting" || typeof r.installId !== "string" || !r.installId.trim()) continue;
    if (typeof r.objectId !== "number" || !Number.isInteger(r.objectId) || r.objectId < 1) continue;
    if (typeof r.mapId !== "number" || typeof r.x !== "number" || typeof r.y !== "number") continue;
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : undefined;
    const capturedAt = typeof r.capturedAt === "string" && Number.isFinite(Date.parse(r.capturedAt)) ? r.capturedAt : undefined;
    out.push({ installId: r.installId, objectId: r.objectId, mapId: r.mapId, x: r.x, y: r.y, ...(name ? { name } : {}), ...(capturedAt ? { capturedAt } : {}) });
  }
  return out;
}

/**
 * Object loot rows from uploads, for the functions above: every loot-api row with an object source. The place,
 * the kind and the name are each kept only when present, so rows from older addons carry just the id.
 */
export function objectSpawnRowsFromRecords(records: unknown[]): ObjectSpawnRow[] {
  const out: ObjectSpawnRow[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.kind !== "loot" || r.sourceEvidence !== "loot-api" || typeof r.installId !== "string" || !r.installId.trim()) continue;
    if (typeof r.sourceObjectId !== "number" || !Number.isInteger(r.sourceObjectId) || r.sourceObjectId < 1) continue;
    const name = typeof r.sourceObjectName === "string" && r.sourceObjectName.trim() ? r.sourceObjectName.trim() : undefined;
    const gatherKind = GATHER_KINDS.includes(r.gatherKind as GatherKind) ? (r.gatherKind as GatherKind) : undefined;
    const place = typeof r.mapId === "number" && typeof r.x === "number" && typeof r.y === "number" ? { mapId: r.mapId, x: r.x, y: r.y } : {};
    const skill = typeof r.gatherSkill === "number" && Number.isInteger(r.gatherSkill) && r.gatherSkill >= 1 && r.gatherSkill <= 500 ? { gatherSkill: r.gatherSkill } : {};
    out.push({ installId: r.installId, objectId: r.sourceObjectId, ...place, ...(gatherKind ? { gatherKind } : {}), ...(name ? { name } : {}), ...skill });
  }
  return out;
}
