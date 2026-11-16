"use client";

import { useState } from "react";
import Link from "next/link";
import Coins from "@/components/ui/Coins";
import { DataTable, type Column } from "@/components/ui";
import { ahledgerMarketLabel, type AhledgerDeal, type AhledgerEconomy } from "@/lib/ahledger";
import { AhledgerMarketPicker, AhledgerPanel, DEFAULT_AHLEDGER_MARKET, useAhledger } from "./AhledgerPanel";

export function AhledgerDeals() {
  const [market, setMarket] = useState(DEFAULT_AHLEDGER_MARKET);
  const read = useAhledger<AhledgerDeal[]>(`/api/ahledger/${market}/deals`, "deals");
  const columns: Column<AhledgerDeal>[] = [
    { key: "item", header: "Item", cell: (r) => <Link href={`/tools/auctions/item/${r.itemId}`}>{r.name}</Link> },
    { key: "min", header: "Min buyout", numeric: true, cell: (r) => <Coins copper={r.minBuyout} /> },
    { key: "reference", header: "Reference median", numeric: true, cell: (r) => <><Coins copper={r.referenceMedian} /> ({r.basis ?? "unrecorded"})</> },
    { key: "quantity", header: "Listed", numeric: true, cell: (r) => r.quantity?.toLocaleString("en-US") ?? "unrecorded" },
    { key: "saving", header: "Saving", numeric: true, cell: (r) => <Coins copper={r.saving} /> },
  ];
  return <AhledgerPanel title="AH Ledger deals" state={read.state} credit={read.state === "ready" ? read.credit : undefined} controls={<AhledgerMarketPicker market={market} onChange={setMarket} />}>
    <p className="text-meta text-fg-2">AH Ledger listings at least 25% below their reference median, with at least 5 units listed. Top 20 by saving, counting at most 20 units per item. The reference uses 30 days when available, otherwise 7 days or the newest scan. Listings may have sold since the scan.</p>
    {read.state === "ready" && (read.data.length ? <DataTable dense caption="Deals from AH Ledger" columns={columns} rows={read.data} rowKey={(r) => String(r.itemId)} meta={(r) => <>Min: <Coins copper={r.minBuyout} /> · Reference: <Coins copper={r.referenceMedian} /> ({r.basis ?? "unrecorded"}) · Listed: {r.quantity ?? "unrecorded"} · Saving: <Coins copper={r.saving} /></>} /> : <p className="text-meta text-fg-2">No deals meet these filters on this market.</p>)}
  </AhledgerPanel>;
}

export function AhledgerEconomySummary() {
  const read = useAhledger<AhledgerEconomy[]>("/api/ahledger/economy", "markets");
  const columns: Column<AhledgerEconomy>[] = [
    { key: "market", header: "Market", cell: (r) => `${ahledgerMarketLabel(r.market)} ${r.market.split(".").at(-1)!.toUpperCase()}` },
    { key: "current", header: "Listed value now", numeric: true, cell: (r) => <Coins copper={r.current} /> },
    { key: "week", header: "A week ago", numeric: true, cell: (r) => <Coins copper={r.weekAgo} /> },
  ];
  return <AhledgerPanel title="AH Ledger economy" state={read.state} credit={read.state === "ready" ? read.credit : undefined}>
    <p className="text-meta text-fg-2">Listed auction value, not the gold players hold. AH Ledger takes each contributor&apos;s latest full scan over 24 hours and uses their median, with price and quantity outliers capped. A week ago uses the same method seven days earlier.</p>
    {read.state === "ready" && (read.data.length ? <DataTable dense caption="Listed value per AH Ledger market" columns={columns} rows={read.data} rowKey={(r) => r.market} meta={(r) => <>Now: <Coins copper={r.current} /> · A week ago: <Coins copper={r.weekAgo} /></>} /> : <p className="text-meta text-fg-2">No full scans for the economy summary yet.</p>)}
  </AhledgerPanel>;
}
