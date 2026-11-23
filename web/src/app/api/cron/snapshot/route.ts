import { NextResponse } from "next/server";
import { uploadStore } from "@/lib/upload-store";
import { intakeQuota } from "@/lib/intake-quota";
import { pruneKeys } from "@/lib/api-keys";
import { guardOn } from "@/lib/data-guard";
import { playerPagesOn } from "@/lib/player-pages";
import { playerStore } from "@/lib/player-store";
import { pullStore } from "@/lib/pull-store";
import { runStoredViews } from "@/lib/stored-views-run";
import { nothingToFold, runSnapshotPass, type SnapshotWork } from "@/lib/snapshot-pass";
import { dispatchSiteHealth, dispatchStoredViews } from "@/lib/stored-views-dispatch";

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
/** A heartbeat this old, with the fold on the stored-views job, means the job is not folding: the Worker folds instead. */
const JOB_STALL_MS = 20 * 60_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const rebuild = new URL(req.url).searchParams.get("rebuild") === "1";
  try {
    const work: SnapshotWork = rebuild ? { idle: false, retryRollups: false, dataAsOf: null, settledWeek: null } : await uploadStore.snapshotWork();
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
    // The first run of each hour starts the site-health check (lib/stored-views-dispatch.ts): GitHub ran its own
    // 15-minute schedule 4 times in 24 hours, so the alarm on stale views, a failing job or an expiring token could lag
    // by hours. Here, before any hand-off, so it runs whatever this run does. A failure is logged; the schedule remains.
    if (!rebuild && new Date().getUTCMinutes() < 10) {
      try { await dispatchSiteHealth(); } catch (err) { console.error("site-health dispatch failed", err); }
    }
    // With EVERLOOT_SNAPSHOT at "job", a run with something to fold starts the stored-views job, which folds it on a
    // GitHub runner and then builds the views (lib/snapshot-pass.ts, scripts/stored-views.ts): writing the corpus
    // means holding all of it, and it outgrew the Worker's 128 MB (#1354). A run with nothing to fold still writes the
    // heartbeat here. If the job cannot be started (no token, or GitHub refused), this run folds the uploads itself, as
    // before the hand-over. So it does when the heartbeat is over JOB_STALL_MS old (or missing): the job was started
    // and did not fold, whether GitHub queued it, the workflow is off or main does not build. A rebuild always runs here.
    let viewsJob: "sent" | "off" | "failed" = "off";
    const beatAge = work.heartbeatAt ? Date.now() - Date.parse(work.heartbeatAt) : Number.NaN;
    const jobFolding = beatAge < JOB_STALL_MS;
    const handOff = process.env.EVERLOOT_SNAPSHOT === "job" && !rebuild && !nothingToFold(work);
    if (handOff && !jobFolding) {
      console.warn(`the stored-views job has not folded for ${Number.isFinite(beatAge) ? `${Math.round(beatAge / 60_000)} minutes` : "an unknown time"}; folding here`);
    }
    if (handOff && jobFolding) {
      try { viewsJob = await dispatchStoredViews(); } catch (err) { console.error("stored-views dispatch failed", err); viewsJob = "failed"; }
      if (viewsJob === "sent") return NextResponse.json({ ok: true, rebuild, snapshotJob: "sent", viewsJob });
    }
    const pass = await runSnapshotPass(rebuild, work);
    if (!pass.ok) {
      const { error, result, market, completion } = pass;
      if (!result) return NextResponse.json({ ok: false, error, rebuild, market, completion }, { status: 500 });
      if (!market) return NextResponse.json({ ok: false, error, rebuild, ...result, completion }, { status: 500 });
      return NextResponse.json({ ok: false, error, rebuild, ...result, market }, { status: 500 });
    }
    const { result, market, completion, census, folded } = pass;
    // A run that folded uploads into the corpus or a rollup starts the stored-views job (lib/stored-views-dispatch.ts):
    // GitHub's schedule for it runs late or not at all, a dispatched run starts at once. So does the first run of each
    // hour, so the auction reports and a view a failed job run left behind wait at most an hour. A failed dispatch is
    // logged; the schedule is the backstop.
    if (viewsJob !== "failed" && (folded || rebuild || new Date().getUTCMinutes() < 10)) {
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
