"use client";

import { useId } from "react";
import Coins from "@/components/ui/Coins";
import { type AhledgerHistory as History, type AhledgerPoint } from "@/lib/ahledger";
import { AhledgerMarketPicker, AhledgerPanel, salesText, useAhledger, useAhledgerMarket } from "./AhledgerPanel";

function HistoryChart({ series }: { series: AhledgerPoint[] }) {
  const title = useId();
  const points = series.filter((p) => p.min !== null || p.median !== null);
  if (!points.length) return <p className="text-meta text-fg-2">No price history on this market yet.</p>;
  const values = points.flatMap((p) => [p.min, p.median, p.p25, p.p75].filter((v): v is number => v !== null));
  const low = Math.min(...values), high = Math.max(...values);
  const last = Date.parse(points.at(-1)!.t), first = last - 30 * 86400000;
  const x = (p: AhledgerPoint) => 8 + (Date.parse(p.t) - first) / (last - first) * 984;
  const y = (v: number) => high === low ? 70 : 8 + (1 - (v - low) / (high - low)) * 124;
  // Separate runs leave missing scans as gaps rather than inventing a price between them.
  const runs = (field: "min" | "median" | "band") => {
    const groups: AhledgerPoint[][] = [];
    let run: AhledgerPoint[] = [];
    for (const p of series) {
      if ((field === "band" ? p.p25 !== null && p.p75 !== null : p[field] !== null) && Date.parse(p.t) >= first) run.push(p);
      else if (run.length) { groups.push(run); run = []; }
    }
    if (run.length) groups.push(run);
    return groups;
  };
  return <figure className="space-y-2">
    <svg viewBox="0 0 1000 140" preserveAspectRatio="none" role="img" aria-labelledby={title} className="h-36 w-full rounded-card border border-line bg-canvas">
      <title id={title}>AH Ledger minimum and median buyout over 30 days, with the 25th to 75th percentile band</title>
      {runs("band").map((run, i) => <polygon key={`band-${i}`} data-history-band points={[...run.map((p) => `${x(p)},${y(p.p25!)}`), ...[...run].reverse().map((p) => `${x(p)},${y(p.p75!)}`)].join(" ")} className="fill-line" />)}
      {(["min", "median"] as const).map((field) => runs(field).map((run, i) => <g key={`${field}-${i}`}>
        <polyline data-history-line={field} points={run.map((p) => `${x(p)},${y(p[field]!)}`).join(" ")} fill="none" className={field === "min" ? "stroke-fg-2" : "stroke-accent"} strokeWidth="2" strokeDasharray={field === "min" ? "6 4" : undefined} vectorEffect="non-scaling-stroke" />
        {run.length === 1 && <circle cx={x(run[0])} cy={y(run[0][field]!)} r="3" className={field === "min" ? "fill-fg-2" : "fill-accent"} />}
      </g>))}
    </svg>
    <figcaption className="flex flex-wrap justify-between gap-2 text-meta text-fg-2">
      <span>{new Date(first).toISOString().slice(0, 10)} to {points.at(-1)!.t.slice(0, 10)} · dashed: minimum · solid: median · band: p25–p75</span>
      <span><Coins copper={low} /> to <Coins copper={high} /></span>
    </figcaption>
  </figure>;
}

export default function AhledgerHistory({ itemId, defaultMarket }: { itemId: number; defaultMarket?: string }) {
  const [market, setMarket] = useAhledgerMarket(defaultMarket);
  const read = useAhledger<History>(market && `/api/ahledger/${market}/history?item=${itemId}`, "history");
  return <AhledgerPanel title="AH Ledger price history" state={read.state} credit={read.state === "ready" ? read.credit : undefined} controls={market && <AhledgerMarketPicker market={market} onChange={setMarket} />}>
    {read.state === "ready" && <>
      <p className="text-meta text-fg-2">AH Ledger scans for this market, separate from player-reported prices. The chart shows up to 30 days of available scans.</p>
      <HistoryChart series={read.data.series} />
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div><dt className="text-fg-2">7-day median</dt><dd><Coins copper={read.data.median7d} /></dd></div>
        <div><dt className="text-fg-2">30-day median</dt><dd><Coins copper={read.data.median30d} /></dd></div>
        <div><dt className="text-fg-2">Estimated sales per day</dt><dd>{salesText(read.data.salesPerDay)}{read.data.windowDays !== null && ` (${read.data.windowDays}-day window)`}</dd></div>
      </dl>
    </>}
  </AhledgerPanel>;
}
