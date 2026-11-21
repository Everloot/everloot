import { writeAuctionReports } from "@/lib/auction-report-store";
import { writeMarketBoards } from "@/lib/market-boards";
import { sharingStore, uploadStore, type Corpus } from "@/lib/upload-store";
import { writeCoverage } from "@/lib/coverage-store";
import { currentSettledWeek, writeSettled } from "@/lib/settled-store";
import { buildItemView, writeItemView } from "@/lib/item-view-store";
import { anonymousAggregates, writeAggregates } from "@/lib/aggregate-store";
import type { AggregateSet } from "@/lib/aggregate-set";
import { writeSearchNames } from "@/lib/search-names-store";
import { buildAuctionHistory, writeAuctionHistory } from "@/lib/auction-history-store";
import { buildProfessions, writeProfessions } from "@/lib/profession-store";
import { buildDatabaseActivity } from "@/lib/database-activity";
import { writeDatabaseActivity } from "@/lib/database-activity-store";
import { buildMapPins, writeMapPins } from "@/lib/map-pins-store";
import { writeGuildLadder } from "@/lib/guild-ladder-store";
import { forgetAllKept } from "@/lib/kept";

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
}

type Written = { written: boolean };

export interface StoredViewsResult {
  settled: (Written & { facts?: number; week?: string }) | null;
  itemView: (Written & { items?: number }) | null;
  aggregates: (Written & { bytes?: number }) | null;
  searchNames: (Written & { bytes?: number }) | null;
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
  const failed: string[] = [];
  const step = async <T>(name: string, label: string, write: () => Promise<T>): Promise<T | null> => {
    try {
      return await write();
    } catch (err) {
      console.error(`${label} failed`, err);
      failed.push(name);
      return null;
    }
  };
  // The stored views below each work from the corpus as it stands. It is read once, by the first view that needs it,
  // and shared: each read runs the publication pass again. An unreachable corpus fails every view that asks for it.
  let corpusRead: Promise<Corpus> | null = null;
  const corpus = () => (corpusRead ??= uploadStore.loadCorpus().then((c) => {
    if (c.unreachable) throw new Error("corpus unreachable");
    return c;
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
  let aggregatesRead: Promise<AggregateSet> | null = null;
  const aggregateSet = () => (aggregatesRead ??= corpus().then(anonymousAggregates));
  const aggregates = await step("aggregates", "aggregates", () => writeAggregates({ added, rebuild, dataAsOf }, { build: aggregateSet }));
  // The names the site's own search matches (lib/search-names-store.ts), a few hundred KB from the same set, so a fresh
  // instance never parses the aggregates for a keystroke. Written on the runs that build the set anyway (uploads added,
  // a rebuild, or aggregates just written), never by an idle run for itself: the set is the cron's heaviest step
  // (#1354). A failure is logged and the search reads the aggregates as before.
  const searchNames = await step("searchNames", "search names", async () => aggregates?.written || rebuild || added > 0
    ? await writeSearchNames({ added, rebuild, dataAsOf }, { build: aggregateSet })
    : { written: false });
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
  return { settled, itemView, aggregates, searchNames, auctionHistory, professions, mapPins, databaseActivity, guildLadder, marketBoards, coverage, auctionReports, failed };
}

/**
 * The stored-views job's run (scripts/stored-views.mts): the views for the snapshot the last heartbeat names. It adds
 * no uploads, so each view is written only when its stamp is not that snapshot's (or every one with `rebuild`). The
 * auction reports wait while the heartbeat says a rollup still has uploads to fold, as the cron's own run waits for
 * the market. No heartbeat yet means the snapshot cron has never run: there is nothing to build from.
 */
export async function runStoredViewsJob(opts: { rebuild?: boolean } = {}, deps: {
  heartbeat?: () => ReturnType<typeof uploadStore.readCronRun>; run?: typeof runStoredViews;
} = {}): Promise<StoredViewsResult & { dataAsOf: string | null }> {
  const beat = await (deps.heartbeat ?? uploadStore.readCronRun)();
  if (!beat) throw new Error("no cron heartbeat yet: the snapshot cron has not run");
  const result = await (deps.run ?? runStoredViews)({ added: 0, rebuild: opts.rebuild === true, dataAsOf: beat.dataAsOf, reportsDue: !beat.completionPending });
  return { dataAsOf: beat.dataAsOf, ...result };
}
