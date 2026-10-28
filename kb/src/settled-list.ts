/**
 * The settled list (docs/design/specs/2026-10-21-coverage-plateau-design.md, section 4, "the off-switch"): per client
 * build, the facts that are settled, at the grain an upload row has, so an uploader can leave out the rows that would
 * only repeat them and the intake can count a repeat instead of storing it.
 *
 * - `npc_sighting`: NPC ids whose name and traits (level, creature type, rank, each role) are settled, each with the
 *   maps whose pin is settled. A sighting is skipped when its NPC and its map are both in the list.
 * - `quest`: quest ids with every reported field settled.
 * - `vendor`: vendor ids whose every offer (price and stock) is settled: a vendor row carries the whole window.
 * - `loot`: sources whose loot is settled: at least `LOOT_SOURCE_MIN_WINDOWS` loot-api windows, and every item that
 *   drops at `LOOT_SOURCE_MIN_RATE` or more with a settled rate.
 * - `instance_entrance`, `encounter`, `object_sighting`: an instance with the outdoor maps whose entrance is settled,
 *   an encounter with its instance, an object with the maps where every treasure cluster and its name are settled.
 *
 * Settled implies confirmed, so the list holds only facts the site already shows: nothing from the local baseline.
 * Facts under a recheck scope count only reports after the scope's date, as the coverage score does, so a fact a patch
 * may have changed leaves the list until it settles again. Ids are sorted and delta-encoded.
 *
 * The file the cron writes also carries each fact's settled values (`values`), all of them public, for the intake:
 * a row that matches its fact's values in every field is counted, not stored (`matchSettled`). The public endpoint
 * serves the list without them.
 */
import { z } from "zod";
import { POSITION_TOLERANCE, type CoverageType, type RecheckScope } from "./coverage.js";
import { measureDropRate } from "./drop-rate-settling.js";
import { lootWindowsFromRecords, recheckLootRecords, rollupDrops } from "./drop-rollup.js";
import { SETTLE_EXTRA_VOTERS, SETTLE_WINDOW_DAYS, tallyVotes, WORLD_AGREEMENT, type VoteRow } from "./fact-states.js";
import { instanceFactsFromRecords } from "./instances.js";
import { objectSightingRowsFromRecords, objectSpawnRowsFromRecords, objectSpawns, SPAWN_RADIUS } from "./object-spawns.js";
import { busiestMap, npcZones, scopeSince as matchScope } from "./recheck-scopes.js";
import { isSpotChecked } from "./spot-check.js";
import { isPinPosition, worldFactsFromRecords } from "./world-pages.js";

export const SETTLED_SCHEMA = "everloot.settled/1";
/** A source's loot settles only past this many loot-api windows (spec section 1, "Drop rates"). */
export const LOOT_SOURCE_MIN_WINDOWS = 200;
/** Items rarer than this do not hold a source's loot open; they keep their interval on the item page. */
export const LOOT_SOURCE_MIN_RATE = 0.03;

const SETTLE_VOTERS = WORLD_AGREEMENT + SETTLE_EXTRA_VOTERS;
const DAY = 86_400_000;

/** The upload row kinds the list covers. */
export const SETTLED_KINDS = ["npc_sighting", "quest", "vendor", "loot", "instance_entrance", "encounter", "object_sighting"] as const;
export type SettledKind = (typeof SETTLED_KINDS)[number];

const deltas = z.array(z.number().int()).max(500_000);
/** Ids, each with the maps (or instances) it is settled on; both delta-encoded. */
const IdMaps = z.object({ ids: deltas, maps: z.array(deltas) }).strict().refine((v) => v.ids.length === v.maps.length, { message: "one map list per id" });
export type IdMaps = z.infer<typeof IdMaps>;

export const SettledList = z.object({
  schema: z.literal(SETTLED_SCHEMA),
  build: z.string().regex(/^\d+(\.\d+)+$/).max(32),
  /** The corpus time the list was made from; null for a build the server has not looked at yet. */
  dataAsOf: z.string().datetime({ offset: true }).nullable(),
  npc_sighting: IdMaps,
  quest: deltas,
  vendor: deltas,
  loot: z.object({ npc: deltas, obj: deltas }).strict(),
  instance_entrance: IdMaps,
  encounter: IdMaps,
  object_sighting: IdMaps,
}).strict();
export type SettledList = z.infer<typeof SettledList>;

const point = z.tuple([z.number(), z.number()]);
const text = z.string().min(1).max(200);
const id = z.number().int().positive();
/** One fact's settled values, by `factKey`. A field absent here was never reported: a row that carries it differs. */
export const SettledValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("npc"), name: text, level: z.number().int().optional(), creatureType: text.optional(), rank: text.optional(), roles: z.array(text), at: point }).strict(),
  z.object({
    kind: z.literal("quest"), title: text, level: z.number().int(), giver: id.optional(), turnIn: id.optional(), rewards: z.array(id),
    category: text.optional(), side: z.enum(["alliance", "horde", "both"]).optional(), group: z.number().int().optional(), tag: text.optional(),
  }).strict(),
  z.object({ kind: z.literal("vendor"), items: z.array(z.tuple([id, z.number().int().nonnegative(), z.number().int().nonnegative()])) }).strict(),
  z.object({ kind: z.literal("loot"), items: z.array(id) }).strict(),
  z.object({ kind: z.literal("entrance"), name: text, instanceType: text, at: point }).strict(),
  z.object({ kind: z.literal("encounter"), name: text, npcs: z.array(id) }).strict(),
  z.object({ kind: z.literal("object"), name: text, at: z.array(point).min(1) }).strict(),
]);
export type SettledValue = z.infer<typeof SettledValue>;

/** What the cron writes to `coverage/settled-<build>.json`: the list and, for the intake, the values behind it. */
export const SettledFile = SettledList.extend({ values: z.record(z.string(), SettledValue) });
export type SettledFile = z.infer<typeof SettledFile>;

export interface SettledInput {
  /** Records after `publicRecords`, so Recorder installs are folded. */
  records: readonly unknown[];
  /** Corpus time (ISO), the time of the last real change. Without it nothing settles. */
  asOf: string | null;
  build: string;
  recheck?: readonly RecheckScope[];
  /** The ISO week the weekly spot check picks with (`isSpotChecked`), `isoWeek(new Date())` from the cron; none without it. */
  week?: string;
}

/** The list for a build nobody has looked at yet: nothing is skipped. */
export function emptySettledList(build: string): SettledList {
  const none = { ids: [], maps: [] };
  return { schema: SETTLED_SCHEMA, build, dataAsOf: null, npc_sighting: none, quest: [], vendor: [], loot: { npc: [], obj: [] }, instance_entrance: none, encounter: none, object_sighting: none };
}

/** Sorted, distinct ids as gaps: [3, 7, 8] becomes [3, 4, 1]. */
export function encodeIds(ids: Iterable<number>): number[] {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  return sorted.map((v, i) => (i === 0 ? v : v - sorted[i - 1]!));
}

export function decodeIds(gaps: readonly number[]): number[] {
  const out: number[] = [];
  for (const gap of gaps) out.push((out.length ? out[out.length - 1]! : 0) + gap);
  return out;
}

function encodeIdMaps(byId: Map<number, Set<number>>): IdMaps {
  const ids = [...byId.keys()].filter((k) => byId.get(k)!.size > 0).sort((a, b) => a - b);
  return { ids: encodeIds(ids), maps: ids.map((k) => encodeIds(byId.get(k)!)) };
}

function decodeIdMaps(v: IdMaps): [number, number[]][] {
  return decodeIds(v.ids).map((k, i) => [k, decodeIds(v.maps[i] ?? [])]);
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const at = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * The fact an upload row belongs to, at the list's grain, or null for a row of another kind or without the ids.
 * The uploaders skip by it and the intake tallies by it.
 */
export function factKey(record: Readonly<Record<string, unknown>>): string | null {
  const r = record;
  switch (r.kind) {
    case "npc_sighting": return num(r.npcId) && at(r.mapId) ? `npc:${r.npcId}@${r.mapId}` : null;
    case "quest": return num(r.questId) ? `quest:${r.questId}` : null;
    case "vendor": return num(r.vendorNpcId) ? `vendor:${r.vendorNpcId}` : null;
    case "loot": return num(r.sourceNpcId) ? `loot:npc:${r.sourceNpcId}` : num(r.sourceObjectId) ? `loot:obj:${r.sourceObjectId}` : null;
    case "instance_entrance": return num(r.instanceMapId) && at(r.mapId) ? `entrance:${r.instanceMapId}@${r.mapId}` : null;
    case "encounter": return num(r.encounterId) && num(r.instanceMapId) ? `encounter:${r.encounterId}@${r.instanceMapId}` : null;
    case "object_sighting": return num(r.objectId) && at(r.mapId) ? `object:${r.objectId}@${r.mapId}` : null;
    default: return null;
  }
}

/** Every fact key in a list. */
export function settledKeys(list: SettledList): Set<string> {
  const keys = new Set<string>();
  const pairs = (prefix: string, v: IdMaps) => { for (const [k, maps] of decodeIdMaps(v)) for (const m of maps) keys.add(`${prefix}:${k}@${m}`); };
  pairs("npc", list.npc_sighting);
  for (const k of decodeIds(list.quest)) keys.add(`quest:${k}`);
  for (const k of decodeIds(list.vendor)) keys.add(`vendor:${k}`);
  for (const k of decodeIds(list.loot.npc)) keys.add(`loot:npc:${k}`);
  for (const k of decodeIds(list.loot.obj)) keys.add(`loot:obj:${k}`);
  pairs("entrance", list.instance_entrance);
  pairs("encounter", list.encounter);
  pairs("object", list.object_sighting);
  return keys;
}

/**
 * The uploaders' filter for one file: true for a row whose fact is settled for the file's build. Undefined (skip
 * nothing) without a list, for a file without a build, or for a list of another build: nothing is skipped until the
 * server has looked at the build being played.
 */
export function settledSkip(list: SettledList | null | undefined, clientBuild: unknown): ((record: Readonly<Record<string, unknown>>) => boolean) | undefined {
  if (!list || typeof clientBuild !== "string" || list.build !== clientBuild) return undefined;
  const keys = settledKeys(list);
  if (!keys.size) return undefined;
  return (record) => { const key = factKey(record); return key !== null && keys.has(key); };
}

export function parseSettledList(raw: unknown): SettledList | null {
  const parsed = SettledList.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseSettledFile(raw: unknown): SettledFile | null {
  const parsed = SettledFile.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The public list alone, without the values. */
export function listOf(file: SettledFile): SettledList {
  const { values: _values, ...list } = file;
  return list;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const near = (x: unknown, y: unknown, p: readonly [number, number], radius: number) =>
  typeof x === "number" && typeof y === "number" && Math.hypot(x - p[0], y - p[1]) <= radius;
/** An optional field: absent on the row agrees; present, it must equal the settled value, which must exist. */
const opt = <T>(row: unknown, settled: T | undefined, eq: (a: T, b: T) => boolean = (a, b) => a === b) =>
  row === undefined || (settled !== undefined && eq(row as T, settled));

/**
 * The fact key when every field of `record` matches its settled value, else null. A row that differs in any field
 * is not a repeat: it is the signal a fact changed, and the intake stores it in full.
 */
export function matchSettled(values: Readonly<Record<string, SettledValue>>, record: Readonly<Record<string, unknown>>): string | null {
  const key = factKey(record);
  const v = key === null ? undefined : values[key];
  if (!key || !v) return null;
  const r = record;
  switch (v.kind) {
    case "npc": {
      if (r.kind !== "npc_sighting" || typeof r.name !== "string" || !same(r.name, v.name)) return null;
      if (!opt(r.level, v.level) || !opt(r.creatureType, v.creatureType) || !opt(r.rank, v.rank)) return null;
      if (r.role !== undefined && !v.roles.includes(String(r.role))) return null;
      // A player position is not the NPC's; only a pin position is held to the pin.
      if (isPinPosition(r.positionKind) && !near(r.x, r.y, v.at, POSITION_TOLERANCE)) return null;
      return key;
    }
    case "quest": {
      if (r.kind !== "quest" || typeof r.title !== "string" || !same(r.title, v.title) || r.level !== v.level) return null;
      if (!opt(r.giverNpcId, v.giver) || !opt(r.turnInNpcId, v.turnIn) || !opt(r.suggestedGroup, v.group) || !opt(r.tag, v.tag)) return null;
      if (!opt(r.category, v.category, same)) return null;
      if (r.faction !== undefined && v.side !== "both" && r.faction !== v.side) return null;
      const rewards = Array.isArray(r.rewardItemIds) ? r.rewardItemIds : [];
      return rewards.every((item) => v.rewards.includes(item as number)) ? key : null;
    }
    case "vendor": {
      if (r.kind !== "vendor" || !Array.isArray(r.items) || !r.items.length) return null;
      const offers = new Map(v.items.map(([item, price, stock]) => [item, { price, stock }]));
      return r.items.every((raw) => {
        const o = raw as { itemId?: unknown; priceCopper?: unknown; limitedStock?: unknown };
        const offer = offers.get(o.itemId as number);
        return offer !== undefined && o.priceCopper === offer.price && (o.limitedStock ?? 0) === offer.stock;
      }) ? key : null;
    }
    case "loot": {
      if (r.kind !== "loot" || !Array.isArray(r.items)) return null;
      return r.items.every((raw) => v.items.includes((raw as { itemId?: unknown }).itemId as number)) ? key : null;
    }
    case "entrance":
      return r.kind === "instance_entrance" && typeof r.name === "string" && same(r.name, v.name) && r.instanceType === v.instanceType
        && near(r.x, r.y, v.at, POSITION_TOLERANCE) ? key : null;
    case "encounter": {
      if (r.kind !== "encounter" || typeof r.name !== "string" || !same(r.name, v.name)) return null;
      const npcs = Array.isArray(r.npcIds) ? r.npcIds : [];
      return npcs.every((n) => v.npcs.includes(n as number)) ? key : null;
    }
    case "object":
      return r.kind === "object_sighting" && typeof r.name === "string" && same(r.name, v.name) && v.at.some((p) => near(r.x, r.y, p, SPAWN_RADIUS)) ? key : null;
  }
}

// --- Computing the list -----------------------------------------------------------------------------------------

function time(value: unknown): number | null {
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function groupBy<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r), list = out.get(k);
    if (list) list.push(r); else out.set(k, [r]);
  }
  return out;
}

const when = (r: { capturedAt?: string }) => (r.capturedAt ? { capturedAt: r.capturedAt } : {});
const capturedOf = (raw: unknown): { capturedAt?: string } => {
  const c = raw && typeof raw === "object" ? (raw as { capturedAt?: unknown }).capturedAt : undefined;
  return typeof c === "string" && time(c) !== null ? { capturedAt: c } : {};
};

/** The settled value of a scalar field, or undefined when the field is not settled (or never reported). */
function settledValue(rows: readonly VoteRow[], asOf: string | null, since: string | null): { value: string | number } | undefined {
  const tally = tallyVotes(rows, { ...(asOf ? { asOf } : {}), ...(since ? { recheckSince: since } : {}) });
  return tally.state === "settled" && tally.winner ? { value: tally.winner.value } : undefined;
}

/**
 * A field of an entity: settled (with its value), never reported (null), or open (undefined). An entity whose
 * every field is settled or unreported is in the list.
 */
function field(rows: readonly VoteRow[], asOf: string | null, since: string | null): { value: string | number } | null | undefined {
  return rows.length ? settledValue(rows, asOf, since) : null;
}

type Placed = { installId: string; x: number; y: number; capturedAt?: string };

/**
 * A settled position's median, or null: the coverage score's position rule (5 installs, every one within `radius` of
 * the median, the third reported at least 14 days before `asOf`), with the same recheck cut-off.
 */
function settledAt(rows: readonly Placed[], asOf: string | null, since: string | null, radius = POSITION_TOLERANCE): [number, number] | null {
  const now = time(asOf);
  if (now === null || !rows.length) return null;
  const stamp = (r: Placed) => { const t = time(r.capturedAt); return t === null ? null : Math.min(t, now); };
  const cut = time(since);
  const installs = (list: readonly Placed[]) => new Set(list.map((r) => r.installId.trim()).filter(Boolean)).size;
  const recheck = cut !== null && installs(rows.filter((r) => { const t = stamp(r); return t !== null && t < cut; })) >= WORLD_AGREEMENT;
  const use = recheck ? rows.filter((r) => { const t = stamp(r); return t !== null && t > cut!; }) : rows;
  const by = new Map<string, { x: number[]; y: number[]; first: number | null }>();
  for (const r of use) {
    const id = r.installId.trim();
    if (!id) continue;
    const e = by.get(id) ?? { x: [], y: [], first: null };
    e.x.push(r.x); e.y.push(r.y);
    const t = stamp(r);
    if (t !== null) e.first = Math.min(e.first ?? t, t);
    by.set(id, e);
  }
  if (by.size < SETTLE_VOTERS) return null;
  const each = [...by.values()].map((e) => ({ x: median(e.x), y: median(e.y), first: e.first }));
  const mx = median(each.map((e) => e.x)), my = median(each.map((e) => e.y));
  if (!each.every((e) => Math.hypot(e.x - mx, e.y - my) <= radius)) return null;
  const third = each.map((e) => e.first).filter((t): t is number => t !== null).sort((a, b) => a - b)[WORLD_AGREEMENT - 1];
  return third !== undefined && third <= now - SETTLE_WINDOW_DAYS * DAY ? [mx, my] : null;
}

/** The latest date of a recheck scope that covers a fact of these types, on these maps, with these ids (recheck-scopes.ts). */
function scopeSince(scopes: readonly RecheckScope[], types: readonly CoverageType[], maps: readonly (number | null)[], refs: readonly number[]): string | null {
  return matchScope(scopes, { types, zones: maps, ids: refs });
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The settled list and its values for one corpus. Pure. */
export function computeSettled(input: SettledInput): SettledFile {
  const asOf = input.asOf && time(input.asOf) !== null ? new Date(time(input.asOf)!).toISOString() : null;
  const scopes = input.recheck ?? [];
  const values: Record<string, SettledValue> = {};
  const npcMaps = new Map<number, Set<number>>(), entranceMaps = new Map<number, Set<number>>();
  const encounterMaps = new Map<number, Set<number>>(), objectMaps = new Map<number, Set<number>>();
  const quests = new Set<number>(), vendors = new Set<number>(), lootNpc = new Set<number>(), lootObj = new Set<number>();
  const add = (map: Map<number, Set<number>>, k: number, m: number) => map.set(k, (map.get(k) ?? new Set<number>()).add(m));
  const list = { schema: SETTLED_SCHEMA, build: input.build, dataAsOf: asOf } as const;
  if (!asOf) return { ...emptySettledList(input.build), values };
  // The weekly spot check (spot-check.ts) leaves about 2% of settled facts out, so uploaders send them again.
  const checked = (key: string, zone: number | null) => input.week !== undefined && isSpotChecked({ key, zone }, input.week, scopes);

  type World = ReturnType<typeof worldFactsFromRecords>;
  const npcs: (World["npcs"][number] & { capturedAt?: string })[] = [];
  const questRows: (World["quests"][number] & { capturedAt?: string })[] = [];
  const vendorRows: (World["vendors"][number] & { capturedAt?: string })[] = [];
  for (const raw of input.records) {
    const one = worldFactsFromRecords([raw]);
    const c = capturedOf(raw);
    for (const r of one.npcs) npcs.push({ ...r, ...c });
    for (const r of one.quests) questRows.push({ ...r, ...c });
    for (const r of one.vendors) vendorRows.push({ ...r, ...c });
  }
  // Where each NPC is counted (the score's rule), for the spot check's zone.
  const npcZone = npcZones(npcs.map((r) => ({ npcId: r.npcId, mapId: r.mapId, installId: r.installId, pin: isPinPosition(r.positionKind) })));

  // NPCs: name and traits settled, then each map whose pin is settled.
  for (const [npcId, rows] of groupBy(npcs.filter((r) => r.installId.trim()), (r) => r.npcId)) {
    const rare = rows.some((r) => r.rank === "rare" || r.rank === "rare_elite");
    // Matched on the zone the score counts the NPC in (the busiest map), not on every map it was seen on.
    const s = scopeSince(scopes, rare ? ["npcs", "rares"] : ["npcs"], [npcZone.get(npcId) ?? null], [npcId]);
    const vote = (k: "name" | "level" | "creatureType" | "rank") => rows.flatMap((r) => (r[k] === undefined ? [] : [{ installId: r.installId, value: r[k]!, ...when(r) }]));
    const name = field(vote("name"), asOf, s), level = field(vote("level"), asOf, s);
    const creatureType = field(vote("creatureType"), asOf, s), rank = field(vote("rank"), asOf, s);
    if (!name || level === undefined || creatureType === undefined || rank === undefined) continue;
    const roles: string[] = [];
    let open = false;
    for (const [role, list] of groupBy(rows.filter((r) => r.positionKind === "interaction" && r.role), (r) => r.role!)) {
      if (settledValue(list.map((r) => ({ installId: r.installId, value: "listed", ...when(r) })), asOf, s)) roles.push(role);
      else open = true;
    }
    if (open || checked(`npc:${npcId}`, npcZone.get(npcId) ?? null)) continue;
    const pins = groupBy(rows.filter((r) => isPinPosition(r.positionKind) && r.x >= 0 && r.x <= 100 && r.y >= 0 && r.y <= 100), (r) => r.mapId);
    for (const [mapId, list] of pins) {
      const pin = settledAt(list, asOf, scopeSince(scopes, rare ? ["pins", "rares"] : ["pins"], [mapId], [npcId]));
      if (!pin || checked(`pin:${npcId}:${mapId}`, mapId)) continue;
      add(npcMaps, npcId, mapId);
      values[`npc:${npcId}@${mapId}`] = {
        kind: "npc", name: String(name.value), ...(level ? { level: Number(level.value) } : {}), ...(creatureType ? { creatureType: String(creatureType.value) } : {}),
        ...(rank ? { rank: String(rank.value) } : {}), roles: roles.sort(), at: [round(pin[0]), round(pin[1])],
      };
    }
  }

  // Where each NPC stands, for a quest's or a vendor's recheck scope by zone.
  const mapsOf = new Map<number, number[]>();
  for (const [npcId, rows] of groupBy(npcs, (r) => r.npcId)) mapsOf.set(npcId, [...new Set(rows.map((r) => r.mapId))]);

  // Quests: every reported field settled.
  for (const [questId, rows] of groupBy(questRows.filter((r) => r.installId.trim()), (r) => r.questId)) {
    const ids = (k: "giverNpcId" | "turnInNpcId") => rows.flatMap((r) => (r[k] === undefined ? [] : [{ installId: r.installId, value: r[k]!, ...when(r) }]));
    const opt = (k: "category" | "tag" | "suggestedGroup") => rows.flatMap((r) => (r[k] === undefined ? [] : [{ installId: r.installId, value: r[k]!, ...when(r) }]));
    const rewardIds = [...new Set(rows.flatMap((r) => r.rewardItemIds.filter((i) => Number.isInteger(i) && i > 0)))];
    const maps = [...ids("giverNpcId"), ...ids("turnInNpcId")].flatMap((v) => mapsOf.get(v.value as number) ?? []);
    const s = scopeSince(scopes, ["quests"], maps, [questId, ...rewardIds]);
    const title = field(rows.map((r) => ({ installId: r.installId, value: r.title, ...when(r) })), asOf, s);
    const level = field(rows.map((r) => ({ installId: r.installId, value: r.level, ...when(r) })), asOf, s);
    const giver = field(ids("giverNpcId"), asOf, s), turnIn = field(ids("turnInNpcId"), asOf, s);
    const category = field(opt("category"), asOf, s), tag = field(opt("tag"), asOf, s), group = field(opt("suggestedGroup"), asOf, s);
    if (!title || !level || [giver, turnIn, category, tag, group].includes(undefined)) continue;
    const rewards = rewardIds.filter((item) => settledValue(rows.filter((r) => r.rewardItemIds.includes(item)).map((r) => ({ installId: r.installId, value: "listed", ...when(r) })), asOf, s));
    if (rewards.length !== rewardIds.length) continue;
    // Side (spec section 1): Alliance or Horde with 5 of that faction and none of the other, Both with 5 of each.
    const a = new Set<string>(), h = new Set<string>();
    for (const r of rows) if (r.faction) (r.faction === "alliance" ? a : h).add(r.installId.trim());
    let side: "alliance" | "horde" | "both" | undefined;
    if (a.size || h.size) {
      side = a.size >= SETTLE_VOTERS && h.size >= SETTLE_VOTERS ? "both" : a.size >= SETTLE_VOTERS && !h.size ? "alliance" : h.size >= SETTLE_VOTERS && !a.size ? "horde" : undefined;
      if (!side) continue;
    }
    const lead = (k: "giverNpcId" | "turnInNpcId") => {
      const id = tallyVotes(ids(k)).groups.sort((x, y) => y.voters.size - x.voters.size)[0]?.value;
      return typeof id === "number" ? npcZone.get(id) ?? null : null;
    };
    if (checked(`quest:${questId}`, lead("giverNpcId") ?? lead("turnInNpcId"))) continue;
    quests.add(questId);
    values[`quest:${questId}`] = {
      kind: "quest", title: String(title.value), level: Number(level.value), ...(giver ? { giver: Number(giver.value) } : {}), ...(turnIn ? { turnIn: Number(turnIn.value) } : {}),
      rewards: rewards.sort((x, y) => x - y), ...(category ? { category: String(category.value) } : {}), ...(side ? { side } : {}),
      ...(group ? { group: Number(group.value) } : {}), ...(tag ? { tag: String(tag.value) } : {}),
    };
  }

  // Vendors: every offer's price and stock settled. Stock 0 stands for "not limited", as the score counts it.
  for (const [vendorNpcId, rows] of groupBy(vendorRows.filter((r) => r.installId.trim() && Number.isInteger(r.itemId) && r.itemId > 0 && Number.isInteger(r.priceCopper) && r.priceCopper >= 0), (r) => r.vendorNpcId)) {
    const items: [number, number, number][] = [];
    let open = false;
    for (const [itemId, offers] of groupBy(rows, (r) => r.itemId)) {
      const s = scopeSince(scopes, ["vendors"], [npcZone.get(vendorNpcId) ?? null], [vendorNpcId, itemId]);
      const price = settledValue(offers.map((r) => ({ installId: r.installId, value: r.priceCopper, ...when(r) })), asOf, s);
      const stock = settledValue(offers.map((r) => ({ installId: r.installId, value: r.limitedStock ?? 0, ...when(r) })), asOf, s);
      if (!price || !stock) { open = true; break; }
      items.push([itemId, Number(price.value), Number(stock.value)]);
    }
    if (open || !items.length || checked(`vendor:${vendorNpcId}`, npcZone.get(vendorNpcId) ?? null)) continue;
    vendors.add(vendorNpcId);
    values[`vendor:${vendorNpcId}`] = { kind: "vendor", items: items.sort((x, y) => x[0] - y[0]) };
  }

  // Loot: a source with enough windows whose every item at 3% or more has a settled rate. Recorder windows, which
  // carry no loot-api source, are not in the rates and never settle a source.
  // A source under a recheck scope counts only the windows after its date, as the public rates do.
  const windows = lootWindowsFromRecords(recheckLootRecords(input.records as unknown[], scopes));
  const windowCount = new Map<string, number>();
  for (const w of windows) {
    const k = w.sourceNpcId !== undefined ? `npc:${w.sourceNpcId}` : `obj:${w.sourceObjectId}`;
    windowCount.set(k, (windowCount.get(k) ?? 0) + 1);
  }
  const objectSeen = new Map<number, Map<number, Set<string>>>();
  for (const r of [...objectSpawnRowsFromRecords(input.records as unknown[]), ...objectSightingRowsFromRecords(input.records as unknown[])]) {
    if (typeof r.mapId !== "number") continue;
    const byMap = objectSeen.get(r.objectId) ?? new Map<number, Set<string>>();
    byMap.set(r.mapId, (byMap.get(r.mapId) ?? new Set<string>()).add(r.installId.trim()));
    objectSeen.set(r.objectId, byMap);
  }
  const objectZone = (id: number) => busiestMap(objectSeen.get(id) ?? new Map());
  const bySource = groupBy(rollupDrops(windows).rates, (r) => (r.sourceNpcId !== undefined ? `npc:${r.sourceNpcId}` : `obj:${r.sourceObjectId}`));
  for (const [source, rates] of bySource) {
    const npc = source.startsWith("npc:");
    const sourceId = Number(source.slice(4));
    if ((windowCount.get(source) ?? 0) < LOOT_SOURCE_MIN_WINDOWS) continue;
    if (!rates.every((r) => r.rate < LOOT_SOURCE_MIN_RATE || (r.public && measureDropRate(r, asOf).settled))) continue;
    if (checked(`loot:${source}`, npc ? npcZone.get(sourceId) ?? null : objectZone(sourceId))) continue;
    (npc ? lootNpc : lootObj).add(sourceId);
    values[`loot:${source}`] = { kind: "loot", items: rates.map((r) => r.itemId).sort((x, y) => x - y) };
  }

  // Dungeon entrances: name and type settled, then each outdoor map whose entrance position is settled.
  const instances = instanceFactsFromRecords(input.records as unknown[]);
  for (const [instanceMapId, rows] of groupBy(instances.entrances, (r) => r.instanceMapId)) {
    const maps = [...new Set(rows.map((r) => r.mapId))];
    const s = scopeSince(scopes, ["entrances"], maps, [instanceMapId]);
    const name = settledValue(rows.map((r) => ({ installId: r.installId, value: r.name, ...when(r) })), asOf, s);
    const type = settledValue(rows.map((r) => ({ installId: r.installId, value: r.instanceType, ...when(r) })), asOf, s);
    if (!name || !type) continue;
    for (const [mapId, list] of groupBy(rows, (r) => r.mapId)) {
      const pin = settledAt(list, asOf, scopeSince(scopes, ["entrances"], [mapId], [instanceMapId]));
      if (!pin) continue;
      add(entranceMaps, instanceMapId, mapId);
      values[`entrance:${instanceMapId}@${mapId}`] = { kind: "entrance", name: String(name.value), instanceType: String(type.value), at: [round(pin[0]), round(pin[1])] };
    }
  }

  // Encounters: listed, name and every boss NPC settled, per instance.
  for (const [, rows] of groupBy(instances.encounters, (r) => `${r.instanceMapId}|${r.encounterId}`)) {
    const { instanceMapId, encounterId } = rows[0]!;
    const npcIds = [...new Set(rows.flatMap((r) => r.npcIds))];
    const s = scopeSince(scopes, ["bosses"], [], [instanceMapId, encounterId, ...npcIds]);
    const listed = (list: typeof rows) => settledValue(list.map((r) => ({ installId: r.installId, value: "listed", ...when(r) })), asOf, s);
    const name = settledValue(rows.map((r) => ({ installId: r.installId, value: r.name, ...when(r) })), asOf, s);
    if (!listed(rows) || !name || !npcIds.every((n) => listed(rows.filter((r) => r.npcIds.includes(n))))) continue;
    add(encounterMaps, encounterId, instanceMapId);
    values[`encounter:${encounterId}@${instanceMapId}`] = { kind: "encounter", name: String(name.value), npcs: npcIds.sort((x, y) => x - y) };
  }

  // Treasures: per object and map, every cluster's position settled and the object's name settled.
  const sightings = objectSightingRowsFromRecords(input.records as unknown[]);
  const spawns = objectSpawns(sightings, [], new Date(asOf));
  const open = new Set(spawns.unconfirmed.map((u) => `${u.objectId}|${u.mapId}`));
  const sightingsOf = groupBy(sightings, (r) => r.objectId);
  for (const [, pins] of groupBy(spawns.pins, (p) => `${p.objectId}|${p.mapId}`)) {
    const { objectId, mapId } = pins[0]!;
    if (open.has(`${objectId}|${mapId}`)) continue;
    const all = sightingsOf.get(objectId) ?? [];
    const s = scopeSince(scopes, ["treasures"], [mapId], [objectId]);
    const name = settledValue(all.flatMap((r) => (r.name === undefined ? [] : [{ installId: r.installId, value: r.name, ...when(r) }])), asOf, s);
    if (!name) continue;
    const centers = pins.map((p) => settledAt(all.filter((r) => r.mapId === mapId && Math.hypot((r.x ?? -99) - p.x, (r.y ?? -99) - p.y) <= SPAWN_RADIUS) as Placed[], asOf, s, SPAWN_RADIUS));
    if (centers.some((c) => c === null)) continue;
    add(objectMaps, objectId, mapId);
    values[`object:${objectId}@${mapId}`] = { kind: "object", name: String(name.value), at: (centers as [number, number][]).map((c) => [round(c[0]), round(c[1])] as [number, number]) };
  }

  return {
    ...list,
    npc_sighting: encodeIdMaps(npcMaps), quest: encodeIds(quests), vendor: encodeIds(vendors), loot: { npc: encodeIds(lootNpc), obj: encodeIds(lootObj) },
    instance_entrance: encodeIdMaps(entranceMaps), encounter: encodeIdMaps(encounterMaps), object_sighting: encodeIdMaps(objectMaps),
    values,
  };
}
