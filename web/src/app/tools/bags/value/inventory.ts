import { marketPricesResponse, type AuctionHouse, type MarketPricesResponse } from "@everloot/protocol";
import type { FullPriceRow } from "@kb/market";

export const MAX_INVENTORY_ITEMS = 400;
export const MAX_QUOTE_AGE_DAYS = 2;
const MAX_QUANTITY = 2_147_483_647; // Maximum aggregated count in the addon's export.
const MAX_PASTE_LENGTH = 32_768;
const BATCH_SIZE = 100; // /api/market/prices accepts up to 100 explicit IDs per request.
const HEADER = "EVERLOOT-INVENTORY-1";
export const PRICE_API = "/api/market/prices";

export type ItemCount = { itemId: number; quantity: number };
export type Market = { realm: string; house: AuctionHouse };
export type InventoryPrices = { quotes: Map<number, FullPriceRow>; unavailable: Set<number> };

export function parseInventory(text: string): { ok: true; items: ItemCount[] } | { ok: false; error: string } {
  if (text.length > MAX_PASTE_LENGTH) return { ok: false, error: "The pasted list is too long." };
  const lines = text.split(/\r\n?|\n/);
  const first = lines.findIndex((line) => line.trim());
  const start = first >= 0 && lines[first].trim() === HEADER ? first + 1 : Math.max(first, 0);
  const counts = new Map<number, number>();
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const match = /^([1-9]\d*)[ \t]+([1-9]\d*)$/.exec(line);
    const itemId = Number(match?.[1]);
    const quantity = Number(match?.[2]);
    if (!Number.isSafeInteger(itemId) || !Number.isSafeInteger(quantity)) {
      return { ok: false, error: `Line ${i + 1} needs an item ID and a quantity, both positive whole numbers.` };
    }
    const total = (counts.get(itemId) ?? 0) + quantity;
    if (total > MAX_QUANTITY) return { ok: false, error: `Line ${i + 1} brings item ${itemId} above ${MAX_QUANTITY.toLocaleString("en-US")} units.` };
    counts.set(itemId, total);
    if (counts.size > MAX_INVENTORY_ITEMS) return { ok: false, error: `Enter at most ${MAX_INVENTORY_ITEMS} different item IDs.` };
  }
  if (!counts.size) return { ok: false, error: "Paste or enter at least one item and quantity." };
  return { ok: true, items: [...counts].map(([itemId, quantity]) => ({ itemId, quantity })) };
}

function isFull(row: MarketPricesResponse["items"][number]): row is [...FullPriceRow] {
  return row[7] !== undefined && row[8] !== undefined && row[9] !== undefined;
}

export async function lookupInventoryPrices(items: ItemCount[], market: Market, signal: AbortSignal): Promise<InventoryPrices> {
  const ids = items.map(({ itemId }) => itemId).sort((a, b) => a - b);
  const quotes = new Map<number, FullPriceRow>();
  const unavailable = new Set<number>();
  for (let start = 0; start < ids.length && !signal.aborted; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    const params = new URLSearchParams({ ...market, items: batch.join(","), fields: "full" });
    try {
      const response = await fetch(`${PRICE_API}?${params}`, { signal });
      if (response.status === 429) {
        for (const id of ids.slice(start)) unavailable.add(id);
        break;
      }
      if (!response.ok) throw new Error("Quote request failed.");
      const parsed = marketPricesResponse.safeParse(await response.json());
      if (!parsed.success || parsed.data.realm !== market.realm || parsed.data.house !== market.house || parsed.data.fields.length !== 10) {
        throw new Error("Quote response did not match the requested market or price fields.");
      }
      const selected = new Set(batch);
      for (const row of parsed.data.items) {
        if (selected.has(row[0]) && isFull(row)) quotes.set(row[0], row);
      }
    } catch {
      for (const id of batch) unavailable.add(id);
    }
  }
  return { quotes, unavailable };
}

/** Copper stays exact when multiplying across the full range of prices and quantities. */
export function inventoryMoney(copper: bigint): string {
  const gold = copper / 10_000n;
  const silver = copper / 100n % 100n;
  const coins = copper % 100n;
  return `${gold ? `${gold.toLocaleString("en-US")}g ` : ""}${silver ? `${silver}s ` : ""}${coins}c`;
}
