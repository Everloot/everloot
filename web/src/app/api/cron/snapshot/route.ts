import { NextResponse } from "next/server";
import { sharingStore, uploadStore } from "@/lib/upload-store";
import { intakeQuota } from "@/lib/intake-quota";
import { pruneKeys } from "@/lib/api-keys";
import { guardOn } from "@/lib/data-guard";
import { playerPagesOn } from "@/lib/player-pages";
import { playerStore } from "@/lib/player-store";
import { pullStore } from "@/lib/pull-store";
import { writeCoverage } from "@/lib/coverage-store";
import { currentSettledWeek, writeSettled } from "@/lib/settled-store";
import { writeItemView } from "@/lib/item-view-store";
import { writeAggregates } from "@/lib/aggregate-store";
import { writeAuctionHistory } from "@/lib/auction-history-store";

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
    // `dropped` scans hit a fold cap and `trimmedDays` of closed history went to fit the size limit: both say
    // the rollup is full, which is otherwise invisible.
    let market: { added: number; scans: number; remaining?: number; dropped?: number; trimmedDays?: number } | null = null;
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
    if (!result) return NextResponse.json({ ok: false, error: "snapshot failed", rebuild, market, completion }, { status: 500 });
    if (!market) return NextResponse.json({ ok: false, error: "market rollup failed", rebuild, ...result, completion }, { status: 500 });
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
    // What the item lists read (lib/item-view.ts), stored after the snapshot so a page never replays the corpus. Written
    // only when this run added uploads, rebuilt, or finds no file; a failure is logged and the pages fall back.
    let itemView: { written: boolean; items?: number } | null = null;
    try {
      itemView = await writeItemView({ added: result.added, rebuild, dataAsOf: result.dataAsOf });
    } catch (err) {
      console.error("item view failed", err);
    }
    // The tables the item, NPC, zone, instance, object, loot, edge and addon pages read (lib/aggregate-store.ts), stored so
    // a new server instance reads one file instead of replaying the corpus. Same rule as the item view: written only when
    // this run added uploads, rebuilt, or finds no file; a failure is logged and the pages work the tables out themselves.
    let aggregates: { written: boolean; bytes?: number } | null = null;
    try {
      aggregates = await writeAggregates({ added: result.added, rebuild, dataAsOf: result.dataAsOf });
    } catch (err) {
      console.error("aggregates failed", err);
    }
    // Every realm and item's public auction days (lib/auction-history-store.ts), stored so the history page and the
    // auction_history tool never replay the corpus. Same rule as the item view; a failure is logged and they read the corpus.
    let auctionHistory: { written: boolean; items?: number } | null = null;
    try {
      auctionHistory = await writeAuctionHistory({ added: result.added, rebuild });
    } catch (err) {
      console.error("auction history failed", err);
    }
    // A rollup with uploads left over is pending: the next run folds them even when no new upload arrived.
    await uploadStore.writeCronRun(
      completion.remaining > 0 || completion.rebuilding || (market.remaining ?? 0) > 0 || (census?.remaining ?? 0) > 0,
      result.dataAsOf,
      settled?.written ? week : work.settledWeek ?? null,
    );
    return NextResponse.json({ ok: true, rebuild, ...result, market, completion, coverage, settled, census, itemView, aggregates, auctionHistory });
  } catch (err) {
    console.error("snapshot failed", err);
    return NextResponse.json({ ok: false, error: "snapshot failed" }, { status: 500 });
  }
}
