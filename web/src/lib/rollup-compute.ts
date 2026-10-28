import { popularAddonsFromRecords, type AddonRollup } from "../../../kb/src/addon-rollup";
import { censusFromRows, type CensusView } from "../../../kb/src/census";
import { itemFactsFromRecords, recheckLootRecords } from "../../../kb/src/drop-rollup";
import { observedEdges, type Edge } from "../../../kb/src/edges";
import { itemFactProgress, itemFactRowsFromRecords, reportedItemFacts, type ItemFactProgress, type ItemFactState } from "../../../kb/src/item-facts";
import type { ItemFacts } from "../../../kb/src/item-page";
import { craftedItemsFromRecords } from "../../../kb/src/item-source";
import { instanceFactsFromRecords, type InstanceFacts } from "../../../kb/src/instances";
import { lootTablesFromRecords, type LootTables } from "../../../kb/src/loot-tables";
import { objectSightingRowsFromRecords, type ObjectSpawnRow } from "../../../kb/src/object-spawns";
import { worldFactsFromRecords, type WorldFacts } from "../../../kb/src/world-pages";
import { RECHECK_SCOPES } from "./recheck-scopes";
import { lootWindowsFromRecords, rollupDrops, type RollupResult } from "./rollups";
import { uploadStore, type CensusRead } from "./upload-store";

export interface CorpusStats {
  uploads: number;
  lootWindows: number;
  records: number;
  /** True when the store could not be read. The numbers beside it are not a count. */
  unreachable: boolean;
  /** When the uploads behind these numbers were current; null when unrecorded. */
  dataAsOf: string | null;
}

const UNREAD: CorpusStats = { uploads: 0, lootWindows: 0, records: 0, unreachable: true, dataAsOf: null };

interface AggregateSet {
  key: string;
  uploads: number;
  records: number;
  windows: number;
  dataAsOf: string | null;
  drops: { rates: RollupResult["rates"]; measuredZeros: RollupResult["measuredZeros"]; rejected: RollupResult["rejected"] };
  items: ItemFacts;
  world: WorldFacts;
  /** Entrances players zoned in from and the encounters inside, and objects seen on the minimap. */
  instances: InstanceFacts;
  sightings: ObjectSpawnRow[];
  /** Item tooltip numbers players reported (`item_fact`), by item id. */
  itemFacts: ReturnType<typeof itemFactRowsFromRecords>;
  /** Items 3 installs saw a recipe make. */
  crafted: Set<number>;
  addons: AddonRollup;
  edges: Edge[];
  /** The NPC loot and item-source tables, with each source's windows, installs and dates. */
  loot: LootTables;
}

/**
 * One aggregation set per corpus version, shared by every answer below. Item and NPC
 * answers used to rescan the whole public corpus each (the NPC page scanned it twice:
 * world facts plus the drop rollup). The shared references are read-only: callers
 * filter and find over them, never sort or push in place.
 */
let memoized: AggregateSet | null = null;

/**
 * Corpus version marker. Uploads, snapshot time and record count all move whenever the
 * store reloads (writes invalidate its cache, reads stamp a fresh time), so a matching
 * key means these aggregates are for this exact corpus. A miss rebuilds all three sets
 * together, so one request warms the other answers.
 */
function corpusKey(corpus: { uploads: number; records: readonly unknown[]; dataAsOf?: string | null }): string {
  return `${corpus.uploads}|${corpus.dataAsOf ?? ""}|${corpus.records.length}`;
}

async function loadAggregates(): Promise<AggregateSet | null> {
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) return null;
  const key = corpusKey(corpus);
  if (memoized === null || memoized.key !== key) {
    const windows = lootWindowsFromRecords(corpus.records);
    // A loot source under a recheck scope counts only the windows after its date; the corpus count stays whole.
    const lootRecords = recheckLootRecords(corpus.records, RECHECK_SCOPES);
    const counted = lootRecords === corpus.records ? windows : lootWindowsFromRecords(lootRecords);
    const items = itemFactsFromRecords(corpus.records, RECHECK_SCOPES);
    memoized = {
      key,
      uploads: corpus.uploads,
      records: corpus.records.length,
      windows: windows.length,
      dataAsOf: corpus.dataAsOf ?? null,
      drops: rollupDrops(counted),
      items,
      // The NPC page reads the pending loot count with the world facts: the same count the item facts hold.
      // The readers count only new reports for a fact under a recheck scope (kb/curated/recheck.json).
      world: { ...worldFactsFromRecords(corpus.records), pending: items.pending, recheck: RECHECK_SCOPES },
      instances: instanceFactsFromRecords(corpus.records),
      sightings: objectSightingRowsFromRecords(corpus.records),
      itemFacts: itemFactRowsFromRecords(corpus.records),
      crafted: craftedItemsFromRecords(corpus.records),
      // Addon rows dated after the corpus was current are ignored, so one forged clock cannot set "last seen".
      addons: popularAddonsFromRecords(corpus.records, corpus.dataAsOf ?? new Date()),
      edges: observedEdges(corpus.records, corpus.dataAsOf ?? new Date(), RECHECK_SCOPES),
      loot: lootTablesFromRecords(lootRecords, corpus.dataAsOf ?? null),
    };
  }
  return memoized;
}

/** Every stored upload, loot windows pulled out, rolled up. */
export async function computeRollups(): Promise<RollupResult & { stats: CorpusStats }> {
  const agg = await loadAggregates();
  if (!agg) return { rates: [], measuredZeros: [], rejected: [], stats: UNREAD };
  return {
    rates: agg.drops.rates,
    measuredZeros: agg.drops.measuredZeros,
    rejected: agg.drops.rejected,
    stats: {
      uploads: agg.uploads,
      lootWindows: agg.windows,
      records: agg.records,
      unreachable: false,
      dataAsOf: agg.dataAsOf,
    },
  };
}

/** Names, pins, and public rates from the same uploads the drop table reads. */
export async function loadItemFacts(): Promise<ItemFacts & { unreachable: boolean }> {
  const agg = await loadAggregates();
  if (!agg) return { rates: [], names: [], npcs: [], unreachable: true };
  return { ...agg.items, unreachable: false };
}

/** NPC, quest, and vendor rows from the same uploads. */
export async function loadWorldFacts(): Promise<WorldFacts & { unreachable: boolean }> {
  const agg = await loadAggregates();
  if (!agg) return { npcs: [], quests: [], vendors: [], unreachable: true };
  return { ...agg.world, unreachable: false };
}

/** Dungeon entrances and encounters players' clients saw, and objects seen on the minimap, each public at 3 installs. */
export async function loadInstanceFacts(): Promise<InstanceFacts & { sightings: ObjectSpawnRow[]; unreachable: boolean; dataAsOf: string | null }> {
  const agg = await loadAggregates();
  if (!agg) return { entrances: [], encounters: [], sightings: [], unreachable: true, dataAsOf: null };
  return { ...agg.instances, sightings: agg.sightings, unreachable: false, dataAsOf: agg.dataAsOf };
}

/** One item's tooltip numbers 3 installs agree on, and the lines they disagree on (kb/src/item-facts.ts). */
export async function loadReportedItemFacts(itemId: number): Promise<ItemFactState & { progress?: ItemFactProgress[]; unreachable: boolean }> {
  const agg = await loadAggregates();
  if (!agg) return { shown: [], contested: [], unreachable: true };
  return { ...reportedItemFacts(agg.itemFacts.get(itemId), agg.dataAsOf ? new Date(agg.dataAsOf) : new Date()), progress: itemFactProgress(agg.itemFacts.get(itemId)), unreachable: false };
}

/** Items players have seen a recipe make (3 installs), for the item lists' Source column. */
export async function loadCraftedItems(): Promise<{ items: Set<number>; unreachable: boolean }> {
  const agg = await loadAggregates();
  return agg ? { items: agg.crafted, unreachable: false } : { items: new Set(), unreachable: true };
}

/** Relations seen in play, each public under the 3-install rule its page uses (kb/src/edges.ts). */
export async function loadObservedEdges(): Promise<{ edges: Edge[]; unreachable: boolean; dataAsOf: string | null }> {
  const agg = await loadAggregates();
  if (!agg) return { edges: [], unreachable: true, dataAsOf: null };
  return { edges: agg.edges, unreachable: false, dataAsOf: agg.dataAsOf };
}

/** Loot windows per source and item, with their installs and dates (kb/src/loot-tables.ts), and the corpus time. */
export async function loadLootTables(): Promise<{ tables: LootTables; unreachable: boolean; dataAsOf: string | null }> {
  const agg = await loadAggregates();
  if (!agg) return { tables: { sources: new Map(), leftOut: 0 }, unreachable: true, dataAsOf: null };
  return { tables: agg.loot, unreachable: false, dataAsOf: agg.dataAsOf };
}

/** The addon leaderboard: only addons three installs report, as counts with no install ids. */
export async function loadPopularAddons(): Promise<AddonRollup & { unreachable: boolean; dataAsOf: string | null }> {
  const agg = await loadAggregates();
  if (!agg) return { addons: [], reportingInstalls: 0, unreachable: true, dataAsOf: null };
  return { ...agg.addons, unreachable: false, dataAsOf: agg.dataAsOf };
}

let censusMemo: { read: CensusRead; view: CensusView } | null = null;

/**
 * The census: aggregate counts under the 10-characters, 3-installs, 3-addresses rule, never a character key,
 * install id or address hash. Rows come from the store's private census read (census rows are not in the
 * corpus); an unreadable store is unavailable, never zero.
 */
export async function loadCensus(): Promise<{ view: CensusView | null; unreachable: boolean; dataAsOf: string | null }> {
  const read = await uploadStore.loadCensus();
  if (read.unreachable) return { view: null, unreachable: true, dataAsOf: null };
  // The store hands back the same read object while its cache holds, so the rollup runs once per read.
  if (censusMemo?.read !== read) censusMemo = { read, view: censusFromRows(read.rows, read.dataAsOf ?? new Date()) };
  return { view: censusMemo.view, unreachable: false, dataAsOf: read.dataAsOf };
}
