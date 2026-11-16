import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { reportHref } from "@/lib/auction-report";
import { storedAuctionReport } from "@/lib/auction-report-store";
import { ReportView } from "../view";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ date: string }> };
export async function generateMetadata({ params }: Props) {
 const { date } = await params; const r = await storedAuctionReport(date); if (!r) notFound();
 return pageMetadata({ title: `Daily auction report · ${date}`, description: r.headline, path: reportHref(date), image: `${reportHref(date)}/opengraph-image`, feed: "/tools/auctions/report/feed.xml" });
}
export default async function Page({ params }: Props) {
 const r = await storedAuctionReport((await params).date); if (!r) notFound();
 return <ReportView report={r} />;
}
