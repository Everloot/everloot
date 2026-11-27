"use client";

import Link from "@/components/Link";
import type { ReactNode } from "react";
import DataTable, { type Column, type SortDirection } from "@/components/ui/DataTable";
import { salesText, type AhledgerCraft } from "@/lib/ahledger";
import { Icon } from "../professions/recipe-table";
import Coins from "./ClientCoins";

/**
 * The AH Ledger margins table, drawn from the rows' numbers: the server renders the same HTML, while the page's RSC data
 * carries each row's figures instead of its cells' markup a second time (AhledgerCrafting reads, filters and pages them).
 */
export interface CraftingTableProps {
  caption: string;
  rows: (AhledgerCraft & { icon?: string })[];
  sort: { key: string; direction: SortDirection };
  /** Each sortable column's link per direction, made on the server. */
  sortHrefs: Record<string, Record<SortDirection, string>>;
  empty: ReactNode;
}

const dash = <span className="text-muted">—</span>;
const coins = (n: number | null) => (n === null ? dash : <Coins copper={n} />);

type Row = CraftingTableProps["rows"][number];
const columns: Column<Row>[] = [
  {
    // No prefetch: /database sits behind Cloudflare's bot challenge, so a prefetch before the visitor has passed it is
    // refused (403) and logs an error for every recipe in view. The link itself works.
    key: "recipe", header: "Recipe", cell: (r) => (
      <span className="pf-rn">
        <Icon src={r.icon} size={24} />
        <Link href={`/database/spells/${r.spellId}`} prefetch={false}>{r.name}</Link>
      </span>
    ),
  },
  { key: "skill", header: "Skill", numeric: true, cell: (r) => r.skill ?? dash },
  { key: "cost", header: "Cost", numeric: true, sortable: true, cell: (r) => r.cost === null ? "unpriced" : <Coins copper={r.cost} /> },
  { key: "net", header: "Net value", numeric: true, sortable: true, cell: (r) => coins(r.netValue) },
  { key: "margin", header: "Margin", numeric: true, sortable: true, cell: (r) => coins(r.margin) },
  { key: "sales", header: "Sales per day", numeric: true, sortable: true, cell: (r) => salesText(r.salesPerDay) },
  { key: "profit", header: "Profit per day", numeric: true, sortable: true, cell: (r) => coins(r.profitPerDay) },
];

export default function CraftingTable({ caption, rows, sort, sortHrefs, empty }: CraftingTableProps) {
  return (
    <DataTable
      dense
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => String(r.spellId)}
      sort={sort}
      sortHref={(key, direction) => sortHrefs[key][direction]}
      empty={empty}
      nofollow
    />
  );
}
