import Coins, { CoinText } from "@/components/ui/Coins";
import { Card, DataTable, SectionHeading, type Column } from "@/components/ui";
import {
  categoryLabel, change, characterKey,
  type PeriodCategory, type PeriodStats, type Receipt, type ResaleItem, type SaleItem, type SalesSummary,
} from "@/lib/money-ledger";
import { formatCopper } from "../../../../../kb/src/gold-ledger";

/**
 * Each spending category keeps one colour wherever it appears (a colour follows the category, never its rank). The
 * eight are the dark steps of the data-viz reference palette in its validated order, checked against the panel
 * (#15171A): lightness band, chroma, adjacent colour-blind and normal-vision separation and 3:1 contrast all pass.
 * Mail out, the ninth, is the muted ink. Stacks follow LEDGER_SPENDING's order rearranged to the slot order below,
 * so neighbouring segments are neighbouring slots.
 */
export const SPENDING_COLOR: Readonly<Record<string, string>> = {
  auction_spend: "#3987e5", repair: "#d95926", vendor_spend: "#199e70", flight: "#c98500",
  postage: "#d55181", respec: "#008300", barber: "#9085e9", trade_out: "#e66767", mail_out: "#8B8778",
};
const STACK_ORDER = Object.keys(SPENDING_COLOR);
const colorOf = (category: string) => SPENDING_COLOR[category] ?? "#8B8778";
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** A share as the list shows it: a share too small to round to 1% is "<1%", not "0%". */
const share = (part: number, whole: number) => (part > 0 && percent(part, whole) === 0 ? "<1%" : `${percent(part, whole)}%`);
const when = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** "12% more than the 30 days before", in words and neutral ink: more spending is not shown as good or bad. */
function compared(now: number, previous: number | null, days: number): string | null {
  const pct = change(now, previous);
  if (pct === null) return previous === 0 && now > 0 ? `none in the ${days} days before` : null;
  if (pct === 0) return `the same as the ${days} days before`;
  return `${Math.abs(pct)}% ${pct > 0 ? "more" : "less"} than the ${days} days before`;
}

function Swatch({ category }: { category: string }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorOf(category) }} />;
}

/** Spending for the chosen period: the headline numbers, where the gold went, each day's spending and the largest payments. */
export default function SpendingInsights({ stats, largest, who }: { stats: PeriodStats; largest: Receipt[]; who: string }) {
  const range = `${stats.from} to ${stats.to} (UTC), ${who}`;
  const tiles = [
    { label: "Spent", value: <Coins copper={stats.out} />, note: compared(stats.out, stats.previous?.out ?? null, stats.days) },
    { label: "Earned", value: <Coins copper={stats.in} />, note: compared(stats.in, stats.previous?.in ?? null, stats.days) },
    { label: "Net", value: <Coins copper={stats.net} />, note: stats.in > 0 ? `spending used ${percent(stats.out, stats.in)}% of income` : null },
    { label: "Spent per day", value: <Coins copper={stats.outPerDay} />, note: "averaged over days with data" },
  ];
  return (
    <section aria-labelledby="ledger-spending" className="space-y-4">
      <SectionHeading id="ledger-spending" note={range}>Where your gold went</SectionHeading>
      <Card>
        <dl data-spending-tiles className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="min-w-0">
              <dt className="text-sm text-muted">{t.label}</dt>
              <dd className={`mt-1 font-mono text-lg tabular-nums [overflow-wrap:anywhere] ${t.label === "Net" && stats.net < 0 ? "text-danger" : "text-fg"}`}>{t.value}</dd>
              {t.note && <dd className="mt-0.5 text-xs text-fg-2">{t.note}</dd>}
            </div>
          ))}
        </dl>
        {stats.out === 0 ? <p className="mt-6 text-sm text-fg-2">No spending recorded in these days.</p> : (
          <>
            <ShareBar rows={stats.spending} total={stats.out} />
            <CategoryList rows={stats.spending} total={stats.out} days={stats.days} />
          </>
        )}
      </Card>
      {stats.out > 0 && <DailySpending stats={stats} />}
      <Largest rows={largest} days={stats.days} />
    </section>
  );
}

/** One bar, the period's spending split by category, each segment as wide as its share. */
function ShareBar({ rows, total }: { rows: PeriodCategory[]; total: number }) {
  const ordered = [...rows].sort((a, b) => STACK_ORDER.indexOf(a.category) - STACK_ORDER.indexOf(b.category));
  return (
    <div data-share-bar aria-hidden="true" className="mt-6 flex h-3 gap-0.5">
      {ordered.map((r) => (
        <div key={r.category} title={`${categoryLabel(r.category)}: ${formatCopper(r.copper)} (${share(r.copper, total)})`}
          className="min-w-[3px] rounded-sm" style={{ flexGrow: r.copper, flexBasis: 0, backgroundColor: colorOf(r.category) }} />
      ))}
    </div>
  );
}

function CategoryList({ rows, total, days }: { rows: PeriodCategory[]; total: number; days: number }) {
  return (
    <ul data-spending-categories className="mt-4 divide-y divide-line">
      {rows.map((r) => {
        const note = compared(r.copper, r.previous, days);
        return (
          <li key={r.category} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-fg"><Swatch category={r.category} />{categoryLabel(r.category)}</span>
            <span className="font-mono text-sm tabular-nums text-fg"><Coins copper={r.copper} /></span>
            <span className="w-12 text-right font-mono text-sm tabular-nums text-fg-2">{share(r.copper, total)}</span>
            {note && <span className="basis-full pl-[18px] text-xs text-muted">{note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const CHART_PX = 128;
const GAP_PX = 2;

/**
 * Each segment's height in a column of `column` pixels, bottom first, so the stack never grows past the column: the
 * 2px gaps between segments are kept only when every segment still gets at least a pixel, and the heights share
 * what is left in proportion to the copper. `gap` is the space above a segment (none above the top one).
 */
export function stack(parts: { category: string; copper: number }[], column: number): { category: string; px: number; gap: number }[] {
  const total = parts.reduce((n, p) => n + p.copper, 0);
  if (!parts.length || total <= 0 || column <= 0) return [];
  const gap = column - GAP_PX * (parts.length - 1) >= parts.length ? GAP_PX : 0;
  const room = column - gap * (parts.length - 1);
  return parts.map((p, i) => ({ category: p.category, px: (room * p.copper) / total, gap: i === parts.length - 1 ? 0 : gap }));
}

/** Each day's spending as a stacked column, one colour per category, with a legend naming the colours. */
function DailySpending({ stats }: { stats: PeriodStats }) {
  const high = Math.max(1, ...stats.river.map((d) => d.out));
  const present = STACK_ORDER.filter((c) => stats.spending.some((r) => r.category === c));
  const other = stats.spending.filter((r) => !STACK_ORDER.includes(r.category)).map((r) => r.category);
  const legend = [...present, ...other];
  return (
    <Card as="section" aria-labelledby="ledger-daily-spending">
      <SectionHeading id="ledger-daily-spending" note="Spending per UTC day, by category.">Daily spending</SectionHeading>
      <ul aria-label="Categories" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
        {legend.map((c) => <li key={c} className="flex items-center gap-1.5"><Swatch category={c} />{categoryLabel(c)}</li>)}
      </ul>
      <ol data-daily-spending className="flex items-end justify-between gap-px border-b border-line" style={{ height: CHART_PX }}>
        {stats.river.map((d) => {
          const parts = legend.filter((c) => d.byCategory[c]).map((c) => ({ category: c, copper: d.byCategory[c]! }));
          const label = `${d.date}: spent ${formatCopper(d.out)}`;
          const detail = parts.map((p) => `${categoryLabel(p.category)} ${formatCopper(p.copper)}`).join(", ");
          const column = d.out ? Math.max(2, Math.round((d.out / high) * CHART_PX)) : 0;
          return (
            <li key={d.date} className="flex h-full min-w-0 max-w-16 flex-1 flex-col-reverse" title={detail ? `${label} (${detail})` : label}>
              <span className="sr-only">{detail ? `${label}. ${detail}.` : label}</span>
              <div aria-hidden="true" className="flex flex-col-reverse" style={{ height: column }}>
                {stack(parts, column).map((p, i) => (
                  <div key={p.category} className={`w-full shrink-0 ${i === parts.length - 1 ? "rounded-t-sm" : ""}`}
                    style={{ height: p.px, marginTop: p.gap, backgroundColor: colorOf(p.category) }} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-xs text-muted">
        <span>{stats.from}</span>
        <span>Tallest day <CoinText text={formatCopper(high)} /></span>
        <span>{stats.to}</span>
      </p>
    </Card>
  );
}

function Largest({ rows, days }: { rows: Receipt[]; days: number }) {
  const columns: Column<Receipt>[] = [
    { key: "at", header: "When", nowrap: true, cell: (r) => when(r.at) },
    { key: "character", header: "Character", nowrap: true, cell: (r) => r.character },
    { key: "category", header: "What", cell: (r) => <span className="inline-flex items-center gap-2"><Swatch category={r.category} />{categoryLabel(r.category)}{r.itemName && <span className="text-fg-2">, {r.itemName}</span>}</span> },
    { key: "copper", header: "Amount", numeric: true, cell: (r) => <CoinText text={formatCopper(r.copper)} /> },
  ];
  return (
    <section aria-labelledby="ledger-largest">
      <SectionHeading id="ledger-largest" note={`The largest single payments in the last ${days} days.`}>Largest expenses</SectionHeading>
      <DataTable caption="Largest payments, largest first" columns={columns} rows={rows}
        rowKey={(r) => `${r.at}-${characterKey(r)}-${r.category}-${r.copper}`}
        empty={<p className="px-4 py-6 text-sm text-fg-2">No spending recorded in these days.</p>} />
    </section>
  );
}

/** The ledger's auction sales: what came in after the house cut, what the house kept, and the best sellers. */
export function AuctionSales({ sales, who }: { sales: SalesSummary; who: string }) {
  if (sales.sales === 0 && sales.pending === 0) return null;
  const gross = sales.total + sales.cut;
  const facts = [
    { label: "Received", value: <Coins copper={sales.total} /> },
    { label: "House cut", value: <><Coins copper={sales.cut} />{gross > 0 && <span className="text-fg-2"> ({percent(sales.cut, gross)}%)</span>}</> },
    { label: "Sold", value: `${sales.units.toLocaleString("en-US")} in ${sales.sales.toLocaleString("en-US")} ${sales.sales === 1 ? "sale" : "sales"}` },
  ];
  const columns: Column<SaleItem>[] = [
    { key: "item", header: "Item", cell: (r) => r.itemName },
    { key: "units", header: "Sold", numeric: true, cell: (r) => r.units.toLocaleString("en-US") },
    { key: "each", header: "Each, after cut", numeric: true, cell: (r) => <CoinText text={formatCopper(Math.floor(r.total / r.units))} /> },
    { key: "total", header: "Received", numeric: true, cell: (r) => <CoinText text={formatCopper(r.total)} /> },
    { key: "cut", header: "House cut", numeric: true, cell: (r) => <CoinText text={formatCopper(r.cut)} /> },
  ];
  return (
    <section aria-labelledby="ledger-sales" className="space-y-4">
      <SectionHeading id="ledger-sales" note={`Auction sales whose letter was taken, the last 90 days, ${who}.`}>Auction sales</SectionHeading>
      <Card>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-sm text-muted">{f.label}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-fg [overflow-wrap:anywhere]">{f.value}</dd>
            </div>
          ))}
        </dl>
        {sales.pending > 0 && (
          <p className="mt-3 text-sm text-fg-2">
            {sales.pending} {sales.pending === 1 ? "sale is" : "sales are"} waiting in the mailbox: sold in the last 48 hours, letter not taken yet.
          </p>
        )}
      </Card>
      {sales.items.length > 0 && (
        <DataTable caption="Best sellers by gold received" columns={columns} rows={sales.items} rowKey={(r) => r.itemName} />
      )}
      {sales.resale.length > 0 && <Resale rows={sales.resale} />}
    </section>
  );
}

const each = (copper: number, units: number) => <CoinText text={formatCopper(Math.floor(copper / units))} />;

/** Items bought and sold at the auction house: what each unit cost, what it brought after the cut, and the difference. */
function Resale({ rows }: { rows: ResaleItem[] }) {
  const columns: Column<ResaleItem>[] = [
    { key: "item", header: "Item", cell: (r) => r.itemName },
    { key: "bought", header: "Bought", numeric: true, cell: (r) => <>{r.bought.toLocaleString("en-US")} <span className="text-fg-2">at</span> {each(r.paid, r.bought)}</> },
    { key: "sold", header: "Sold, after cut", numeric: true, cell: (r) => <>{r.sold.toLocaleString("en-US")} <span className="text-fg-2">at</span> {each(r.received, r.sold)}</> },
    { key: "margin", header: "Margin each", numeric: true, cell: (r) => <Coins copper={r.margin} /> },
    { key: "profit", header: "Profit", numeric: true, cell: (r) => <span className={r.profit < 0 ? "text-danger" : undefined}><Coins copper={r.profit} /></span> },
  ];
  return (
    <section aria-labelledby="ledger-resale" className="space-y-2">
      <SectionHeading id="ledger-resale" note="Items you both bought and sold at the auction house in these 90 days. Profit counts only units bought and sold: the average received after the cut minus the average paid, times the smaller count.">Resale</SectionHeading>
      <DataTable caption="Resale by item, largest profit first" columns={columns} rows={rows} rowKey={(r) => r.itemName} />
    </section>
  );
}
