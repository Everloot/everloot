import type { AuctionHouse, DisenchantResponse } from "@everloot/protocol";
import { allBandYields, auctionCut, bandLabel, expectedValue, placer, type BandYield, type DisenchantTables, type Placer } from "../../../kb/src/disenchant";
import type { MarketRow, RealmBoard } from "./auction-house";
import { CLIENT_DISENCHANT } from "../data/game-data/client-disenchant";
import { loadDisenchantTables } from "./rollup-compute";

/**
 * The disenchant tables the pages, the tool and the API read: every band of the current build with what it yields,
 * and a placer that puts an item in its band (the files' level, else the one players reported). Unreachable storage
 * gives every band with no disenchants and `unreachable: true`, never zero.
 */
export interface DisenchantView {
  tables: DisenchantTables;
  yields: BandYield[];
  placer: Placer;
  dataAsOf: string | null;
  unreachable: boolean;
}

const NO_TABLES = { tables: { bands: new Map(), items: new Map(), unplaced: 0, playerBands: new Map() }, unreachable: true, dataAsOf: null };

/** Never throws: a page that shows disenchants beside other facts keeps its other facts when these cannot be read. */
export async function loadDisenchant(): Promise<DisenchantView> {
  let read: Awaited<ReturnType<typeof loadDisenchantTables>>;
  try {
    read = await loadDisenchantTables();
  } catch {
    read = NO_TABLES;
  }
  const { tables, unreachable, dataAsOf } = read;
  const sort = placer(CLIENT_DISENCHANT, tables.playerBands);
  return { tables, yields: allBandYields(tables, sort.bands), placer: sort, dataAsOf, unreachable };
}

const QUALITY = { 2: "uncommon", 3: "rare", 4: "epic" } as const;

/** The API's bands: every band, materials only where 3 installs disenchanted in it. */
export function disenchantBands(yields: readonly BandYield[]): DisenchantResponse["bands"] {
  return yields.flatMap((y) => {
    const quality = QUALITY[y.band.quality as keyof typeof QUALITY];
    if (!quality) return [];
    return [{
      bandId: y.band.id,
      itemClass: y.band.itemClass === 2 ? "weapon" as const : "armor" as const,
      quality,
      minLevel: y.band.minLevel,
      maxLevel: y.band.maxLevel,
      label: bandLabel(y.band),
      state: y.state,
      windows: y.windows,
      installs: y.installs,
      first: y.first,
      last: y.last,
      missingInstalls: y.missingInstalls,
      materials: y.rows.map((r) => ({ itemId: r.materialId, withMaterial: r.withMaterial, chance: r.chance, perDisenchant: r.perDisenchant, min: r.min, max: r.max })),
    }];
  });
}

export const DISENCHANT_BUILD = CLIENT_DISENCHANT.build.version;

/**
 * A material's price on one house: its market value, else the newest public minimum buyout. Null when the house has
 * no public price for it: unrecorded, never zero.
 */
export function materialPrice(board: Pick<RealmBoard, "byItem"> | null, itemId: number): number | null {
  const row = board?.byItem.get(itemId)?.[0];
  return row ? row.value.market ?? row.value.min : null;
}

/** What one rated band's disenchant is worth on a house: gross, after the house's cut, and the materials with no price. */
export interface BandValue {
  yield: BandYield;
  /** Mean material value per disenchant at the house's prices. A floor when `complete` is false. */
  value: number;
  /** The same after the house's cut, as if every material were sold there. */
  afterCut: number;
  complete: boolean;
  missing: number[];
}

/** Every rated band's value on one house, by band id. */
export function bandValues(yields: readonly BandYield[], board: Pick<RealmBoard, "byItem"> | null, house: AuctionHouse | null): Map<number, BandValue> {
  const out = new Map<number, BandValue>();
  for (const y of yields) {
    if (y.state !== "rated") continue;
    const ev = expectedValue(y.rows, (id) => materialPrice(board, id));
    out.set(y.band.id, { yield: y, value: ev.value, afterCut: Math.round(ev.value * (1 - auctionCut(house))), complete: ev.complete, missing: ev.missing });
  }
  return out;
}

/** An item listed on the house that its band's materials are worth more than: buy it, disenchant it, sell the materials. */
export interface Deal {
  itemId: number;
  row: MarketRow;
  band: BandValue;
  /** Materials after the cut, less the item's minimum buyout. */
  margin: number;
}

/** The most deals one page lists. */
export const DEALS_SHOWN = 40;

/**
 * Items on the board whose band's value after the cut is above their minimum buyout, the widest margin first. Only
 * bands with every material priced count: a floor is not a margin. Materials are never deals of their own.
 */
export function disenchantDeals(board: Pick<RealmBoard, "rows"> | null, values: ReadonlyMap<number, BandValue>, sort: Placer): Deal[] {
  if (!board) return [];
  const deals: Deal[] = [];
  const seen = new Set<number>();
  for (const row of board.rows) {
    const itemId = row.value.itemId;
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    const placed = sort.place(itemId);
    const band = placed.kind === "band" ? values.get(placed.band.id) : undefined;
    if (!band || !band.complete) continue;
    const margin = band.afterCut - row.value.min;
    if (margin > 0) deals.push({ itemId, row, band, margin });
  }
  return deals.sort((a, b) => b.margin - a.margin || a.itemId - b.itemId).slice(0, DEALS_SHOWN);
}

/** One material and the rated bands that give it. */
export interface MaterialRow {
  itemId: number;
  price: number | null;
  sources: { band: BandYield["band"]; chance: number; perDisenchant: number }[];
}

/** Every material a rated band gives, most bands first, each band's chance beside it. */
export function materialRows(yields: readonly BandYield[], board: Pick<RealmBoard, "byItem"> | null): MaterialRow[] {
  const byId = new Map<number, MaterialRow>();
  for (const y of yields) {
    for (const r of y.rows) {
      const row = byId.get(r.materialId) ?? { itemId: r.materialId, price: materialPrice(board, r.materialId), sources: [] };
      row.sources.push({ band: y.band, chance: r.chance, perDisenchant: r.perDisenchant });
      byId.set(r.materialId, row);
    }
  }
  return [...byId.values()].sort((a, b) => b.sources.length - a.sources.length || a.itemId - b.itemId);
}

/** "82%", "<1%". */
export const chanceText = (chance: number) => (chance > 0 && chance < 0.01 ? "<1%" : `${Math.round(chance * 100)}%`);
