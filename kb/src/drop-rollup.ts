/**
 * Drop rollup shared by the site and the item_page tool.
 * A rate is public after 3 distinct install reports. These are observed loot
 * windows, not a census of kills or independent people. The legacy `kills`
 * field names the window count for compatibility. Unobserved kills are unknown.
 *
 * A source under a recheck scope counts only the windows captured after the scope's date (`recheckLootRecords`).
 */
import type { RecheckScope } from "./coverage.js";
import { objectSightingRowsFromRecords, objectSpawnRowsFromRecords, type ObjectSpawnRow } from "./object-spawns.js";
import { pendingLootFromRecords, type PendingLoot } from "./pending-loot.js";
import { busiestMap, npcZones, scopeSince } from "./recheck-scopes.js";
import { isPinPosition } from "./world-pages.js";

export const INDEPENDENT_INSTALLS = 3;

export interface LootRow {
  installId: string;
  sourceNpcId?: number;
  sourceObjectId?: number;
  items: Array<{ itemId: number; count: number }>;
}

export interface DropRate {
  sourceNpcId?: number;
  sourceObjectId?: number;
  itemId: number;
  kills: number;
  drops: number;
  rate: number;
  reporters: number;
  public: boolean;
}

/** Kills of one source, and no valid item in any of those windows. */
export interface MeasuredZero {
  sourceNpcId?: number;
  sourceObjectId?: number;
  kills: number;
  reporters: number;
  public: boolean;
}

export interface RollupResult {
  rates: DropRate[];
  measuredZeros: MeasuredZero[];
  rejected: string[];
}

export type ItemNameRow = { installId: string; itemId: number; name: string };
export type NpcPinRow = { installId: string; npcId: number; name: string; mapId: number; x: number; y: number };
/** Object rows that carry a name, for the agreed object names. */
export type ItemFactRows = { rates: DropRate[]; names: ItemNameRow[]; npcs: NpcPinRow[]; objects: ObjectSpawnRow[]; pending: PendingLoot };

/** Frequency among source-attributed observations; missing kills are not inferred. */
export function rollupDrops(windows: LootRow[]): RollupResult {
  const rejected: string[] = [];
  const kills = new Map<string, { n: number; reporters: Set<string> }>();
  const drops = new Map<string, { n: number; reporters: Set<string> }>();
  const sourcesWithDrops = new Set<string>();
  const meta = new Map<string, { sourceNpcId?: number; sourceObjectId?: number; itemId: number }>();

  const sourceKey = (w: LootRow): string | null => {
    if (w.sourceNpcId !== undefined) return `npc:${w.sourceNpcId}`;
    if (w.sourceObjectId !== undefined) return `obj:${w.sourceObjectId}`;
    return null;
  };

  for (const w of windows) {
    const s = sourceKey(w);
    if (!s) {
      rejected.push("loot window without a source is not an attributed observation");
      continue;
    }
    const sourceId = w.sourceNpcId ?? w.sourceObjectId;
    if (!Number.isInteger(sourceId) || sourceId! < 1) {
      rejected.push("implausible source id");
      continue;
    }
    const k = kills.get(s) ?? { n: 0, reporters: new Set<string>() };
    k.n += 1;
    k.reporters.add(w.installId);
    kills.set(s, k);
    const seen = new Set<number>();
    for (const it of w.items) {
      if (!Number.isInteger(it.itemId) || it.itemId < 1 || !Number.isInteger(it.count) || it.count < 1) {
        rejected.push(`implausible item entry: ${JSON.stringify(it)}`);
        continue;
      }
      const key = `${s}|item:${it.itemId}`;
      const d = drops.get(key) ?? { n: 0, reporters: new Set<string>() };
      if (!seen.has(it.itemId)) {
        seen.add(it.itemId);
        d.n += 1;
      }
      d.reporters.add(w.installId);
      drops.set(key, d);
      sourcesWithDrops.add(s);
      const [src, item] = key.split("|");
      const [kind, id] = src.split(":");
      meta.set(key, {
        ...(kind === "npc" ? { sourceNpcId: Number(id) } : { sourceObjectId: Number(id) }),
        itemId: Number(item.split(":")[1]),
      });
    }
  }

  const rates: DropRate[] = [];
  for (const [key, d] of drops) {
    const [src] = key.split("|");
    const k = kills.get(src) ?? { n: 0, reporters: new Set<string>() };
    const reporters = k.reporters.size;
    rates.push({
      ...meta.get(key)!,
      kills: k.n,
      drops: d.n,
      rate: k.n > 0 ? d.n / k.n : 0,
      reporters,
      public: reporters >= INDEPENDENT_INSTALLS,
    });
  }
  rates.sort((a, b) => b.kills - a.kills || b.rate - a.rate);

  const measuredZeros: MeasuredZero[] = [];
  for (const [src, k] of kills) {
    if (sourcesWithDrops.has(src)) continue;
    const [kind, idText] = src.split(":");
    const id = Number(idText);
    measuredZeros.push({
      ...(kind === "npc" ? { sourceNpcId: id } : { sourceObjectId: id }),
      kills: k.n,
      reporters: k.reporters.size,
      public: k.reporters.size >= INDEPENDENT_INSTALLS,
    });
  }
  measuredZeros.sort((a, b) => b.kills - a.kills || (a.sourceNpcId ?? a.sourceObjectId ?? 0) - (b.sourceNpcId ?? b.sourceObjectId ?? 0));
  return { rates, measuredZeros, rejected };
}

/**
 * The windows that make the kill and gathering tables: those with no type (older addons) and the three that
 * open on the source itself. Pick-pocket, skinning, disenchant and container windows wait for their own tables
 * (loot tables spec, section 4), so they never count in a kill's denominator.
 */
export function countsAsKillOrGather(lootType: unknown): boolean {
  return lootType === undefined || lootType === "kill" || lootType === "gather" || lootType === "fishing";
}

export function lootWindowsFromRecords(records: unknown[]): LootRow[] {
  const windows: LootRow[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.kind !== "loot" || row.sourceEvidence !== "loot-api" || typeof row.installId !== "string" || !Array.isArray(row.items)) continue;
    if (!countsAsKillOrGather(row.lootType)) continue;
    windows.push({
      installId: row.installId,
      ...(typeof row.sourceNpcId === "number" ? { sourceNpcId: row.sourceNpcId } : {}),
      ...(typeof row.sourceObjectId === "number" ? { sourceObjectId: row.sourceObjectId } : {}),
      items: (row.items as Array<{ itemId?: unknown; count?: unknown }>)
        .filter((item) => typeof item?.itemId === "number" && typeof item?.count === "number")
        .map((item) => ({ itemId: item.itemId as number, count: item.count as number })),
    });
  }
  return windows;
}

const lootSource = (row: Record<string, unknown>): { key: string; id: number } | null => {
  if (row.kind !== "loot" || row.sourceEvidence !== "loot-api") return null;
  const id = typeof row.sourceNpcId === "number" ? row.sourceNpcId : typeof row.sourceObjectId === "number" ? row.sourceObjectId : null;
  return id === null ? null : { key: typeof row.sourceNpcId === "number" ? `npc:${id}` : `obj:${id}`, id };
};

/**
 * Each loot source a recheck scope covers, with the scope's date (`npc:<id>` or `obj:<id>`). A rate is the windows
 * holding an item over the source's windows, so the cut-off is per source, never per item: a scope that names an item
 * covers every source that dropped it. A source is placed where the coverage score places it: an NPC on the map most
 * installs pinned it on, an object on the map most installs saw it on.
 */
export function lootRecheckSince(records: readonly unknown[], recheck: readonly RecheckScope[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!recheck.length) return out;
  const items = new Map<string, { id: number; npc: boolean; items: Set<number> }>();
  const npcRows: { npcId: number; mapId: number; installId: string; pin: boolean }[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.kind === "npc_sighting" && typeof row.npcId === "number" && typeof row.mapId === "number" && typeof row.installId === "string") {
      npcRows.push({ npcId: row.npcId, mapId: row.mapId, installId: row.installId, pin: isPinPosition(row.positionKind) });
    }
    const source = lootSource(row);
    if (!source) continue;
    const entry = items.get(source.key) ?? { id: source.id, npc: source.key.startsWith("npc:"), items: new Set<number>() };
    if (Array.isArray(row.items)) for (const item of row.items as { itemId?: unknown }[]) if (typeof item?.itemId === "number") entry.items.add(item.itemId);
    items.set(source.key, entry);
  }
  const npcZone = npcZones(npcRows);
  const objectMaps = new Map<number, Map<number, Set<string>>>();
  for (const r of [...objectSpawnRowsFromRecords(records as unknown[]), ...objectSightingRowsFromRecords(records as unknown[])]) {
    if (typeof r.mapId !== "number") continue;
    const maps = objectMaps.get(r.objectId) ?? new Map<number, Set<string>>();
    maps.set(r.mapId, (maps.get(r.mapId) ?? new Set<string>()).add(r.installId.trim()));
    objectMaps.set(r.objectId, maps);
  }
  for (const [key, source] of items) {
    const zone = source.npc ? npcZone.get(source.id) ?? null : busiestMap(objectMaps.get(source.id) ?? new Map());
    const since = scopeSince(recheck, { types: ["drops"], zones: [zone], ids: [source.id, ...source.items] });
    if (since !== null) out.set(key, since);
  }
  return out;
}

/**
 * The records with the drop rates' recheck cut-off applied: a loot-api window of a source under a recheck scope is
 * kept only when it was captured after the scope's date, whether or not the source's rates were public before. Old
 * windows came from a table the patch may have changed, so they would bias the new rate either way; a window without a
 * capture time cannot be placed after the date and is left out. Every other record passes through. Without scopes the
 * same array comes back, so a memo keyed on it still holds.
 */
export function recheckLootRecords(records: unknown[], recheck: readonly RecheckScope[]): unknown[] {
  const since = lootRecheckSince(records, recheck);
  if (!since.size) return records;
  return records.filter((raw) => {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const source = row && lootSource(row);
    const cut = source ? since.get(source.key) : undefined;
    if (cut === undefined) return true;
    const t = typeof row!.capturedAt === "string" ? Date.parse(row!.capturedAt) : NaN;
    return Number.isFinite(t) && t > Date.parse(cut);
  });
}

/**
 * Rates, names, and pins from one upload record list. Same rows the item page renders. `recheck` cuts only the rates
 * (`recheckLootRecords`); names and places from older windows still count.
 */
export function itemFactsFromRecords(records: unknown[], recheck: readonly RecheckScope[] = []): ItemFactRows {
  const names: ItemNameRow[] = [];
  const npcs: NpcPinRow[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.installId !== "string") continue;
    if (row.kind === "item_seen" && typeof row.itemId === "number" && typeof row.name === "string") {
      names.push({ installId: row.installId, itemId: row.itemId, name: row.name });
    }
    if (
      row.kind === "npc_sighting" &&
      isPinPosition(row.positionKind) &&
      typeof row.npcId === "number" &&
      typeof row.name === "string" &&
      typeof row.mapId === "number" &&
      typeof row.x === "number" &&
      typeof row.y === "number"
    ) {
      npcs.push({ installId: row.installId, npcId: row.npcId, name: row.name, mapId: row.mapId, x: row.x, y: row.y });
    }
  }
  // Names from loot windows and from minimap sightings agree together: both are the name the client showed.
  const objects = [...objectSpawnRowsFromRecords(records), ...objectSightingRowsFromRecords(records)].filter((row) => row.name !== undefined);
  // Recorder windows are counted apart and never reach rollupDrops: lootWindowsFromRecords keeps loot-api rows only.
  return { rates: rollupDrops(lootWindowsFromRecords(recheckLootRecords(records, recheck))).rates, names, npcs, objects, pending: pendingLootFromRecords(records) };
}
