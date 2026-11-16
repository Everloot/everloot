import { notFound } from "next/navigation";
import { storedAuctionReport } from "@/lib/auction-report-store";
import { renderAuctionReportCard } from "@/lib/og-card";
export const alt = "Daily auction asking-price report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export default async function Image({ params }: { params: Promise<{ date: string }> }) {
 const report = await storedAuctionReport((await params).date); if (!report) notFound();
 const image = await renderAuctionReportCard(report); image.headers.set("CDN-Cache-Control", "max-age=86400"); return image;
}
