import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { readDailyHistory } from "@/lib/platform-history";

/**
 * GET /api/history: Everloot's own numbers, one row per UTC day (lib/platform-history.ts). Each row has the uploads,
 * the records by kind, the distinct contributors, the realms, houses and items the market has prices for, and the
 * coverage counts. Rows marked `source: "backfill"` were counted afterwards from capture times and carry no market or
 * coverage. Counts only: no install, character, guild or realm is named. A day is added after it ends, so the newest
 * row is yesterday's. ETag and `If-None-Match` work as on the other public files.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const days = await readDailyHistory();
  if (!days) {
    return NextResponse.json({ ok: false, error: "Storage unreachable. These figures are unrecorded, not zero; retry later." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const body = JSON.stringify({ version: 1, days });
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
  const headers = { "CDN-Cache-Control": "public, max-age=600", etag, "cache-control": "public, max-age=600, s-maxage=600, stale-while-revalidate=3600" };
  const match = req.headers.get("if-none-match");
  if (match && match.split(",").map((t) => t.trim().replace(/^W\//, "")).includes(etag)) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { status: 200, headers: { ...headers, "content-type": "application/json" } });
}
