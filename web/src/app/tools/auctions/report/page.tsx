import { pageMetadata } from "@/lib/seo";
import { reportDates, storedAuctionReport } from "@/lib/auction-report-store";
import { ReportView } from "./view";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
 const dates = await reportDates();
 const report = dates[0] ? await storedAuctionReport(dates[0]) : null;
 return { ...pageMetadata({ title: "Daily auction report", description: "Daily WoW Forever auction asking prices, movers and cross-house spreads from public scans. Browse past reports or download a shareable report image.", path: "/tools/auctions/report", image: "/tools/auctions/report/opengraph-image", feed: "/tools/auctions/report/feed.xml" }), ...(!report ? { robots: { index: false, follow: true } } : {}) };
}
export default async function Page() {
 const dates = await reportDates();
 const report = dates[0] ? await storedAuctionReport(dates[0]) : null;
 return <ReportView report={report} dates={dates} />;
}
