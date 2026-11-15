import { notFound } from "next/navigation";
import { reportDates, storedAuctionReport } from "@/lib/auction-report-store";
import { renderAuctionReportCard } from "@/lib/og-card";
export const alt = "Latest daily auction asking-price report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export default async function Image() {
 const date = (await reportDates())[0]; const report = date ? await storedAuctionReport(date) : null; if (!report) notFound();
 const image = await renderAuctionReportCard(report); image.headers.set("CDN-Cache-Control", "max-age=300"); return image;
}
