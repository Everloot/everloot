import { economyMarkets } from "@/lib/ahledger";
import { proxyError, readAhledger, refuseOtherSite } from "@/lib/ahledger-proxy";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refused = refuseOtherSite(req);
  if (refused) return refused;
  if (new URL(req.url).search) return proxyError("Economy takes no query parameters.", 400);
  return readAhledger("economy", (body) => ({ markets: economyMarkets(body) }));
}
