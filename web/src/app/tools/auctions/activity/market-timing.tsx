"use client";

import { useState } from "react";
import { itemsParam, type AhledgerTiming } from "@/lib/ahledger";
import { AhledgerMarketPicker, AhledgerPanel, useAhledger, useAhledgerMarket } from "../AhledgerPanel";
import { hourLabel } from "./sale-report";

const windowLabel = (hour: number) => `${hourLabel(hour)}–${hourLabel(hour + 3)} UTC`;
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export default function MarketTiming({ initialItem, initialMarket }: { initialItem: number | null; initialMarket?: string }) {
  const [itemId, setItemId] = useState(initialItem);
  const [market, setMarket] = useAhledgerMarket(initialMarket);
  const read = useAhledger<AhledgerTiming>(market && itemId ? `/api/ahledger/${market}/timing?item=${itemId}` : null, "timing");
  const data = read.state === "ready" ? read.data : null;
  return <>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      const item = new FormData(event.currentTarget).get("item");
      const ids = typeof item === "string" ? itemsParam(item.trim()) : null;
      if (ids?.length === 1) setItemId(ids[0]);
    }}>
      <label className="grid gap-1 text-sm">Item ID
        <input className="min-h-10 rounded-control border border-line bg-canvas px-2" name="item" inputMode="numeric"
          pattern="[1-9][0-9]{0,9}" defaultValue={initialItem ?? ""} required />
      </label>
      <button className="btn" type="submit">Show timing</button>
    </form>
    {itemId && <AhledgerPanel title={data?.itemName ?? `Timing for item ${itemId}`} state={read.state} nofollowCredit
    credit={read.state === "ready" ? read.credit : undefined}
    controls={market && <AhledgerMarketPicker market={market} onChange={setMarket} />}>
    {data && <>
      <p className="text-sm text-fg-2">Three-hour windows from 28 days of asking prices. Sales volume and future prices can differ.</p>
      {data.asOf && <p className="text-sm text-fg-2">Latest market scan <time dateTime={data.asOf}>{new Date(data.asOf).toISOString().slice(0, 16).replace("T", " ")} UTC</time>.</p>}
      {data.buy !== null || data.sell !== null ? <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {data.buy !== null && <div><dt className="text-fg-2">Lower-price buying window</dt><dd>{windowLabel(data.buy)}</dd></div>}
        {data.sell !== null && <div><dt className="text-fg-2">Higher-price posting window</dt><dd>{windowLabel(data.sell)}</dd></div>}
        <div><dt className="text-fg-2">Coverage</dt><dd className="capitalize">{data.confidence}</dd></div>
      </dl> : <p className="text-sm text-fg-2">Too few scans for a reliable price window on this market.</p>}
      {data.hours.length > 0 && <details>
        <summary className="cursor-pointer text-sm">Listings by hour (UTC)</summary>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="border-b border-line text-left">
            <th scope="col">Hour</th><th scope="col">Average listings</th><th scope="col">Days scanned</th>
          </tr></thead>
          <tbody>{data.hours.map(row => <tr key={row.hour} className="border-b border-line">
            <th scope="row" className="text-left font-normal">{hourLabel(row.hour)}</th>
            <td>{count.format(row.listings)}</td><td>{row.days}</td>
          </tr>)}</tbody>
        </table>
      </details>}
    </>}
    </AhledgerPanel>}
  </>;
}
