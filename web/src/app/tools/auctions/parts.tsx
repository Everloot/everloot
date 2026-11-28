import { CoinText } from "@/components/ui/Coins";
import Link from "@/components/Link";
import type { ReactNode } from "react";
import ItemTip from "@/components/game/ItemTip";
import GameIcon from "@/components/game/GameIcon";
import { AGREEMENT_NEEDED, AgreementMeter, Card, Contribute as ContributeCard, DataTable, EmptyState, QUALITY_LABEL, QUALITY_TEXT, qualityOf as qualityToken, type Column, type Quality } from "@/components/ui";
import { SPARK_BOX, itemHref, itemLabel, percent, realmHref, scanDayText, scansPaused, sparkline, type ItemNames, type MarketRow, type PendingRealm, type RulesetSummary } from "@/lib/auction-house";
import { RULESET_LABEL, isRulesetSlug, type RulesetSlug } from "@/lib/realms";
import { RealmName } from "./RealmName";
import { HISTORY_DAYS, formatCopper, reportersText, type MarketState, type PublicDay } from "@kb/market";
import type { ItemTip as Tip } from "./art";
import { categoryRow } from "./browse";
import ClientCoins from "./ClientCoins";

export { RealmName };

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

/**
 * An item's label in its quality colour, its icon in front and the game tooltip on hover and focus. `icon` is the
 * files' icon for an item they give nothing else for (no tooltip): drawn only beside a shown name, as the item page does.
 */
export function ItemLink({ id, href, tip, icon, names }: { id: number; href: string; tip: Tip | undefined; icon?: string; names: ItemNames }) {
  const q = itemQuality(id, tip, names.has(id));
  const link = <Link prefetch={false} href={href} className={`underline-offset-4 hover:underline ${q ? QUALITY_TEXT[q] : "text-fg"}`}>{itemLabel(id, names)}</Link>;
  if (!tip && icon && names.has(id)) return <span className="inline-flex items-center gap-1.5 align-middle"><GameIcon src={icon} quality={q ?? undefined} />{link}</span>;
  return <ItemTip tip={tip}>{link}</ItemTip>;
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

/** One item on one realm in each auction house: market value, minimum, units and its newest scan day. */
export function HousePrices({ rows, caption, now }: { rows: MarketRow[]; caption: string; now: Date }) {
  const columns: Column<MarketRow>[] = [
    { key: "house", header: "House", nowrap: true, cell: (r) => r.house },
    { key: "market", header: "Market value", numeric: true, cell: (r) => <span className={r.value.market === null ? "text-muted" : undefined}><ClientCoins copper={r.value.market} /></span> },
    { key: "min", header: "Min buyout", numeric: true, cell: (r) => <ClientCoins copper={r.value.min} /> },
    { key: "units", header: "Units", numeric: true, cell: (r) => r.value.quantity.toLocaleString("en-US") },
    { key: "updated", header: "Newest scan", numeric: true, cell: (r) => scanDayText(r.value.day, now) },
  ];
  return <DataTable dense caption={caption} columns={columns} rows={rows} rowKey={(r) => r.house} />;
}

/**
 * One line per ruleset: realms, items priced, the newest scan day and the week's biggest moves, across every house. A
 * ruleset with nothing says why: no realm is mapped to it yet, or its realms have no public prices yet.
 */
export function RulesetSummaryTable({ rows, now, names, href }: { rows: RulesetSummary[]; now: Date; names: ItemNames; href: (r: RulesetSlug) => string }) {
  const link = "text-fg underline decoration-edge underline-offset-4 hover:decoration-fg";
  const columns: Column<RulesetSummary>[] = [
    {
      key: "ruleset", header: "Ruleset", nowrap: true,
      cell: (r) => (isRulesetSlug(r.ruleset) ? <Link href={href(r.ruleset)} className={link}>{RULESET_LABEL[r.ruleset]}</Link> : <span className="text-fg-2">Realms not mapped yet</span>),
    },
    { key: "realms", header: "Realms", numeric: true, cell: (r) => r.realms.toLocaleString("en-US") },
    { key: "items", header: "Items priced", numeric: true, cell: (r) => r.items.toLocaleString("en-US") },
    {
      key: "updated", header: "Newest scan", nowrap: true,
      cell: (r) => (!r.mapped ? <span className="text-muted">Not mapped yet</span>
        : !r.items || r.newestDay === null ? <span className="text-muted">No public prices yet</span>
        : scanDayText(r.newestDay, now)),
    },
    {
      key: "moves", header: "Biggest moves, 7 days",
      cell: (r) => (r.moves.length ? (
        <span className="flex flex-wrap gap-x-3">
          {r.moves.map((m) => (
            <span key={`${m.row.realm.key}:${m.row.value.itemId}`}>
              <Link href={itemHref(m.row.realm, m.row.value.itemId)} className={link}>{itemLabel(m.row.value.itemId, names)}</Link>{" "}
              <span className={m.change > 0 ? "text-accent" : "text-fg"}>{percent(m.change)}</span>
            </span>
          ))}
        </span>
      ) : <span className="text-muted">—</span>),
    },
  ];
  return <DataTable dense caption="Auction House by ruleset, all houses" columns={columns} rows={rows} rowKey={(r) => r.ruleset} />;
}

/**
 * With no scan anywhere for SCANS_PAUSED_DAYS, one line on why and where current prices are. It links Blizzard's prices
 * and never shows them: those pages are ad-free, this one is not.
 */
export function ScansPaused({ state, now, className }: { state: MarketState | null; now: Date; className?: string }) {
  if (!scansPaused(state, now)) return null;
  return (
    <Card className={className}>
      <p className="text-fg-2" role="status">
        Community scans are paused: the game stopped reporting realm names, so the addon holds scans back. Current Blizzard prices are on{" "}
        <a href="/blizzard-auctions" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Blizzard auctions</a>.
      </p>
    </Card>
  );
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

/**
 * Why an item reads "Item N" (lib/items.ts shownItemName, as art.ts auctionNames applies it): no name three
 * installs agree on, none the game files and the Warcraft Wiki agree on, and no tooltip from a scanned item.
 */
export const UNNAMED_REASON = "No agreed name yet: a name shows once three installs report the same one, or when the game files and the Warcraft Wiki agree on one. The prices are real.";

/** The one line under the header of an unnamed item's price page; nothing for a named item. */
export function UnnamedReason({ id, names }: { id: number; names: ItemNames }) {
  if (names.has(id)) return null;
  return <p className="text-cell text-fg-2" data-unnamed-reason>{UNNAMED_REASON}</p>;
}

/** How the counts in PendingRealms are made, in one sentence. */
export const PENDING_RULE = "A player is counted when they scanned the same item there on one day in the last 7 days; installs behind one upload address count once.";

/** Realms with scans but no public price yet, each with how many of the 3 players have scanned there. Counts only. */
export function PendingRealms({ realms, href = realmHref }: { realms: PendingRealm[]; href?: (realm: PendingRealm) => string }) {
  return (
    <section aria-labelledby="ah-pending" className="mt-4">
      <h2 id="ah-pending" className="text-cell font-medium text-fg">Not public yet</h2>
      <p className="mt-1 text-meta text-fg-2">{PENDING_RULE}</p>
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {realms.map((r) => (
          <li key={r.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-cell">
            <span aria-hidden="true"><AgreementMeter count={r.reporters} /></span>
            <Link href={href(r)} className="text-fg hover:underline underline-offset-4"><RealmName name={r.realm} /></Link>
            <span className="text-fg-2">{r.reporters} of {AGREEMENT_NEEDED} players have scanned; prices go public at {AGREEMENT_NEEDED}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Facts beside each other under a page title: "Prices updated 4 min ago · 3 realms". */
export function Facts({ items }: { items: ReactNode[] }) {
  return (
    <>
      {items.flatMap((item, i) => (i === 0 ? [<span key={i}>{item}</span>] : [<span key={`s${i}`} aria-hidden="true">{" · "}</span>, <span key={i}>{item}</span>]))}
    </>
  );
}

export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Market value, minimum buyout, historical and units in one card; `note` is one line under them, what the values rest on. */
export function PriceFacts({ facts, note }: { facts: { label: string; value: ReactNode; note?: string }[]; note?: ReactNode }) {
  return (
    <Card>
      {note && <p className="mb-4 text-meta text-fg-2">{note}</p>}
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

/**
 * Market value per public day in the 60-day window; one thin line, drawn only with two or more days. The axis runs
 * from the first public day to the newest, the two dates under it, so the line spans the box instead of sitting in
 * the last weeks of an empty window.
 */
export function PriceChart({ points }: { points: PublicDay[] }) {
  if (points.length < 2) {
    return <p className="text-sm text-muted">The line starts once a second public day is in.</p>;
  }
  const width = 1000, height = 140, pad = 8;
  const days = points.map((p) => Date.parse(`${p.day}T00:00:00Z`) / 86_400_000);
  const first = days[0]!, span = Math.max(1, days[days.length - 1]! - first);
  const values = points.map((p) => p.market);
  const low = Math.min(...values), high = Math.max(...values);
  const x = (d: number) => pad + ((d - first) / span) * (width - 2 * pad);
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
        <span className="font-mono tabular-nums"><CoinText text={formatCopper(low)} /> to <CoinText text={formatCopper(high)} /></span>
      </figcaption>
    </figure>
  );
}

/** A reporter count; under 3 the day is public because Everloot's own installs scanned it, and the cell says so. */
const reporterCell = (n: number) => (n < AGREEMENT_NEEDED ? reportersText(n) : n);

/** One item's price on each realm, each row linking to that realm's page for it. */
export function RealmPrices({ rows, caption, empty }: { rows: MarketRow[]; caption: string; empty: string }) {
  const columns: Column<MarketRow>[] = [
    {
      key: "realm", header: "Realm", nowrap: true,
      cell: (r) => <Link href={itemHref(r.realm, r.value.itemId)} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg"><RealmName name={r.realm.name} /></Link>,
    },
    { key: "house", header: "House", nowrap: true, cell: (r) => r.house },
    { key: "market", header: "Market value", numeric: true, cell: (r) => <span className={r.value.market === null ? "text-muted" : undefined}><ClientCoins copper={r.value.market} /></span> },
    { key: "min", header: "Min buyout", numeric: true, cell: (r) => <ClientCoins copper={r.value.min} /> },
    { key: "historical", header: "Historical", numeric: true, cell: (r) => <CoinText text={formatCopper(r.value.historical)} /> },
    { key: "units", header: "Units", numeric: true, cell: (r) => r.value.quantity.toLocaleString("en-US") },
    { key: "reporters", header: "Reporters", numeric: true, cell: (r) => reporterCell(r.value.reporters) },
    { key: "day", header: "Day", numeric: true, cell: (r) => r.value.day },
  ];
  return <DataTable caption={caption} columns={columns} rows={rows} rowKey={(r) => `${r.realm.key}:${r.house}`} empty={<EmptyState framed={false} message={empty} />} />;
}

/** The public days behind one price, newest first. */
export function DayTable({ points, caption }: { points: PublicDay[]; caption: string }) {
  const columns: Column<PublicDay>[] = [
    { key: "day", header: "Day", numeric: true, cell: (p) => p.day },
    { key: "value", header: "Value", numeric: true, cell: (p) => <CoinText text={formatCopper(p.market)} /> },
    { key: "min", header: "Min buyout", numeric: true, cell: (p) => <CoinText text={formatCopper(p.min)} /> },
    { key: "units", header: "Units", numeric: true, cell: (p) => `${p.quantity.toLocaleString("en-US")}${p.thin ? " (thin)" : ""}` },
    { key: "reporters", header: "Reporters", numeric: true, cell: (p) => reporterCell(p.reporters) },
  ];
  return <DataTable caption={caption} columns={columns} rows={[...points].reverse()} rowKey={(p) => p.day} />;
}
