import type { ReactNode } from "react";
import { DataTable, installsNeeded, type Column } from "@/components/ui";
import { datedPhrase, METHOD_LINE, missingLine, shortLine, spanPhrase, type ItemDropSources, type LootTableRow, type NpcLootTable } from "../../../../kb/src/loot-tables";
import { EmptyTab, FREQUENCY, percent } from "./entity";

/**
 * The NPC loot table and the item-source table (docs/design/specs/2026-10-21-loot-tables-design.md, section 9):
 * every number with its denominator, its dates and how it was made. Short of 3 installs, a line says what is
 * missing instead of a rate.
 */

const NOTE = "py-2 text-meta text-fg-2";

/** The method and the corpus time, under a table. */
function Method({ dataAsOf, lead }: { dataAsOf: string | null; lead?: string }) {
  const asOf = dataAsOf ? ` Data as of ${dataAsOf.slice(0, 10)}.` : "";
  return <p className={NOTE}>{lead ? `${lead}. ` : ""}{METHOD_LINE}{asOf}</p>;
}

/** The Drops tab of an NPC page. */
export function NpcLootPanel({ table, title, item, dataAsOf }: { table: NpcLootTable; title: string; item: (itemId: number) => ReactNode; dataAsOf: string | null }) {
  if (table.state === "none") return <EmptyTab message={`Nobody has looted this NPC in Forever yet. ${installsNeeded()}`} />;
  if (table.state === "short") return <p className="py-3 text-meta text-fg">{missingLine(table)}</p>;
  if (table.rows.length === 0) {
    return <>
      <p className="py-3 text-meta text-fg">No items observed in {spanPhrase(table.span)}.</p>
      <Method dataAsOf={dataAsOf} />
    </>;
  }
  const columns: Column<LootTableRow>[] = [
    { key: "item", header: "Item", cell: (r) => item(r.itemId) },
    { key: "with", header: "Windows with it", numeric: true, cell: (r) => r.withItem },
    { key: "windows", header: "Out of", numeric: true, cell: (r) => r.windows },
    { key: "rate", header: FREQUENCY, numeric: true, cell: (r) => percent(r.rate) },
    { key: "installs", header: "Installs", numeric: true, cell: (r) => r.installs },
  ];
  return <>
    <DataTable dense caption={`What ${title} drops`} columns={columns} rows={table.rows} rowKey={(r) => String(r.itemId)} />
    <Method dataAsOf={dataAsOf} lead={`Out of ${spanPhrase(table.span)}`} />
  </>;
}

/** The Dropped by tab of an item page. */
export function ItemSourcesPanel({ sources, title, source, dataAsOf }: { sources: ItemDropSources; title: string; source: (row: LootTableRow) => ReactNode; dataAsOf: string | null }) {
  const short = sources.short ? <p className={NOTE}>{shortLine(sources.short)}</p> : null;
  if (sources.rows.length === 0) return short ?? <EmptyTab message={`Nobody has looted this in Forever yet. ${installsNeeded()}`} />;
  const columns: Column<LootTableRow>[] = [
    { key: "source", header: "Source", cell: source },
    { key: "with", header: "Windows with it", numeric: true, cell: (r) => r.withItem },
    { key: "windows", header: "Loot windows", numeric: true, cell: (r) => r.windows },
    { key: "rate", header: FREQUENCY, numeric: true, cell: (r) => percent(r.rate) },
    { key: "installs", header: "Installs", numeric: true, cell: (r) => r.installs },
    { key: "dated", header: "Windows dated", nowrap: true, cell: (r) => datedPhrase(r).replace(/^dated /, "") || "[?]" },
  ];
  return <>
    <DataTable dense caption={`Where ${title} drops`} columns={columns} rows={sources.rows} rowKey={(r) => `${r.sourceNpcId ?? "o"}-${r.sourceObjectId ?? "n"}`} />
    <Method dataAsOf={dataAsOf} />
    {short}
  </>;
}
