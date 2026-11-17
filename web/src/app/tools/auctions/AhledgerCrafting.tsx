"use client";

import Link from "next/link";
import Coins from "@/components/ui/Coins";
import { DataTable, type Column } from "@/components/ui";
import { isAhledgerProfession, type AhledgerCraft } from "@/lib/ahledger";
import { AhledgerMarketPicker, AhledgerPanel, salesText, useAhledger, useAhledgerMarket } from "./AhledgerPanel";

function Crafting({ profession }: { profession: string }) {
  const [market, setMarket] = useAhledgerMarket();
  const read = useAhledger<AhledgerCraft[]>(market && `/api/ahledger/${market}/crafting?profession=${encodeURIComponent(profession)}`, "recipes");
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
    <p className="text-meta text-fg-2">AH Ledger reagent and result prices, separate from player uploads. Net value uses average yield less the 5% auction house cut. A missing reagent price makes the cost unpriced. Sorted by estimated profit per day: an upper bound assuming you supply the whole market, not guaranteed earnings. Estimated sales lean low and are unrecorded when too few scans support them.</p>
    {read.state === "ready" && (read.data.length ? <DataTable dense caption={`${profession} crafting margins from AH Ledger`} columns={columns} rows={read.data} rowKey={(r) => String(r.spellId)} meta={(r) => <>Cost: {r.cost === null ? "unpriced" : <Coins copper={r.cost} />} · Net: <Coins copper={r.netValue} /> · Margin: <Coins copper={r.margin} /> · Sales/day: {salesText(r.salesPerDay)} · Profit/day: <Coins copper={r.profitPerDay} /></>} /> : <p className="text-meta text-fg-2">No crafting margins on this market yet.</p>)}
  </AhledgerPanel>;
}

export default function AhledgerCrafting({ profession }: { profession: string }) {
  return isAhledgerProfession(profession) ? <Crafting profession={profession} /> : null;
}
