/**
 * What disenchanting yields, from the disenchants players recorded. The addon records each disenchant as a loot
 * window (`lootType: "disenchant"`) naming the item destroyed (`sourceItemId`). One item is rarely disenchanted by 3
 * installs, so windows pool by the band the game sorts the item into (kb/src/client-disenchant.ts): the same class,
 * quality and item level range draws from one table on the server. The loot tables spec calls this the shared table
 * (docs/design/specs/2026-10-21-loot-tables-design.md, section 4).
 *
 * A band's yields are public once 3 installs disenchanted items in it, the site's rule for every fact. The denominator
 * is the band's disenchants: a material's chance is the windows holding it over them, and its mean is its units over
 * them, so a material that did not come out counts as zero (docs/design/2026-11-05-addon-item-decisions-analysis.md).
 * Never Disenchant Buddy's or any other addon's tables: those are classic numbers, and Forever's bands differ.
 */
import { INDEPENDENT_INSTALLS, isCountedLootEvidence } from "./drop-rollup.js";
import { bandOf, findBand, type ClientDisenchant, type DisenchantBand } from "./client-disenchant.js";

/** `item_seen.quality` as the files' quality id. */
const QUALITY_ID: Record<string, number> = { poor: 0, common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, artifact: 6, heirloom: 7 };

export interface MaterialTally {
  /** Windows that held the material. */
  windows: number;
  /** Units across those windows. */
  units: number;
  /** Windows by the units they held: `count -> windows`. */
  counts: Map<number, number>;
}

/** Disenchants of one band or one item: how many, from how many installs, the first and last day, and what came out. */
export interface DisenchantTally {
  windows: number;
  installs: Set<string>;
  first: string | null;
  last: string | null;
  materials: Map<number, MaterialTally>;
}

export interface DisenchantTables {
  /** By band id. */
  bands: Map<number, DisenchantTally>;
  /** By the item disenchanted. */
  items: Map<number, DisenchantTally>;
  /** Disenchants of items no band places: no level in the files and no player report of one yet. */
  unplaced: number;
  /** Armor and weapons the files give no level, placed by the quality and level most installs reported: item -> band id. */
  playerBands: Map<number, number>;
}

/** Where an item stands: its band, or why it has none. */
export type Placement =
  | { kind: "band"; band: DisenchantBand; from: "files" | "players" }
  | { kind: "no-disenchant" }
  | { kind: "none" };

/** Sorts items into bands: the files' level first, then the quality and level most installs reported (`item_seen`). */
export interface Placer {
  bands: readonly DisenchantBand[];
  place(itemId: number): Placement;
}

const positive = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

function captureDay(at: unknown, until: number): string | null {
  if (typeof at !== "string") return null;
  const t = Date.parse(at);
  if (!Number.isFinite(t) || t > until) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The quality and item level of each item, as most installs reported them in `item_seen`. A tie leaves the item out:
 * one install cannot move a band's windows by reporting another level.
 */
export function reportedLevels(records: readonly unknown[]): Map<number, { quality: number; itemLevel: number }> {
  const votes = new Map<number, Map<string, Set<string>>>();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.kind !== "item_seen" || !positive(row.itemId) || !positive(row.itemLevel) || typeof row.installId !== "string") continue;
    const quality = typeof row.quality === "string" ? QUALITY_ID[row.quality] : undefined;
    if (quality === undefined) continue;
    const byValue = votes.get(row.itemId) ?? new Map<string, Set<string>>();
    const key = `${quality}:${row.itemLevel}`;
    byValue.set(key, (byValue.get(key) ?? new Set<string>()).add(row.installId));
    votes.set(row.itemId, byValue);
  }
  const out = new Map<number, { quality: number; itemLevel: number }>();
  for (const [itemId, byValue] of votes) {
    const ranked = [...byValue].sort((a, b) => b[1].size - a[1].size);
    if (ranked.length > 1 && ranked[0][1].size === ranked[1][1].size) continue;
    const [quality, itemLevel] = ranked[0][0].split(":").map(Number);
    out.set(itemId, { quality, itemLevel });
  }
  return out;
}

/** The items the files give no level, placed by the quality and level installs reported: item -> band id. */
export function playerBands(files: ClientDisenchant, reported: ReadonlyMap<number, { quality: number; itemLevel: number }>): Map<number, number> {
  const bands = files.bands.map(bandOf);
  const out = new Map<number, number>();
  for (const [itemClass, items] of Object.entries(files.unleveled)) {
    for (const itemId of items) {
      const seen = reported.get(itemId);
      const band = seen ? findBand(bands, Number(itemClass), seen.quality, seen.itemLevel) : null;
      if (band) out.set(itemId, band.id);
    }
  }
  return out;
}

/** The placer for one build's file and the items players placed (`playerBands`). */
export function placer(files: ClientDisenchant, players: ReadonlyMap<number, number> = new Map()): Placer {
  const bands = files.bands.map(bandOf);
  const byId = new Map(bands.map((b) => [b.id, b]));
  const inBand = new Map<number, DisenchantBand>();
  for (const [id, items] of Object.entries(files.items)) {
    const band = byId.get(Number(id));
    if (band) for (const itemId of items) inBand.set(itemId, band);
  }
  const blocked = new Set(files.noDisenchant);
  return {
    bands,
    place(itemId) {
      const band = inBand.get(itemId);
      if (band) return { kind: "band", band, from: "files" };
      if (blocked.has(itemId)) return { kind: "no-disenchant" };
      const found = byId.get(players.get(itemId) ?? -1);
      return found ? { kind: "band", band: found, from: "players" } : { kind: "none" };
    },
  };
}

const emptyTally = (): DisenchantTally => ({ windows: 0, installs: new Set(), first: null, last: null, materials: new Map() });

function add(tally: DisenchantTally, installId: string, day: string | null, items: { itemId: number; count: number }[]): void {
  tally.windows += 1;
  tally.installs.add(installId);
  if (day && (tally.first === null || day < tally.first)) tally.first = day;
  if (day && (tally.last === null || day > tally.last)) tally.last = day;
  for (const { itemId, count } of items) {
    const m = tally.materials.get(itemId) ?? { windows: 0, units: 0, counts: new Map<number, number>() };
    m.windows += 1;
    m.units += count;
    m.counts.set(count, (m.counts.get(count) ?? 0) + 1);
    tally.materials.set(itemId, m);
  }
}

/**
 * Every disenchant window the loot API attributed, by band and by item. A window with no install or no item, or
 * from an older addon that named no item, is not counted; a material listed twice in one window counts once, with
 * its units added.
 */
export function disenchantTablesFromRecords(records: readonly unknown[], files: ClientDisenchant, asOf: Date | string | null = null): DisenchantTables {
  const until = asOf === null ? Infinity : new Date(asOf).getTime();
  const players = playerBands(files, reportedLevels(records));
  const sort = placer(files, players);
  const bands = new Map<number, DisenchantTally>();
  const items = new Map<number, DisenchantTally>();
  let unplaced = 0;
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.kind !== "loot" || row.lootType !== "disenchant" || !isCountedLootEvidence(row)) continue;
    const installId = typeof row.installId === "string" ? row.installId.trim() : "";
    if (!installId || !positive(row.sourceItemId) || !Array.isArray(row.items)) continue;
    const merged = new Map<number, number>();
    for (const entry of row.items as { itemId?: unknown; count?: unknown }[]) {
      if (positive(entry?.itemId) && positive(entry?.count)) merged.set(entry.itemId, (merged.get(entry.itemId) ?? 0) + entry.count);
    }
    const out = [...merged].map(([itemId, count]) => ({ itemId, count }));
    const day = captureDay(row.capturedAt, until);
    const item = items.get(row.sourceItemId) ?? emptyTally();
    add(item, installId, day, out);
    items.set(row.sourceItemId, item);
    const placed = sort.place(row.sourceItemId);
    if (placed.kind !== "band") {
      unplaced += 1;
      continue;
    }
    const band = bands.get(placed.band.id) ?? emptyTally();
    add(band, installId, day, out);
    bands.set(placed.band.id, band);
  }
  return { bands, items, unplaced, playerBands: players };
}

/** One material from one band: its chance, its mean per disenchant, and the counts seen. */
export interface YieldRow {
  materialId: number;
  /** Disenchants holding it. */
  withMaterial: number;
  /** The band's disenchants. */
  windows: number;
  chance: number;
  /** Units over all the band's disenchants, zeros included. */
  perDisenchant: number;
  /** Fewest and most units one disenchant gave. */
  min: number;
  max: number;
}

export interface BandYield {
  band: DisenchantBand;
  /** none: no disenchants; short: from fewer than 3 installs; rated: 3 or more, rows public. */
  state: "none" | "short" | "rated";
  windows: number;
  installs: number;
  first: string | null;
  last: string | null;
  rows: YieldRow[];
  missingInstalls: number;
}

/** A band's yields, once 3 installs disenchanted in it; before that, only its counts. */
export function bandYield(tables: DisenchantTables, band: DisenchantBand): BandYield {
  const tally = tables.bands.get(band.id);
  const installs = tally?.installs.size ?? 0;
  const missingInstalls = Math.max(0, INDEPENDENT_INSTALLS - installs);
  const base = { band, windows: tally?.windows ?? 0, installs, first: tally?.first ?? null, last: tally?.last ?? null, missingInstalls };
  if (!tally) return { ...base, state: "none", rows: [] };
  if (missingInstalls > 0) return { ...base, state: "short", rows: [] };
  const rows = [...tally.materials].map(([materialId, m]): YieldRow => {
    const counts = [...m.counts.keys()];
    return {
      materialId, withMaterial: m.windows, windows: tally.windows, chance: m.windows / tally.windows,
      perDisenchant: m.units / tally.windows, min: Math.min(...counts), max: Math.max(...counts),
    };
  }).sort((a, b) => b.chance - a.chance || a.materialId - b.materialId);
  return { ...base, state: "rated", rows };
}

/** Every band with its yields, in the files' order (class, then quality, then level). */
export function allBandYields(tables: DisenchantTables, bands: readonly DisenchantBand[]): BandYield[] {
  return [...bands]
    .sort((a, b) => b.itemClass - a.itemClass || a.quality - b.quality || a.minLevel - b.minLevel)
    .map((b) => bandYield(tables, b));
}

/**
 * What a disenchant is worth on average at the given prices: each material's mean units times its price. A material
 * with no price is listed in `missing` and left out of `value`, which is then a floor, never a guess.
 */
export function expectedValue(rows: readonly YieldRow[], price: (itemId: number) => number | null): { value: number; missing: number[]; complete: boolean } {
  let value = 0;
  const missing: number[] = [];
  for (const r of rows) {
    const p = price(r.materialId);
    if (p === null) missing.push(r.materialId);
    else value += r.perDisenchant * p;
  }
  return { value: Math.round(value), missing, complete: missing.length === 0 };
}

/** The house's cut of a sale: 5% on the faction houses (as the addon's gold-per-hour tracker takes it), 15% on the neutral one. */
export const auctionCut = (house: string | null) => (house === "Neutral" ? 0.15 : 0.05);

const QUALITY_WORD: Record<number, string> = { 2: "Uncommon", 3: "Rare", 4: "Epic" };

/** "Uncommon armor, item level 5 to 15". */
export function bandLabel(band: DisenchantBand): string {
  const what = band.itemClass === 2 ? "weapons" : "armor";
  const range = band.maxLevel >= 99 ? `${band.minLevel} and up` : `${band.minLevel} to ${band.maxLevel}`;
  return `${QUALITY_WORD[band.quality] ?? `Quality ${band.quality}`} ${what}, item level ${range}`;
}

/** "1", "1 to 2". */
export const unitsRange = (r: Pick<YieldRow, "min" | "max">) => (r.min === r.max ? `${r.min}` : `${r.min} to ${r.max}`);
