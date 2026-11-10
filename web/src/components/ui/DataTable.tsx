import Link from "./PendingLink";
import type { ReactNode } from "react";

export type SortDirection = "asc" | "desc";

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Numbers, counts and ids: right-aligned, mono, tabular figures. */
  numeric?: boolean;
  /** The column can be sorted; its header becomes a link when the table has `sortHref`. */
  sortable?: boolean;
  /** Keep the cell on one line (names may still wrap when this is off). */
  nowrap?: boolean;
}

/** A column a list can leave out (filledColumns): `blank` says a cell has nothing to say ("—", 0, no id). */
export type SparseColumn<Row> = Column<Row> & { blank?: (row: Row) => boolean };

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** What the table lists, for screen readers and the scroll region's name. */
  caption: string;
  /** The column the rows are sorted by, as the page sorted them. */
  sort?: { key: string; direction: SortDirection };
  /** Where a sortable header points: usually the same page with ?sort= and ?dir=. */
  sortHref?: (key: string, direction: SortDirection) => string;
  /** Shown under the headers when there are no rows: an EmptyState with `framed={false}`. */
  empty?: ReactNode;
  /** Under the rows: "8 of 19 recipes · Show all". */
  footer?: ReactNode;
  /** Tabs or filters above the headers, inside the frame. */
  toolbar?: ReactNode;
  /**
   * The database list style (density spec, 2026-10-20): no card frame, 36 px rows, a 32 px header that sticks
   * under the site header, sans headers. Below 640 px only the first column shows, with `meta` as its
   * second line, so a phone never scrolls the table sideways.
   */
  dense?: boolean;
  /** Dense tables on a phone: the other columns' facts in one muted line under the first cell. */
  meta?: (row: Row) => ReactNode;
}

/**
 * The columns with something to say for these rows: one whose `blank` holds on every row (a count nobody has
 * reported yet, an id the results do not have) is noise. A list passes its whole result, not one page, so a
 * column does not come and go from page to page.
 */
export function filledColumns<Row>(columns: SparseColumn<Row>[], rows: readonly Row[]): SparseColumn<Row>[] {
  return rows.length ? columns.filter((col) => !col.blank || !rows.every(col.blank)) : columns;
}

const ariaSort = (direction: SortDirection) => (direction === "asc" ? "ascending" : "descending");

/**
 * The one table: dense rows in a card frame. A wide table scrolls inside its frame, never the page.
 * Names go in their quality colour through QUALITY_TEXT. Rendered on the server; sorting is a link.
 */
export default function DataTable<Row>(props: DataTableProps<Row>) {
  if (props.dense) return <DenseTable {...props} />;
  const { columns, rows, rowKey, caption, sort, sortHref, empty, footer, toolbar } = props;
  return (
    <div data-table className="min-w-0 overflow-hidden rounded-card border border-line bg-panel">
      {toolbar && <div className="border-b border-line">{toolbar}</div>}
      {/* Focusable so a keyboard can scroll it sideways; named by the caption. Positioned, so a cell's
          absolutely placed sr-only text is clipped with the rest instead of widening the page. */}
      <div role="region" aria-label={caption} tabIndex={0} className="relative max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((col) => {
                const sorted = sort?.key === col.key ? sort.direction : undefined;
                const next: SortDirection = sorted === "desc" ? "asc" : "desc";
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={sorted ? ariaSort(sorted) : undefined}
                    className={`h-9 whitespace-nowrap border-b border-line bg-canvas px-4 font-mono text-xs font-medium ${sorted ? "text-fg" : "text-muted"} ${col.numeric ? "text-right" : "text-left"}`}
                  >
                    {col.sortable && sortHref ? (
                      <Link href={sortHref(col.key, next)} className="inline-flex min-h-6 items-center gap-1 hover:text-fg">
                        {col.header}
                        {sorted && <span aria-hidden="true" className="text-accent">{sorted === "desc" ? "↓" : "↑"}</span>}
                      </Link>
                    ) : (
                      <>
                        {col.header}
                        {sorted && <span aria-hidden="true" className="ml-1 text-accent">{sorted === "desc" ? "↓" : "↑"}</span>}
                      </>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && empty ? (
              // Pinned to the frame's left edge and no wider than the screen, so on a phone the message and its
              // button stay in view while the headers above it scroll sideways.
              <tr><td colSpan={columns.length} className="p-0"><div className="sticky left-0 max-w-[calc(100vw-2rem-2px)]">{empty}</div></td></tr>
            ) : rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-line first:border-t-0 hover:bg-canvas/40">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`h-11 px-4 py-2 align-middle text-fg ${col.numeric ? "text-right font-mono tabular-nums" : "text-left"} ${col.nowrap || col.numeric ? "whitespace-nowrap" : ""}`}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-muted">{footer}</div>}
    </div>
  );
}

/**
 * The dense list table. Every sortable header is a link that says its direction (▲ ascending, ▼ descending)
 * on the sorted column, with aria-sort. On a phone the first column carries the row; the others hide.
 */
function DenseTable<Row>({ columns, rows, rowKey, caption, sort, sortHref, empty, footer, toolbar, meta }: DataTableProps<Row>) {
  // Without a phone line the other columns cannot fold away. Either way a table too wide for its column scrolls inside
  // itself below 1024 px (the sticky header needs the page as its scroll parent, so it applies from `lg`).
  const folds = Boolean(meta);
  const phoneHidden = (i: number) => (folds && i > 0 ? "hidden sm:table-cell" : "");
  return (
    <div data-table data-dense className="min-w-0">
      {toolbar}
      <div role="region" aria-label={caption} tabIndex={0} className="relative max-w-full overflow-x-auto lg:overflow-visible">
        <table className="w-full border-collapse text-cell">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((col, i) => {
                const sorted = sort?.key === col.key ? sort.direction : undefined;
                const next: SortDirection = sorted === "asc" ? "desc" : sorted === "desc" ? "asc" : col.numeric ? "desc" : "asc";
                const arrow = sorted && <span aria-hidden="true" className="text-[10px] text-accent">{sorted === "asc" ? "▲" : "▼"}</span>;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={sorted ? ariaSort(sorted) : undefined}
                    // Sticky under the site header from 1024 px up only: below that the table scrolls sideways inside
                    // its own box, which is then the sticky parent, so the offset pushed the header down onto the rows.
                    className={`z-10 h-th lg:sticky lg:top-header whitespace-nowrap border-b border-line bg-canvas px-3 text-th ${sorted ? "text-fg" : "text-muted"} ${col.numeric ? "text-right" : "text-left"} ${phoneHidden(i)}`}
                  >
                    {col.sortable && sortHref ? (
                      // Block-level, so the link fills the 32 px cell without a line box around it.
                      <Link href={sortHref(col.key, next)} className={`flex items-center gap-1 hover:text-fg ${col.numeric ? "flex-row-reverse" : ""}`}>
                        {col.header}{arrow}
                      </Link>
                    ) : (
                      <span className={`flex items-center gap-1 ${col.numeric ? "flex-row-reverse" : ""}`}>{col.header}{arrow}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && empty ? (
              <tr><td colSpan={columns.length} className="p-0">{empty}</td></tr>
            ) : rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line hover:bg-panel">
                {columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={`h-row-sm px-3 py-1 align-middle text-fg sm:h-row ${col.numeric ? "text-right font-mono tabular-nums" : "text-left"} ${col.nowrap || col.numeric ? "whitespace-nowrap" : ""} ${phoneHidden(i)}`}
                  >
                    {col.cell(row)}
                    {folds && i === 0 && <div className="text-cell-2 text-muted sm:hidden">{meta!(row)}</div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-meta text-muted">{footer}</div>}
    </div>
  );
}
