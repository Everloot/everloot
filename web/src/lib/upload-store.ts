import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import { CENSUS_KINDS, parseRecords, type IntakeRecord, type StoredCensusRecord, type StoredUpload } from "@everloot/protocol";
import { mergeCorpus, mergeCorpusBatches, publicRecords, type CorpusState } from "@kb/corpus";
import { HISTORY_DAYS, MARKET_MAX_BYTES, emptyMarket, foldMarket, marketBytes, trimMarket, uploadScans, type FoldStats, type MarketState } from "@kb/market";
import { mergeCensusRows } from "@kb/census-rows";
import { TRUSTED_REPORTER, trustedInstalls } from "@kb/trusted-source";
import { createSharingStore } from "./sharing-store";
import { keep } from "./kept";
import {
  COMPLETION_MAX_BYTES, authorizedOwners, emptyCompletion, foldCompletion, isCompletionState, normalizeCompletion, trimCompletion, type CompletionState, type CompletionUpload,
} from "@kb/completion-rollup";
import type { PublicationState } from "@kb/publication";

/**
 * Where uploads and waitlist signups live.
 * Cloud: the raw upload is an R2 object (cheap, the record of truth) and Supabase holds one index
 * row per upload plus the waitlist. Every rollup can be rebuilt from the R2 objects.
 * Pages read one snapshot (`snapshots/corpus.json`, which lists its parts under `snapshots/corpus/`) that a cron
 * job extends with only the uploads it has not seen yet. With no snapshot they fall back to reading every indexed object.
 * Full auction scans skip the corpus: the same cron folds them into `snapshots/market.json`
 * (kb/src/market.ts), which the market page, API and MCP tool read.
 * Local (no cloud variables, i.e. dev): the same files under web/data, as before.
 */

export interface CloudConfig {
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2Bucket: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
}

export interface Corpus {
  uploads: number;
  /** Every record already passed its kind schema, so a rollup never reads a row no schema accepted. */
  records: IntakeRecord[];
  /** Set when the read failed. An empty `records` array is then not a count of uploads. */
  unreachable?: boolean;
  legacyRecords?: number;
  /**
   * When these records were current: the snapshot's build time, or the read time for a live read.
   * Null when a snapshot carries no valid time — its age is then unrecorded, never "now".
   */
  dataAsOf?: string | null;
}

/** `etag` is the snapshot object's, so a later read asks R2 whether it changed instead of downloading it again. */
interface RawCorpus { uploads: number; state: CorpusState; unreachable?: boolean; dataAsOf: string | null; etag?: string }

function validTime(value: string): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

export interface SnapshotHealth {
  status: "fresh" | "stale" | "missing" | "unavailable" | "local";
  updatedAt: string | null;
  ageSeconds: number | null;
}

export const STORAGE_UNREACHABLE = "Storage unreachable. These figures are unrecorded, not zero.";
export const STORAGE_UNREACHABLE_SHORT = "Storage unreachable";

interface Snapshot extends Corpus {
  conflictTombstones?: string[];
  corpusState?: CorpusState;
  seenUploadIds?: string[];
  etag?: string;
  /** Format 2: the part objects that hold the events, and the previous write's, deleted by the write after next. */
  parts?: string[];
  retired?: string[];
  generatedAt: string;
  /** received_at of the newest upload included, and the ids sharing it, so ties are not re-read. */
  lastReceivedAt: string | null;
  lastIds: string[];
}

/** Null state means the read failed: market values are then unrecorded, never zero. */
export interface Market {
  state: MarketState | null;
  dataAsOf: string | null;
  unreachable?: boolean;
}

/** Null state means the read failed: completion is then unrecorded, never zero. */
export interface CompletionRead {
  state: CompletionState | null;
  dataAsOf: string | null;
  unreachable?: boolean;
}

/** Stored census rows, folded: one per install and event, the daily caps applied. Null rows mean the read failed. */
export interface CensusRead {
  rows: StoredCensusRecord[];
  dataAsOf: string | null;
  unreachable?: boolean;
}

/** An install's uploads read back for its census cap; past this many the cap cannot be checked, so census rows wait. */
const CENSUS_INSTALL_UPLOADS_MAX = 500;
/** Rows are dated at most 30 days back, so older uploads cannot hold a day that still accepts rows. */
const CENSUS_READ_DAYS = 32;

/**
 * The census rows the cron has folded, so a census, rankings or population read is one object instead of every
 * upload. `mergeCensusRows` gives the same rows whether it folds once or in steps, so the snapshot equals a full fold.
 */
interface CensusSnapshot {
  version: 1;
  generatedAt: string;
  rows: StoredCensusRecord[];
  /** received_at of the newest upload folded in, and the ids sharing it, so ties are not read twice. */
  lastReceivedAt: string | null;
  lastIds: string[];
}
/** Uploads one census run folds at most; the next run continues from where it stopped. */
const CENSUS_UPLOADS_PER_RUN = 2000;

interface CompletionSnapshot {
  version: 2;
  generatedAt: string;
  state: CompletionState;
  /** received_at of the newest upload folded in, and the ids sharing it, so ties are not read twice. */
  lastReceivedAt: string | null;
  lastIds: string[];
}

interface MarketSnapshot {
  version: 3;
  generatedAt: string;
  state: MarketState;
  /** received_at of the newest upload folded in, and the ids sharing it, so ties are not read twice. */
  lastReceivedAt: string | null;
  lastIds: string[];
  /**
   * Before the watermark, every upload id in the read window was kept here, which grew with every upload of any
   * kind. Only read, never written: the run after such a rollup lists the window once more and skips these.
   */
  seenUploadIds?: string[];
}

/** An upload received before this can only hold days the 60-day history has pruned (one day of clock drift allowed). */
const MARKET_READ_DAYS = HISTORY_DAYS + 2;
/** Upload objects read and folded at a time, so a rebuild never holds every payload at once. */
const MARKET_FOLD_BATCH = 64;
/** Uploads one market cron run folds at most; a backlog is folded over several runs, each saving its place. */
const MARKET_UPLOADS_PER_RUN = 1500;
/** Uploads one completion cron run folds; a first run or a rebuild takes several runs and saves after each. */
const COMPLETION_UPLOADS_PER_RUN = 1500;

interface IndexRow {
  id: string;
  object_key: string;
  received_at: string;
}

export interface WaitlistEntry {
  toolSlug: string;
  email: string;
  ts: string;
}

/** Cloud mode requires every variable. Production rejects incomplete configuration. */
export function cloudConfig(env: Record<string, string | undefined> = process.env): CloudConfig | null {
  const v = (k: string) => env[k]?.trim() || undefined;
  const c = {
    r2AccountId: v("R2_ACCOUNT_ID"),
    r2AccessKeyId: v("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: v("R2_SECRET_ACCESS_KEY"),
    r2Bucket: v("R2_BUCKET"),
    supabaseUrl: v("SUPABASE_URL"),
    supabaseServiceKey: v("SUPABASE_SERVICE_ROLE_KEY"),
  };
  return Object.values(c).every(Boolean) ? (c as CloudConfig) : null;
}

export type R2Config = Pick<CloudConfig, "r2AccountId" | "r2AccessKeyId" | "r2SecretAccessKey" | "r2Bucket">;

/** R2 readers do not need the upload index's Supabase configuration. */
export function r2Config(): R2Config | null {
  const c = {
    r2AccountId: process.env.R2_ACCOUNT_ID?.trim(),
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID?.trim(),
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim(),
    r2Bucket: process.env.R2_BUCKET?.trim(),
  };
  return Object.values(c).every(Boolean) ? c as R2Config : null;
}

export function r2Client(cloud: R2Config): AwsClient {
  return new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });
}

const PAGE = 1000; // PostgREST's default row cap on Supabase
const PARALLEL_READS = 16;
// R2 calls are bounded (r2Fetch). The pages' read of the market rollup gives up sooner, since a visitor or crawler waits on it.
const R2_READ_TIMEOUT_MS = 25_000;
const R2_WRITE_TIMEOUT_MS = 45_000;
const MARKET_PAGE_READ_MS = 12_000;
const MARKET_STALE_MS = 60 * 60_000;
const MARKET_RETRY_MS = 30_000;
const SNAPSHOT_KEY = "snapshots/corpus.json";
/**
 * The snapshot's events are stored in parts under this prefix, one folder per write, and SNAPSHOT_KEY lists them
 * (format 2). Read whole, the 31 MB file (2026-11-19) was a 59 MB string beside its 48 MB of parsed events, past the
 * Worker's 128 MB before any work began (#1354). A part holds at most SNAPSHOT_PART_CHARS of JSON.
 */
const SNAPSHOT_PARTS_PREFIX = "snapshots/corpus/";
const SNAPSHOT_PART_CHARS = 2_000_000;
/**
 * While one request of an instance reads a newer corpus, the others answer from the copy it already holds instead of
 * parsing a second one beside it (#1354). Past this long the read is taken for lost (a cancelled request) and the next
 * caller reads again.
 */
const CORPUS_REFRESH_HOLD_MS = 60_000;
const MARKET_KEY = "snapshots/market.json";
const COMPLETION_KEY = "snapshots/completion.json";
const CENSUS_KEY = "snapshots/census.json";
/** A rebuild is folded here over several runs and swapped into COMPLETION_KEY when done, so pages never read a partial one. */
const COMPLETION_REBUILD_KEY = "snapshots/completion-rebuild.json";

/**
 * The snapshot's events as part bodies, each a JSON array of at most `maxChars` (a single larger event gets a part of
 * its own). Strings are built one part at a time, so the whole corpus is never one string.
 */
export function* snapshotParts(events: readonly unknown[], maxChars = SNAPSHOT_PART_CHARS): Generator<string> {
  let chunk: string[] = [];
  let size = 2;
  for (const event of events) {
    const text = JSON.stringify(event);
    if (chunk.length && size + text.length + 1 > maxChars) {
      yield `[${chunk.join(",")}]`;
      chunk = [];
      size = 2;
    }
    chunk.push(text);
    size += text.length + 1;
  }
  if (chunk.length) yield `[${chunk.join(",")}]`;
}

/** The folder one snapshot write puts its parts in: its time and a random suffix, so two racing writes never share one. */
export function snapshotPartsFolder(generatedAt: string): string {
  return `${SNAPSHOT_PARTS_PREFIX}${generatedAt.replace(/[^0-9TZ]/g, "")}-${crypto.randomUUID().slice(0, 8)}/`;
}

function rawRecordsOf(payload: unknown): unknown[] {
  const records = (payload as { records?: unknown })?.records;
  return Array.isArray(records) ? records : [];
}

/**
 * Every read boundary normalizes through the same kind schemas: stored files, R2 objects and
 * snapshot rows may predate a schema change. Unknown kinds and invalid rows are dropped, extra
 * fields stripped. No aggregate cap — 2,000 is a per-request limit, not a corpus size.
 */
export function createUploadStore(opts: {
  cloud: CloudConfig | null;
  localDir: string;
  fetch?: typeof fetch;
  now?: () => Date;
  cacheMs?: number;
  /** Largest market.json the rollup may read or write; defaults to MARKET_MAX_BYTES. Tests lower it. */
  marketMaxBytes?: number;
  /** Largest completion.json the rollup may read; a write trims to stay under it. Tests lower it. */
  completionMaxBytes?: number;
  /** How long a page waits on the market rollup's read, how long a held copy answers when it cannot be read, and the pause before the next try. Tests shorten them. */
  marketReadMs?: number;
  marketStaleMs?: number;
  marketRetryMs?: number;
  /** Uploads one market run folds at most; the next run continues from where it stopped. */
  marketBatch?: number;
  /** Uploads one completion run folds at most; the next run continues from where it stopped. */
  completionBatch?: number;
  /** Time and catalog/owned rows one completion run may spend before it saves and stops (checked between batches). */
  completionBudgetMs?: number;
  completionRowBudget?: number;
  /** Recheck current publication authority on EVERY read, including cache hits. */
  publication?: (state: CorpusState) => Promise<IntakeRecord[]>;
  /** Everloot's own install ids, public on their own in the market and census (kb/src/trusted-source.ts). Defaults to EVERLOOT_TRUSTED_INSTALLS. */
  trusted?: ReadonlySet<string>;
}) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const cacheMs = opts.cacheMs ?? 5 * 60 * 1000;
  let marketCached: { at: number; market: Market } | null = null;
  let marketRead: { at: number; promise: Promise<Market | null> } | null = null;
  let marketRetryAt = 0;
  let completionCached: { at: number; read: CompletionRead } | null = null;
  let censusCached: { at: number; read: CensusRead } | null = null;
  const marketMaxBytes = opts.marketMaxBytes ?? MARKET_MAX_BYTES;
  const marketReadMs = opts.marketReadMs ?? MARKET_PAGE_READ_MS;
  const marketStaleMs = opts.marketStaleMs ?? MARKET_STALE_MS;
  const marketRetryMs = opts.marketRetryMs ?? MARKET_RETRY_MS;
  const marketBatch = opts.marketBatch ?? MARKET_UPLOADS_PER_RUN;
  const completionMaxBytes = opts.completionMaxBytes ?? COMPLETION_MAX_BYTES;
  const completionBatch = opts.completionBatch ?? COMPLETION_UPLOADS_PER_RUN;
  const completionBudgetMs = opts.completionBudgetMs ?? 150_000;
  const completionRowBudget = opts.completionRowBudget ?? 500_000;
  const trusted = opts.trusted ?? trustedInstalls(process.env.EVERLOOT_TRUSTED_INSTALLS);

  const cloud = opts.cloud;
  const unavailable = !cloud && process.env.NODE_ENV === "production";
  const r2 = cloud && r2Client(cloud);
  const objectUrl = (key: string) => `https://${cloud!.r2AccountId}.r2.cloudflarestorage.com/${cloud!.r2Bucket}/${key}`;
  const rest = (path: string) => `${cloud!.supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`;
  const restHeaders = (extra: Record<string, string> = {}) => ({
    apikey: cloud!.supabaseServiceKey,
    authorization: `Bearer ${cloud!.supabaseServiceKey}`,
    "content-type": "application/json",
    ...extra,
  });

  /**
   * One R2 call, always bounded: a read the platform never answers would otherwise hold its request to the Worker's
   * limit (and, for the pages, end as a canceled request instead of an answer). The cron's reads and writes get the
   * longer default; a caller that must give up sooner passes its own limit.
   */
  async function r2Fetch(key: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    const read = init.method === undefined || init.method === "GET" || init.method === "HEAD";
    const bounded = init.signal ? init : { ...init, signal: AbortSignal.timeout(timeoutMs ?? (read ? R2_READ_TIMEOUT_MS : R2_WRITE_TIMEOUT_MS)) };
    return doFetch(await r2!.sign(objectUrl(key), bounded));
  }

  async function putUpload(uploadId: string, installId: string, payload: StoredUpload, publicationGrants: string[] = []): Promise<boolean> {
    if (unavailable) return false;
    const body = JSON.stringify(publicationGrants.length ? { ...payload, publicationGrants } : payload);
    if (!cloud) {
      try {
        const dir = join(opts.localDir, "uploads");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${uploadId}.json`), body);
        corpusKept.forget(); completionCached = null; censusCached = null;
        return true;
      } catch {
        return false;
      }
    }
    const key = `uploads/${now().toISOString().slice(0, 10)}/${uploadId}.json`;
    let put: Response;
    try {
      put = await r2Fetch(key, { method: "PUT", body, headers: { "content-type": "application/json" } });
    } catch (err) {
      // A rejection means the network, not an answer; name the half that failed like the status log below.
      console.error(`upload ${uploadId}: R2 put failed`, err);
      return false;
    }
    try {
      if (!put.ok) {
        // Both halves answer the same 503, so each names itself in the log.
        const detail = await put.text().catch(() => "");
        console.error(`upload ${uploadId}: R2 put failed (${put.status}): ${detail.slice(0, 500)}`);
        return false;
      }
      const row = JSON.stringify({
        id: uploadId,
        install_id: installId,
        record_count: rawRecordsOf(payload).length,
        bytes: body.length,
        object_key: key,
      });
      if (!(await insertIndex(uploadId, row))) return false;
      corpusKept.forget(); completionCached = null; censusCached = null;
      return true;
    } catch (err) {
      console.error(`upload ${uploadId}: store failed`, err);
      return false;
    }
  }

  /**
   * The index row for an object already in R2. Readers find objects only through this table, so an object without
   * its row is never read. A failure that can pass (the network, a 5xx) is tried once more, and a 409 on that second
   * try means the first one landed. A refused row is not retried: it would be refused again.
   */
  async function insertIndex(uploadId: string, row: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let index: Response;
      try {
        index = await doFetch(rest("uploads"), { method: "POST", headers: restHeaders({ prefer: "return=minimal" }), body: row });
      } catch (err) {
        if (attempt === 1) continue;
        console.error(`upload ${uploadId}: R2 object stored but index insert failed`, err);
        return false;
      }
      if (index.ok || (attempt === 2 && index.status === 409)) return true;
      if (attempt === 1 && index.status >= 500) continue;
      // The status alone does not say what went wrong: PostgREST puts the reason (a column, a constraint, a
      // type) in the body. Without it in the log, the 400 behind a 503 cannot be read.
      const detail = await index.text().catch(() => "");
      console.error(`upload ${uploadId}: R2 object stored but index insert failed (${index.status}): ${detail.slice(0, 500)}`);
      return false;
    }
    return false;
  }

  function grantsOf(payload: unknown): string[] {
    const grants = (payload as { publicationGrants?: unknown })?.publicationGrants;
    return Array.isArray(grants) ? grants.filter((g) => typeof g === "string" && /^[a-f0-9]{64}$/.test(g)) : [];
  }

  /** Local upload files; null when the folder exists but cannot be read. */
  async function readLocalPayloads(): Promise<{ files: number; payloads: unknown[] } | null> {
    const dir = join(opts.localDir, "uploads");
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ENOENT" ? { files: 0, payloads: [] } : null;
    }
    const payloads: unknown[] = [];
    for (const f of files) {
      try {
        payloads.push(JSON.parse(await readFile(join(dir, f), "utf8")));
      } catch {
        continue; // a corrupt file never breaks a rollup
      }
    }
    return { files: files.length, payloads };
  }

  async function readLocal(): Promise<RawCorpus> {
    const local = await readLocalPayloads();
    if (!local) return { uploads: 0, state: mergeCorpus(undefined, []), unreachable: true, dataAsOf: null };
    const state = mergeCorpusBatches(undefined, local.payloads.map((p) => ({ raw: rawRecordsOf(p), grants: grantsOf(p) })));
    return { uploads: local.files, state, dataAsOf: now().toISOString() };
  }

  async function listIndex(since?: string, installId?: string, max = Infinity): Promise<IndexRow[]> {
    const filter = (since ? `&received_at=gte.${encodeURIComponent(since)}` : "") + (installId ? `&install_id=eq.${encodeURIComponent(installId)}` : "");
    const rows: IndexRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await doFetch(
        rest(`uploads?select=id,object_key,received_at&order=received_at.asc,id.asc&limit=${PAGE}&offset=${offset}${filter}`),
        { headers: restHeaders() },
      );
      if (!res.ok) throw new Error(`upload index read failed (${res.status})`);
      const page = (await res.json()) as IndexRow[];
      rows.push(...page);
      if (rows.length > max) throw new Error("upload index read is over its limit");
      if (page.length < PAGE) break;
    }
    return rows;
  }

  /** Upload objects by key. A corrupt object reads as null; an unreachable one sets `missed`. */
  async function readPayloads(keys: string[]): Promise<{ payloads: unknown[]; missed: boolean }> {
    const payloads: unknown[] = [];
    let missed = false;
    for (let i = 0; i < keys.length; i += PARALLEL_READS) {
      const batch = await Promise.all(keys.slice(i, i + PARALLEL_READS).map(async (key) => {
        try {
          const res = await r2Fetch(key, { method: "GET" });
          if (!res.ok) return { payload: null, missed: true };
          try {
            return { payload: JSON.parse(await res.text()) as unknown, missed: false };
          } catch {
            return { payload: null, missed: false };
          }
        } catch {
          return { payload: null, missed: true };
        }
      }));
      for (const row of batch) {
        if (row.missed) missed = true;
        else payloads.push(row.payload);
      }
    }
    return { payloads, missed };
  }

  async function readObjects(keys: string[], previous?: CorpusState): Promise<{ state: CorpusState; missed: boolean }> {
    const { payloads, missed } = await readPayloads(keys);
    const batches = payloads.map((p) => ({ raw: rawRecordsOf(p), grants: grantsOf(p) }));
    return { state: mergeCorpusBatches(previous ?? mergeCorpus(undefined, []), batches), missed };
  }

  /**
   * The auction parts of each upload, read only through the market's own schema: at most a few realms
   * per upload, each part carrying the upload's reporter (a keyed hash of the upload address, set by
   * the intake route; never the address).
   */
  function marketScans(payloads: unknown[]) {
    return payloads.flatMap((p) => {
      const reporter = (p as { reporter?: unknown } | null)?.reporter;
      const raw = rawRecordsOf(p).filter((r) => (r as { kind?: unknown } | null)?.kind === "auction_snapshot");
      return uploadScans(raw, typeof reporter === "string" ? reporter : undefined);
    });
  }

  /**
   * The stored rollup and its ETag. `snapshot` is null when the object is unusable (wrong version, a
   * shape the code does not know, or over the size limit): a rebuild may then replace it, a normal
   * run may not.
   */
  async function readMarketSnapshot(timeoutMs?: number): Promise<{ snapshot: MarketSnapshot | null; etag?: string } | null> {
    const res = await r2Fetch(MARKET_KEY, { method: "GET", headers: { "accept-encoding": "identity" } }, timeoutMs);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`market read failed (${res.status})`);
    const etag = res.headers.get("etag") ?? undefined;
    const text = await res.text();
    if (text.length > marketMaxBytes) return { snapshot: null, etag };
    let parsed: Partial<MarketSnapshot>;
    try { parsed = JSON.parse(text) as Partial<MarketSnapshot>; } catch { return { snapshot: null, etag }; }
    const state = parsed.state;
    const watermarked = (typeof parsed.lastReceivedAt === "string" || parsed.lastReceivedAt === null) && Array.isArray(parsed.lastIds);
    if (parsed.version !== 3 || state?.version !== 3 || !state.realms || typeof state.realms !== "object" || (!watermarked && !Array.isArray(parsed.seenUploadIds))) {
      return { snapshot: null, etag };
    }
    return { snapshot: { lastReceivedAt: null, lastIds: [], ...parsed } as MarketSnapshot, etag };
  }

  /**
   * Fold full scans from uploads not yet seen into the market rollup (cron). The rollup keeps a watermark
   * (`lastReceivedAt` and the ids sharing it), so a run lists only the uploads received since the last one, folds
   * at most `marketBatch` of them in arrival order and saves its place; `remaining` says how many wait for the
   * next run. A rollup from before the watermark carries `seenUploadIds` instead: the run after it lists the whole
   * read window once more and skips those. `rebuild` starts from empty and folds the whole window in one run.
   * A missed object writes nothing, so the next run reads it again.
   */
  async function writeMarket(opts: { rebuild?: boolean; idle?: boolean } = {}): Promise<{ added: number; scans: number; remaining?: number; dropped?: number; released?: number; trimmedDays?: number; skipped?: boolean }> {
    if (!cloud) throw new Error("the market rollup needs the cloud store");
    const current = await readMarketSnapshot();
    if (current && (!current.etag || current.etag.startsWith("W/"))) throw new Error("market rollup has no strong ETag: cannot safely update it");
    if (current && !current.snapshot && !opts.rebuild) throw new Error("market rollup is invalid: rebuild it with ?rebuild=1");
    const prev = opts.rebuild ? null : current?.snapshot ?? null;
    if (opts.idle && !opts.rebuild && prev && validTime(prev.generatedAt) &&
        new Date(prev.generatedAt).toISOString().slice(0, 10) === now().toISOString().slice(0, 10)) {
      return { added: 0, scans: 0, skipped: true };
    }
    const windowStart = new Date(now().getTime() - MARKET_READ_DAYS * 86_400_000).toISOString();
    // From the watermark when there is one inside the window; an upload older than the window holds only pruned days.
    const since = prev?.lastReceivedAt && Date.parse(prev.lastReceivedAt) > Date.parse(windowStart) ? prev.lastReceivedAt : windowStart;
    const legacy = new Set(prev?.seenUploadIds ?? []);
    const rows = await listIndex(since);
    const unseen = rows.filter((r) => !legacy.has(r.id) && !(prev?.lastReceivedAt && r.received_at === prev.lastReceivedAt && prev.lastIds.includes(r.id)));
    const fresh = opts.rebuild ? unseen : unseen.slice(0, marketBatch);
    let state = prev?.state ?? emptyMarket();
    let scans = 0;
    const stats: FoldStats = { dropped: 0, released: 0 };
    for (let i = 0; i < fresh.length; i += MARKET_FOLD_BATCH) {
      const { payloads, missed } = await readPayloads(fresh.slice(i, i + MARKET_FOLD_BATCH).map((r) => r.object_key));
      if (missed) throw new Error("upload object unreadable");
      const batch = marketScans(payloads);
      scans += batch.length;
      state = foldMarket(state, batch, now(), {}, stats, trusted);
    }
    const last = fresh.length > 0 ? fresh[fresh.length - 1].received_at : null;
    const sameTime = (ids: string[]) => (last !== null && prev?.lastReceivedAt === last ? [...new Set([...prev.lastIds, ...ids])] : ids);
    const snapshot: MarketSnapshot = {
      version: 3,
      generatedAt: now().toISOString(),
      // With no new scans the fold still closes and prunes days as time passes.
      state: fresh.length ? state : foldMarket(state, [], now(), {}, undefined, trusted),
      lastReceivedAt: last ?? prev?.lastReceivedAt ?? null,
      lastIds: last !== null ? sameTime(fresh.filter((r) => r.received_at === last).map((r) => r.id)) : prev?.lastIds ?? [],
    };
    let body = JSON.stringify(snapshot);
    let trimmedDays = 0;
    // The fold's caps bound the open scans; the closed history is bounded here, oldest days first, so prices
    // keep coming at the cost of history. Only a state that cannot be trimmed enough is refused.
    if (Buffer.byteLength(body) > marketMaxBytes) {
      const overhead = Buffer.byteLength(body) - marketBytes(snapshot.state);
      const trimmed = trimMarket(snapshot.state, marketMaxBytes - overhead);
      snapshot.state = trimmed.state;
      trimmedDays = trimmed.trimmedDays;
      body = JSON.stringify(snapshot);
      if (Buffer.byteLength(body) > marketMaxBytes) throw new Error("market rollup would exceed its size limit; not written");
    }
    const put = await r2Fetch(MARKET_KEY, {
      method: "PUT",
      body,
      headers: { "content-type": "application/json", ...(current ? { "if-match": current.etag! } : { "if-none-match": "*" }) },
    });
    if (!put.ok) throw new Error(`market write failed (${put.status})`);
    marketCached = null;
    return { added: fresh.length, scans, remaining: unseen.length - fresh.length, dropped: stats.dropped, released: stats.released, trimmedDays };
  }

  /** The rollup as the storage has it now; null when it cannot be read (no rollup yet, unusable, or storage out of reach). */
  async function readMarket(): Promise<Market | null> {
    try {
      if (unavailable) throw new Error("Production storage is not configured");
      if (cloud) {
        // No rollup yet (before the first cron run) is unavailable, not "no scans uploaded".
        const read = await readMarketSnapshot(marketReadMs);
        if (!read?.snapshot) throw new Error("market rollup not built yet or unusable");
        return { state: read.snapshot.state, dataAsOf: validTime(read.snapshot.generatedAt) };
      }
      const local = await readLocalPayloads();
      if (!local) throw new Error("local uploads unreadable");
      return { state: foldMarket(emptyMarket(), marketScans(local.payloads), now(), {}, undefined, trusted), dataAsOf: now().toISOString() };
    } catch {
      return null;
    }
  }

  /**
   * The market rollup the pages and tools read, kept `cacheMs` per isolate. Pages that arrive while it is being read
   * share that one read instead of each downloading and parsing the whole file at once (which is how a burst of
   * crawlers filled the isolate's memory and asked R2 for one object many times over). Each waits at most
   * MARKET_PAGE_READ_MS: a read started by a request that was canceled never finishes, and must not hold the others.
   * When the rollup cannot be read, the copy already held answers for up to MARKET_STALE_MS (figures an hour old, not
   * an unrecorded market) and the read is not tried again for MARKET_RETRY_MS.
   */
  async function loadMarket(): Promise<Market> {
    const at = Date.now();
    if (marketCached && at - marketCached.at < cacheMs) return marketCached.market;
    const stale = marketCached && at - marketCached.at < marketStaleMs ? marketCached.market : null;
    if (stale && at < marketRetryAt) return stale;
    if (!marketRead || at - marketRead.at > marketReadMs) {
      const run = { at, promise: readMarket().then((market) => {
        if (market) marketCached = { at: Date.now(), market };
        return market;
      }) };
      marketRead = run;
      void run.promise.finally(() => { if (marketRead === run) marketRead = null; });
    }
    const run = marketRead;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const market = await Promise.race([
      run.promise,
      // A read that outlasts the wait is dropped, so the next page starts its own instead of waiting on it again.
      new Promise<null>((resolve) => { timer = setTimeout(() => { if (marketRead === run) marketRead = null; resolve(null); }, marketReadMs); }),
    ]).finally(() => clearTimeout(timer));
    if (market) return market;
    if (stale) {
      marketRetryAt = Date.now() + marketRetryMs;
      return stale;
    }
    return { state: null, dataAsOf: null, unreachable: true };
  }

  /** Census rows of some upload payloads, folded into `previous` (the daily caps and last-write rule live in mergeCensusRows). */
  function foldCensus(previous: StoredCensusRecord[], payloads: unknown[]): StoredCensusRecord[] {
    const raw = payloads.flatMap((p) => rawRecordsOf(p).filter((r) => CENSUS_KINDS.includes(String((r as { kind?: unknown } | null)?.kind))));
    return mergeCensusRows(previous, raw);
  }

  /**
   * Every upload's census rows folded from scratch: the census before the cron's first census snapshot, and its rebuild.
   * Reads every upload object, so pages use the snapshot (`loadCensus`) and never this when one exists.
   */
  async function foldAllCensus(): Promise<{ rows: StoredCensusRecord[]; last: IndexRow[] }> {
    const index = await listIndex();
    let rows: StoredCensusRecord[] = [];
    for (let i = 0; i < index.length; i += MARKET_FOLD_BATCH) {
      const read = await readPayloads(index.slice(i, i + MARKET_FOLD_BATCH).map((r) => r.object_key));
      if (read.missed) throw new Error("upload object unreadable");
      rows = foldCensus(rows, read.payloads);
    }
    return { rows, last: index };
  }

  /** The stored census snapshot and its ETag; `snapshot` is null for one this code cannot read (a rebuild replaces it). */
  async function readCensusSnapshot(): Promise<{ snapshot: CensusSnapshot | null; etag?: string } | null> {
    const res = await r2Fetch(CENSUS_KEY, { method: "GET", headers: { "accept-encoding": "identity" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`census snapshot read failed (${res.status})`);
    const etag = res.headers.get("etag") ?? undefined;
    let parsed: Partial<CensusSnapshot>;
    try { parsed = JSON.parse(await res.text()) as Partial<CensusSnapshot>; } catch { return { snapshot: null, etag }; }
    if (parsed.version !== 1 || typeof parsed.generatedAt !== "string" || !Array.isArray(parsed.rows) || !Array.isArray(parsed.lastIds)
        || !(typeof parsed.lastReceivedAt === "string" || parsed.lastReceivedAt === null)) {
      return { snapshot: null, etag };
    }
    // Through the stored schemas again, as every read boundary does: a row of a shape the code no longer knows is dropped.
    return { snapshot: { ...(parsed as CensusSnapshot), rows: mergeCensusRows([], parsed.rows) }, etag };
  }

  /**
   * Fold the census rows of uploads received since the last run into the census snapshot (cron), like the market
   * rollup: a watermark, at most CENSUS_UPLOADS_PER_RUN uploads a run, `remaining` for the next. An idle run with a
   * snapshot reads nothing more. With no snapshot, or `rebuild`, it folds every upload from empty in one run. A missed
   * object writes nothing, so the next run reads it again.
   */
  async function writeCensus(opts: { rebuild?: boolean; idle?: boolean } = {}): Promise<{ added: number; rows: number; remaining: number; skipped?: boolean }> {
    if (!cloud) throw new Error("the census snapshot needs the cloud store");
    const current = await readCensusSnapshot();
    if (current && (!current.etag || current.etag.startsWith("W/"))) throw new Error("census snapshot has no strong ETag: cannot safely update it");
    if (current && !current.snapshot && !opts.rebuild) throw new Error("census snapshot is invalid: rebuild it with ?rebuild=1");
    const prev = opts.rebuild ? null : current?.snapshot ?? null;
    if (opts.idle && prev) return { added: 0, rows: prev.rows.length, remaining: 0, skipped: true };
    let rows: StoredCensusRecord[];
    let fresh: IndexRow[];
    let remaining = 0;
    if (!prev) {
      const all = await foldAllCensus();
      rows = all.rows;
      fresh = all.last;
    } else {
      const listed = await listIndex(prev.lastReceivedAt ?? undefined);
      const unseen = listed.filter((r) => !(prev.lastReceivedAt && r.received_at === prev.lastReceivedAt && prev.lastIds.includes(r.id)));
      fresh = unseen.slice(0, CENSUS_UPLOADS_PER_RUN);
      remaining = unseen.length - fresh.length;
      rows = prev.rows;
      for (let i = 0; i < fresh.length; i += MARKET_FOLD_BATCH) {
        const read = await readPayloads(fresh.slice(i, i + MARKET_FOLD_BATCH).map((r) => r.object_key));
        if (read.missed) throw new Error("upload object unreadable");
        rows = foldCensus(rows, read.payloads);
      }
    }
    const last = fresh.length > 0 ? fresh[fresh.length - 1].received_at : null;
    const atLast = fresh.filter((r) => r.received_at === last).map((r) => r.id);
    const snapshot: CensusSnapshot = {
      version: 1,
      generatedAt: now().toISOString(),
      rows,
      lastReceivedAt: last ?? prev?.lastReceivedAt ?? null,
      lastIds: last === null ? prev?.lastIds ?? [] : prev?.lastReceivedAt === last ? [...new Set([...prev.lastIds, ...atLast])] : atLast,
    };
    const put = await r2Fetch(CENSUS_KEY, {
      method: "PUT",
      body: JSON.stringify(snapshot),
      headers: { "content-type": "application/json", ...(current ? { "if-match": current.etag! } : { "if-none-match": "*" }) },
    });
    if (!put.ok) throw new Error(`census snapshot write failed (${put.status})`);
    censusCached = null;
    return { added: fresh.length, rows: rows.length, remaining };
  }

  /**
   * Every stored census row, folded. This is the reader the census summary uses: census rows are never in the
   * public corpus, so they come from the private upload objects, through the stored schemas only. A row still
   * carrying a GUID and no key is skipped, so no GUID can come out of here. In the cloud it reads the cron's census
   * snapshot (one object, cached for `cacheMs`); only before the first snapshot exists does it fold every upload.
   * Dated by the snapshot, so the census says when its rows were last folded.
   */
  async function loadCensus(): Promise<CensusRead> {
    try {
      if (unavailable) throw new Error("Production storage is not configured");
      if (censusCached && Date.now() - censusCached.at < cacheMs) return censusCached.read;
      let rows: StoredCensusRecord[] = [];
      let dataAsOf = now().toISOString();
      if (cloud) {
        const stored = await readCensusSnapshot();
        if (stored?.snapshot) {
          rows = stored.snapshot.rows;
          dataAsOf = stored.snapshot.generatedAt;
        } else {
          rows = (await foldAllCensus()).rows;
        }
      } else {
        const local = await readLocalPayloads();
        if (!local) throw new Error("local uploads unreadable");
        rows = foldCensus([], local.payloads);
      }
      // Everloot's own installs count as trusted reporters (kb/src/trusted-source.ts); their address hash is not needed here.
      if (trusted.size) rows = rows.map((r) => (trusted.has(r.installId) ? { ...r, reporter: TRUSTED_REPORTER } : r));
      const read = { rows, dataAsOf };
      censusCached = { at: Date.now(), read };
      return read;
    } catch {
      return { rows: [], dataAsOf: null, unreachable: true };
    }
  }

  /**
   * What one install has already stored in the days a census row may still be dated, across all its uploads,
   * so the daily cap holds over many uploads and not only within one. Null when it cannot be read: the caller
   * then stores no census rows rather than guessing.
   */
  async function installCensus(installId: string): Promise<StoredCensusRecord[] | null> {
    try {
      if (unavailable) return null;
      if (!cloud) {
        const local = await readLocalPayloads();
        return local ? foldCensus([], local.payloads).filter((r) => r.installId === installId) : null;
      }
      const since = new Date(now().getTime() - CENSUS_READ_DAYS * 86_400_000).toISOString();
      const keys = (await listIndex(since, installId, CENSUS_INSTALL_UPLOADS_MAX)).map((r) => r.object_key);
      let rows: StoredCensusRecord[] = [];
      for (let i = 0; i < keys.length; i += MARKET_FOLD_BATCH) {
        const read = await readPayloads(keys.slice(i, i + MARKET_FOLD_BATCH));
        if (read.missed) return null;
        rows = foldCensus(rows, read.payloads);
      }
      return rows.filter((r) => r.installId === installId);
    } catch {
      return null;
    }
  }

  /** Each upload with its address hash (never published) and, from the index, when it arrived. */
  function completionUploads(payloads: unknown[], receivedAt: (string | undefined)[] = []): CompletionUpload[] {
    return payloads.map((p, i) => {
      const reporter = (p as { reporter?: unknown } | null)?.reporter;
      return {
        records: rawRecordsOf(p), grants: grantsOf(p), receivedAt: receivedAt[i],
        reporter: typeof reporter === "string" && /^[a-f0-9]{16}$/.test(reporter) ? reporter : undefined,
      };
    });
  }

  /** A stored completion rollup and its ETag; `snapshot` is null when the object is unusable. */
  async function readCompletionSnapshot(key = COMPLETION_KEY): Promise<{ snapshot: CompletionSnapshot | null; etag?: string } | null> {
    const res = await r2Fetch(key, { method: "GET", headers: { "accept-encoding": "identity" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`completion read failed (${res.status})`);
    const etag = res.headers.get("etag") ?? undefined;
    const text = await res.text();
    if (text.length > completionMaxBytes) return { snapshot: null, etag };
    let parsed: Partial<CompletionSnapshot>;
    try { parsed = JSON.parse(text) as Partial<CompletionSnapshot>; } catch { return { snapshot: null, etag }; }
    if (parsed.version !== 2 || !isCompletionState(parsed.state) || !Array.isArray(parsed.lastIds)) return { snapshot: null, etag };
    return { snapshot: { ...(parsed as CompletionSnapshot), state: normalizeCompletion(parsed.state) }, etag };
  }

  const strong = (read: { etag?: string } | null) => {
    if (read && (!read.etag || read.etag.startsWith("W/"))) throw new Error("completion rollup has no strong ETag: cannot safely update it");
  };

  /**
   * One cron run of the completion rollup. It folds uploads newer than the rollup's watermark in arrival order,
   * in batches of 64, and stops between batches once it has folded `completionBatch` uploads or spent its time or
   * row budget; the watermark moves to the last upload fully folded, so every run makes progress and the next
   * one continues there. After each batch the rollup is trimmed to stay under its size limit (never refused);
   * `authority` says which installs still have a live grant, and when it cannot be read no progress is trimmed.
   * `rebuild` starts again from empty in a separate object, which later runs continue and which replaces the
   * served rollup only once it has caught up. A missed upload object saves what was folded before it and fails,
   * so the next run reads it again.
   */
  async function writeCompletion(opts: { rebuild?: boolean; authority?: () => Promise<PublicationState> } = {}): Promise<{ added: number; remaining: number; trimmed: number; rebuilding: boolean }> {
    if (!cloud) throw new Error("the completion rollup needs the cloud store");
    const started = Date.now();
    const served = await readCompletionSnapshot(COMPLETION_KEY);
    const pending = await readCompletionSnapshot(COMPLETION_REBUILD_KEY);
    strong(served); strong(pending);
    const rebuilding = !!opts.rebuild || !!pending?.snapshot;
    if (!rebuilding && served && !served.snapshot) throw new Error("completion rollup is invalid: rebuild it with ?rebuild=1");
    const prev = opts.rebuild ? null : rebuilding ? pending!.snapshot : served?.snapshot ?? null;
    const rows = await listIndex(prev?.lastReceivedAt ?? undefined);
    const unseen = rows.filter((r) => !(prev && r.received_at === prev.lastReceivedAt && prev.lastIds.includes(r.id)));
    let state = prev?.state ?? emptyCompletion();
    let authority: PublicationState | null = null;
    try { authority = opts.authority ? await opts.authority() : null; } catch { authority = null; }
    const liveOwners = () => (authority ? authorizedOwners(state, authority, now()) : null);
    let folded = 0;
    let rowsFolded = 0;
    let trimmed = 0;
    let missed = false;
    while (folded < Math.min(unseen.length, completionBatch)) {
      if (folded > 0 && (Date.now() - started > completionBudgetMs || rowsFolded > completionRowBudget)) break;
      const slice = unseen.slice(folded, Math.min(folded + MARKET_FOLD_BATCH, completionBatch));
      const read = await readPayloads(slice.map((r) => r.object_key));
      if (read.missed) { missed = true; break; }
      const uploads = completionUploads(read.payloads, slice.map((r) => r.received_at));
      rowsFolded += uploads.reduce((n, u) => n + u.records.length, 0);
      state = foldCompletion(state, uploads);
      folded += slice.length;
      // Checked after every batch, so the state never grows far past the limit before it is trimmed.
      const trim = trimCompletion(state, completionMaxBytes, liveOwners());
      trimmed += trim.variants + trim.characters;
    }
    if (missed && folded === 0) throw new Error("upload object unreadable");
    const done = unseen.slice(0, folded);
    const last = done.length > 0 ? done[done.length - 1].received_at : null;
    const sameTime = (ids: string[]) => (last !== null && prev?.lastReceivedAt === last ? [...new Set([...prev.lastIds, ...ids])] : ids);
    const snapshot: CompletionSnapshot = {
      version: 2,
      generatedAt: now().toISOString(),
      state,
      lastReceivedAt: last ?? prev?.lastReceivedAt ?? null,
      lastIds: last !== null ? sameTime(done.filter((r) => r.received_at === last).map((r) => r.id)) : prev?.lastIds ?? [],
    };
    const body = JSON.stringify(snapshot);
    if (Buffer.byteLength(body) > completionMaxBytes) throw new Error("completion rollup would exceed its size limit after trimming; not written");
    const remaining = unseen.length - folded;
    const put = async (key: string, read: { etag?: string } | null) => {
      const res = await r2Fetch(key, {
        method: "PUT", body,
        headers: { "content-type": "application/json", ...(read ? { "if-match": read.etag! } : { "if-none-match": "*" }) },
      });
      if (!res.ok) throw new Error(`completion write failed (${res.status})`);
    };
    let stillRebuilding = false;
    if (rebuilding && (remaining > 0 || missed)) {
      await put(COMPLETION_REBUILD_KEY, pending);
      stillRebuilding = true;
    } else {
      await put(COMPLETION_KEY, served);
      if (pending) {
        // Delete only the rebuild object this run read: a ?rebuild=1 that started a new one since then keeps it.
        const latest = await r2Fetch(COMPLETION_REBUILD_KEY, { method: "HEAD" });
        if (latest.ok && latest.headers.get("etag") === pending.etag) {
          const gone = await r2Fetch(COMPLETION_REBUILD_KEY, { method: "DELETE", headers: { "if-match": pending.etag! } });
          if (!gone.ok && gone.status !== 404 && gone.status !== 412) throw new Error(`completion rebuild cleanup failed (${gone.status})`);
        }
      }
    }
    completionCached = null;
    if (missed) throw new Error("upload object unreadable; the uploads before it were saved");
    return { added: folded, remaining, trimmed, rebuilding: stillRebuilding };
  }

  /** The completion rollup. Cloud reads the cron's object; local folds the local uploads. */
  async function loadCompletion(): Promise<CompletionRead> {
    if (completionCached && Date.now() - completionCached.at < cacheMs) return completionCached.read;
    let read: CompletionRead;
    try {
      if (unavailable) throw new Error("Production storage is not configured");
      if (cloud) {
        const stored = await readCompletionSnapshot(COMPLETION_KEY);
        if (!stored?.snapshot) throw new Error("completion rollup not built yet or unusable");
        read = { state: stored.snapshot.state, dataAsOf: validTime(stored.snapshot.generatedAt) };
      } else {
        const local = await readLocalPayloads();
        if (!local) throw new Error("local uploads unreadable");
        read = { state: foldCompletion(emptyCompletion(), completionUploads(local.payloads)), dataAsOf: now().toISOString() };
      }
    } catch {
      return { state: null, dataAsOf: null, unreachable: true };
    }
    completionCached = { at: Date.now(), read };
    return read;
  }

  async function readSnapshot(): Promise<Snapshot | null> {
    const read = await readSnapshotIfChanged();
    return read === "unchanged" ? null : read;
  }

  /** The snapshot, or "unchanged" when `etag` is given and still the object's: nothing is downloaded or parsed then. */
  async function readSnapshotIfChanged(etag?: string): Promise<Snapshot | null | "unchanged"> {
    // Compression can turn the object's strong ETag into a weak response validator.
    const res = await r2Fetch(SNAPSHOT_KEY, { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } });
    if (etag && res.status === 304) return "unchanged";
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`snapshot read failed (${res.status})`);
    let parsed: Partial<Snapshot> & { format?: unknown; state?: Omit<CorpusState, "events"> };
    try {
      parsed = JSON.parse(await res.text()) as typeof parsed;
    } catch {
      throw new Error("snapshot is not JSON");
    }
    if (parsed.format === 2) {
      // The events come from the parts, one at a time, so no string larger than a part is ever held.
      if (!Array.isArray(parsed.parts) || !parsed.parts.every((k) => typeof k === "string" && k.startsWith(SNAPSHOT_PARTS_PREFIX)) ||
          typeof parsed.state !== "object" || parsed.state === null) throw new Error("snapshot part list is invalid");
      const events: CorpusState["events"] = [];
      for (const key of parsed.parts) {
        const part = await r2Fetch(key, { method: "GET", headers: { "accept-encoding": "identity" } });
        if (!part.ok) throw new Error(`snapshot part read failed (${part.status})`);
        let list: unknown;
        try { list = JSON.parse(await part.text()); } catch { throw new Error("snapshot part is not JSON"); }
        if (!Array.isArray(list)) throw new Error("snapshot part is not a list");
        for (const event of list) events.push(event as CorpusState["events"][number]);
      }
      parsed.corpusState = { ...parsed.state, events } as CorpusState;
    }
    // A snapshot with replay state carries its records there (writeSnapshot stores them once, as events), so the
    // records array is read, and required, only for a snapshot from before the replay state existed.
    const replayable = typeof parsed.corpusState === "object" && parsed.corpusState !== null;
    // A snapshot without a records array is unreadable, never an empty corpus.
    if (!replayable && !Array.isArray(parsed.records)) throw new Error("snapshot has no records array");
    return {
      corpusState: parsed.corpusState,
      conflictTombstones: parsed.conflictTombstones,
      seenUploadIds: parsed.seenUploadIds,
      etag: res.headers.get("etag") ?? undefined,
      parts: parsed.parts,
      retired: Array.isArray(parsed.retired) ? parsed.retired.filter((k) => typeof k === "string" && k.startsWith(SNAPSHOT_PARTS_PREFIX)) : undefined,
      generatedAt: parsed.generatedAt ?? "",
      uploads: typeof parsed.uploads === "number" ? parsed.uploads : 0,
      records: replayable ? [] : parseRecords(parsed.records ?? []).records,
      lastReceivedAt: parsed.lastReceivedAt ?? null,
      lastIds: Array.isArray(parsed.lastIds) ? parsed.lastIds : [],
    };
  }

  /** When the snapshot was written and its newest upload, from the part list alone: no event is read. */
  async function readSnapshotMark(): Promise<{ generatedAt: string; lastReceivedAt: string | null } | null> {
    const res = await r2Fetch(SNAPSHOT_KEY, { method: "GET", headers: { "accept-encoding": "identity" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`snapshot read failed (${res.status})`);
    let parsed: Partial<Snapshot>;
    try { parsed = JSON.parse(await res.text()) as Partial<Snapshot>; } catch { throw new Error("snapshot is not JSON"); }
    return { generatedAt: parsed.generatedAt ?? "", lastReceivedAt: parsed.lastReceivedAt ?? null };
  }

  /** One bounded index probe before any corpus replay. A successful run records its corpus generation. */
  async function snapshotWork(): Promise<{ idle: boolean; retryRollups: boolean; dataAsOf: string | null; settledWeek: string | null }> {
    if (!cloud) throw new Error("snapshots need the cloud store");
    const snapshot = await readSnapshotMark();
    const filter = snapshot?.lastReceivedAt ? `&received_at=gt.${encodeURIComponent(snapshot.lastReceivedAt)}` : "";
    const res = await doFetch(rest(`uploads?select=id&limit=1${filter}`), { headers: restHeaders() });
    if (!res.ok) throw new Error(`upload index probe failed (${res.status})`);
    const rows = await res.json() as unknown[];
    const idle = snapshot !== null && rows.length === 0;
    let retryRollups = false;
    let settledWeek: string | null = null;
    try {
      const run = await r2Fetch("cron/last-run.json", { method: "GET" });
      if (run.status === 404) {
        if (idle) retryRollups = true;
      } else if (run.ok) {
        const previous = await run.json() as { dataAsOf?: string; completionPending?: boolean; settledWeek?: string };
        if (typeof previous.settledWeek === "string") settledWeek = previous.settledWeek;
        if (idle) retryRollups = previous.dataAsOf !== snapshot.generatedAt || previous.completionPending === true;
      } else if (idle) {
        throw new Error(`cron heartbeat read failed (${run.status})`);
      }
    } catch (err) {
      // A broken heartbeat must not block pending uploads; only the idle run, which reads it to decide the fold,
      // treats it as fatal (as it did before the settled week was stored there).
      if (idle) throw err;
    }
    return { idle, retryRollups, dataAsOf: snapshot?.generatedAt ?? null, settledWeek };
  }

  async function writeCronRun(completionPending: boolean, dataAsOf: string | null, settledWeek: string | null): Promise<void> {
    const res = await r2Fetch("cron/last-run.json", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ generatedAt: now().toISOString(), dataAsOf, completionPending, settledWeek }),
    });
    if (!res.ok) throw new Error(`cron heartbeat write failed (${res.status})`);
  }

  function stateOf(snapshot: Snapshot): CorpusState {
    const state = snapshot.corpusState;
    if (!state) {
      // The first recovery deployment used pipe-delimited conflict identities.
      // Migrate unambiguous keys; refuse ambiguous ones instead of resurrecting data.
      const conflicts = (snapshot.conflictTombstones ?? []).map(key => {
        const parts = typeof key === "string" ? key.split("|") : [];
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Legacy conflicts need a reviewed migration");
        return JSON.stringify(parts);
      });
      return mergeCorpus({ version: 1, events: [], conflicts, legacyRecords: 0 }, snapshot.records);
    }
    if (state.version !== 1 || !Array.isArray(state.events) || !Array.isArray(state.conflicts) ||
        !state.conflicts.every((k) => typeof k === "string") || !Number.isSafeInteger(state.legacyRecords) || state.legacyRecords < 0) {
      throw new Error("snapshot replay state is invalid");
    }
    const start: CorpusState = { version: 1, events: [], conflicts: state.conflicts, legacyRecords: state.legacyRecords };
    const batches = state.events.map((event) => {
      if (!event?.record || !event.record.eventId || !Array.isArray(event.grants)) throw new Error("snapshot event is invalid");
      return { raw: [event.record], grants: grantsOf({ publicationGrants: event.grants }) };
    });
    return mergeCorpusBatches(start, batches);
  }

  async function readCloud(last: RawCorpus | null): Promise<RawCorpus> {
    const snapshot = await readSnapshotIfChanged(last?.etag);
    // Unchanged: the same state object, so the public records and every rollup kept for it stay valid.
    if (snapshot === "unchanged") return last!;
    if (snapshot) return { uploads: snapshot.uploads, state: stateOf(snapshot), dataAsOf: validTime(snapshot.generatedAt), etag: snapshot.etag };
    const readAt = now().toISOString();
    const keys = (await listIndex()).map((r) => r.object_key);
    const read = await readObjects(keys);
    if (read.missed) throw new Error("upload object unreadable");
    return { uploads: keys.length, state: read.state, dataAsOf: readAt };
  }

  /**
   * Extend the snapshot with uploads newer than its last one (cron). `rebuild` starts from empty,
   * which is how a deleted upload leaves the snapshot.
   */
  async function writeSnapshot(opts: { rebuild?: boolean } = {}): Promise<{ uploads: number; added: number; dataAsOf: string }> {
    if (!cloud) throw new Error("snapshots need the cloud store");
    const current = await readSnapshot();
    if (current && !current.etag) throw new Error("snapshot has no ETag: cannot safely update it");
    if (current?.etag?.startsWith("W/")) throw new Error("snapshot has a weak ETag: cannot safely update it");
    const etag = current?.etag;
    const prev = opts.rebuild ? null : current;
    const seen = prev?.seenUploadIds ? new Set(prev.seenUploadIds) : null;
    const rows = await listIndex(seen ? undefined : prev?.lastReceivedAt ?? undefined);
    const fresh = rows.filter((r) => seen ? !seen.has(r.id) : !(prev && r.received_at === prev.lastReceivedAt && prev.lastIds.includes(r.id)));
    // Rebuilds preserve known conflict tombstones, including after a raw file is removed.
    let start: CorpusState | undefined = prev ? stateOf(prev) : current
      ? { ...mergeCorpus(undefined, []), conflicts: stateOf(current).conflicts } : undefined;
    // The parsed snapshot's events were replayed into `start`; nothing reads them again. Releasing them here keeps the
    // old file's objects, the replayed copy and the merged copy from all being in memory while the new uploads are read.
    if (current) { current.corpusState = undefined; current.records = []; }
    const read = await readObjects(fresh.map((r) => r.object_key), start);
    start = undefined;
    if (read.missed) throw new Error("upload object unreadable");
    const lastReceivedAt = rows.length > 0 ? rows[rows.length - 1].received_at : prev?.lastReceivedAt ?? null;
    const lastIds = rows.length > 0 ? rows.filter((r) => r.received_at === lastReceivedAt).map((r) => r.id) : prev?.lastIds ?? [];
    const generatedAt = now().toISOString();
    const uploads = (prev?.uploads ?? 0) + fresh.length;
    // The events go to a new folder of parts first; the part list below is the only object written conditionally,
    // so a reader sees the old list and its parts or the new list and its parts, never a mix.
    const folder = snapshotPartsFolder(generatedAt);
    const parts: string[] = [];
    const dropParts = (keys: readonly string[]) => Promise.all(keys.map((key) =>
      r2Fetch(key, { method: "DELETE" }).then((r) => r.body?.cancel()).catch((err) => console.error("snapshot part cleanup failed", key, err))));
    try {
      for (const part of snapshotParts(read.state.events)) {
        const key = `${folder}${parts.length}.json`;
        const res = await r2Fetch(key, { method: "PUT", body: part, headers: { "content-type": "application/json" } });
        if (!res.ok) throw new Error(`snapshot part write failed (${res.status})`);
        parts.push(key);
      }
    } catch (err) {
      await dropParts(parts);
      throw err;
    }
    const { events: _events, ...state } = read.state;
    const body = JSON.stringify({
      // Format 2 has no `records` and no `corpusState`, so a reader from before the parts refuses it (no records
      // array) rather than reading an empty corpus.
      format: 2,
      generatedAt,
      uploads,
      state,
      parts,
      // The previous write's parts stay for readers that listed them; the write after this one deletes them.
      retired: current?.parts ?? [],
      // A legacy watermark query covers only a suffix of the index. Stay in that
      // mode until a full rebuild supplies the complete upload inventory.
      seenUploadIds: seen || !prev ? [...new Set([...(prev?.seenUploadIds ?? []), ...rows.map((r) => r.id)])].sort() : undefined,
      lastReceivedAt,
      lastIds,
    });
    const put = await r2Fetch(SNAPSHOT_KEY, {
      method: "PUT",
      body,
      // R2 supports conditional PutObject; a race fails instead of losing tombstones.
      // https://developers.cloudflare.com/r2/api/s3/api/
      headers: { "content-type": "application/json", ...(current ? { "if-match": etag! } : { "if-none-match": "*" }) },
    });
    if (!put.ok) {
      await dropParts(parts);
      throw new Error(`snapshot write failed (${put.status})`);
    }
    if (current?.retired?.length) await dropParts(current.retired);
    // The state just written is what a read of the file would replay, so the corpus the rollups read next is this one,
    // not the file downloaded and parsed again (a second whole copy, and another read of the same R2 object).
    corpusKept.set({ value: { uploads, state: read.state, dataAsOf: validTime(generatedAt), etag: put.headers.get("etag") ?? undefined } });
    completionCached = null; censusCached = null;
    return { uploads, added: fresh.length, dataAsOf: generatedAt };
  }

  /**
   * One corpus per instance, kept `cacheMs`. Each request reads on its own (`share: false`, release.ts says why), but
   * an expired copy is re-read with its ETag, so an unchanged snapshot is neither downloaded nor parsed again.
   */
  const corpusKept = keep<RawCorpus>(async (_, last) => {
    const corpus = cloud ? await readCloud(last?.value ?? null) : await readLocal();
    if (corpus.unreachable) throw new Error("corpus unreachable");
    return { value: corpus };
  }, { ttlMs: cacheMs, share: false });
  let refreshing: { since: number } | null = null;

  async function rawCorpus(): Promise<RawCorpus> {
    const fresh = corpusKept.fresh();
    if (fresh) return fresh.value;
    const last = corpusKept.last();
    if (last && refreshing && Date.now() - refreshing.since < CORPUS_REFRESH_HOLD_MS) return last.value;
    const mine = { since: Date.now() };
    refreshing = mine;
    try {
      return await corpusKept.get();
    } finally {
      if (refreshing === mine) refreshing = null;
    }
  }

  /** The public records of one state, built once for it; the publication hook decides its own reuse. */
  let publicOf: { state: CorpusState; records: IntakeRecord[] } | null = null;

  async function loadCorpus(): Promise<Corpus> {
    try {
      if (unavailable) throw new Error("Production storage is not configured");
      const corpus = await rawCorpus();
      let records: IntakeRecord[];
      if (opts.publication) records = await opts.publication(corpus.state);
      else {
        if (publicOf?.state !== corpus.state) publicOf = { state: corpus.state, records: publicRecords(corpus.state) };
        records = publicOf.records;
      }
      return {
        uploads: corpus.uploads,
        records,
        ...(corpus.state.legacyRecords ? { legacyRecords: corpus.state.legacyRecords } : {}),
        dataAsOf: corpus.dataAsOf,
      };
    } catch {
      return { uploads: 0, records: [], unreachable: true };
    }
  }

  async function putWaitlist(entry: WaitlistEntry): Promise<boolean> {
    if (unavailable) return false;
    if (!cloud) {
      try {
        await mkdir(opts.localDir, { recursive: true });
        const file = join(opts.localDir, "waitlist.json");
        let list: WaitlistEntry[] = [];
        try {
          const parsed = JSON.parse(await readFile(file, "utf8"));
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          list = [];
        }
        if (!list.some((e) => e.email === entry.email && e.toolSlug === entry.toolSlug)) {
          list.push(entry);
          await writeFile(file, JSON.stringify(list, null, 2));
        }
        return true;
      } catch {
        return false;
      }
    }
    try {
      const res = await doFetch(rest("waitlist"), {
        method: "POST",
        headers: restHeaders({ prefer: "resolution=ignore-duplicates,return=minimal" }),
        body: JSON.stringify({ email: entry.email, tool_slug: entry.toolSlug, created_at: entry.ts }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function snapshotHealth(): Promise<SnapshotHealth> {
    const unknown = { updatedAt: null, ageSeconds: null };
    if (unavailable) return { status: "unavailable", ...unknown };
    if (!cloud) return { status: "local", ...unknown };
    try {
      // Cron freshness is independent of the last real corpus change.
      const res = await r2Fetch("cron/last-run.json", { method: "GET", signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) return { status: "missing", ...unknown };
      if (!res.ok) return { status: "unavailable", ...unknown };
      const heartbeat = await res.json() as { generatedAt?: string };
      const modified = Date.parse(heartbeat.generatedAt ?? "");
      const age = now().getTime() - modified;
      if (!Number.isFinite(age) || age < -30_000) return { status: "unavailable", ...unknown };
      return { status: age > 30 * 60_000 ? "stale" : "fresh", updatedAt: new Date(modified).toISOString(), ageSeconds: Math.max(0, Math.floor(age / 1000)) };
    } catch { return { status: "unavailable", ...unknown }; }
  }

  /**
   * Drop every read this instance keeps: the corpus, the market, the completion and census rollups. The snapshot cron
   * calls it between its steps; each kept copy is tens of MB that would otherwise sit beside the next step (#1354).
   */
  function forgetReads(): void {
    corpusKept.forget(); refreshing = null;
    marketCached = null; marketRead = null;
    completionCached = null; censusCached = null;
  }

  return { putUpload, loadCorpus, putWaitlist, snapshotWork, writeCronRun, writeSnapshot, snapshotHealth, writeMarket, loadMarket, writeCompletion, loadCompletion, writeCensus, loadCensus, installCensus, forgetReads };
}

/** The store the routes and pages use. */
const configuredCloud = cloudConfig();
const localDir = join(process.cwd(), "data");
export const sharingStore = createSharingStore({ cloud: configuredCloud, localDir });
export const uploadStore = createUploadStore({ cloud: configuredCloud, localDir, publication: sharingStore.publish });
