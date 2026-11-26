import { dropTierLabel } from "@kb/drop-rollup";
import type { ReactNode } from "react";
import Link from "next/link";
import { DataTable, ResultStrip, type Column, type SortDirection } from "@/components/ui";
import { datedPhrase, METHOD_LINE, missingLine, shortLine, spanPhrase, type ItemDropSources, type LootTableRow, type NpcLootTable } from "@kb/loot-tables";
import { DROP_SETTLE_MIN_WINDOWS, measureDropRate } from "@kb/drop-rate-settling";
import { EMPTY, EmptyTab, FREQUENCY, LINK, percent } from "./entity";

/**
 * The NPC loot table and the item-source table (docs/design/specs/2026-10-21-loot-tables-design.md, section 9):
 * every number with its denominator, dates and agreement tier, from one reporter upward.
 */

const NOTE = "py-2 text-meta text-fg-2";

/** Descriptive 95% Wilson range of the recorded windows, not a kill probability. */
export function rateWithRange(withItem: number, windows: number, installs: number): string {
  const { rate, interval } = measureDropRate({ drops: withItem, kills: windows, reporters: installs }, "");
  if (rate === null || interval === null) return "Not recorded";
  return `${percent(rate)} (${percent(interval.lower)}–${percent(interval.upper)})${windows < DROP_SETTLE_MIN_WINDOWS ? " · few windows" : ""}`;
}


/** The method and the corpus time, under a table. */
function Method({ dataAsOf, lead, ranges = true }: { dataAsOf: string | null; lead?: string; ranges?: boolean }) {
  const asOf = dataAsOf ? ` Data as of ${dataAsOf.slice(0, 10)}.` : "";
  return <p className={NOTE}>{lead ? `${lead}. ` : ""}{METHOD_LINE}{ranges ? " Ranges describe the recorded sample (95% Wilson); windows may not be independent." : ""}{asOf}</p>;
}

/** Rows on one page of a loot table; a longer table pages (`?drops=2`) or shows whole (`?drops=all`). */
export const LOOT_PER_PAGE = 25;

/** Which page of a loot table the address asks for: a page number, "all", or the first page for anything else. */
export function lootPage(raw: unknown): number | "all" {
  if (raw === "all") return "all";
  return typeof raw === "string" && /^[1-9]\d{0,3}$/.test(raw) ? Number(raw) : 1;
}

/** The page of a loot table the address names, and the address of each page. */
export type LootPages = { page: number | "all"; href: (page: number | "all") => string };

/**
 * The rows one page shows (every row without `pages`, on the "all" page, or when they fit on one page) and the strip
 * under the table: the count, the rows shown, the pager and "Show all N"; on the all page, the way back to pages.
 */
function lootRows<T>(rows: T[], noun: [one: string, many: string], label: string, pages?: LootPages): { shown: T[]; strip: ReactNode } {
  if (!pages || rows.length <= LOOT_PER_PAGE) return { shown: rows, strip: null };
  const total = rows.length.toLocaleString("en-US");
  if (pages.page === "all") {
    return {
      shown: rows,
      strip: <p className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-meta text-muted">
        <span className="tabular-nums"><span className="text-fg-2">{total}</span> {noun[1]}</span>
        <Link href={pages.href(1)} rel="nofollow" className={LINK}>Show {LOOT_PER_PAGE} per page</Link>
      </p>,
    };
  }
  const page = Math.min(pages.page, Math.ceil(rows.length / LOOT_PER_PAGE));
  return {
    shown: rows.slice((page - 1) * LOOT_PER_PAGE, page * LOOT_PER_PAGE),
    strip: <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-meta">
      <div className="min-w-0 flex-1"><ResultStrip total={rows.length} noun={noun[1]} page={page} perPage={LOOT_PER_PAGE} href={pages.href} label={label} nofollow /></div>
      <Link href={pages.href("all")} rel="nofollow" className={LINK}>Show all {total}</Link>
    </div>,
  };
}

/** The sortable columns of the NPC loot table, for a page that sorts its rows (`sort`, `sortHref`). */
export const NPC_LOOT_SORTS = ["item", "with", "rate"] as const;

/** The Drops tab of an NPC page; with `sortHref` the item, count and rate headers sort the rows the caller sorted. */
export function NpcLootPanel({ table, title, item, dataAsOf, sort, sortHref, pages }: {
  table: NpcLootTable; title: string; item: (itemId: number) => ReactNode; dataAsOf: string | null;
  sort?: { key: string; direction: SortDirection }; sortHref?: (key: string, direction: SortDirection) => string;
  /** Pages a table longer than LOOT_PER_PAGE rows; without it every row shows. */
  pages?: LootPages;
}) {
  if (table.state === "none") return <EmptyTab message={EMPTY.drops("this NPC")} />;
  if (table.state === "short") return <p className="py-3 text-meta text-fg">{missingLine(table)}</p>;
  if (table.rows.length === 0) {
    return <>
      <p className="py-3 text-meta text-fg">No items observed in {spanPhrase(table.span)} · {dropTierLabel(table.span.installs)}.</p>
      <Method dataAsOf={dataAsOf} ranges={false} />
    </>;
  }
  const columns: Column<LootTableRow>[] = [
    { key: "item", header: "Item", sortable: true, cell: (r) => item(r.itemId) },
    { key: "with", header: "Windows with it", numeric: true, sortable: true, cell: (r) => r.withItem },
    { key: "windows", header: "Out of", numeric: true, cell: (r) => r.windows },
    { key: "rate", header: FREQUENCY, numeric: true, sortable: true, cell: (r) => rateWithRange(r.withItem, r.windows, r.installs) },
    { key: "installs", header: "Reports", cell: (r) => dropTierLabel(r.installs) },
  ];
  const { shown, strip } = lootRows(table.rows, ["item", "items"], "Drop pages", pages);
  return <>
    <DataTable dense caption={`What ${title} drops`} columns={columns} rows={shown} rowKey={(r) => String(r.itemId)} sort={sort} sortHref={sortHref} nofollow />
    {strip}
    <Method dataAsOf={dataAsOf} lead={`Out of ${spanPhrase(table.span)}`} />
  </>;
}

/** Highest drop chance first, then the most windows with the item, then the lower source id. */
const byChance = (a: LootTableRow, b: LootTableRow) =>
  b.rate - a.rate || b.withItem - a.withItem || (a.sourceNpcId ?? a.sourceObjectId ?? 0) - (b.sourceNpcId ?? b.sourceObjectId ?? 0);

/** One row of an instance's loot table: a creature's loot table row, with the boss that creature is tied to. */
export type InstanceLootRow = LootTableRow & { encounterId: number };

/**
 * The Loot tab of an instance page: every boss creature's rated rows in one table, highest drop chance first, each
 * with its boss, paged like the NPC Drops tab. Nothing when no row is rated; the caller says why per boss.
 */
export function InstanceLootPanel({ rows, title, item, boss, dataAsOf, pages }: {
  rows: InstanceLootRow[]; title: string; item: (itemId: number) => ReactNode; boss: (encounterId: number) => ReactNode;
  dataAsOf: string | null; pages?: LootPages;
}) {
  if (rows.length === 0) return null;
  const columns: Column<InstanceLootRow>[] = [
    { key: "item", header: "Item", cell: (r) => item(r.itemId) },
    { key: "boss", header: "Boss", cell: (r) => boss(r.encounterId) },
    { key: "with", header: "Windows with it", numeric: true, cell: (r) => r.withItem },
    { key: "windows", header: "Out of", numeric: true, cell: (r) => r.windows },
    { key: "rate", header: FREQUENCY, numeric: true, cell: (r) => rateWithRange(r.withItem, r.windows, r.installs) },
    { key: "installs", header: "Reports", cell: (r) => dropTierLabel(r.installs) },
  ];
  const { shown, strip } = lootRows([...rows].sort(byChance), ["item", "items"], "Drop pages", pages);
  return <>
    <DataTable dense caption={`What the bosses of ${title} drop`} columns={columns} rows={shown} rowKey={(r) => `${r.encounterId}-${r.sourceNpcId}-${r.itemId}`} nofollow />
    {strip}
    <Method dataAsOf={dataAsOf} />
  </>;
}

/**
 * The Dropped by tab of an item page, highest drop chance first. `zone` is where 3 installs agree a source stands, or
 * null: the Zone column shows only when some source has one.
 */
export function ItemSourcesPanel({ sources, title, source, zone, dataAsOf, pages }: {
  sources: ItemDropSources; title: string; source: (row: LootTableRow) => ReactNode; dataAsOf: string | null;
  zone?: (row: LootTableRow) => ReactNode;
  /** Pages a table longer than LOOT_PER_PAGE rows; without it every row shows. */
  pages?: LootPages;
}) {
  const short = sources.short ? <p className={NOTE}>{shortLine(sources.short)}</p> : null;
  if (sources.rows.length === 0) return short ?? <EmptyTab message={EMPTY.drops("this")} />;
  const rows = [...sources.rows].sort(byChance);
  const zones = new Map(zone ? rows.map((r) => [r, zone(r)]) : []);
  const zoned = [...zones.values()].some((z) => z !== null && z !== undefined);
  const columns: Column<LootTableRow>[] = [
    { key: "source", header: "Source", cell: source },
    ...(zoned ? [{ key: "zone", header: "Zone", cell: (r: LootTableRow) => zones.get(r) ?? <span className="text-muted">—</span> }] : []),
    { key: "with", header: "Windows with it", numeric: true, cell: (r) => r.withItem },
    { key: "windows", header: "Loot windows", numeric: true, cell: (r) => r.windows },
    { key: "rate", header: FREQUENCY, numeric: true, cell: (r) => rateWithRange(r.withItem, r.windows, r.installs) },
    { key: "installs", header: "Reports", cell: (r) => dropTierLabel(r.installs) },
    { key: "dated", header: "Windows dated", nowrap: true, cell: (r) => datedPhrase(r).replace(/^dated /, "") || "[?]" },
  ];
  const { shown, strip } = lootRows(rows, ["source", "sources"], "Source pages", pages);
  return <>
    <DataTable dense caption={`Where ${title} drops`} columns={columns} rows={shown} rowKey={(r) => `${r.sourceNpcId ?? "o"}-${r.sourceObjectId ?? "n"}`} />
    {strip}
    <Method dataAsOf={dataAsOf} />
    {short}
  </>;
}
