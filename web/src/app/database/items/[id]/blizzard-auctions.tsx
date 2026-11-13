import { CoinText } from "@/components/ui/Coins";
import { DataTable, type Column } from "@/components/ui";
import type { BlizzardPrice } from "@/lib/blizzard-auctions";
import { formatCopper } from "../../../../../../kb/src/market";

const UTC = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** "13 Nov 2026, 12:22 UTC". */
export function blizzardTime(iso: string): string {
  return `${UTC.format(new Date(iso))} UTC`;
}

/**
 * The item's prices from Blizzard's API, in their own section beside (never inside) the player-reported Auction House
 * box, with the time Blizzard published them and the credit line its terms ask for. The heading names the oldest
 * snapshot shown, so "as of" holds for every row. Renders nothing without rows. The page that shows it places no ad.
 */
export function BlizzardAuctions({ rows }: { rows: BlizzardPrice[] }) {
  if (!rows.length) return null;
  const asOf = rows.reduce((oldest, r) => (r.snapshotAt < oldest ? r.snapshotAt : oldest), rows[0].snapshotAt);
  const columns: Column<BlizzardPrice>[] = [
    { key: "region", header: "Region", nowrap: true, cell: (r) => r.region.toUpperCase() },
    { key: "house", header: "House", nowrap: true, cell: (r) => `${r.houseName.replace(/ Auction House$/, "")}, house ${r.houseId}` },
    { key: "min", header: "Lowest buyout", numeric: true, cell: (r) => <CoinText text={formatCopper(r.minUnit)} /> },
    { key: "typical", header: "Typical", numeric: true, cell: (r) => <CoinText text={formatCopper(r.typicalUnit)} /> },
    { key: "quantity", header: "Listed", numeric: true, cell: (r) => r.quantity.toLocaleString("en-US") },
  ];
  return (
    <section aria-labelledby="item-blizzard-auctions" data-blizzard-auctions className="mt-6 mb-6 max-w-[584px]">
      <h2 id="item-blizzard-auctions" className="mb-1 text-control font-medium text-fg">
        Blizzard auction house data, as of <time dateTime={asOf}>{blizzardTime(asOf)}</time>
      </h2>
      <p className="mb-2 text-meta text-fg-2">
        Unit buyout prices on each house when Blizzard last published it: the lowest, and the typical (the median unit
        by quantity). Kept apart from the prices players&apos; scans report.
      </p>
      <DataTable dense caption="Blizzard auction house prices" columns={columns} rows={rows} rowKey={(r) => `${r.region}:${r.houseId}`} />
      <p className="mt-2 text-meta text-fg-2">Data from Blizzard Entertainment</p>
    </section>
  );
}
