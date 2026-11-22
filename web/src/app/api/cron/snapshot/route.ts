import { NextResponse } from "next/server";
import { sharingStore, uploadStore } from "@/lib/upload-store";
import { intakeQuota } from "@/lib/intake-quota";
import { pruneKeys } from "@/lib/api-keys";
import { guardOn } from "@/lib/data-guard";
import { playerPagesOn } from "@/lib/player-pages";
import { playerStore } from "@/lib/player-store";
import { pullStore } from "@/lib/pull-store";
import { releaseKept, runStoredViews } from "@/lib/stored-views-run";
import { dispatchStoredViews } from "@/lib/stored-views-dispatch";

/**
 * GET /api/cron/snapshot — the Worker's Cron Trigger (src/lib/cf-crons.ts, every 10 minutes) extends the corpus snapshot with new uploads,
 * then folds new full auction scans into the market rollup. The rollups keep their own watermarks, so
 * they run whether or not the corpus step succeeded: a corpus snapshot that has grown past what one run can
 * parse must not freeze prices. A failed step makes the response a 500, leaves the heartbeat alone, and the
 * next run retries the same uploads.
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
    // A corpus failure is reported at the end, after the rollups that do not depend on it have run.
    let result: { added: number; skipped?: boolean; dataAsOf: string | null } | null = null;
    try {
      result = idle ? { added: 0, skipped: true, dataAsOf: work.dataAsOf } : await uploadStore.writeSnapshot({ rebuild });
    } catch (err) {
      console.error("snapshot failed", err);
    }
    // The write keeps the corpus it wrote for pages. The rollups below never read it, and beside them it outgrew the
    // Worker on runs with new uploads (#1354); the coverage step reads it again from the parts.
    releaseKept();
    await intakeQuota.prune();
    // Key retention (lib/api-keys.ts) runs only once the data guard's tables exist; a failure is retried next run.
    if (guardOn()) {
      try { await pruneKeys(); } catch (err) { console.error("key retention failed", err); }
    }
    // Player rows not seen for 90 days are deleted. Only with the player pages on, once their table exists.
    if (playerPagesOn()) {
      try { await playerStore().prune(); } catch (err) { console.error("player retention failed", err); }
    }
    // Pull summaries are kept a year after they were received, switch on or off: turning collection off must not keep
    // what was collected. Before the migration there is nothing to prune, and the store says so without an error.
    try { await pullStore().prune(); } catch (err) { console.error("pull retention failed", err); }
    // The market has its own watermark, so a failure here leaves the corpus snapshot current
    // and the next run retries the same uploads.
    // `dropped` scans hit a fold cap, `released` open scans were let go to make room for newer ones, and `trimmedDays` of
    // closed history went to fit the size limit: each says the rollup is full, which is otherwise invisible.
    let market: { added: number; scans: number; remaining?: number; dropped?: number; released?: number; trimmedDays?: number } | null = null;
    try {
      market = await uploadStore.writeMarket(idle && !work.retryRollups ? { idle: true } : { rebuild });
    } catch (err) {
      console.error("market rollup failed", err);
    }
    // The completion rollup has its own watermark too, and runs after the market so it cannot starve it.
    let completion: { added: number; remaining: number; trimmed: number; rebuilding: boolean } | null = null;
    try {
      completion = idle && !work.retryRollups
        ? { added: 0, remaining: 0, trimmed: 0, rebuilding: false }
        : await uploadStore.writeCompletion({ rebuild, authority: () => sharingStore.loadState() });
    } catch (err) {
      console.error("completion rollup failed", err);
    }
    // The census snapshot keeps its own watermark too: pages read it instead of every upload (lib/upload-store.ts).
    // A failure is logged and the pages keep the last snapshot; the next run retries the same uploads.
    let census: { added: number; rows: number; remaining: number; skipped?: boolean } | null = null;
    try {
      census = await uploadStore.writeCensus(idle && !work.retryRollups ? { idle: true } : { rebuild });
    } catch (err) {
      console.error("census snapshot failed", err);
    }
    releaseKept();
    if (!result) return NextResponse.json({ ok: false, error: "snapshot failed", rebuild, market, completion }, { status: 500 });
    if (!market) return NextResponse.json({ ok: false, error: "market rollup failed", rebuild, ...result, completion }, { status: 500 });
    if (!completion) return NextResponse.json({ ok: false, error: "completion rollup failed", rebuild, ...result, market }, { status: 500 });
    // The heartbeat: the corpus and the rollups are current. Everything below is a stored view or file that is rewritten
    // whenever its stamp is not the snapshot's, so an idle run catches up on one a run could not write. A run with new
    // uploads replays the whole corpus for them and ran out of the Worker's memory partway through them, so they come
    // after it (#1354); /api/health says whether this pipeline runs, not whether every view finished.
    // A rollup with uploads left over is pending: the next run folds them even when no new upload arrived. The settled
    // week the heartbeat carried is kept as it was; the settled list's own stamp now carries its week.
    await uploadStore.writeCronRun(
      completion.remaining > 0 || completion.rebuilding || (market.remaining ?? 0) > 0 || (census?.remaining ?? 0) > 0,
      result.dataAsOf,
      work.settledWeek ?? null,
    );
    // A run that folded uploads into the corpus or a rollup starts the stored-views job (lib/stored-views-dispatch.ts):
    // GitHub's schedule for it runs late or not at all, a dispatched run starts at once. So does the first run of each
    // hour, so the auction reports and a view a failed job run left behind wait at most an hour. A failed dispatch is
    // logged; the schedule is the backstop.
    const folded = result.added > 0 || market.added > 0 || completion.added > 0 || (census?.added ?? 0) > 0;
    let viewsJob: "sent" | "off" | "failed" = "off";
    if (folded || rebuild || new Date().getUTCMinutes() < 10) {
      try { viewsJob = await dispatchStoredViews(); } catch (err) { console.error("stored-views dispatch failed", err); viewsJob = "failed"; }
    }
    // The settled list, the stored views, the guild ladder, the boards, the coverage score and the auction reports
    // (lib/stored-views-run.ts). With EVERLOOT_STORED_VIEWS at "job", the stored-views job builds them outside the
    // Worker, with the memory a run with new uploads needs (scripts/stored-views.ts, #1354), and this run ends here.
    if (process.env.EVERLOOT_STORED_VIEWS === "job") {
      return NextResponse.json({ ok: true, rebuild, ...result, market, completion, census, viewsJob, storedViews: "job" });
    }
    const views = await runStoredViews({ added: result.added, rebuild, dataAsOf: result.dataAsOf, reportsDue: !(market.remaining ?? 0) });
    return NextResponse.json({ ok: true, rebuild, ...result, market, completion, census, viewsJob, ...views });
  } catch (err) {
    console.error("snapshot failed", err);
    return NextResponse.json({ ok: false, error: "snapshot failed" }, { status: 500 });
  }
}
