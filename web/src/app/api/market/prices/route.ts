import { NextResponse } from "next/server";
import { AUCTION_AGREEMENT } from "../../../../../../kb/src/auction-history";
import { MARKET_RULE, MAX_PRICE_ROWS, marketHouses, marketPrices, marketRealms, parseHouse, validRealm } from "../../../../../../kb/src/market";
import { admit, attribution, attributionHeaders } from "@/lib/data-guard";
import { pendingRealms } from "@/lib/auction-house";
import { uploadStore } from "@/lib/upload-store";
export const dynamic = "force-dynamic";

const FIELDS = ["itemId", "market", "min", "historical", "quantity", "day", "reporters"] as const;
// The rollup changes once per cron run (ten minutes); let the CDN answer repeat requests. On the Worker only
// `CDN-Cache-Control` is honoured (lib/cf-edge-cache.ts keeps a response for its max-age); `s-maxage` is for
// the rollback host. A request that hits the edge cache never reaches the quota.
const CACHE = { "Cache-Control": "public, max-age=0, s-maxage=300", "CDN-Cache-Control": "max-age=300" };
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/market/prices?realm=<realm> — the items with the most units listed on that realm that have a
 * public market value, as tuples (see `fields`), at most MAX_PRICE_ROWS of them. The companion writes
 * them into the EverlootPrices slot addon. Without `realm` it lists the realms that have public values, and in
 * `pending` the realms with scans but none public yet, each with how many reporters have scanned there (a count only).
 * `house` (Alliance, Horde or Neutral, any case) narrows a realm to the scans of that auction house;
 * without it the values blend every house, as they did before scans named their house.
 * Install ids and upload addresses stay on the site. Requests the CDN does not answer count against a
 * per-IP quota, or against the caller's key (lib/data-guard.ts).
 */
export async function GET(req: Request) {
  const admitted = await admit(req, "market");
  if (admitted instanceof Response) return admitted;
  // A keyed answer is counted against that key, so the CDN must not hand it to anyone else.
  const cache = { ...(admitted.tier === "key" ? NO_STORE : CACHE), ...attributionHeaders() };
  const realm = new URL(req.url).searchParams.get("realm")?.trim() ?? "";
  if (realm && !validRealm(realm)) return NextResponse.json({ ok: false, error: "Not a realm name." }, { status: 400, headers: NO_STORE });
  const houseParam = new URL(req.url).searchParams.get("house");
  const house = houseParam === null ? null : parseHouse(houseParam);
  if (houseParam !== null && (!house || !realm)) {
    return NextResponse.json({ ok: false, error: "house is Alliance, Horde or Neutral, with a realm." }, { status: 400, headers: NO_STORE });
  }
  const market = await uploadStore.loadMarket();
  if (!market.state) {
    return NextResponse.json({ ok: false, error: "Market values unavailable. They are unrecorded, not zero." },
      { status: 503, headers: NO_STORE });
  }
  const credit = attribution("/tools/auctions");
  if (!realm) {
    const pending = pendingRealms(market.state).map((p) => ({ realm: p.realm, reporters: p.reporters, needed: AUCTION_AGREEMENT }));
    return NextResponse.json({ ok: true, dataAsOf: market.dataAsOf, realms: marketRealms(market.state), houses: marketHouses(market.state), pending, attribution: credit }, { headers: cache });
  }
  return NextResponse.json(
    { ok: true, dataAsOf: market.dataAsOf, rule: MARKET_RULE, fields: FIELDS, ...marketPrices(market.state, realm, new Date(), MAX_PRICE_ROWS, house), attribution: credit },
    { headers: cache },
  );
}
