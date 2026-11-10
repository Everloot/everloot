import type { AddonRollup, AddonTrend } from "../../../kb/src/addon-rollup";
import { censusFromRows, type CensusView } from "../../../kb/src/census";
import type { Edge } from "../../../kb/src/edges";
import { itemFactProgress, siteItemFacts, type ItemFactProgress, type ItemFactState } from "../../../kb/src/item-facts";
import type { ItemFacts } from "../../../kb/src/item-page";
import type { InstanceFacts } from "../../../kb/src/instances";
import type { LootTables } from "../../../kb/src/loot-tables";
import type { ObjectSpawnRow } from "../../../kb/src/object-spawns";
import type { WorldFacts } from "../../../kb/src/world-pages";
import { buildAggregates, corpusKey, type AggregateSet } from "./aggregate-set";
import { loadStoredAggregates } from "./aggregate-store";
import type { RollupResult } from "./rollups";
import { uploadStore, type CensusRead, type Corpus } from "./upload-store";

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

/**
 * One aggregation set per corpus version, shared by every answer below. Item and NPC
 * answers used to rescan the whole public corpus each (the NPC page scanned it twice:
 * world facts plus the drop rollup). The shared references are read-only: callers
 * filter and find over them, never sort or push in place.
 */
let memoized: AggregateSet | null = null;

/**
 * The aggregates the answers below read. With no `read`, the set the snapshot cron stored (aggregate-store.ts), so a new
 * server instance reads one file instead of downloading and replaying the whole corpus; when there is no stored set
 * yet, or it cannot be read, the same set is worked out from the corpus as before. `read` is a corpus the caller
 * already loaded, so a page that needs the records too reads the store once: that set is always worked out from it.
 */
async function loadAggregates(read?: Corpus): Promise<AggregateSet | null> {
  if (!read) {
    const stored = await loadStoredAggregates();
    if (stored) return stored;
  }
  const corpus = read ?? await uploadStore.loadCorpus();
  if (corpus.unreachable) return null;
  if (memoized === null || memoized.key !== corpusKey(corpus)) memoized = buildAggregates(corpus);
  return memoized;
}

/** Every stored upload, loot windows pulled out, rolled up. */
export async function computeRollups(read?: Corpus): Promise<RollupResult & { stats: CorpusStats }> {
  const agg = await loadAggregates(read);
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
export async function loadItemFacts(read?: Corpus): Promise<ItemFacts & { unreachable: boolean }> {
  const agg = await loadAggregates(read);
  if (!agg) return { rates: [], names: [], npcs: [], unreachable: true };
  return { ...agg.items, unreachable: false };
}

/** NPC, quest, and vendor rows from the same uploads. */
export async function loadWorldFacts(read?: Corpus): Promise<WorldFacts & { unreachable: boolean; dataAsOf?: string | null }> {
  const agg = await loadAggregates(read);
  if (!agg) return { npcs: [], quests: [], vendors: [], unreachable: true, dataAsOf: null };
  return { ...agg.world, unreachable: false, dataAsOf: agg.dataAsOf };
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
  return { ...siteItemFacts(agg.itemFacts.get(itemId), agg.dataAsOf ? new Date(agg.dataAsOf) : new Date()), progress: itemFactProgress(agg.itemFacts.get(itemId)), unreachable: false };
}

/** `loadReportedItemFacts` for every item with an agreed or a disputed line, for the cron's stored item view. */
export async function loadAllReportedItemFacts(read?: Corpus): Promise<{ reported: Map<number, ItemFactState>; unreachable: boolean }> {
  const agg = await loadAggregates(read);
  if (!agg) return { reported: new Map(), unreachable: true };
  const asOf = agg.dataAsOf ? new Date(agg.dataAsOf) : new Date();
  const reported = new Map<number, ItemFactState>();
  for (const [itemId, rows] of agg.itemFacts) {
    const state = siteItemFacts(rows, asOf);
    if (state.shown.length || state.contested.length || state.unconfirmed?.length) reported.set(itemId, state);
  }
  return { reported, unreachable: false };
}

/** Items players have seen a recipe make (3 installs), for the item lists' Source column. */
export async function loadCraftedItems(read?: Corpus): Promise<{ items: Set<number>; unreachable: boolean }> {
  const agg = await loadAggregates(read);
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

/** The leaderboard and each listed addon's weekly history, for /addons/popular only. */
export async function loadAddonLeaderboard(): Promise<AddonRollup & { trends: Record<string, AddonTrend>; unreachable: boolean; dataAsOf: string | null }> {
  const agg = await loadAggregates();
  if (!agg) return { addons: [], reportingInstalls: 0, trends: {}, unreachable: true, dataAsOf: null };
  return { ...agg.addons, trends: agg.addonTrends(), unreachable: false, dataAsOf: agg.dataAsOf };
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
