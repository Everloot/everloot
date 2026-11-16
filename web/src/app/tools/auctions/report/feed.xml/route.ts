import { reportDates, storedAuctionReport } from "@/lib/auction-report-store";
import { reportHref } from "@/lib/auction-report";
import { absoluteUrl } from "@/lib/seo";
export const dynamic = "force-dynamic";
const xml = (s: string) => s.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
export async function GET() {
 const reports = await Promise.all((await reportDates()).slice(0,30).map(d => storedAuctionReport(d)));
 const items = reports.flatMap(r => r ? [`<item><title>${xml(`Daily auction report · ${r.date}`)}</title><link>${xml(absoluteUrl(reportHref(r.date)))}</link><guid isPermaLink="true">${xml(absoluteUrl(reportHref(r.date)))}</guid><description>${xml(`${r.headline} Listed asking prices, not sales. ${r.houses.length} houses covered; ${r.date} UTC.`)}</description></item>`] : []);
 return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Everloot daily auction reports</title><link>${xml(absoluteUrl("/tools/auctions/report"))}</link><description>Public daily asking prices from scans, not sales.</description>${items.join("")}</channel></rss>`, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "CDN-Cache-Control": "max-age=3600" } });
}
