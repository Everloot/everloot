import { NextResponse } from "next/server";
import { MARKET_PRICE_FIELDS } from "@everloot/protocol";
import { AUCTION_AGREEMENT } from "@kb/auction-history";
import { MARKET_RULE, MAX_PRICE_ITEMS, MAX_PRICE_ROWS, marketHouses, marketPrices, marketRealms, parseHouse, validRealm } from "@kb/market";
import { admit, attribution, attributionHeaders } from "@/lib/data-guard";
import { pendingRealms } from "@/lib/auction-house";
import { uploadStore } from "@/lib/upload-store";
export const dynamic = "force-dynamic";

/** The positions of a row, from the protocol: the seven first given, then updatedAt, ageDays and change1d. Only ever appended to. */
const FIELDS = MARKET_PRICE_FIELDS;
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
 * `house` (Alliance, Horde or Neutral, any case) asks for one auction house: each house is its own market, and the
 * companion asks for each house it writes. Without it the answer holds only scans that named neither a house nor a
 * faction, and days folded before houses were kept apart: an older companion's request. Those may mix houses, so no
 * house's price ever comes from them, and every scan that names its house is left out of them.
 * `items=2589,2592` selects up to 100 positive item ids before the row cap, with a realm; unknown or
 * non-public items are omitted. Without it the most-listed items are returned as before.
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
  const itemParams = new URL(req.url).searchParams.getAll("items");
  let itemIds: number[] | undefined;
  if (itemParams.length) {
    const raw = itemParams[0];
    const parts = raw.split(",");
    if (!realm || itemParams.length !== 1 || raw.length > MAX_PRICE_ITEMS * 17 ||
      parts.length > MAX_PRICE_ITEMS || parts.some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
      return NextResponse.json({ ok: false, error: `items is a comma-separated list of at most ${MAX_PRICE_ITEMS} positive integer ids, with a realm.` }, { status: 400, headers: NO_STORE });
    }
    itemIds = parts.map(Number);
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
    { ok: true, dataAsOf: market.dataAsOf, rule: MARKET_RULE, fields: FIELDS, ...marketPrices(market.state, realm, new Date(), MAX_PRICE_ROWS, house, itemIds), attribution: credit },
    { headers: cache },
  );
}
