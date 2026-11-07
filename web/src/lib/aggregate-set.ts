import { addonRowsFromRecords, addonTrends, popularAddonsFromRecords, type AddonRollup, type AddonTrend } from "../../../kb/src/addon-rollup";
import { itemFactsFromRecords, recheckLootRecords } from "../../../kb/src/drop-rollup";
import { observedEdges, type Edge } from "../../../kb/src/edges";
import { itemFactRowsFromRecords } from "../../../kb/src/item-facts";
import type { ItemFacts } from "../../../kb/src/item-page";
import { craftedItemsFromRecords } from "../../../kb/src/item-source";
import { instanceFactsFromRecords, type InstanceFacts } from "../../../kb/src/instances";
import { lootTablesFromRecords, type LootTables } from "../../../kb/src/loot-tables";
import { objectSightingRowsFromRecords, type ObjectSpawnRow } from "../../../kb/src/object-spawns";
import { worldFactsFromRecords, type WorldFacts } from "../../../kb/src/world-pages";
import { RECHECK_SCOPES } from "./recheck-scopes";
import { lootWindowsFromRecords, rollupDrops, type RollupResult } from "./rollups";
import type { Corpus } from "./upload-store";

/**
 * Every table the item, NPC, zone, instance, object, loot, edge and addon answers read, worked out from one corpus.
 * The pages read it through rollup-compute.ts; the snapshot cron stores it (aggregate-store.ts) so a page does not
 * replay the whole corpus to get it. This file does no reading or writing of its own, so both share one builder.
 */
export interface AggregateSet {
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
  /**
   * Each listed addon's weekly history, by folder name. Only /addons/popular shows it, so a live build works it out
   * on that page's first read of this corpus, not for every caller of these aggregates. The stored copy holds the
   * value the cron worked out.
   */
  addonTrends: () => Record<string, AddonTrend>;
  edges: Edge[];
  /** The NPC loot and item-source tables, with each source's windows, installs and dates. */
  loot: LootTables;
}

/**
 * Corpus version marker. Uploads, snapshot time and record count all move whenever the
 * store reloads (writes invalidate its cache, reads stamp a fresh time), so a matching
 * key means these aggregates are for this exact corpus. A miss rebuilds all three sets
 * together, so one request warms the other answers.
 */
export function corpusKey(corpus: { uploads: number; records: readonly unknown[]; dataAsOf?: string | null }): string {
  return `${corpus.uploads}|${corpus.dataAsOf ?? ""}|${corpus.records.length}`;
}

/** The value worked out on the first call and kept for the next. */
function once<T>(make: () => T): () => T {
  let value: { v: T } | null = null;
  return () => (value ??= { v: make() }).v;
}

/** The aggregate set of one readable corpus. Pure: the same records give the same set. */
export function buildAggregates(corpus: Pick<Corpus, "uploads" | "records" | "dataAsOf">): AggregateSet {
  const windows = lootWindowsFromRecords(corpus.records);
  // A loot source under a recheck scope counts only the windows after its date; the corpus count stays whole.
  const lootRecords = recheckLootRecords(corpus.records, RECHECK_SCOPES);
  const counted = lootRecords === corpus.records ? windows : lootWindowsFromRecords(lootRecords);
  const items = itemFactsFromRecords(corpus.records, RECHECK_SCOPES);
  const { records } = corpus;
  const asOf = corpus.dataAsOf ?? new Date();
  return {
    key: corpusKey(corpus),
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
    addonTrends: once(() => addonTrends(addonRowsFromRecords(records), asOf)),
    edges: observedEdges(corpus.records, corpus.dataAsOf ?? new Date(), RECHECK_SCOPES),
    loot: lootTablesFromRecords(lootRecords, corpus.dataAsOf ?? null),
  };
}
