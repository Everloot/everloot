import { storedAuctionReport } from "@/lib/auction-report-store";
import { renderAuctionReportCard } from "@/lib/og-card";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
 const report = await storedAuctionReport((await params).date);
 if (!report) return new Response("Report not found", { status: 404 });
 const image = await renderAuctionReportCard(report, true);
 image.headers.set("CDN-Cache-Control", "max-age=86400");
 return image;
}
