"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card, CopyButton, Input } from "@/components/ui";
import type { SearchRecipe } from "@/lib/profession-planner";
import { formatCopper } from "@kb/profession-path";
import type { FullPriceRow } from "@kb/market";
import { SELECT_CLASS } from "./controls";

export default function RecipeShopping({ recipe, initialCrafts }: { recipe: SearchRecipe; initialCrafts: number }) {
  const [count, setCount] = useState(String(initialCrafts));
  const [houses, setHouses] = useState<Record<string, string[]> | null>(null);
  const [realm, setRealm] = useState("");
  const [house, setHouse] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [marketError, setMarketError] = useState(false);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: FullPriceRow[] | null }>();
  const ids = [...new Set(recipe.reagents.map(r => r.itemId))].sort((a, b) => a - b).join(",");
  const key = JSON.stringify([realm, house, ids, request]);
  const trades = Number(count);
  const valid = Number.isInteger(trades) && trades >= 1 && trades <= 999;

  async function loadMarkets() {
    setDiscovering(true);
    setMarketError(false);
    try {
      const response = await fetch("/api/market/prices");
      if (!response.ok) throw new Error();
      const data: { houses: Record<string, string[]> } = await response.json();
      if (!data.houses || typeof data.houses !== "object") throw new Error();
      setHouses(data.houses);
    } catch {
      setMarketError(true);
    } finally {
      setDiscovering(false);
    }
  }

  useEffect(() => {
    if (!realm || !house) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ realm, house, items: ids, fields: "full" });
    void fetch(`/api/market/prices?${query}`, { signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: { ok: boolean; items: FullPriceRow[] } = await response.json();
        if (!data.ok || !Array.isArray(data.items)) throw new Error();
        if (!abort.signal.aborted) setResult({ key, rows: data.items });
      }).catch(() => { if (!abort.signal.aborted) setResult({ key, rows: null }); });
    return () => abort.abort();
  }, [realm, house, ids, key]);

  function changeCount(value: string) {
    setCount(value);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 999) return;
    const url = new URL(window.location.href);
    url.searchParams.set("crafts", String(n));
    window.history.replaceState(window.history.state, "", url);
  }

  const current = result?.key === key ? result : undefined;
  const quotes = new Map(current?.rows?.map(row => [row[0], row]));
  const materials = recipe.reagents.map(r => ({ ...r, amount: valid ? r.count * trades : null, quote: quotes.get(r.itemId) }));
  const pricedCount = materials.filter(r => r.quote).length;
  const cost = materials.reduce((sum, r) => sum + (r.quote?.[2] ?? 0) * (r.amount ?? 0), 0);
  const complete = pricedCount === materials.length;
  const lines = materials.map(r => `${r.amount} × ${r.name}${r.quote
    ? ` — ${formatCopper(r.quote[2] * (r.amount ?? 0))} (${r.quote[5]}${r.quote[8] > 2 ? ", stale" : ""})`
    : current?.rows ? " — no quote" : ""}`);
  const priceNote = `${realm}, ${house} auction house · Everloot listed-price estimates`;
  const copy = [recipe.name, `${trades} crafts`, ...(current?.rows ? [priceNote] : []), ...lines,
    ...(pricedCount ? [`${complete ? "Estimated material total" : "Known subtotal (incomplete)"}: ${formatCopper(cost)}`] : [])].join("\n");

  return (
    <section id="recipe-shopping" aria-labelledby="recipe-shopping-heading" className="scroll-mt-24">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 id="recipe-shopping-heading" className="break-words text-xl font-semibold text-fg">{recipe.name}</h3>
            <p className="mt-1 flex items-center gap-2 text-meta text-muted"><Badge tone="files" /> Materials from game files</p>
          </div>
          <label className="grid gap-1 text-cell text-fg-2">Crafts
            <Input className="w-24" type="number" min={1} max={999} step={1} value={count} onChange={e => changeCount(e.target.value)} />
          </label>
        </div>
        {!houses ? <button type="button" className="btn" disabled={discovering} onClick={() => void loadMarkets()}>
          {discovering ? "Loading auction houses…" : "Load auction prices"}
        </button> : <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-wrap items-center gap-y-1 text-cell">Realm
            <select aria-label="Realm" className={SELECT_CLASS} value={realm} onChange={e => { setRealm(e.target.value); setHouse(""); setResult(undefined); }}>
              <option value="">Select realm</option>
              {Object.keys(houses).sort().map(name => <option key={name}>{name}</option>)}
            </select>
          </label>
          {realm && <label className="text-cell">Auction house
            <select aria-label="Auction house" className={SELECT_CLASS} value={house} onChange={e => { setHouse(e.target.value); setResult(undefined); }}>
              <option value="">Select house</option>
              {houses[realm].map(name => <option key={name}>{name}</option>)}
            </select>
          </label>}
          {Object.keys(houses).length === 0 && <p className="text-muted">No auction houses have public quotes yet.</p>}
        </div>}
        {(marketError || current?.rows === null) && <div className="flex flex-wrap items-center gap-2" role="status">
          <span>Market prices unavailable. Material quantities are ready to copy.</span>
          {current?.rows === null && <button type="button" className="btn" onClick={() => setRequest(n => n + 1)}>Retry prices</button>}
        </div>}
        {house && !current && <p className="text-muted" role="status">Loading prices…</p>}
        {current?.rows && <p className="text-meta text-muted">{priceNote}. These are recent observations, not guaranteed live offers.</p>}
        {!valid && <p role="status">Enter a whole number from 1 to 999 crafts.</p>}
        <ul className="divide-y divide-line border-y border-line">
          {materials.map((r, index) => <li key={`${r.itemId}:${index}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
            <span className="min-w-0 break-words">{r.amount !== null ? `${r.amount} × ` : ""}<Link href={`/database/items/${r.itemId}`} className="underline decoration-edge underline-offset-4 hover:decoration-fg">{r.name}</Link></span>
            {current?.rows && <span className="text-right text-meta text-muted">{r.quote
              ? `${r.amount !== null ? formatCopper(r.quote[2] * r.amount) + " · " : ""}${formatCopper(r.quote[2])} each · ${r.quote[5]}${r.quote[8] > 2 ? " (stale)" : ""}`
              : "No quote"}</span>}
          </li>)}
        </ul>
        {valid && current?.rows && <div role="status" className="space-y-1">
          {pricedCount > 0 && <p className="font-semibold">{complete ? "Estimated material total" : "Known subtotal"}: {formatCopper(cost)}</p>}
          {complete ? <p className="text-meta text-muted">{formatCopper(cost / trades)} per craft</p> : <p>Batch total incomplete. One or more reagents have no quote.</p>}
        </div>}
        {valid && <CopyButton text={copy} label="Copy recipe shopping list" />}
      </Card>
    </section>
  );
}
