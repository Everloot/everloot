import { DataTable, type Column } from "@/components/ui";
import { CoinText } from "@/components/ui/Coins";
import type { BlizzardBrowseRead, BlizzardHistoryPrice } from "@/lib/blizzard-auctions";
import { houseLabel, houseOrder } from "@/lib/blizzard-houses";
import { formatCopper } from "../../../../../kb/src/market";
import { blizzardTime } from "./blizzard-auctions";

export function BlizzardHistory({ read }: { read: BlizzardBrowseRead<BlizzardHistoryPrice> }) {
  if (!read.ok) return <section className="mt-6"><h2 className="text-control font-medium text-fg">30-day price history</h2><p role="status">{read.reason === "unavailable" ? "Blizzard auction house history is not available yet." : "Blizzard auction house history could not be read. Try again in a few minutes."}</p></section>;
  const houses = new Map<string, BlizzardHistoryPrice[]>();
  for (const row of [...read.rows].sort((a, b) => a.region.localeCompare(b.region) * -1 || houseOrder(a.houseId) - houseOrder(b.houseId) || b.day.localeCompare(a.day) || a.kind.localeCompare(b.kind))) {
    const key = `${row.region}:${row.houseId}`;
    houses.set(key, [...(houses.get(key) ?? []), row]);
  }
  const columns: Column<BlizzardHistoryPrice>[] = [
    { key: "day", header: "UTC day", cell: (r) => <time dateTime={r.day}>{r.day}</time> },
    { key: "kind", header: "Document", cell: (r) => r.kind === "items" ? "Items" : "Commodities" },
    { key: "min", header: "Min unit price", numeric: true, cell: (r) => <CoinText text={formatCopper(r.minUnit)} /> },
    { key: "typical", header: "Typical unit price", numeric: true, cell: (r) => <CoinText text={formatCopper(r.typicalUnit)} /> },
    { key: "asOf", header: "As of", cell: (r) => <time dateTime={r.snapshotAt}>{blizzardTime(r.snapshotAt)}</time> },
  ];
  return <section className="mt-6">
    <h2 className="text-control font-medium text-fg">30-day price history</h2>
    <p className="mb-3 text-meta text-fg-2">Each UTC day&apos;s newest listing for this item, per house and document. Days without a stored listing are omitted.</p>
    {!houses.size && <p>No Blizzard auction house history for this item yet.</p>}
    {[...houses].map(([key, rows]) => <div key={key} className="mb-4">
      <h3 className="mb-2 text-control text-fg">{rows[0].region.toUpperCase()} · {houseLabel(rows[0].houseId, rows[0].houseName)}</h3>
      <DataTable caption={`${rows[0].region.toUpperCase()} ${houseLabel(rows[0].houseId, rows[0].houseName)} daily unit prices`} columns={columns} rows={rows} rowKey={(r) => `${r.day}:${r.kind}`} />
    </div>)}
  </section>;
}
