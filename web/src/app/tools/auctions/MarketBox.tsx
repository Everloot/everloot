import Link from "next/link";
import { DataTable, type Column } from "@/components/ui";
import { uploadStore } from "@/lib/upload-store";
import { crossRealmHref, itemAcrossRealms, itemByHouse, itemHref, money, realmBoards, type MarketRow } from "@/lib/auction-house";
import { formatCopper } from "../../../../../kb/src/market";

/**
 * An item's public auction prices for its database page: each realm's blend, then each of that realm's houses
 * with its own price. Empty when nothing is public (3 players' scans) or the rollup cannot be read: the page then
 * shows no box at all. Never throws.
 */
export async function loadMarketBox(itemId: number, now: Date = new Date()): Promise<MarketRow[]> {
  try {
    const { state } = await uploadStore.loadMarket();
    if (!state) return [];
    return itemAcrossRealms(realmBoards(state, now), itemId).flatMap((r) => [r, ...itemByHouse(state, now, r.realm.slug, itemId)]);
  } catch {
    return [];
  }
}

/** The small "Auction House" box on an item's database page: market value and minimum per realm and house, and a link. */
export function MarketBox({ itemId, rows }: { itemId: number; rows: MarketRow[] }) {
  if (!rows.length) return null;
  const columns: Column<MarketRow>[] = [
    { key: "realm", header: "Realm", nowrap: true, cell: (r) => <Link href={itemHref(r.realm, itemId)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">{r.realm.name}</Link> },
    { key: "house", header: "House", nowrap: true, cell: (r) => r.house ?? "All" },
    { key: "market", header: "Market value", numeric: true, cell: (r) => <span className={r.value.market === null ? "text-muted" : undefined}>{money(r.value.market)}</span> },
    { key: "min", header: "Min buyout", numeric: true, cell: (r) => formatCopper(r.value.min) },
  ];
  return (
    <section aria-labelledby="item-auction-house" data-market-box className="mb-6 max-w-[584px]">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 id="item-auction-house" className="text-control font-medium text-fg">Auction House</h2>
        <Link href={crossRealmHref(itemId)} className="text-meta text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">All prices</Link>
      </div>
      <DataTable dense caption="Auction House prices" columns={columns} rows={rows} rowKey={(r) => `${r.realm.key}:${r.house ?? "all"}`} />
    </section>
  );
}
