import { NextResponse } from "next/server";
import { collectOpsSummary } from "@/lib/ops/collector";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Collector not configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  try {
    const summary = await collectOpsSummary();
    return NextResponse.json({ ok: true, generatedAt: summary.generatedAt, sources: summary.sources }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Operations collection failed" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
