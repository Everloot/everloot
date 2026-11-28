import { CoinText } from "@/components/ui/Coins";
import Link from "@/components/Link";
import { DataTable, type Column } from "@/components/ui";
import { uploadStore } from "@/lib/upload-store";
import { crossRealmHref, itemHref, itemRows, money, scanDayText, scansPaused, type MarketRow } from "@/lib/auction-house";
import { formatCopper } from "@kb/market";
import { RealmName } from "./RealmName";
import { ScansPausedNotice } from "./parts";

/**
 * An item's public auction prices for its database page: each house of each realm with its own price, never a
 * blend of houses. It reads this one item from the rollup without building every realm's board. Empty when nothing
 * is public (3 players' scans) or the rollup cannot be read: the page then shows no box at all. `paused` is whether
 * community scans are paused (no scan anywhere for days), which the box then says. Never throws.
 */
export async function loadMarketBox(itemId: number, now: Date = new Date()): Promise<{ rows: MarketRow[]; paused: boolean }> {
  try {
    const { state } = await uploadStore.loadMarket();
    if (!state) return { rows: [], paused: false };
    return { rows: itemRows(state, now, itemId), paused: scansPaused(state, now) };
  } catch {
    return { rows: [], paused: false };
  }
}

/**
 * The small "Auction House" box on an item's database page: market value and minimum per realm and house, the day
 * each was scanned, the scans-paused line when scans are paused, and a link.
 */
export function MarketBox({ itemId, rows, paused }: { itemId: number; rows: MarketRow[]; paused: boolean }) {
  if (!rows.length) return null;
  const columns: Column<MarketRow>[] = [
    { key: "realm", header: "Realm", nowrap: true, cell: (r) => <Link href={itemHref(r.realm, itemId, r.house)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg"><RealmName name={r.realm.name} /></Link> },
    { key: "house", header: "House", nowrap: true, cell: (r) => r.house },
    { key: "market", header: "Market value", numeric: true, cell: (r) => <span className={r.value.market === null ? "text-muted" : undefined}><CoinText text={money(r.value.market)} /></span> },
    { key: "min", header: "Min buyout", numeric: true, cell: (r) => <CoinText text={formatCopper(r.value.min)} /> },
    { key: "day", header: "Scanned", nowrap: true, cell: (r) => <time dateTime={r.value.day}>{scanDayText(r.value.day)}</time> },
  ];
  return (
    <section aria-labelledby="item-auction-house" data-market-box className="mt-6 mb-6 max-w-[584px]">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 id="item-auction-house" className="text-control font-medium text-fg">Auction House</h2>
        <Link href={crossRealmHref(itemId)} className="text-meta text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">All prices</Link>
      </div>
      {paused && <ScansPausedNotice className="mb-2" />}
      <DataTable dense caption="Auction House prices" columns={columns} rows={rows} rowKey={(r) => `${r.realm.key}:${r.house}`}
        meta={(r) => <>{r.house} · <CoinText text={formatCopper(r.value.min)} /> · {scanDayText(r.value.day)}</>} />
    </section>
  );
}
