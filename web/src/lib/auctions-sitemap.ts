import { reportDates } from "./auction-report-store";
import { reportHref, REPORT_PATH } from "./auction-report";
import { realmBoards, sitemapPaths } from "@/lib/auction-house";
import { uploadStore } from "@/lib/upload-store";

/** Auction House URLs per sitemap file, under the protocol's 50,000. */
export const AUCTIONS_CHUNK = 40_000;

/** The indexable Auction House pages, or null when the market rollup cannot be read. */
export async function auctionPaths(): Promise<string[] | null> {
  const market = await uploadStore.loadMarket();
  if (!market.state) return null;
  const dates = await reportDates();
  const reports = dates.length ? [REPORT_PATH, ...dates.map(reportHref)] : [];
  return [...sitemapPaths(realmBoards(market.state)), ...reports];
}

export function auctionsUnavailable(): Response {
  return Response.json({ error: "Market values unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "CDN-Cache-Control": "no-store" } });
}

/** The market rollup changes every ten minutes; crawlers do not need it fresher than hourly. */
export const AUCTIONS_SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, must-revalidate",
  // Next overwrites Cache-Control on dynamic routes, so the CDN reads these instead.
  "CDN-Cache-Control": "max-age=3600, stale-while-revalidate=86400",
};
