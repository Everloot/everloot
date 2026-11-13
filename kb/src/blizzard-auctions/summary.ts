/**
 * Per-item price summaries of one Blizzard auction house snapshot. Raw auctions are never stored, only these.
 *
 * Forever serves a house in two documents (checked 2026-11-13): `/auctions/{house}` lists items, each with a
 * `buyout` for the whole auction and `quantity` 1 in every listing seen; `/auctions/{house}/commodities` lists
 * stackables with a `unit_price`. A listing without a price (bid only) is left out of every number.
 *
 * Per item id (bonus lists and modifiers are not told apart):
 * - minUnit: the lowest unit price listed.
 * - typicalUnit: the quantity-weighted median unit price: units sorted by price, the price of the unit at
 *   position ceil(quantity / 2). A few listings far above or below the rest do not move it.
 * - quantity: units listed; auctions: listings.
 */

export interface PriceRow {
  item_id: number;
  min_unit: number;
  typical_unit: number;
  quantity: number;
  auctions: number;
}

const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** [itemId, unitPrice, quantity] of every priced listing in a house document; malformed listings are skipped. */
export function listings(body: unknown): [number, number, number][] {
  const auctions = (body as { auctions?: unknown } | null)?.auctions;
  if (!Array.isArray(auctions)) return []; // an empty house has no `auctions` key at all
  const out: [number, number, number][] = [];
  for (const a of auctions as { item?: { id?: unknown }; quantity?: unknown; unit_price?: unknown; buyout?: unknown }[]) {
    const id = a?.item?.id;
    const quantity = a?.quantity;
    if (!positiveInt(id) || !positiveInt(quantity)) continue;
    const unit = positiveInt(a.unit_price) ? a.unit_price : positiveInt(a.buyout) ? Math.max(1, Math.round(a.buyout / quantity)) : null;
    if (unit !== null) out.push([id, unit, quantity]);
  }
  return out;
}

/** One summary row per item, sorted by item id. */
export function summarize(...documents: unknown[]): PriceRow[] {
  const byItem = new Map<number, [number, number][]>();
  for (const body of documents)
    for (const [id, unit, quantity] of listings(body)) {
      const list = byItem.get(id);
      if (list) list.push([unit, quantity]);
      else byItem.set(id, [[unit, quantity]]);
    }
  const rows: PriceRow[] = [];
  for (const [itemId, list] of byItem) {
    list.sort((a, b) => a[0] - b[0]);
    const quantity = list.reduce((n, [, q]) => n + q, 0);
    const half = Math.ceil(quantity / 2);
    let seen = 0;
    let typical = list[0][0];
    for (const [unit, q] of list) {
      seen += q;
      if (seen >= half) {
        typical = unit;
        break;
      }
    }
    rows.push({ item_id: itemId, min_unit: list[0][0], typical_unit: typical, quantity, auctions: list.length });
  }
  return rows.sort((a, b) => a.item_id - b.item_id);
}
