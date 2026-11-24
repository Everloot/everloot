import { NextResponse } from "next/server";
import { AHLEDGER_API, ahledgerCredit, upstreamCacheHeaders, type AhledgerCredit } from "./ahledger";

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

/**
 * The same read for a page rendered on the server: only what `select` keeps, with the credit, and kept nowhere but
 * the rendered page. Any failure, including an answer `select` cannot read, is `{ ok: false }`, never empty data.
 */
export async function readAhledgerPage<T>(path: string, select: (body: unknown) => T): Promise<{ ok: true; value: T; credit: AhledgerCredit } | { ok: false }> {
  try {
    const upstream = await askAhledger(path, 5000);
    if (!upstream.ok) return { ok: false };
    const body: unknown = await upstream.json();
    return { ok: true, value: select(body), credit: ahledgerCredit(body) };
  } catch {
    return { ok: false };
  }
}
