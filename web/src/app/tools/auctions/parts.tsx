import Link from "next/link";
import type { ReactNode } from "react";
import ItemTip from "@/components/game/ItemTip";
import { Card, Contribute as ContributeCard, DataTable, EmptyState, QUALITY_LABEL, QUALITY_TEXT, qualityOf as qualityToken, type Column, type Quality } from "@/components/ui";
import { SPARK_BOX, itemHref, itemLabel, money, sparkline, type ItemNames, type MarketRow } from "@/lib/auction-house";
import { HISTORY_DAYS, formatCopper, type PublicDay } from "../../../../../kb/src/market";
import type { ItemTip as Tip } from "./art";
import { categoryRow } from "./browse";
import TimeAgo from "./TimeAgo";

/** The quality token for a tooltip's quality name ("Uncommon"); null without a tooltip. */
export function qualityOf(tip: Tip | undefined): Quality | null {
  if (!tip) return null;
  return (Object.keys(QUALITY_LABEL) as Quality[]).find((q) => QUALITY_LABEL[q] === tip.quality) ?? null;
}

/** An item's quality: its tooltip's, else the game files' for an item with a shown name; null for a plain "Item N". */
export function itemQuality(id: number, tip: Tip | undefined, named: boolean): Quality | null {
  const fromTip = qualityOf(tip);
  if (fromTip || !named) return fromTip;
  const q = categoryRow(id)?.[4];
  return q === undefined || q === null || q > 5 ? null : qualityToken(q);
}

/** An item's label in its quality colour, its icon in front and the game tooltip on hover and focus. */
export function ItemLink({ id, href, tip, names }: { id: number; href: string; tip: Tip | undefined; names: ItemNames }) {
  const q = itemQuality(id, tip, names.has(id));
  return (
    <ItemTip tip={tip}>
      <Link href={href} className={`underline-offset-4 hover:underline ${q ? QUALITY_TEXT[q] : "text-accent"}`}>{itemLabel(id, names)}</Link>
    </ItemTip>
  );
}

/** The trend in a results row: the market value over the last two weeks, or nothing under two solid days. */
export function Sparkline({ points, now }: { points: PublicDay[]; now: Date }) {
  const line = sparkline(points, now);
  if (!line) return <span className="text-muted">—</span>;
  return (
    <svg data-sparkline width={SPARK_BOX.width} height={SPARK_BOX.height} viewBox={`0 0 ${SPARK_BOX.width} ${SPARK_BOX.height}`} aria-hidden="true" className="inline-block align-middle text-accent">
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

/** One item on one realm in each auction house: market value, minimum, units and when it was last scanned. */
export function HousePrices({ rows, caption, now }: { rows: MarketRow[]; caption: string; now: Date }) {
  const columns: Column<MarketRow>[] = [
    { key: "house", header: "House", nowrap: true, cell: (r) => r.house },
    { key: "market", header: "Market value", numeric: true, cell: (r) => <span className={r.value.market === null ? "text-muted" : undefined}>{money(r.value.market)}</span> },
    { key: "min", header: "Min buyout", numeric: true, cell: (r) => formatCopper(r.value.min) },
    { key: "units", header: "Units", numeric: true, cell: (r) => r.value.quantity.toLocaleString("en-US") },
    { key: "updated", header: "Updated", numeric: true, cell: (r) => (r.updatedAt !== null ? <TimeAgo at={r.updatedAt} renderedAt={now.getTime()} /> : r.value.day) },
  ];
  return <DataTable dense caption={caption} columns={columns} rows={rows} rowKey={(r) => r.house ?? "all"} />;
}

/** Contributing is the one way a realm gets prices: run a scan, upload it. */
export function Contribute() {
  return (
    <ContributeCard
      id="ah-contribute"
      title={<>Add your realm&apos;s prices</>}
      note="Open the auction house in game and press Everloot scan. The Desktop App uploads the scan when you log out and puts these prices in your item tooltips."
    />
  );
}

/** Facts beside each other under a page title: "Prices updated 4 min ago Â· 3 realms". */
export function Facts({ items }: { items: ReactNode[] }) {
  return (
    <>
      {items.flatMap((item, i) => (i === 0 ? [<span key={i}>{item}</span>] : [<span key={`s${i}`} aria-hidden="true">Â·</span>, <span key={i}>{item}</span>]))}
    </>
  );
}

export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Market value, minimum buyout, historical and units in one card. */
export function PriceFacts({ facts }: { facts: { label: string; value: string; note?: string }[] }) {
  return (
    <Card>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-sm text-muted">{f.label}</dt>
            <dd className={`mt-1 font-mono text-lg tabular-nums [overflow-wrap:anywhere] ${f.value === "unrecorded" ? "text-muted" : "text-fg"}`}>{f.value}</dd>
            {f.note && <dd className="mt-1 text-xs text-muted">{f.note}</dd>}
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Market value per public day across the 60-day window; one thin line, drawn only with two or more days. */
export function PriceChart({ points }: { points: PublicDay[] }) {
  if (points.length < 2) {
    return <p className="text-sm text-muted">The line starts once a second public day is in.</p>;
  }
  const width = 1000, height = 140, pad = 8;
  const days = points.map((p) => Date.parse(`${p.day}T00:00:00Z`) / 86_400_000);
  const last = days[days.length - 1]!;
  const first = last - (HISTORY_DAYS - 1);
  const values = points.map((p) => p.market);
  const low = Math.min(...values), high = Math.max(...values);
  const x = (d: number) => pad + ((d - first) / (HISTORY_DAYS - 1)) * (width - 2 * pad);
  const y = (v: number) => (high === low ? height / 2 : pad + (1 - (v - low) / (high - low)) * (height - 2 * pad));
  const line = points.map((p, i) => `${x(days[i]!).toFixed(1)},${y(p.market).toFixed(1)}`).join(" ");
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-labelledby="ah-chart-title" className="h-36 w-full rounded-card border border-line bg-canvas text-accent">
        <title id="ah-chart-title">{`Market value per public day, last ${HISTORY_DAYS} days: ${formatCopper(low)} to ${formatCopper(high)}`}</title>
        {/* The box stretches to the column, so the line carries no dots that would stretch with it. */}
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex flex-wrap justify-between gap-x-4 text-xs text-muted">
        <span>{points[0]!.day} to {points.at(-1)!.day}</span>
        <span className="font-mono tabular-nums">{formatCopper(low)} to {formatCopper(high)}</span>
      </figcaption>
    </figure>
  );
}

/** One item's price on each realm, each row linking to that realm's page for it. */
export function RealmPrices({ rows, caption, empty }: { rows: MarketRow[]; caption: string; empty: string }) {
  const columns: Column<MarketRow>[] = [
    {
      key: "realm", header: "Realm", nowrap: true,
      cell: (r) => <Link href={itemHref(r.realm, r.value.itemId)} className="text-accent underline-offset-4 hover:underline">{r.realm.name}</Link>,
    },
    { key: "market", header: "Market value", numeric: true, cell: (r) => <span className={r.value.market === null ? "text-muted" : undefined}>{money(r.value.market)}</span> },
    { key: "min", header: "Min buyout", numeric: true, cell: (r) => formatCopper(r.value.min) },
    { key: "historical", header: "Historical", numeric: true, cell: (r) => formatCopper(r.value.historical) },
    { key: "units", header: "Units", numeric: true, cell: (r) => r.value.quantity.toLocaleString("en-US") },
    { key: "reporters", header: "Reporters", numeric: true, cell: (r) => r.value.reporters },
    { key: "day", header: "Day", numeric: true, cell: (r) => r.value.day },
  ];
  return <DataTable caption={caption} columns={columns} rows={rows} rowKey={(r) => r.realm.key} empty={<EmptyState framed={false} message={empty} />} />;
}

/** The public days behind one price, newest first. */
export function DayTable({ points, caption }: { points: PublicDay[]; caption: string }) {
  const columns: Column<PublicDay>[] = [
    { key: "day", header: "Day", numeric: true, cell: (p) => p.day },
    { key: "value", header: "Value", numeric: true, cell: (p) => formatCopper(p.market) },
    { key: "min", header: "Min buyout", numeric: true, cell: (p) => formatCopper(p.min) },
    { key: "units", header: "Units", numeric: true, cell: (p) => `${p.quantity.toLocaleString("en-US")}${p.thin ? " (thin)" : ""}` },
    { key: "reporters", header: "Reporters", numeric: true, cell: (p) => p.reporters },
  ];
  return <DataTable caption={caption} columns={columns} rows={[...points].reverse()} rowKey={(p) => p.day} />;
}
