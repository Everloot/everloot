"use client";

import { useEffect, useState } from "react";
import type { FullPriceRow } from "@kb/market";
import { SELECT_CLASS } from "./controls";

const PER_REQUEST = 100;
type Markets = Record<string, string[]>;
export type GuideMarket = { realm: string; house: string; quotes: ReadonlyMap<number, FullPriceRow>; missingBatches: number };

async function readJson<T>(params: URLSearchParams, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/market/prices${params.size ? `?${params}` : ""}`, { signal });
  if (!response.ok) throw new Error("Price request failed");
  return response.json() as Promise<T>;
}

/** Fetches only relevant item IDs, and publishes prices only for the currently selected house. */
export function useGuideMarket(ids: readonly number[], initial: { realm: string; house: string }) {
  const [wantMarkets, setWantMarkets] = useState(Boolean(initial.realm));
  const [revision, setRevision] = useState(0);
  const [realm, setRealm] = useState(initial.realm);
  const [house, setHouse] = useState(initial.house);
  const [catalog, setCatalog] = useState<{ revision: number; markets: Markets | null }>();
  const markets = catalog?.revision === revision ? catalog.markets : undefined;
  const itemKey = ids.join(",");
  const scope = JSON.stringify([realm, house, itemKey, revision]);
  const [loaded, setLoaded] = useState<{ scope: string; market: GuideMarket }>();
  const market = loaded?.scope === scope ? loaded.market : undefined;

  useEffect(() => {
    if (!wantMarkets) return;
    const controller = new AbortController();
    void readJson<{ houses?: Markets }>(new URLSearchParams(), controller.signal)
      .then(({ houses }) => { if (!controller.signal.aborted) setCatalog({ revision, markets: houses ?? null }); })
      .catch(() => { if (!controller.signal.aborted) setCatalog({ revision, markets: null }); });
    return () => controller.abort();
  }, [wantMarkets, revision]);

  useEffect(() => {
    if (!itemKey || !realm || !house || !markets?.[realm]?.includes(house)) return;
    const controller = new AbortController();
    const items = itemKey.split(",");
    void (async () => {
      const quotes = new Map<number, FullPriceRow>();
      let missingBatches = 0;
      // Request small batches serially to avoid a burst against the public market quota.
      for (let index = 0; index < items.length && !controller.signal.aborted; index += PER_REQUEST) {
        const params = new URLSearchParams({ realm, house, items: items.slice(index, index + PER_REQUEST).join(","), fields: "full" });
        try {
          const data = await readJson<{ ok: boolean; items: FullPriceRow[] }>(params, controller.signal);
          if (!data.ok || !Array.isArray(data.items)) throw new Error("Prices unavailable");
          for (const row of data.items) if (row[0] > 0 && Number.isFinite(row[2]) && row[2] >= 0) quotes.set(row[0], row);
        } catch {
          missingBatches++;
        }
      }
      if (!controller.signal.aborted) setLoaded({ scope, market: { realm, house, quotes, missingBatches } });
    })();
    return () => controller.abort();
  }, [realm, house, itemKey, scope, markets]);

  return {
    realm, setRealm, house, setHouse, market, markets,
    pending: wantMarkets && (markets === undefined || Boolean(itemKey && realm && house && markets?.[realm]?.includes(house) && !market)),
    load() { if (wantMarkets) setRevision(value => value + 1); else setWantMarkets(true); },
  };
}

export function GuideMarketControls({ state }: { state: ReturnType<typeof useGuideMarket> }) {
  const { markets, market, realm, house, setRealm, setHouse, pending, load } = state;
  const houses = markets?.[realm] ?? [];
  const matchedRealm = Boolean(markets?.[realm]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {markets && <label className="text-cell text-fg-2">
          Realm
          <select className={SELECT_CLASS} value={matchedRealm ? realm : ""} onChange={event => {
            const next = event.target.value;
            setRealm(next);
            setHouse(markets[next]?.length === 1 ? markets[next][0]! : "");
          }}>
            <option value="">Choose a realm</option>
            {Object.keys(markets).sort().map(name => <option key={name}>{name}</option>)}
          </select>
        </label>}
        {matchedRealm && <label className="text-cell text-fg-2">
          Auction house
          <select className={SELECT_CLASS} value={houses.includes(house) ? house : ""} onChange={event => setHouse(event.target.value)}>
            <option value="">Choose an auction house</option>
            {houses.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>}
        <button className="btn" type="button" disabled={pending} onClick={load}>
          {pending ? "Loading auction prices…" : markets ? "Refresh auction prices" : "Load auction prices"}
        </button>
      </div>
      {markets === null && <p role="status" className="text-meta text-fg-2">Auction houses are unavailable. You can still plan by skill.</p>}
      {markets && realm && !matchedRealm && <p role="status" className="text-meta text-fg-2">The realm in this link has no public prices.</p>}
      {market && <p role="status" className="text-meta text-fg-2">
        {market.quotes.size ? `${market.realm} · ${market.house} · Everloot listing estimates` : "No public prices for these items on this house."}
        {market.missingBatches > 0 && " Some price requests failed. The comparison is incomplete."}
      </p>}
    </div>
  );
}
