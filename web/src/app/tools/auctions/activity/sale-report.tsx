"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Coins from "@/components/ui/Coins";
import { readSaleLedger, SALE_CYCLES, saleCycles, type SaleCycle, type SaleLedger } from "@/lib/sale-cycles";

const MAX_FILE_BYTES = 20_000_000;
export const hourLabel = (hour: number) => `${String(hour % 24).padStart(2, "0")}:00`;
const seconds = () => Math.floor(Date.now() / 1000);

export default function SaleReport({ initialName }: { initialName?: string }) {
  const [ledger, setLedger] = useState<SaleLedger | null>(null);
  const [error, setError] = useState("");
  const [cycle, setCycle] = useState<SaleCycle>("day");
  const [item, setItem] = useState(initialName ?? "");
  const [now, setNow] = useState(seconds);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    if (!ledger) return;
    const timer = window.setInterval(() => setNow(seconds()), 30_000);
    return () => window.clearInterval(timer);
  }, [ledger]);
  const names = useMemo(() => [...new Set([...(initialName ? [initialName] : []), ...(ledger?.sales.map(row => row.itemName) ?? [])])].sort(), [ledger, initialName]);
  const report = useMemo(() => ledger && saleCycles(ledger, now, item || undefined), [ledger, now, item]);

  async function read(file: File) {
    const reading = ++sequence.current;
    setLedger(null);
    setError("");
    if (file.size > MAX_FILE_BYTES) {
      setLoading(false);
      setError("Choose an Everloot.lua file up to 20 MB.");
      return;
    }
    setLoading(true);
    try {
      const parsed = readSaleLedger((await file.text()).replace(/^\uFEFF/, ""));
      if (reading !== sequence.current) return;
      setNow(seconds());
      setItem(initialName ?? "");
      setLedger(parsed);
    } catch {
      if (reading === sequence.current) setError("This file could not be read. Choose Everloot.lua from your account's SavedVariables folder.");
    } finally {
      if (reading === sequence.current) setLoading(false);
    }
  }

  const rows = report?.rank[cycle] ?? [];
  const start = report?.start[cycle];
  const peak = report?.peak;
  const maxNotices = Math.max(1, ...(report?.hours.map(row => row.notices) ?? []));
  return (
    <section className="space-y-4 rounded-card border border-line bg-panel p-4" aria-labelledby="sales-title">
      <h2 id="sales-title" className="text-xl font-semibold">Your auction sales</h2>
      <p className="text-sm text-fg-2">After reloading or logging out of WoW, open <code>WTF/Account/&lt;account&gt;/SavedVariables/Everloot.lua</code>. The file is read in this tab and stays on your device.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">Everloot SavedVariables
          <input className="max-w-full text-sm text-fg-2 file:mr-2 file:rounded-control file:border file:border-line file:bg-canvas file:p-2 file:text-fg"
            type="file" accept=".lua" onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void read(file);
            }} />
        </label>
        {(ledger || loading) && <button type="button" className="btn" onClick={() => {
          sequence.current += 1;
          setLoading(false);
          setLedger(null);
        }}>Clear report</button>}
      </div>
      {loading && <p role="status">Reading auction sales…</p>}
      {error && <p role="alert" className="text-warning">{error}</p>}
      {report && <>
        <label className="grid max-w-sm gap-1 text-sm">Product (by item name)
          <select className="min-h-10 rounded-control border border-line bg-canvas px-2" value={item} onChange={e => setItem(e.target.value)}>
            <option value="">All products</option>
            {names.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <section aria-labelledby="peak-title">
          <h3 id="peak-title" className="font-semibold">Peak sale hours</h3>
          <p className="text-sm text-fg-2">{peak
            ? `${hourLabel(peak.hour)}–${hourLabel(peak.hour + 1)} UTC · ${peak.notices} sale notices across ${peak.days} days`
            : "A peak needs at least three sale notices in the same UTC hour across two days."}</p>
          <p className="text-sm text-fg-2">Counts the sale notices Everloot saw during play over the last 28 days.</p>
          {report.hours.some(row => row.notices > 0) && <details className="mt-2">
            <summary className="cursor-pointer text-sm">Sale notices by hour (UTC)</summary>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {report.hours.map(row => <li key={row.hour} className="flex items-center gap-3">
                <span className="tabular-nums">{hourLabel(row.hour)}</span>
                <meter aria-hidden="true" className="min-w-0 flex-1" max={maxNotices} value={row.notices} />
                <span className="min-w-20 text-right tabular-nums">{row.notices} <span className="sr-only">notices</span> · {row.days}d</span>
              </li>)}
            </ul>
          </details>}
        </section>
        <section className="space-y-2" aria-labelledby="products-title">
          <h3 id="products-title" className="font-semibold">Your top-selling products</h3>
          <div role="group" aria-label="Sales cycle" className="flex flex-wrap gap-2">
            {SALE_CYCLES.map(([key, label]) => <button className="btn aria-pressed:border-accent" key={key} type="button"
              aria-pressed={key === cycle} onClick={() => setCycle(key)}>{label}</button>)}
          </div>
          {start == null ? <p className="text-sm text-fg-2">This file has no current weekly reset time. Open Everloot in game and reload before reading a fresh copy.</p> : <>
            <p className="text-sm text-fg-2">Payouts collected since {new Date(start * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC.</p>
            {rows.length ? <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left"><th scope="col" className="py-2">Product</th>
                <th scope="col" className="px-2 text-right">Paid auctions</th><th scope="col" className="text-right">Net proceeds</th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.itemName} className="border-b border-line">
                <th scope="row" className="break-words py-2 text-left font-normal">{row.itemName}</th>
                <td className="px-2 text-right tabular-nums">{row.sales}</td>
                <td className="whitespace-nowrap text-right"><Coins copper={row.total} /></td>
              </tr>)}</tbody>
            </table> : <p className="text-sm text-fg-2">No confirmed auction payouts collected in this cycle.</p>}
          </>}
        </section>
      </>}
    </section>
  );
}
