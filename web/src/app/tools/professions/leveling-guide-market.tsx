"use client";

import { useEffect, useState } from "react";
import type { FullPriceRow } from "@kb/market";
import { realmSlug } from "@/lib/auction-house";
import { SELECT_CLASS } from "./controls";

const PER_REQUEST = 100;
const MARKET_SLOT = "everloot.profession-guide.market.v1";
type Markets = Record<string, string[]>;
type Selection = { realm: string; house: string };
const NO_HOUSES: readonly string[] = [];
export type GuideMarket = { realm: string; house: string; quotes: ReadonlyMap<number, FullPriceRow>; missingBatches: number };

function marketHouses(markets: Markets | null | undefined, realm: string): readonly string[] {
  const houses = markets?.[realm];
  return Array.isArray(houses) ? houses.filter(house => typeof house === "string") : NO_HOUSES;
}

function selectedHouse(houses: readonly string[], requested: string): string {
  return houses.find(house => house.toLowerCase() === requested.toLowerCase())
    ?? (!requested && houses.length === 1 ? houses[0]! : "");
}

function selectedRealm(markets: Markets | null | undefined, requested: string): string {
  if (!markets || !requested || Object.hasOwn(markets, requested)) return requested;
  const slug = realmSlug(requested);
  const matches = Object.keys(markets).filter(name => realmSlug(name) === slug);
  return matches.length === 1 ? matches[0]! : requested;
}

function savedSelection(): Selection | undefined {
  try {
    const saved: Partial<Selection> | null = JSON.parse(window.localStorage.getItem(MARKET_SLOT) ?? "null");
    if (saved && typeof saved.realm === "string" && typeof saved.house === "string") {
      return { realm: saved.realm, house: saved.house };
    }
  } catch { /* Browser storage is optional. */ }
}

async function readJson<T>(params: URLSearchParams, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/market/prices${params.size ? `?${params}` : ""}`, { signal });
  if (!response.ok) throw new Error("Price request failed");
  return response.json() as Promise<T>;
}

/** Fetches only relevant item IDs, and publishes prices only for the currently selected house. */
export function useGuideMarket(ids: readonly number[], initial: Selection) {
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState(initial);
  const [catalog, setCatalog] = useState<{ revision: number; markets: Markets | null }>();
  const markets = catalog?.revision === revision ? catalog.markets : undefined;
  const realm = selectedRealm(markets, selection.realm);
  const houses = marketHouses(markets, realm);
  const house = selectedHouse(houses, selection.house);
  const itemKey = ids.join(",");
  const scope = JSON.stringify([realm, house, itemKey, revision]);
  const [loaded, setLoaded] = useState<{ scope: string; market: GuideMarket }>();
  const market = loaded?.scope === scope ? loaded.market : undefined;

  useEffect(() => {
    const linked = { realm: initial.realm, house: initial.house };
    setSelection(linked.realm ? linked : savedSelection() ?? linked);
  }, [initial.realm, initial.house]);

  useEffect(() => {
    const controller = new AbortController();
    void readJson<{ houses?: Markets }>(new URLSearchParams(), controller.signal)
      .then(({ houses }) => { if (!controller.signal.aborted) setCatalog({ revision, markets: houses ?? null }); })
      .catch(() => { if (!controller.signal.aborted) setCatalog({ revision, markets: null }); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!itemKey || !realm || !house) return;
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
  }, [realm, house, itemKey, scope]);

  function choose(next: Selection) {
    setSelection(next);
    try {
      if (next.realm) window.localStorage.setItem(MARKET_SLOT, JSON.stringify(next));
      else window.localStorage.removeItem(MARKET_SLOT);
    } catch { /* A blocked preference does not prevent price lookup. */ }
  }

  return {
    realm, house, houses, market, markets,
    setRealm(next: string) { choose({ realm: next, house: selectedHouse(marketHouses(markets, next), "") }); },
    setHouse(next: string) { choose({ realm, house: next }); },
    pending: markets === undefined || Boolean(itemKey && realm && house && !market),
    load() { setRevision(value => value + 1); },
  };
}

export function GuideMarketControls({ state }: { state: ReturnType<typeof useGuideMarket> }) {
  const { markets, market, realm, house, houses, setRealm, setHouse, pending, load } = state;
  const realms = Object.keys(markets ?? {}).sort();
  const matchedRealm = realms.includes(realm);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {realms.length > 0 && <label className="text-cell text-fg-2">
          Realm
          <select className={SELECT_CLASS} value={matchedRealm ? realm : ""} onChange={event => setRealm(event.target.value)}>
            <option value="">No auction prices</option>
            {realms.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>}
        {(houses.length > 1 || (houses.length === 1 && !house)) && <label className="text-cell text-fg-2">
          Auction house
          <select className={SELECT_CLASS} value={house} onChange={event => setHouse(event.target.value)}>
            <option value="">Choose an auction house</option>
            {houses.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>}
      </div>
      {pending && <p role="status" className="text-meta text-fg-2">Loading auction prices…</p>}
      {markets === null && <p role="status" className="text-meta text-fg-2">
        Auction prices are unavailable. <button className="underline underline-offset-4" type="button" onClick={load}>Retry prices</button>
      </p>}
      {markets && !realms.length && <p role="status" className="text-meta text-fg-2">No public auction prices are available.</p>}
      {markets && realm && !matchedRealm && <p role="status" className="text-meta text-fg-2">The selected realm has no public prices.</p>}
      {market && <p role="status" className="text-meta text-fg-2">
        {market.quotes.size ? `${market.realm} · ${market.house} · Everloot listing estimates` : "No public prices for these items on this house."}
        {market.missingBatches > 0 && <> Some prices could not load. <button className="underline underline-offset-4" type="button" onClick={load}>Retry prices</button></>}
      </p>}
    </div>
  );
}
