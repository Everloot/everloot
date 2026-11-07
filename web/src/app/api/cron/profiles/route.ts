import { NextResponse } from "next/server";
import { leaderboardsOn } from "@/lib/leaderboard-switch";
import { writeGearBoard } from "@/lib/profile-pipeline";

/**
 * GET /api/cron/profiles: the Worker's Cron Trigger (src/lib/cf-crons.ts, every 30 minutes) digests the linked
 * characters' synced facts into what the pages read (lib/profile-pipeline.ts): the gear boards' snapshot and each
 * ranked character's tracking points. Only gear received since the last run is scored, and once a day every ranked
 * character. With EVERLOOT_LEADERBOARDS off it does nothing. A failure is a 500 and leaves the stored boards as they
 * were; the next run reads the same rows again.
 * The trigger sends `Authorization: Bearer $CRON_SECRET`; without the secret configured it refuses to run.
 * `?rebuild=1` makes the run a full pass.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!leaderboardsOn()) return NextResponse.json({ ok: true, skipped: "off" });
  try {
    const gear = await writeGearBoard({ rebuild: new URL(req.url).searchParams.get("rebuild") === "1" });
    console.info("profile pipeline", gear);
    return NextResponse.json({ ok: true, gear });
  } catch (err) {
    console.error("gear boards failed", err);
    return NextResponse.json({ ok: false, error: "gear boards failed" }, { status: 500 });
  }
}
