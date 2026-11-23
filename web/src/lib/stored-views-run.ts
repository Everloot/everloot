import { writeAuctionReports } from "@/lib/auction-report-store";
import { writeMarketBoards } from "@/lib/market-boards";
import { sharingStore, uploadStore, type Corpus } from "@/lib/upload-store";
import { writeCoverage } from "@/lib/coverage-store";
import { currentSettledWeek, writeSettled } from "@/lib/settled-store";
import { buildItemView, writeItemView } from "@/lib/item-view-store";
import { anonymousAggregates, writeAggregates } from "@/lib/aggregate-store";
import type { AggregateSet } from "@/lib/aggregate-set";
import { writeSearchNames } from "@/lib/search-names-store";
import { writeFarmAreas } from "@/lib/farm-areas-store";
import { writeNpcFacts } from "@/lib/npc-facts-store";
import { writeRankingWeeks } from "@/lib/ranking-weeks-store";
import { rankingWeeks } from "@/lib/rankings";
import { buildAuctionHistory, writeAuctionHistory } from "@/lib/auction-history-store";
import { buildProfessions, writeProfessions } from "@/lib/profession-store";
import { buildDatabaseActivity } from "@/lib/database-activity";
import { writeDatabaseActivity } from "@/lib/database-activity-store";
import { buildMapPins, writeMapPins } from "@/lib/map-pins-store";
import { writeGuildLadder } from "@/lib/guild-ladder-store";
import { forgetAllKept } from "@/lib/kept";
import { writeViewsRun, type ViewsRun } from "@/lib/stored-views-status";
import { writeDailyHistory } from "@/lib/platform-history";
import { loadCoverageSummary } from "@/lib/coverage-summary";

/**
 * Whether the aggregates file leaves the raw NPC sightings out (#1464). It shipped off in #1472, because the job runs
 * main's code before the site deploy lands, and the old site code read a file without the sightings as no file. On
 * now that the site reading npc-facts.json is live. Rolling the site back past #1472 needs this off again first.
 */
const NPC_SIGHTINGS_APART = true;

const writeHistory = (now: Date) => writeDailyHistory(now, {
  corpus: () => uploadStore.loadCorpus(),
  market: async () => (await uploadStore.loadMarket()).state,
  coverage: () => loadCoverageSummary(),
});

/**
 * Let go of what the steps so far read and kept for pages: the stores keep each file they read or write, tens of MB
 * apiece, and one run reads them all. Kept to the end of the run they added up past the Worker's 128 MB (#1354).
 */
export function releaseKept(): void {
  uploadStore.forgetReads();
  sharingStore.forgetPublished();
  forgetAllKept();
}

export interface StoredViewsRun {
  /** Uploads the run added: any added (or a rebuild) writes every view; none writes a view only when its stamp is not `dataAsOf`. */
  added: number;
  rebuild: boolean;
  /** The snapshot's time, the heartbeat's `dataAsOf`: each view is stamped with it. */
  dataAsOf: string | null;
  /** The auction reports are written only once the market rollup has no scans left to fold. */
  reportsDue: boolean;
  /** Times a failed step is tried again. The job retries once; the Worker never does, its memory is the limit. */
  retries?: number;
}

/**
 * Runs the steps: each one's time is kept, a throw is logged and named in `failed`, and the next step still runs. With
 * `retries`, a failed step is tried again after `waitMs` first: each step writes one file whole, so a second try is
 * safe, and a dropped connection (ECONNRESET on the settled list, 2026-11-22 13:10 UTC) no longer fails a run.
 */
export function stepRunner(opts: { retries: number; waitMs?: number; beforeRetry?: () => void }) {
  const failed: string[] = [];
  const timings: Record<string, number> = {};
  const step = async <T>(name: string, label: string, write: () => Promise<T>): Promise<T | null> => {
    const started = Date.now();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await write();
        } catch (err) {
          if (attempt >= opts.retries) {
            console.error(`${label} failed`, err);
            failed.push(name);
            return null;
          }
          console.warn(`${label} failed; trying again`, err);
          await new Promise((resolve) => setTimeout(resolve, opts.waitMs ?? 5_000));
          opts.beforeRetry?.();
        }
      }
    } finally {
      timings[name] = Date.now() - started;
    }
  };
  return { step, failed, timings };
}

type Written = { written: boolean };

export interface StoredViewsResult {
  settled: (Written & { facts?: number; week?: string }) | null;
  itemView: (Written & { items?: number }) | null;
  npcFacts: (Written & { npcs?: number; bytes?: number }) | null;
  aggregates: (Written & { bytes?: number }) | null;
  searchNames: (Written & { bytes?: number }) | null;
  farmAreas: (Written & { bytes?: number }) | null;
  rankingWeeks: (Written & { weeks?: number; bytes?: number }) | null;
  auctionHistory: (Written & { items?: number }) | null;
  professions: (Written & { bytes?: number }) | null;
  mapPins: (Written & { bytes?: number }) | null;
  databaseActivity: (Written & { entries?: number }) | null;
  guildLadder: (Written & { bytes?: number }) | null;
  marketBoards: (Written & { bytes?: number; ms?: number }) | null;
  coverage: Written | null;
  auctionReports: (Written & { reports?: number }) | null;
  /** The steps that threw, in order; each was logged and the next step ran. */
  failed: string[];
  /** Milliseconds each step took, by name: how the job's time grows with the corpus. */
  timings: Record<string, number>;
}

/**
 * Everything after the snapshot cron's heartbeat: the settled list, the stored views, the guild ladder, the Auction
 * House boards, the coverage score and the auction reports. Each is a file in R2 rewritten whenever its stamp is not
 * the snapshot's, so a run that could not write one is caught up by the next. The snapshot cron runs it after its
 * heartbeat; with EVERLOOT_STORED_VIEWS at "job", the stored-views job (scripts/stored-views.mts, run by GitHub
 * Actions with more memory than a Worker has) runs it instead (#1354). A step that fails is logged and named in
 * `failed`; the steps after it still run.
 */
export async function runStoredViews(run: StoredViewsRun): Promise<StoredViewsResult> {
  const { added, rebuild, dataAsOf } = run;
  // The stored views below each work from the corpus as it stands. It is read once, by the first view that needs it,
  // and shared: each read runs the publication pass again. An unreachable corpus fails every view that asks for it.
  // A retried step reads it again if the shared read failed; the views after it share whatever that retry read.
  let corpusRead: Promise<Corpus> | null = null;
  let aggregatesRead: Promise<AggregateSet> | null = null;
  const sharedFailed = { corpus: false, aggregates: false };
  const { step, failed, timings } = stepRunner({
    retries: run.retries ?? 0,
    beforeRetry: () => {
      if (sharedFailed.corpus) corpusRead = null;
      if (sharedFailed.aggregates) aggregatesRead = null;
      sharedFailed.corpus = sharedFailed.aggregates = false;
    },
  });
  const corpus = () => (corpusRead ??= uploadStore.loadCorpus().then((c) => {
    if (c.unreachable) throw new Error("corpus unreachable");
    return c;
  }).catch((err: unknown) => {
    sharedFailed.corpus = true;
    throw err;
  }));
  // The settled list (kb/src/settled-list.ts), dated by the snapshot and stamped with the ISO week, from the views'
  // corpus: rewritten whenever the snapshot or the week changed, so the weekly spot check rotates even when nothing new
  // arrives. Before the heartbeat it read the corpus again on its own, and runs with new uploads ran out of memory
  // there (2026-11-20 23:10 and 23:20 UTC, #1354). A failure is logged; uploaders keep the list they have.
  const settled = await step("settled", "settled list", () =>
    writeSettled({ added, rebuild, dataAsOf, week: currentSettledWeek() }, { corpus }));
  // What the item lists read (lib/item-view.ts), stored after the snapshot so a page never replays the corpus. Written
  // only when this run added uploads, rebuilt, or finds no file; a failure is logged and the pages fall back.
  const itemView = await step("itemView", "item view", () => writeItemView({ added, rebuild, dataAsOf }, {
    build: async () => buildItemView(dataAsOf, new Date(), await corpus()),
  }));
  releaseKept();
  // The tables the item, NPC, zone, instance, object, loot, edge and addon pages read (lib/aggregate-store.ts), stored so
  // a new server instance reads one file instead of replaying the corpus. Same rule as the item view: written only when
  // this run added uploads, rebuilt, or finds no file; a failure is logged and the pages work the tables out themselves.
  // The set is worked out once per run: the aggregates file and the search names file are written from the same one.
  const aggregateSet = () => (aggregatesRead ??= corpus().then(anonymousAggregates).catch((err: unknown) => {
    sharedFailed.aggregates = true;
    throw err;
  }));
  // What the agreement rules give each NPC (lib/npc-facts-store.ts), from the same set and before the aggregates: the
  // aggregates file leaves the raw NPC sightings out, so the pages read this table instead (#1464). When it could not
  // be written, the aggregates keep the sightings this run, stamped so the next run writes both again.
  const npcFacts = await step("npcFacts", "NPC facts", () => writeNpcFacts({ added, rebuild, dataAsOf }, { build: aggregateSet }));
  const aggregates = await step("aggregates", "aggregates", () => writeAggregates({ added, rebuild, dataAsOf, keepNpcRows: !NPC_SIGHTINGS_APART || npcFacts === null }, { build: aggregateSet }));
  // The names the site's own search matches (lib/search-names-store.ts), a few hundred KB from the same set, so a fresh
  // instance never parses the aggregates for a keystroke. Written on the runs that build the set anyway (uploads added,
  // a rebuild, or aggregates just written), never by an idle run for itself: the set is the cron's heaviest step
  // (#1354). A failure is logged and the search reads the aggregates as before.
  const searchNames = await step("searchNames", "search names", async () => aggregates?.written || rebuild || added > 0
    ? await writeSearchNames({ added, rebuild, dataAsOf }, { build: aggregateSet })
    : { written: false });
  // The zones behind each mob farm (lib/farm-areas-store.ts), a few KB from the same set, so the farming and the cloth
  // and leather profession pages never parse the aggregates on the site Worker. Written whenever its stamp is not the
  // snapshot's: the set is built then anyway for the aggregates, and a missing file is caught up by the next run.
  const farmAreas = await step("farmAreas", "farm areas", () => writeFarmAreas({ added, rebuild, dataAsOf }, { build: aggregateSet }));
  // Nothing after this reads the set; the corpus stays for the views below.
  aggregatesRead = null;
  releaseKept();
  // Every realm and item's public auction days (lib/auction-history-store.ts), stored so the history page and the
  // auction_history tool never replay the corpus. Same rule as the item view; a failure is logged and they read the corpus.
  const auctionHistory = await step("auctionHistory", "auction history", () =>
    writeAuctionHistory({ added, rebuild, dataAsOf }, { build: async () => buildAuctionHistory(await corpus()) }));
  releaseKept();
  // The profession and map views follow the auction history's rule: an idle run also rewrites a file built from
  // another snapshot, so a failed write catches up on the next run.
  const professions = await step("professions", "profession view", () =>
    writeProfessions({ added, rebuild, dataAsOf }, { build: async () => buildProfessions(await corpus()) }));
  releaseKept();
  const mapPins = await step("mapPins", "map pins view", () =>
    writeMapPins({ added, rebuild, dataAsOf }, { build: async () => buildMapPins(await corpus()) }));
  releaseKept();
  const databaseActivity = await step("databaseActivity", "database activity", () => writeDatabaseActivity({ added, rebuild, dataAsOf }, {
    build: async (previous) => buildDatabaseActivity(await corpus(), new Date(), previous),
  }));
  // The last view that reads the corpus is done.
  corpusRead = null;
  releaseKept();
  // The weeks the rankings pages draw (lib/ranking-weeks-store.ts), 20 KB from the census rollup, so /rankings never
  // parses every census row on the site Worker. Stamped with the census's own time: rewritten when it moved on.
  const rankingWeeksView = await step("rankingWeeks", "ranking weeks", () => writeRankingWeeks({ census: () => uploadStore.loadCensus(), weeks: rankingWeeks }));
  releaseKept();
  // The auction reports and the Auction House boards each read the market rollup, the aggregates and the client's item
  // tables to name items, the run's largest working sets (#1354), so they come after the views. A failure is logged;
  // the pages build the boards themselves and keep the last reports.
  // The boards go first: without a current file every Auction House page builds them on the site Worker, while a
  // missing day of reports only waits. The reports, the largest step (about 110 MB more than the boards in a local
  // replay, 2026-11-20), are written once a day and go last.
  // The guild ladder reads the whole corpus again; a run with new uploads ran out of memory there, after every view
  // above (#1354). It goes first of the last steps: its pages replay the corpus without it.
  // Guild authority is checked even on idle runs, and a file stamped by another snapshot is rewritten, so an idle run
  // catches up on a failed one; hides stay live in the page/tool reader.
  const guildLadder = await step("guildLadder", "guild ladder", () => writeGuildLadder({ added, rebuild, dataAsOf }));
  releaseKept();
  // The Auction House boards (lib/market-boards.ts), built once here instead of on every browse, realm, bags and
  // disenchanting request: rewritten when the rollup or the UTC day changed.
  const marketBoards = await step("marketBoards", "market boards", () => writeMarketBoards());
  releaseKept();
  // The coverage score, dated by the snapshot's time, the heartbeat's `dataAsOf`. It reads the whole corpus and works
  // the score out beside it, and runs with new uploads ran out of memory there before their heartbeat (#1354), so it
  // comes after it. Like the views, it is rewritten whenever its stamp is not the snapshot's, so an idle run catches
  // up on a failed one. The pages show the last stored score (or say it is unreachable); a failure is logged.
  const coverage = await step("coverage", "coverage", () => writeCoverage({ added, rebuild, dataAsOf }));
  releaseKept();
  const auctionReports = run.reportsDue ? await step("auctionReports", "auction reports", () => writeAuctionReports()) : null;
  releaseKept();
  return { settled, itemView, npcFacts, aggregates, searchNames, farmAreas, auctionHistory, professions, mapPins, databaseActivity, rankingWeeks: rankingWeeksView, guildLadder, marketBoards, coverage, auctionReports, failed, timings };
}

/**
 * The stored-views job's run (scripts/stored-views.mts): the views for the snapshot the last heartbeat names. It adds
 * no uploads, so each view is written only when its stamp is not that snapshot's (or every one with `rebuild`). The
 * auction reports wait while the heartbeat says a rollup still has uploads to fold, as the cron's own run waits for
 * the market. No heartbeat yet means the snapshot cron has never run: there is nothing to build from.
 * A finished run leaves its own heartbeat (lib/stored-views-status.ts), failed steps and all, which /api/health reads;
 * a heartbeat that cannot be written is logged and fails the run, so the job shows red.
 */
export async function runStoredViewsJob(opts: { rebuild?: boolean; failedBefore?: string[] } = {}, deps: {
  heartbeat?: () => ReturnType<typeof uploadStore.readCronRun>; run?: typeof runStoredViews;
  record?: (run: ViewsRun) => Promise<void>; now?: () => number; history?: (now: Date) => Promise<unknown>;
} = {}): Promise<StoredViewsResult & { dataAsOf: string | null }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const beat = await (deps.heartbeat ?? uploadStore.readCronRun)();
  if (!beat) throw new Error("no cron heartbeat yet: the snapshot cron has not run");
  const views = await (deps.run ?? runStoredViews)({ added: 0, rebuild: opts.rebuild === true, dataAsOf: beat.dataAsOf, reportsDue: !beat.completionPending, retries: 1 });
  // The platform's own numbers for the day that just ended (lib/platform-history.ts): a GET on every run, the corpus
  // read only on the first run after midnight UTC. A failure is logged and named; the next run tries the day again.
  const historyFailed: string[] = [];
  try {
    await (deps.history ?? writeHistory)(new Date(started));
  } catch (err) {
    console.error("platform history failed", err);
    historyFailed.push("history");
  }
  releaseKept();
  // Steps the job ran before the views (its fold, with EVERLOOT_SNAPSHOT at "job") count in the heartbeat too.
  const failed = [...(opts.failedBefore ?? []), ...views.failed, ...historyFailed];
  const result = failed.length === views.failed.length ? views : { ...views, failed };
  const finished = now();
  try {
    await (deps.record ?? writeViewsRun)({
      finishedAt: new Date(finished).toISOString(), dataAsOf: beat.dataAsOf, failed: result.failed,
      seconds: Math.round((finished - started) / 1000), timings: result.timings,
    });
  } catch (err) {
    console.error("stored-views heartbeat failed", err);
    return { dataAsOf: beat.dataAsOf, ...result, failed: [...result.failed, "heartbeat"] };
  }
  return { dataAsOf: beat.dataAsOf, ...result };
}
