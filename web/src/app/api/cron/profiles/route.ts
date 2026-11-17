import { NextResponse } from "next/server";
import { deleteGearBoard } from "@/lib/gear-board-store";

/**
 * GET /api/cron/profiles: the Worker's Cron Trigger (src/lib/cf-crons.ts, every 30 minutes). The synced gear boards
 * it used to score gave way to the armory boards (/armory/rankings), so it now only deletes their stored file from the
 * private bucket; deleting an absent file is a success. Once the file is gone the trigger can be removed.
 * The trigger sends `Authorization: Bearer $CRON_SECRET`; without the secret configured it refuses to run.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, deleted: await deleteGearBoard() });
  } catch (err) {
    console.error("gear board delete failed", err);
    return NextResponse.json({ ok: false, error: "gear board delete failed" }, { status: 500 });
  }
}
