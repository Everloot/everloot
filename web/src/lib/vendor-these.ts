import type { AuctionHouse } from "@everloot/protocol";
import { auctionCut } from "../../../kb/src/disenchant";
import type { MarketRow } from "./auction-house";
import { STALE_DAYS } from "./chat/market-question";

/**
 * Items a vendor pays more for than one auction house does after its cut: the addon's Sell tab check
 * (addon/modules/sellcheck.lua) as a list. An item is on it when the house's market value less the cut, rounded
 * down as the addon does, is at or below the vendor's sell price. Only a current market counts: one with a market
 * value, whose newest public day is not thin (kb/src/market.ts THIN_UNITS) nor older than STALE_DAYS. An item
 * with no vendor price, or none known, is left out.
 */
export interface VendorRow {
  itemId: number;
  row: MarketRow;
  /** The vendor's sell price per unit, in copper. */
  vendor: number;
  /** The house's market value per unit. */
  market: number;
  /** The market value less the house's cut, rounded down. */
  afterCut: number;
  /** How much more the vendor pays per unit. */
  more: number;
}

/** The most rows the list shows. */
export const VENDOR_SHOWN = 40;

/** The market value of a row when it is current, else null. */
const currentMarket = (row: MarketRow) =>
  row.value.market !== null && !row.value.thin && row.value.ageDays <= STALE_DAYS ? row.value.market : null;

/** The house's rows whose market a lookup of sell prices could be compared with: the ids to read sell prices for. */
export const vendorCandidates = (rows: readonly MarketRow[]) => rows.filter((r) => currentMarket(r) !== null).map((r) => r.value.itemId);

/** The house's items a vendor pays more for, the biggest difference per unit first. */
export function vendorThese(rows: readonly MarketRow[], house: AuctionHouse, sellPrice: (itemId: number) => number | undefined): VendorRow[] {
  const cut = auctionCut(house);
  const out: VendorRow[] = [];
  for (const row of rows) {
    const market = currentMarket(row);
    const vendor = sellPrice(row.value.itemId);
    if (market === null || !vendor || vendor <= 0) continue;
    const afterCut = Math.floor(market * (1 - cut));
    if (afterCut <= vendor) out.push({ itemId: row.value.itemId, row, vendor, market, afterCut, more: vendor - afterCut });
  }
  return out.sort((a, b) => b.more - a.more || a.itemId - b.itemId);
}
