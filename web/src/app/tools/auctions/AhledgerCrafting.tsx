"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import Coins from "@/components/ui/Coins";
import { DataTable, type Column } from "@/components/ui";
import { ahledgerMarketLabel, isAhledgerMarket, isAhledgerProfession, type AhledgerCraft } from "@/lib/ahledger";
import { AhledgerPanel, salesText, useAhledger } from "./AhledgerPanel";

// The sortable columns: the column key (also the `?sort=` value, `-` first for high to low) and the field it orders by.
const CRAFT_SORTS = { cost: "cost", net: "netValue", margin: "margin", sales: "salesPerDay", profit: "profitPerDay" } as const;
type CraftSort = keyof typeof CRAFT_SORTS;
type CraftOrder = { key: CraftSort; desc: boolean };
const DEFAULT_CRAFT_SORT: CraftOrder = { key: "profit", desc: true };
const SORT_LABELS: Record<CraftSort, string> = { cost: "Cost", net: "Net value", margin: "Margin", sales: "Sales per day", profit: "Profit per day" };

/** `?sort=-profit` (high to low) or `?sort=cost` (low to high); anything else is the default, profit per day high to low. */
function parseCraftSort(raw: string | null): CraftOrder {
  const m = raw ? /^(-?)([a-z]+)$/.exec(raw) : null;
  return m && m[2] in CRAFT_SORTS ? { key: m[2] as CraftSort, desc: m[1] === "-" } : DEFAULT_CRAFT_SORT;
}
const craftSortParam = (s: CraftOrder) => `${s.desc ? "-" : ""}${s.key}`;

// The order lives in the URL beside the market, so a sorted table can be shared; the default leaves no parameter.
function useCraftingSort(): [CraftOrder, (next: CraftOrder) => void] {
  const [sort, setSort] = useState<CraftOrder>(DEFAULT_CRAFT_SORT);
  useEffect(() => {
    const read = () => setSort(parseCraftSort(new URL(window.location.href).searchParams.get("sort")));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return [sort, (next) => {
    const url = new URL(window.location.href);
    if (next.key === DEFAULT_CRAFT_SORT.key && next.desc === DEFAULT_CRAFT_SORT.desc) url.searchParams.delete("sort");
    else url.searchParams.set("sort", craftSortParam(next));
    window.history.replaceState(window.history.state, "", url);
    setSort(next);
  }];
}

function Crafting({ profession, market, picker, none }: CraftingProps) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useCraftingSort();
  const read = useAhledger<AhledgerCraft[]>(market && isAhledgerMarket(market) ? `/api/ahledger/${market}/crafting?profession=${encodeURIComponent(profession)}` : null, "recipes");
  const query = filter.trim().toLowerCase();
  const field = CRAFT_SORTS[sort.key];
  const rows = read.state === "ready" ? read.data.filter((r) => r.name.toLowerCase().includes(query)).sort((a, b) => {
    const left = a[field], right = b[field];
    if (left === null) return right === null ? a.spellId - b.spellId : 1;
    if (right === null) return -1;
    return (sort.desc ? right - left : left - right) || a.spellId - b.spellId;
  }) : [];
  const columns: Column<AhledgerCraft>[] = [
    // No prefetch: /database sits behind Cloudflare's bot challenge, so a prefetch before the visitor has passed it is
    // refused (403) and logs an error for every recipe in view. The link itself works.
    { key: "recipe", header: "Recipe", cell: (r) => <Link href={`/database/spells/${r.spellId}`} prefetch={false}>{r.name}</Link> },
    { key: "cost", header: "Cost", numeric: true, cell: (r) => r.cost === null ? "unpriced" : <Coins copper={r.cost} /> },
    { key: "net", header: "Net value", numeric: true, cell: (r) => <Coins copper={r.netValue} /> },
    { key: "margin", header: "Margin", numeric: true, cell: (r) => <Coins copper={r.margin} /> },
    { key: "sales", header: "Sales per day", numeric: true, cell: (r) => salesText(r.salesPerDay) },
    { key: "profit", header: "Profit per day", numeric: true, cell: (r) => <Coins copper={r.profitPerDay} /> },
  ];
  const controls = <>{picker}<p data-ahledger-market className="text-meta text-fg-2">{market ? `AH Ledger market: ${ahledgerMarketLabel(market)}` : none}</p></>;
  if (!market) return <section data-ahledger="none" className="space-y-3"><h2 className="text-control font-medium text-fg">AH Ledger crafting margins</h2>{controls}</section>;
  return <AhledgerPanel title="AH Ledger crafting margins" state={read.state} credit={read.state === "ready" ? read.credit : undefined} controls={controls}>
    <p className="text-meta text-fg-2">AH Ledger reagent and result prices, separate from player uploads. Net value uses average yield less the 5% auction house cut. A missing reagent price makes the cost unpriced. Estimated profit per day is an upper bound assuming you supply the whole market, not guaranteed earnings. Estimated sales lean low and are unrecorded when too few scans support them.</p>
    <div className="flex flex-wrap gap-3 text-meta text-fg-2">
      <label className="flex items-center gap-2">Filter recipes <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className="min-h-10 rounded-control border border-line bg-canvas px-2 text-sm text-fg" /></label>
      <label className="flex items-center gap-2">Sort by <select aria-label="Sort crafting margins" value={craftSortParam(sort)} onChange={(e) => setSort(parseCraftSort(e.target.value))} className="min-h-10 rounded-control border border-line bg-canvas px-2 text-sm text-fg">
        {(Object.keys(CRAFT_SORTS) as CraftSort[]).map((key) => [true, false].map((desc) => (
          <option key={`${key}:${desc}`} value={craftSortParam({ key, desc })}>{SORT_LABELS[key]}: {desc ? "high to low" : "low to high"}</option>
        )))}
      </select></label>
    </div>
    {read.state === "ready" && (read.data.length ? <DataTable dense caption={`${profession} crafting margins from AH Ledger`} columns={columns} rows={rows} sort={{ key: sort.key, direction: sort.desc ? "desc" : "asc" }}empty={<p className="py-3 text-meta text-fg-2">No recipes match this filter.</p>} rowKey={(r) => String(r.spellId)} meta={(r) => <>Cost: {r.cost === null ? "unpriced" : <Coins copper={r.cost} />} · Net: <Coins copper={r.netValue} /> · Margin: <Coins copper={r.margin} /> · Sales/day: {salesText(r.salesPerDay)} · Profit/day: <Coins copper={r.profitPerDay} /></>} /> : <p className="text-meta text-fg-2">No crafting margins on this market yet.</p>)}
  </AhledgerPanel>;
}

interface CraftingProps {
  profession: string;
  /** The AH Ledger market the page chose from its realm and house; null where AH Ledger has none. */
  market: string | null;
  /** The page's realm and house picker (RealmHousePicker), rendered on the server. */
  picker?: ReactNode;
  /** What to say when `market` is null. */
  none?: string;
}

export default function AhledgerCrafting(props: CraftingProps) {
  return isAhledgerProfession(props.profession) ? <Crafting {...props} /> : null;
}
