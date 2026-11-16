import { NextResponse } from "next/server";
import { AHLEDGER_API, ahledgerCredit, upstreamCacheHeaders } from "./ahledger";

const NO_STORE = { "Cache-Control": "no-store" };
export const proxyError = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
export function refuseOtherSite(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  return site && site !== "same-origin" ? proxyError("For everloot.app pages only.", 403) : null;
}

/** Called only with a validated, allow-listed path. Fetch never persists a response. */
export async function readAhledger(path: string, select: (body: unknown) => Record<string, unknown>) {
  const key = process.env.AHLEDGER_API_KEY?.trim();
  try {
    const upstream = await fetch(`${AHLEDGER_API}/v1/${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Everloot (https://everloot.app)", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
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
