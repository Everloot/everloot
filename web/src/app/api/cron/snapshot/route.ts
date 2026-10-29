import { NextResponse } from "next/server";
import { sharingStore, uploadStore } from "@/lib/upload-store";
import { intakeQuota } from "@/lib/intake-quota";
import { pruneKeys } from "@/lib/api-keys";
import { guardOn } from "@/lib/data-guard";
import { playerPagesOn } from "@/lib/player-pages";
import { playerStore } from "@/lib/player-store";
import { writeCoverage } from "@/lib/coverage-store";
import { currentSettledWeek, writeSettled } from "@/lib/settled-store";

/**
 * GET /api/cron/snapshot — the Worker's Cron Trigger (src/lib/cf-crons.ts, every 10 minutes) extends the corpus snapshot with new uploads,
 * then folds new full auction scans into the market rollup. The market step runs only after the
 * corpus step succeeded; if it fails the corpus snapshot is already current, the response is a 500
 * and the next run retries the same uploads.
 * The trigger sends `Authorization: Bearer $CRON_SECRET`; without the secret configured it refuses to run.
 * `?rebuild=1` rebuilds both from empty, which is how a deleted upload leaves them. The market
 * rebuild reads only uploads from the last 62 days (older ones cannot hold a day it keeps), and
 * is also how an unusable market.json is replaced. The completion rollup folds at most a batch of uploads per
 * run (and stops early at its time budget) and saves its place; `remaining` says how many are left. A
 * rebuild is folded into a separate object over several runs and replaces the served rollup only when it
 * has caught up, so pages never read a partial one; `rebuilding` says one is under way.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const rebuild = new URL(req.url).searchParams.get("rebuild") === "1";
  try {
    const work = rebuild ? { idle: false, retryRollups: false, dataAsOf: null, settledWeek: null } : await uploadStore.snapshotWork();
    const idle = work.idle && !rebuild;
    const result = idle ? { added: 0, skipped: true, dataAsOf: work.dataAsOf } : await uploadStore.writeSnapshot({ rebuild });
    await intakeQuota.prune();
    // Key retention (lib/api-keys.ts) runs only once the data guard's tables exist; a failure is retried next run.
    if (guardOn()) {
      try { await pruneKeys(); } catch (err) { console.error("key retention failed", err); }
    }
    // Player rows not seen for 90 days are deleted. Only with the player pages on, once their table exists.
    if (playerPagesOn()) {
      try { await playerStore().prune(); } catch (err) { console.error("player retention failed", err); }
    }
    // The market has its own watermark, so a failure here leaves the corpus snapshot current
    // and the next run retries the same uploads.
    let market: { added: number; scans: number } | null = null;
    try {
      market = await uploadStore.writeMarket(idle && !work.retryRollups ? { idle: true } : { rebuild });
    } catch (err) {
      console.error("market rollup failed", err);
    }
    if (!market) return NextResponse.json({ ok: false, error: "market rollup failed", rebuild, ...result }, { status: 500 });
    // The completion rollup has its own watermark too, and runs after the market so it cannot starve it.
    let completion: { added: number; remaining: number; trimmed: number; rebuilding: boolean } | null = null;
    try {
      completion = idle && !work.retryRollups
        ? { added: 0, remaining: 0, trimmed: 0, rebuilding: false }
        : await uploadStore.writeCompletion({ rebuild, authority: () => sharingStore.loadState() });
    } catch (err) {
      console.error("completion rollup failed", err);
    }
    if (!completion) return NextResponse.json({ ok: false, error: "completion rollup failed", rebuild, ...result, market }, { status: 500 });
    // The coverage score changes only with the snapshot, so an idle run never recomputes it. It is dated by the
    // snapshot's time, the heartbeat's `dataAsOf`. The pages compute it themselves, so a failure here is logged and
    // the cron carries on; the next run that adds uploads writes it again.
    let coverage: { written: boolean } | null = null;
    try {
      coverage = idle ? { written: false } : await writeCoverage({ added: result.added, rebuild, dataAsOf: result.dataAsOf });
    } catch (err) {
      console.error("coverage failed", err);
    }
    // The settled list (kb/src/settled-list.ts) goes beside the score, dated by the snapshot. It is also rewritten
    // once per ISO week on an idle run, so the weekly spot check rotates even when nothing new arrives. A failure is
    // logged; uploaders keep the list they have and the heartbeat keeps the week, so the next run retries it.
    const week = currentSettledWeek();
    const settledStale = idle && work.settledWeek !== week;
    let settled: { written: boolean; facts?: number; week?: string } | null = null;
    try {
      settled = idle && !settledStale
        ? { written: false }
        : await writeSettled({ added: result.added, rebuild, dataAsOf: result.dataAsOf, force: settledStale, week });
    } catch (err) {
      console.error("settled list failed", err);
    }
    await uploadStore.writeCronRun(
      completion.remaining > 0 || completion.rebuilding,
      result.dataAsOf,
      settled?.written ? week : work.settledWeek ?? null,
    );
    return NextResponse.json({ ok: true, rebuild, ...result, market, completion, coverage, settled });
  } catch (err) {
    console.error("snapshot failed", err);
    return NextResponse.json({ ok: false, error: "snapshot failed" }, { status: 500 });
  }
}
