import { realmBoards, sitemapPaths } from "@/lib/auction-house";
import { uploadStore } from "@/lib/upload-store";

/** Auction House URLs per sitemap file, under the protocol's 50,000. */
export const AUCTIONS_CHUNK = 40_000;

/** The indexable Auction House pages, or null when the market rollup cannot be read. */
export async function auctionPaths(): Promise<string[] | null> {
  const market = await uploadStore.loadMarket();
  return market.state ? sitemapPaths(realmBoards(market.state)) : null;
}

export function auctionsUnavailable(): Response {
  return Response.json({ error: "Market values unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "no-store", "CDN-Cache-Control": "no-store" } });
}

/** The market rollup changes every ten minutes; crawlers do not need it fresher than hourly. */
export const AUCTIONS_SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};
