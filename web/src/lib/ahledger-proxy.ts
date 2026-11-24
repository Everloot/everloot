import { NextResponse } from "next/server";
import { AHLEDGER_API, ahledgerCredit, lifetimes, upstreamCacheHeaders, type AhledgerCredit } from "./ahledger";
import type { EdgeCacheStore } from "./cf-edge-cache";

const NO_STORE = { "Cache-Control": "no-store" };
export const proxyError = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
export function refuseOtherSite(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  return site && site !== "same-origin" ? proxyError("For everloot.app pages only.", 403) : null;
}

/** Called only with a validated, allow-listed path. Fetch never persists a response. */
function askAhledger(path: string, timeoutMs: number) {
  const key = process.env.AHLEDGER_API_KEY?.trim();
  return fetch(`${AHLEDGER_API}/v1/${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "Everloot (https://everloot.app)", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function readAhledger(path: string, select: (body: unknown) => Record<string, unknown>) {
  try {
    const upstream = await askAhledger(path, 8000);
    if (!upstream.ok) {
      const busy = upstream.status === 429 || upstream.status === 503;
      const retry = upstream.headers.get("retry-after");
      return NextResponse.json({ ok: false, error: busy ? "AH Ledger is busy; try again shortly." : "AH Ledger could not answer." }, {
        status: busy ? 503 : 502, headers: { ...NO_STORE, ...(busy && retry ? { "Retry-After": retry } : {}) },
      });
    }
    const body: unknown = await upstream.json();
    return NextResponse.json({ ok: true, ...select(body), credit: ahledgerCredit(body) }, { headers: upstreamCacheHeaders(upstream.headers.get("cache-control")) });
  } catch {
    return proxyError("AH Ledger could not be read right now.", 502);
  }
}

/** The longest a page read is shared between renders, whatever AH Ledger allows: the professions pages' own edge lifetime. */
const PAGE_READ_MAX_AGE = 300;

type PageRead<T> = { ok: true; value: T; credit: AhledgerCredit } | { ok: false };

/**
 * The same read for a page rendered on the server: only what `select` keeps, with the credit. Any failure, including
 * an answer `select` cannot read, is `{ ok: false }`, never empty data.
 *
 * Every sort, filter and page of one market renders from one upstream path, so the selected answer is kept in the
 * Worker's Cache API (`caches.default`, as mcp-response-cache.ts) under that path, for AH Ledger's own shared lifetime
 * and at most PAGE_READ_MAX_AGE seconds: one AH Ledger call per market and profession instead of one per URL. An
 * answer AH Ledger marks private or no-store, and any failure, is not kept. A path has one `select` (the page's).
 */
export async function readAhledgerPage<T>(path: string, select: (body: unknown) => T, suppliedStore?: EdgeCacheStore): Promise<PageRead<T>> {
  const store = suppliedStore ?? (globalThis as unknown as { caches?: { default?: EdgeCacheStore } }).caches?.default;
  const key = new Request(`${AHLEDGER_API}/v1/${path}`);
  try {
    const hit = await store?.match(key);
    if (hit) return await hit.json() as PageRead<T>;
  } catch { /* A cache outage reads AH Ledger live. */ }
  let read: PageRead<T>;
  let header: string | null;
  try {
    const upstream = await askAhledger(path, 5000);
    if (!upstream.ok) return { ok: false };
    header = upstream.headers.get("cache-control");
    const body: unknown = await upstream.json();
    read = { ok: true, value: select(body), credit: ahledgerCredit(body) };
  } catch {
    return { ok: false };
  }
  const life = /\b(private|no-store|no-cache)\b/i.test(header ?? "") ? null : lifetimes(header);
  const ttl = Math.min(life?.shared ?? 0, PAGE_READ_MAX_AGE);
  if (store && ttl > 0) {
    try {
      await store.put(key, Response.json(read, { headers: { "Cache-Control": `public, max-age=${ttl}` } }));
    } catch { /* A cache outage never changes the live answer. */ }
  }
  return read;
}
