"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Coins from "@/components/ui/Coins";
import { DataTable, type Column } from "@/components/ui";
import { isAhledgerMarket, isAhledgerProfession, type AhledgerCraft } from "@/lib/ahledger";
import { AhledgerMarketPicker, AhledgerPanel, AHLEDGER_MARKET_SLOT, DEFAULT_AHLEDGER_MARKET, salesText, useAhledger } from "./AhledgerPanel";

// This table's shareable URL takes precedence over the browser's remembered market.
function useCraftingMarket(): [string | null, (next: string) => void] {
  const [market, setMarket] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const shared = new URL(window.location.href).searchParams.get("market");
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(AHLEDGER_MARKET_SLOT); } catch {}
      const next = shared && isAhledgerMarket(shared) ? shared : saved && isAhledgerMarket(saved) ? saved : DEFAULT_AHLEDGER_MARKET;
      const url = new URL(window.location.href);
      url.searchParams.set("market", next);
      window.history.replaceState(window.history.state, "", url);
      setMarket(next);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return [market, (next) => {
    if (!isAhledgerMarket(next)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("market", next);
    window.history.replaceState(window.history.state, "", url);
    try { window.localStorage.setItem(AHLEDGER_MARKET_SLOT, next); } catch {}
    setMarket(next);
  }];
}

type CraftSort = "profitPerDay" | "margin" | "cost";
function Crafting({ profession }: { profession: string }) {
  const [market, setMarket] = useCraftingMarket();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: CraftSort; desc: boolean }>({ key: "profitPerDay", desc: true });
  const read = useAhledger<AhledgerCraft[]>(market && `/api/ahledger/${market}/crafting?profession=${encodeURIComponent(profession)}`, "recipes");
  const query = filter.trim().toLowerCase();
  const rows = read.state === "ready" ? read.data.filter((r) => r.name.toLowerCase().includes(query)).sort((a, b) => {
    const left = a[sort.key], right = b[sort.key];
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
  return <AhledgerPanel title="AH Ledger crafting margins" state={read.state} credit={read.state === "ready" ? read.credit : undefined} controls={market && <AhledgerMarketPicker market={market} onChange={setMarket} />}>
    <p className="text-meta text-fg-2">AH Ledger reagent and result prices, separate from player uploads. Net value uses average yield less the 5% auction house cut. A missing reagent price makes the cost unpriced. Estimated profit per day is an upper bound assuming you supply the whole market, not guaranteed earnings. Estimated sales lean low and are unrecorded when too few scans support them.</p>
    <div className="flex flex-wrap gap-3 text-meta text-fg-2">
      <label className="flex items-center gap-2">Filter recipes <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className="min-h-10 rounded-control border border-line bg-canvas px-2 text-sm text-fg" /></label>
      <label className="flex items-center gap-2">Sort by <select aria-label="Sort crafting margins" value={`${sort.key}:${sort.desc ? "desc" : "asc"}`} onChange={(e) => {
        const [key, direction] = e.target.value.split(":");
        setSort({ key: key as CraftSort, desc: direction === "desc" });
      }} className="min-h-10 rounded-control border border-line bg-canvas px-2 text-sm text-fg">
        <option value="profitPerDay:desc">Profit per day: high to low</option><option value="profitPerDay:asc">Profit per day: low to high</option>
        <option value="margin:desc">Margin: high to low</option><option value="margin:asc">Margin: low to high</option>
        <option value="cost:asc">Cost: low to high</option><option value="cost:desc">Cost: high to low</option>
      </select></label>
    </div>
    {read.state === "ready" && (read.data.length ? <DataTable dense caption={`${profession} crafting margins from AH Ledger`} columns={columns} rows={rows} empty={<p className="py-3 text-meta text-fg-2">No recipes match this filter.</p>} rowKey={(r) => String(r.spellId)} meta={(r) => <>Cost: {r.cost === null ? "unpriced" : <Coins copper={r.cost} />} · Net: <Coins copper={r.netValue} /> · Margin: <Coins copper={r.margin} /> · Sales/day: {salesText(r.salesPerDay)} · Profit/day: <Coins copper={r.profitPerDay} /></>} /> : <p className="text-meta text-fg-2">No crafting margins on this market yet.</p>)}
  </AhledgerPanel>;
}

export default function AhledgerCrafting({ profession }: { profession: string }) {
  return isAhledgerProfession(profession) ? <Crafting profession={profession} /> : null;
}
