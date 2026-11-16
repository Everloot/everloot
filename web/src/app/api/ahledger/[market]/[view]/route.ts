import { craftingMargins, dealPrices, isAhledgerMarket, isAhledgerProfession, itemsParam, priceHistory } from "@/lib/ahledger";
import { proxyError, readAhledger, refuseOtherSite } from "@/lib/ahledger-proxy";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ market: string; view: string }> }) {
  const refused = refuseOtherSite(req);
  if (refused) return refused;
  const { market, view } = await params;
  if (!isAhledgerMarket(market)) return proxyError("Not an AH Ledger market.", 400);
  const query = new URL(req.url).searchParams;
  const only = (...keys: string[]) => [...query.keys()].every((k) => keys.includes(k) && query.getAll(k).length === 1);
  if (view === "history") {
    const ids = itemsParam(query.get("item"));
    if (!only("item") || ids?.length !== 1) return proxyError("item must be one positive item id.", 400);
    return readAhledger(`prices/${market}/${ids[0]}?range=30d`, (body) => ({ history: priceHistory(body) }));
  }
  if (view === "crafting") {
    const profession = query.get("profession") ?? "";
    if (!only("profession") || !isAhledgerProfession(profession)) return proxyError("Not an AH Ledger profession.", 400);
    return readAhledger(`crafting/${market}?profession=${encodeURIComponent(profession)}`, (body) => ({ recipes: craftingMargins(body) }));
  }
  if (view === "deals" && only()) return readAhledger(`deals/${market}?pct=25&units=5`, (body) => ({ deals: dealPrices(body) }));
  return proxyError("Not an AH Ledger view or query.", 400);
}
