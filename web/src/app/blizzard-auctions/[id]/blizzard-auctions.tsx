import { CoinText } from "@/components/ui/Coins";
import { DataTable, type Column } from "@/components/ui";
import type { BlizzardPrice, BlizzardRead } from "@/lib/blizzard-auctions";
import { formatCopper } from "../../../../../kb/src/market";

const UTC = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** "13 Nov 2026, 12:22 UTC". */
export function blizzardTime(iso: string): string {
  return `${UTC.format(new Date(iso))} UTC`;
}

/**
 * The item's prices from Blizzard's API, with the time Blizzard published them. The heading names the oldest
 * snapshot shown, so "as of" holds for every row, and each row shows its own (a house's items and commodities are
 * published apart). A failed read says so, and is not shown as "no data yet". The page it sits on is ad-free.
 */
export function BlizzardAuctions({ read }: { read: BlizzardRead }) {
  if (!read.ok) {
    return (
      <section aria-labelledby="item-blizzard-auctions" data-blizzard-auctions="unread" className="mt-6 mb-6 max-w-[640px]">
        <h2 id="item-blizzard-auctions" className="mb-1 text-control font-medium text-fg">Blizzard auction house data could not be read</h2>
        <p className="text-meta text-fg-2">The stored prices are out of reach right now. Try again in a few minutes.</p>
      </section>
    );
  }
  const { rows } = read;
  if (!rows.length) {
    return (
      <section aria-labelledby="item-blizzard-auctions" data-blizzard-auctions="empty" className="mt-6 mb-6 max-w-[640px]">
        <h2 id="item-blizzard-auctions" className="mb-1 text-control font-medium text-fg">No Blizzard auction house data for this item yet</h2>
        <p className="text-meta text-fg-2">No house listed it in the last snapshots Blizzard published, or none has been read yet.</p>
      </section>
    );
  }
  const asOf = rows.reduce((oldest, r) => (r.snapshotAt < oldest ? r.snapshotAt : oldest), rows[0].snapshotAt);
  const columns: Column<BlizzardPrice>[] = [
    { key: "region", header: "Region", nowrap: true, cell: (r) => r.region.toUpperCase() },
    { key: "house", header: "House", nowrap: true, cell: (r) => `${r.houseName.replace(/ Auction House$/, "")}, house ${r.houseId}` },
    { key: "min", header: "Lowest buyout", numeric: true, cell: (r) => <CoinText text={formatCopper(r.minUnit)} /> },
    { key: "typical", header: "Typical", numeric: true, cell: (r) => <CoinText text={formatCopper(r.typicalUnit)} /> },
    { key: "quantity", header: "Listed", numeric: true, cell: (r) => r.quantity.toLocaleString("en-US") },
    { key: "asOf", header: "As of", nowrap: true, cell: (r) => <time dateTime={r.snapshotAt}>{blizzardTime(r.snapshotAt)}</time> },
  ];
  return (
    <section aria-labelledby="item-blizzard-auctions" data-blizzard-auctions="rows" className="mt-6 mb-6 max-w-[760px]">
      <h2 id="item-blizzard-auctions" className="mb-1 text-control font-medium text-fg">
        Blizzard auction house data, as of <time dateTime={asOf}>{blizzardTime(asOf)}</time>
      </h2>
      <p className="mb-2 text-meta text-fg-2">
        Unit buyout prices on each house when Blizzard last published it: the lowest, and the typical (the median unit
        by quantity). Kept apart from the prices players&apos; scans report.
      </p>
      <DataTable dense caption="Blizzard auction house prices" columns={columns} rows={rows} rowKey={(r) => `${r.region}:${r.houseId}:${r.snapshotAt}`} />
    </section>
  );
}
