import { sharingStore, uploadStore } from "@/lib/upload-store";
import { releaseKept } from "@/lib/stored-views-run";

export type SnapshotWork = Awaited<ReturnType<typeof uploadStore.snapshotWork>>;
export type SnapshotResult = { added: number; skipped?: boolean; dataAsOf: string | null; uploads?: number };
export type MarketResult = { added: number; scans: number; remaining?: number; dropped?: number; released?: number; trimmedDays?: number };
export type CompletionResult = { added: number; remaining: number; trimmed: number; rebuilding: boolean };
export type CensusResult = { added: number; rows: number; remaining: number; skipped?: boolean };

export type SnapshotPass =
  | { ok: true; result: SnapshotResult; market: MarketResult; completion: CompletionResult; census: CensusResult | null; folded: boolean }
  | { ok: false; error: string; result: SnapshotResult | null; market: MarketResult | null; completion: CompletionResult | null };

/** True when a run has nothing to fold: no new upload and every rollup caught up with the heartbeat. */
export const nothingToFold = (work: SnapshotWork, rebuild = false) => work.idle && !work.retryRollups && !rebuild;

/**
 * The snapshot cron's folding (#1354): extends the corpus snapshot with new uploads, then folds them into the market,
 * completion and census rollups, then writes the heartbeat. The rollups keep their own watermarks, so they run whether
 * or not the corpus step succeeded: a corpus that has grown past what one run can parse must not freeze prices. A
 * failed corpus, market or completion step leaves the heartbeat alone, and the next run retries the same uploads.
 * The cron Worker runs it (app/api/cron/snapshot/route.ts); with EVERLOOT_SNAPSHOT at "job" the stored-views job runs
 * it on a GitHub runner instead whenever there is something to fold (scripts/stored-views.ts): the Worker has to hold
 * the whole corpus to write it, and the corpus outgrew its 128 MB.
 */
export async function runSnapshotPass(rebuild: boolean, work: SnapshotWork): Promise<SnapshotPass> {
  const idle = work.idle && !rebuild;
  let result: SnapshotResult | null = null;
  try {
    result = idle ? { added: 0, skipped: true, dataAsOf: work.dataAsOf } : await uploadStore.writeSnapshot({ rebuild });
  } catch (err) {
    console.error("snapshot failed", err);
  }
  // The write keeps the corpus it wrote for pages. The rollups below never read it, and beside them it outgrew the
  // Worker on runs with new uploads (#1354).
  releaseKept();
  // `dropped` scans hit a fold cap, `released` open scans were let go to make room for newer ones, and `trimmedDays` of
  // closed history went to fit the size limit: each says the rollup is full, which is otherwise invisible.
  let market: MarketResult | null = null;
  try {
    market = await uploadStore.writeMarket(idle && !work.retryRollups ? { idle: true } : { rebuild });
  } catch (err) {
    console.error("market rollup failed", err);
  }
  // The completion rollup has its own watermark too, and runs after the market so it cannot starve it.
  let completion: CompletionResult | null = null;
  try {
    completion = idle && !work.retryRollups
      ? { added: 0, remaining: 0, trimmed: 0, rebuilding: false }
      : await uploadStore.writeCompletion({ rebuild, authority: () => sharingStore.loadState() });
  } catch (err) {
    console.error("completion rollup failed", err);
  }
  // The census snapshot keeps its own watermark too: pages read it instead of every upload (lib/upload-store.ts).
  // A failure is logged and the pages keep the last snapshot; the next run retries the same uploads.
  let census: CensusResult | null = null;
  try {
    census = await uploadStore.writeCensus(idle && !work.retryRollups ? { idle: true } : { rebuild });
  } catch (err) {
    console.error("census snapshot failed", err);
  }
  releaseKept();
  if (!result) return { ok: false, error: "snapshot failed", result, market, completion };
  if (!market) return { ok: false, error: "market rollup failed", result, market, completion };
  if (!completion) return { ok: false, error: "completion rollup failed", result, market, completion };
  // The heartbeat: the corpus and the rollups are current. Everything after it is a stored view or file rewritten
  // whenever its stamp is not the snapshot's; /api/health says whether this pipeline runs, not whether every view did.
  // A rollup with uploads left over is pending: the next run folds them even when no new upload arrived. The settled
  // week the heartbeat carried is kept as it was; the settled list's own stamp now carries its week.
  await uploadStore.writeCronRun(
    completion.remaining > 0 || completion.rebuilding || (market.remaining ?? 0) > 0 || (census?.remaining ?? 0) > 0,
    result.dataAsOf,
    work.settledWeek ?? null,
  );
  const folded = result.added > 0 || market.added > 0 || completion.added > 0 || (census?.added ?? 0) > 0;
  return { ok: true, result, market, completion, census, folded };
}

export interface JobFold {
  /** "folded": the job folded uploads or caught a rollup up; "idle": nothing to fold; "failed": a step failed (logged). */
  status: "folded" | "idle" | "failed";
  pass: SnapshotPass | null;
  /** Orphaned corpus part folders deleted, or null when the sweep failed (logged). */
  swept: { folders: number; objects: number } | null;
}

/**
 * The stored-views job's half of the snapshot cron, with EVERLOOT_SNAPSHOT at "job": the fold, when the cron's probe
 * finds something to fold, then the sweep of corpus parts no snapshot names. A run with nothing to fold writes nothing
 * here: the cron Worker writes the heartbeat on those runs itself. A failed sweep is logged and never fails the fold.
 */
export async function runJobFold(deps: {
  work?: () => Promise<SnapshotWork>; pass?: typeof runSnapshotPass; sweep?: () => Promise<{ folders: number; objects: number }>;
} = {}): Promise<JobFold> {
  const work = await (deps.work ?? uploadStore.snapshotWork)();
  const pass = nothingToFold(work) ? null : await (deps.pass ?? runSnapshotPass)(false, work);
  let swept: JobFold["swept"] = null;
  try {
    swept = await (deps.sweep ?? (() => uploadStore.sweepSnapshotParts()))();
  } catch (err) {
    console.error("snapshot part sweep failed", err);
  }
  return { status: !pass ? "idle" : pass.ok ? "folded" : "failed", pass, swept };
}