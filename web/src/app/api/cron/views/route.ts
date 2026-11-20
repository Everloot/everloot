import { writeAuctionReports } from "@/lib/auction-report-store";
import { writeMarketBoards } from "@/lib/market-boards";
import { NextResponse } from "next/server";
import { uploadStore, type Corpus } from "@/lib/upload-store";
import { releaseCronReads as release } from "@/lib/cron-release";
import { writeCoverage } from "@/lib/coverage-store";
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

/**
 * GET /api/cron/views — the stored views, five minutes after each snapshot run (src/lib/cf-crons.ts). Each is a file the
 * pages read instead of replaying the corpus, rewritten whenever its stamp is not the stored corpus's `generatedAt`, so
 * a run that could not write one is caught up by the next. They ran at the end of the snapshot run until runs with new
 * uploads, which had just written the corpus and the rollups, kept running out of the Worker's 128 MB in them; idle
 * runs, which only rebuild views, never did (#1354). A failure is logged and the run answers 200: the pages fall back.
 * The trigger sends `Authorization: Bearer $CRON_SECRET`. `?rebuild=1` rewrites every view, whatever its stamp.
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
  // The isolate may still hold what an earlier request read and kept; this run needs the room (#1354).
  release();
  let work: { dataAsOf: string | null; rollupsPending: boolean };
  try {
    work = await uploadStore.viewsWork();
  } catch (err) {
    console.error("stored views: snapshot unreadable", err);
    return NextResponse.json({ ok: false, error: "snapshot unreadable" }, { status: 500 });
  }
  const { dataAsOf } = work;
  if (!dataAsOf) return NextResponse.json({ ok: true, skipped: "no snapshot" });
  // Every writer decides from its stamp; `added` is the snapshot run's to know, so it is 0 here.
  const opts = { added: 0, rebuild, dataAsOf };
  // The views below each work from the corpus as it stands. It is read once, by the first view that needs it, and
  // shared: each read runs the publication pass again. An unreachable corpus fails every view that asks for it.
  let corpusRead: Promise<Corpus> | null = null;
  const corpus = () => (corpusRead ??= uploadStore.loadCorpus().then((c) => {
    if (c.unreachable) throw new Error("corpus unreachable");
    return c;
  }));
  // What the item lists read (lib/item-view.ts); a failure is logged and the pages fall back.
  let itemView: { written: boolean; items?: number } | null = null;
  try {
    itemView = await writeItemView(opts, { build: async () => buildItemView(dataAsOf, new Date(), await corpus()) });
  } catch (err) {
    console.error("item view failed", err);
  }
  release();
  // The tables the item, NPC, zone, instance, object, loot, edge and addon pages read (lib/aggregate-store.ts), so a new
  // server instance reads one file instead of replaying the corpus. The set is worked out once per run: the aggregates
  // file and the search names file are written from the same one.
  let aggregatesRead: Promise<AggregateSet> | null = null;
  const aggregateSet = () => (aggregatesRead ??= corpus().then(anonymousAggregates));
  let aggregates: { written: boolean; bytes?: number } | null = null;
  try {
    aggregates = await writeAggregates(opts, { build: aggregateSet });
  } catch (err) {
    console.error("aggregates failed", err);
  }
  // The names the site's own search matches (lib/search-names-store.ts), a few hundred KB from the same set. Written on
  // the runs that build the set anyway (aggregates just written, or a rebuild), never for itself: the set is the
  // heaviest step (#1354). A failure is logged and the search reads the aggregates as before.
  let searchNames: { written: boolean; bytes?: number } | null = null;
  try {
    searchNames = aggregates?.written || rebuild ? await writeSearchNames(opts, { build: aggregateSet }) : { written: false };
  } catch (err) {
    console.error("search names failed", err);
  }
  // Nothing after this reads the set; the corpus stays for the views below.
  aggregatesRead = null;
  release();
  // Every realm and item's public auction days (lib/auction-history-store.ts), for the history page and the
  // auction_history tool; a failure is logged and they read the corpus.
  let auctionHistory: { written: boolean; items?: number } | null = null;
  try {
    auctionHistory = await writeAuctionHistory(opts, { build: async () => buildAuctionHistory(await corpus()) });
  } catch (err) {
    console.error("auction history failed", err);
  }
  release();
  let professions: { written: boolean; bytes?: number } | null = null;
  try {
    professions = await writeProfessions(opts, { build: async () => buildProfessions(await corpus()) });
  } catch (err) {
    console.error("profession view failed", err);
  }
  release();
  let mapPins: { written: boolean; bytes?: number } | null = null;
  try {
    mapPins = await writeMapPins(opts, { build: async () => buildMapPins(await corpus()) });
  } catch (err) {
    console.error("map pins view failed", err);
  }
  release();
  let databaseActivity: { written: boolean; entries?: number } | null = null;
  try {
    databaseActivity = await writeDatabaseActivity(opts, { build: async (previous) => buildDatabaseActivity(await corpus(), new Date(), previous) });
  } catch (err) {
    console.error("database activity failed", err);
  }
  release();
  // The coverage score, dated by the snapshot, from the same corpus: read again on its own, it ran out of the Worker's
  // memory after the boards on runs with new uploads (2026-11-20 19:45, #1354). The pages show the last stored score
  // (or say it is unreachable).
  let coverage: { written: boolean } | null = null;
  try {
    coverage = await writeCoverage(opts, { corpus });
  } catch (err) {
    console.error("coverage failed", err);
  }
  // The last step that shares the corpus is done.
  corpusRead = null;
  release();
  // The guild ladder reads the whole corpus again, between two reads of guild authority, so a revoke or hide made during
  // the run cannot reach the file; its pages replay the corpus without it. Hides stay live in the page/tool reader.
  let guildLadder: { written: boolean; bytes?: number } | null = null;
  try {
    guildLadder = await writeGuildLadder(opts);
  } catch (err) {
    console.error("guild ladder failed", err);
  }
  release();
  // The Auction House boards (lib/market-boards.ts), built once here instead of on every browse, realm, bags and
  // disenchanting request: rewritten when the rollup or the UTC day changed. They and the auction reports each read the
  // market rollup, the aggregates and the client's item tables to name items. The boards go first: without a current
  // file every Auction House page builds them, while a missing day of reports only waits.
  let marketBoards: { written: boolean; bytes?: number; ms?: number } | null = null;
  try { marketBoards = await writeMarketBoards(); } catch (err) { console.error("market boards failed", err); }
  release();
  // The auction reports, the largest step (about 110 MB more than the boards in a local replay, 2026-11-20), are written
  // once a UTC day, and only from a market with no uploads left to fold: a day's report is never rewritten.
  let auctionReports: { written: boolean; reports?: number } | null = null;
  try { if (!work.rollupsPending) auctionReports = await writeAuctionReports(); } catch (err) { console.error("auction reports failed", err); }
  release();
  return NextResponse.json({ ok: true, rebuild, dataAsOf, itemView, aggregates, searchNames, auctionHistory, professions, mapPins, databaseActivity, guildLadder, marketBoards, coverage, auctionReports });
}
