import { NextResponse } from "next/server";
import { AHLEDGER_API, AHLEDGER_SITE, MAX_ITEMS, ahledgerMarketLabel, isAhledgerMarket, itemsParam, lifetimes, tooltipPrices } from "@/lib/ahledger";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/ahledger/<market>?items=2589,2592 — AH Ledger's latest price for each item on one market (lib/ahledger.ts),
 * read from its tooltip endpoint with Everloot's key and answered with only the fields the auction pages show and the
 * credit link. Nothing is stored: the answer carries AH Ledger's own lifetimes, a browser keeps it for its max-age and
 * the edge for its s-maxage (lib/cf-edge-cache.ts), and an answer AH Ledger marks private is passed on uncached.
 * For Everloot's own pages: a browser request from another site is refused.
 */
export async function GET(req: Request, { params }: { params: Promise<{ market: string }> }) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return NextResponse.json({ ok: false, error: "For everloot.app pages only." }, { status: 403, headers: NO_STORE });
  const { market } = await params;
  if (!isAhledgerMarket(market)) return NextResponse.json({ ok: false, error: "Not an AH Ledger market." }, { status: 400, headers: NO_STORE });
  const items = itemsParam(new URL(req.url).searchParams.get("items"));
  if (!items) return NextResponse.json({ ok: false, error: `items is 1 to ${MAX_ITEMS} item ids, comma separated.` }, { status: 400, headers: NO_STORE });

  const key = process.env.AHLEDGER_API_KEY?.trim();
  let upstream: Response;
  try {
    upstream = await fetch(`${AHLEDGER_API}/v1/tooltip/${market}?items=${items.join(",")}`, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Everloot (https://everloot.app)", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "AH Ledger did not answer." }, { status: 502, headers: NO_STORE });
  }
  if (!upstream.ok) {
    const busy = upstream.status === 429 || upstream.status === 503;
    const retry = upstream.headers.get("retry-after");
    return NextResponse.json(
      { ok: false, error: busy ? "AH Ledger is busy; try again shortly." : "AH Ledger could not answer." },
      { status: busy ? 503 : 502, headers: { ...NO_STORE, ...(busy && retry ? { "Retry-After": retry } : {}) } },
    );
  }
  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return NextResponse.json({ ok: false, error: "AH Ledger could not answer." }, { status: 502, headers: NO_STORE });
  }
  const life = lifetimes(upstream.headers.get("cache-control"));
  const headers = life
    ? { "Cache-Control": `public, max-age=${life.browser}`, "CDN-Cache-Control": `max-age=${life.shared}` }
    : NO_STORE;
  return NextResponse.json({
    ok: true,
    market,
    label: ahledgerMarketLabel(market),
    prices: tooltipPrices(body),
    credit: { text: "Prices from AHledger", url: AHLEDGER_SITE },
  }, { headers });
}
