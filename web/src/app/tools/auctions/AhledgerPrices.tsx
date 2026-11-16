"use client";

import { useEffect, useState } from "react";
import Coins from "@/components/ui/Coins";
import { DataTable, Segmented, type Column } from "@/components/ui";
import { AHLEDGER_SITE, ahledgerCredit, ahledgerItemUrl, ahledgerMarketLabel, type AhledgerPrice } from "@/lib/ahledger";

/** One region's markets: "US" and the market ids AH Ledger lists there. */
export interface AhledgerRegion { label: string; markets: string[] }

type Row = { market: string; price: AhledgerPrice | null; credit?: string };
type Read = { state: "loading" } | { state: "failed" } | { state: "rows"; rows: Row[] };

const UTC = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

async function readMarket(market: string, itemId: number): Promise<Row> {
  const res = await fetch(`/api/ahledger/${market}?items=${itemId}`);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as { prices?: AhledgerPrice[]; credit?: { url: string } };
  return { market, price: body.prices?.find((p) => p.itemId === itemId) ?? null, credit: ahledgerCredit({ attribution: body.credit }).url };
}

/**
 * The item's latest price on AH Ledger's markets, read in the browser through /api/ahledger when the panel
 * mounts, so the page's HTML and Everloot's data never hold it (lib/ahledger.ts). A market AH Ledger has no
 * price for says so; a failed read says that, not "no price".
 */
export default function AhledgerPrices({ itemId, regions, title = "AH Ledger prices" }: { itemId: number; regions: AhledgerRegion[]; title?: string }) {
  const [region, setRegion] = useState(regions[0]?.label ?? "");
  const [read, setRead] = useState<Read>({ state: "loading" });
  const markets = regions.find((r) => r.label === region)?.markets ?? [];
  const key = markets.join(",");

  useEffect(() => {
    let live = true;
    setRead({ state: "loading" });
    Promise.all(key.split(",").filter(Boolean).map((m) => readMarket(m, itemId)))
      .then((rows) => { if (live) setRead({ state: "rows", rows }); })
      .catch(() => { if (live) setRead({ state: "failed" }); });
    return () => { live = false; };
  }, [key, itemId]);

  if (!regions.length) return null;
  const columns: Column<Row>[] = [
    {
      key: "market", header: "Market", nowrap: true,
      cell: (r) => <a href={ahledgerItemUrl(itemId, r.market)} rel="noopener">{ahledgerMarketLabel(r.market)}</a>,
    },
    { key: "min", header: "Min buyout", numeric: true, cell: (r) => (r.price ? <Coins copper={r.price.minBuyout} /> : "no price") },
    { key: "median", header: "Median", numeric: true, cell: (r) => (r.price ? <Coins copper={r.price.median} /> : "") },
    { key: "quantity", header: "Listed", numeric: true, cell: (r) => r.price?.quantity?.toLocaleString("en-US") ?? "" },
    {
      key: "sales", header: "Sold a day", numeric: true,
      cell: (r) => (r.price?.salesPerDay == null ? "" : r.price.salesPerDay.toLocaleString("en-US", { maximumFractionDigits: 1 })),
    },
    {
      key: "seen", header: "Scanned", nowrap: true,
      cell: (r) => (r.price?.observedAt ? <time dateTime={r.price.observedAt}>{UTC.format(new Date(r.price.observedAt))} UTC</time> : ""),
    },
  ];

  return (
    <section aria-labelledby="ahledger-prices" data-ahledger={read.state}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="ahledger-prices" className="text-control font-medium text-fg">{title}</h2>
        {regions.length > 1 && (
          <Segmented label="Region" value={region} onChange={setRegion} options={regions.map((r) => ({ value: r.label, label: r.label }))} />
        )}
      </div>
      <p className="mb-2 text-meta text-fg-2">
        Each faction&apos;s auction house is its own market. Read live from AH Ledger&apos;s scans when you open this page and
        not kept by Everloot, so they can differ from the prices above.
      </p>
      {read.state === "loading" && <p className="text-meta text-fg-2" role="status">Reading AH Ledger…</p>}
      {read.state === "failed" && <p className="text-meta text-fg-2" role="status">AH Ledger could not be read right now. Try again in a few minutes.</p>}
      {read.state === "rows" && (
        <DataTable dense caption={`${title}, ${region}`} columns={columns} rows={read.rows} rowKey={(r) => r.market} />
      )}
      <p className="mt-2 text-meta text-fg-2">
        <a href={read.state === "rows" ? read.rows[0]?.credit ?? AHLEDGER_SITE : AHLEDGER_SITE} rel="noopener">Prices from AHledger</a>
      </p>
    </section>
  );
}
