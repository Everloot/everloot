"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { AHLEDGER_SITE, ahledgerCredit, isAhledgerMarket, type AhledgerCredit } from "@/lib/ahledger";

type Read<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; data: T; credit: AhledgerCredit };

/** Response data lives only in this mounted panel. A change discards the old market's answer. No URL reads nothing yet. */
export function useAhledger<T>(url: string | null, field: string): Read<T> {
  const [read, setRead] = useState<{ url: string | null; value: Read<T> }>({ url, value: { state: "loading" } });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setRead({ url, value: { state: "loading" } });
    fetch(url, { signal: controller.signal }).then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      if (body.ok !== true || body[field] == null) throw new Error("Unreadable answer");
      // Recheck the URL even when reading our own proxy.
      const credit = ahledgerCredit({ attribution: body.credit });
      if (!controller.signal.aborted) setRead({ url, value: { state: "ready", data: body[field] as T, credit } });
    }).catch(() => {
      if (!controller.signal.aborted) setRead({ url, value: { state: "failed" } });
    });
    return () => controller.abort();
  }, [url, field]);
  return read.url === url ? read.value : { state: "loading" };
}

export function AhledgerPanel({ title, state, credit, controls, children }: {
  title: string; state: Read<unknown>["state"]; credit?: AhledgerCredit; controls?: ReactNode; children: ReactNode;
}) {
  const heading = useId();
  return <section aria-labelledby={heading} data-ahledger={state} className="space-y-3">
    <h2 id={heading} className="text-control font-medium text-fg">{title}</h2>
    {controls}
    {state === "loading" && <p role="status" className="text-meta text-fg-2">Reading AH Ledger…</p>}
    {state === "failed" && <p role="status" className="text-meta text-fg-2">AH Ledger could not be read right now. Try again in a few minutes.</p>}
    {state === "ready" && children}
    <p className="text-meta text-fg-2"><a href={credit?.url ?? AHLEDGER_SITE} rel="noopener">Prices from AHledger</a></p>
  </section>;
}

const SELECT = "min-h-10 rounded-control border border-line bg-canvas px-2 text-sm text-fg";
export const DEFAULT_AHLEDGER_MARKET = "forever.normal.alliance.us";

/** The market this browser last picked in any AH Ledger panel. Nothing is sent anywhere. */
export const AHLEDGER_MARKET_SLOT = "everloot.ahledger.market.v1";

/**
 * The panel's market and the visitor's choice of another, which this browser remembers. A page's own market (the
 * realm's, on a realm page) comes first; otherwise the remembered one, else the default. Null until the browser's copy
 * is read, so no panel asks AH Ledger for a market it is about to replace.
 */
export function useAhledgerMarket(pageMarket?: string): [string | null, (market: string) => void] {
  const [market, setMarket] = useState<string | null>(pageMarket ?? null);
  useEffect(() => {
    if (pageMarket) return;
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(AHLEDGER_MARKET_SLOT); } catch {}
    setMarket(saved && isAhledgerMarket(saved) ? saved : DEFAULT_AHLEDGER_MARKET);
  }, [pageMarket]);
  const choose = useCallback((next: string) => {
    setMarket(next);
    try { window.localStorage.setItem(AHLEDGER_MARKET_SLOT, next); } catch {}
  }, []);
  return [market, choose];
}

/** AH Ledger has no Hardcore market; Taiwanese realms share KR. */
export function AhledgerMarketPicker({ market, onChange }: { market: string; onChange: (market: string) => void }) {
  const [, ruleset, faction, region] = market.split(".");
  return <fieldset className="flex flex-wrap gap-3 text-meta text-fg-2">
    <legend className="sr-only">AH Ledger market</legend>
    <label className="flex items-center gap-2">Region <select className={SELECT} value={region} onChange={(e) => onChange(`forever.${ruleset}.${faction}.${e.target.value}`)}>
      <option value="us">US</option><option value="eu">EU</option><option value="kr">KR / TW</option>
    </select></label>
    <label className="flex items-center gap-2">Ruleset <select className={SELECT} value={ruleset} onChange={(e) => onChange(`forever.${e.target.value}.${faction}.${region}`)}>
      <option value="normal">PvE</option><option value="pvp">PvP</option><option value="rp">RP</option><option value="rppvp">RP-PvP</option>
    </select></label>
    <label className="flex items-center gap-2">Faction <select className={SELECT} value={faction} onChange={(e) => onChange(`forever.${ruleset}.${e.target.value}.${region}`)}>
      <option value="alliance">Alliance</option><option value="horde">Horde</option>
    </select></label>
  </fieldset>;
}

export const salesText = (n: number | null) => n === null ? "unrecorded" : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
