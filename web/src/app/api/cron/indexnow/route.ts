import { NextResponse } from "next/server";
import { loadTimeline } from "@/lib/changes";
import { changeUrlsToPing, pingIndexNow } from "@/lib/indexnow";

/**
 * GET /api/cron/indexnow: the Worker's Cron Trigger (src/lib/cf-crons.ts), hourly. New change entries reach the site with a deploy,
 * so each run submits /changes and its feed when an entry from the last two hours exists. An empty list, or
 * nothing recent, sends nothing. Same auth as the snapshot cron: `Authorization: Bearer $CRON_SECRET`.
 */
export const dynamic = "force-dynamic";

const WINDOW_MS = 2 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const urls = changeUrlsToPing(await loadTimeline(), new Date(), WINDOW_MS);
  const result = await pingIndexNow(urls);
  return NextResponse.json({ ok: true, urls: urls.length, ...result });
}
