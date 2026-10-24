import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import { CENSUS_KINDS, parseRecords, type IntakeRecord, type StoredCensusRecord, type StoredUpload } from "@everloot/protocol";
import { mergeCorpus, mergeCorpusBatches, publicRecords, type CorpusState } from "../../../kb/src/corpus";
import { HISTORY_DAYS, MARKET_MAX_BYTES, emptyMarket, foldMarket, uploadScans, type MarketState } from "../../../kb/src/market";
import { mergeCensusRows } from "../../../kb/src/census-rows";
import { createSharingStore } from "./sharing-store";
import {
  COMPLETION_MAX_BYTES, authorizedOwners, emptyCompletion, foldCompletion, isCompletionState, normalizeCompletion, trimCompletion, type CompletionState, type CompletionUpload,
} from "../../../kb/src/completion-rollup";
import type { PublicationState } from "../../../kb/src/publication";

/**
 * Where uploads and waitlist signups live.
 * Cloud: the raw upload is an R2 object (cheap, the record of truth) and Supabase holds one index
 * row per upload plus the waitlist. Every rollup can be rebuilt from the R2 objects.
 * Pages read one snapshot object (`snapshots/corpus.json`) that a cron job extends with only the
 * uploads it has not seen yet. With no snapshot they fall back to reading every indexed object.
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

interface RawCorpus { uploads: number; state: CorpusState; unreachable?: boolean; dataAsOf: string | null }

function validTime(value: string): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

export interface SnapshotHealth {
  status: "fresh" | "stale" | "missing" | "unavailable" | "local";
  updatedAt: string | null;
  ageSeconds: number | null;
}

export const STORAGE_UNREACHABLE = "Storage unreachable. These figures are unrecorded, not zero.";

interface Snapshot extends Corpus {
  conflictTombstones?: string[];
  corpusState?: CorpusState;
  seenUploadIds?: string[];
  etag?: string;
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
  /** Uploads in the read window already folded in, so each is read once. Older ids are forgotten. */
  seenUploadIds: string[];
}

/** An upload received before this can only hold days the 60-day history has pruned (one day of clock drift allowed). */
const MARKET_READ_DAYS = HISTORY_DAYS + 2;
/** Upload objects read and folded at a time, so a rebuild never holds every payload at once. */
const MARKET_FOLD_BATCH = 64;
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
const SNAPSHOT_KEY = "snapshots/corpus.json";
const MARKET_KEY = "snapshots/market.json";
const COMPLETION_KEY = "snapshots/completion.json";
/** A rebuild is folded here over several runs and swapped into COMPLETION_KEY when done, so pages never read a partial one. */
const COMPLETION_REBUILD_KEY = "snapshots/completion-rebuild.json";

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
  /** Uploads one completion run folds at most; the next run continues from where it stopped. */
  completionBatch?: number;
  /** Time and catalog/owned rows one completion run may spend before it saves and stops (checked between batches). */
  completionBudgetMs?: number;
  completionRowBudget?: number;
  /** Recheck current publication authority on EVERY read, including cache hits. */
  publication?: (state: CorpusState) => Promise<IntakeRecord[]>;
}) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const cacheMs = opts.cacheMs ?? 5 * 60 * 1000;
  let cached: { at: number; corpus: RawCorpus } | null = null;
  let marketCached: { at: number; market: Market } | null = null;
  let completionCached: { at: number; read: CompletionRead } | null = null;
  let censusCached: { at: number; read: CensusRead } | null = null;
  const marketMaxBytes = opts.marketMaxBytes ?? MARKET_MAX_BYTES;
  const completionMaxBytes = opts.completionMaxBytes ?? COMPLETION_MAX_BYTES;
  const completionBatch = opts.completionBatch ?? COMPLETION_UPLOADS_PER_RUN;
  const completionBudgetMs = opts.completionBudgetMs ?? 150_000;
  const completionRowBudget = opts.completionRowBudget ?? 500_000;

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

  async function r2Fetch(key: string, init: RequestInit): Promise<Response> {
    return doFetch(await r2!.sign(objectUrl(key), init));
  }

  async function putUpload(uploadId: string, installId: string, payload: StoredUpload, publicationGrants: string[] = []): Promise<boolean> {
    if (unavailable) return false;
    const body = JSON.stringify(publicationGrants.length ? { ...payload, publicationGrants } : payload);
    if (!cloud) {
      try {
        const dir = join(opts.localDir, "uploads");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${uploadId}.json`), body);
        cached = null; completionCached = null; censusCached = null;
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
      cached = null; completionCached = null; censusCached = null;
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
  async function readMarketSnapshot(): Promise<{ snapshot: MarketSnapshot | null; etag?: string } | null> {
    const res = await r2Fetch(MARKET_KEY, { method: "GET", headers: { "accept-encoding": "identity" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`market read failed (${res.status})`);
    const etag = res.headers.get("etag") ?? undefined;
    const text = await res.text();
    if (text.length > marketMaxBytes) return { snapshot: null, etag };
    let parsed: Partial<MarketSnapshot>;
    try { parsed = JSON.parse(text) as Partial<MarketSnapshot>; } catch { return { snapshot: null, etag }; }
    const state = parsed.state;
    if (parsed.version !== 3 || state?.version !== 3 || !state.realms || typeof state.realms !== "object" || !Array.isArray(parsed.seenUploadIds)) {
      return { snapshot: null, etag };
    }
    return { snapshot: parsed as MarketSnapshot, etag };
  }

  /**
   * Fold full scans from uploads not yet seen into the market rollup (cron). `rebuild` starts
   * from empty. A missed object writes nothing, so the next run reads it again.
   */
  async function writeMarket(opts: { rebuild?: boolean; idle?: boolean } = {}): Promise<{ added: number; scans: number; skipped?: boolean }> {
    if (!cloud) throw new Error("the market rollup needs the cloud store");
    const current = await readMarketSnapshot();
    if (current && (!current.etag || current.etag.startsWith("W/"))) throw new Error("market rollup has no strong ETag: cannot safely update it");
    if (current && !current.snapshot && !opts.rebuild) throw new Error("market rollup is invalid: rebuild it with ?rebuild=1");
    const prev = opts.rebuild ? null : current?.snapshot ?? null;
    if (opts.idle && !opts.rebuild && prev && validTime(prev.generatedAt) &&
        new Date(prev.generatedAt).toISOString().slice(0, 10) === now().toISOString().slice(0, 10)) {
      return { added: 0, scans: 0, skipped: true };
    }
    const seen = new Set(prev?.seenUploadIds ?? []);
    const rows = await listIndex(new Date(now().getTime() - MARKET_READ_DAYS * 86_400_000).toISOString());
    const fresh = rows.filter((r) => !seen.has(r.id));
    let state = prev?.state ?? emptyMarket();
    let scans = 0;
    for (let i = 0; i < fresh.length; i += MARKET_FOLD_BATCH) {
      const { payloads, missed } = await readPayloads(fresh.slice(i, i + MARKET_FOLD_BATCH).map((r) => r.object_key));
      if (missed) throw new Error("upload object unreadable");
      const batch = marketScans(payloads);
      scans += batch.length;
      state = foldMarket(state, batch, now());
    }
    const snapshot: MarketSnapshot = {
      version: 3,
      generatedAt: now().toISOString(),
      // With no new scans the fold still closes and prunes days as time passes.
      state: fresh.length ? state : foldMarket(state, [], now()),
      // Every listed upload is now folded in; ids outside the window drop out with it.
      seenUploadIds: rows.map((r) => r.id).sort(),
    };
    const body = JSON.stringify(snapshot);
    // The fold's own caps keep this far below the limit; this refuses to store anything past it.
    if (Buffer.byteLength(body) > marketMaxBytes) throw new Error("market rollup would exceed its size limit; not written");
    const put = await r2Fetch(MARKET_KEY, {
      method: "PUT",
      body,
      headers: { "content-type": "application/json", ...(current ? { "if-match": current.etag! } : { "if-none-match": "*" }) },
    });
    if (!put.ok) throw new Error(`market write failed (${put.status})`);
    marketCached = null;
    return { added: fresh.length, scans };
  }

  async function loadMarket(): Promise<Market> {
    if (marketCached && Date.now() - marketCached.at < cacheMs) return marketCached.market;
    let market: Market;
    try {
      if (unavailable) throw new Error("Production storage is not configured");
      if (cloud) {
        // No rollup yet (before the first cron run) is unavailable, not "no scans uploaded".
        const read = await readMarketSnapshot();
        if (!read?.snapshot) throw new Error("market rollup not built yet or unusable");
        market = { state: read.snapshot.state, dataAsOf: validTime(read.snapshot.generatedAt) };
      } else {
        const local = await readLocalPayloads();
        if (!local) throw new Error("local uploads unreadable");
        market = { state: foldMarket(emptyMarket(), marketScans(local.payloads), now()), dataAsOf: now().toISOString() };
      }
    } catch {
      return { state: null, dataAsOf: null, unreachable: true };
    }
    marketCached = { at: Date.now(), market };
    return market;
  }

  /** Census rows of some upload payloads, folded into `previous` (the daily caps and last-write rule live in mergeCensusRows). */
  function foldCensus(previous: StoredCensusRecord[], payloads: unknown[]): StoredCensusRecord[] {
    const raw = payloads.flatMap((p) => rawRecordsOf(p).filter((r) => CENSUS_KINDS.includes(String((r as { kind?: unknown } | null)?.kind))));
    return mergeCensusRows(previous, raw);
  }

  /**
   * Every stored census row, folded. This is the reader the census summary uses: census rows are never in the
   * public corpus, so they come from the private upload objects, through the stored schemas only. A row still
   * carrying a GUID and no key is skipped, so no GUID can come out of here. Without a rollup snapshot this reads
   * every upload object (cached for `cacheMs`); a census snapshot is the next step if that gets slow.
   */
  async function loadCensus(): Promise<CensusRead> {
    try {
      if (unavailable) throw new Error("Production storage is not configured");
      if (censusCached && Date.now() - censusCached.at < cacheMs) return censusCached.read;
      let rows: StoredCensusRecord[] = [];
      const dataAsOf = now().toISOString();
      if (cloud) {
        const keys = (await listIndex()).map((r) => r.object_key);
        for (let i = 0; i < keys.length; i += MARKET_FOLD_BATCH) {
          const read = await readPayloads(keys.slice(i, i + MARKET_FOLD_BATCH));
          if (read.missed) throw new Error("upload object unreadable");
          rows = foldCensus(rows, read.payloads);
        }
      } else {
        const local = await readLocalPayloads();
        if (!local) throw new Error("local uploads unreadable");
        rows = foldCensus([], local.payloads);
      }
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
    // Compression can turn the object's strong ETag into a weak response validator.
    const res = await r2Fetch(SNAPSHOT_KEY, { method: "GET", headers: { "accept-encoding": "identity" } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`snapshot read failed (${res.status})`);
    let parsed: Partial<Snapshot>;
    try {
      parsed = JSON.parse(await res.text()) as Partial<Snapshot>;
    } catch {
      throw new Error("snapshot is not JSON");
    }
    // A snapshot without a records array is unreadable, never an empty corpus.
    if (!Array.isArray(parsed.records)) throw new Error("snapshot has no records array");
    return {
      corpusState: parsed.corpusState,
      conflictTombstones: parsed.conflictTombstones,
      seenUploadIds: parsed.seenUploadIds,
      etag: res.headers.get("etag") ?? undefined,
      generatedAt: parsed.generatedAt ?? "",
      uploads: typeof parsed.uploads === "number" ? parsed.uploads : 0,
      records: parseRecords(parsed.records).records,
      lastReceivedAt: parsed.lastReceivedAt ?? null,
      lastIds: Array.isArray(parsed.lastIds) ? parsed.lastIds : [],
    };
  }

  /** One bounded index probe before any corpus replay. A successful run records its corpus generation. */
  async function snapshotWork(): Promise<{ idle: boolean; retryRollups: boolean; dataAsOf: string | null; settledWeek: string | null }> {
    if (!cloud) throw new Error("snapshots need the cloud store");
    const snapshot = await readSnapshot();
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

  async function readCloud(): Promise<RawCorpus> {
    const snapshot = await readSnapshot();
    if (snapshot) return { uploads: snapshot.uploads, state: stateOf(snapshot), dataAsOf: validTime(snapshot.generatedAt) };
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
    const prev = opts.rebuild ? null : current;
    const seen = prev?.seenUploadIds ? new Set(prev.seenUploadIds) : null;
    const rows = await listIndex(seen ? undefined : prev?.lastReceivedAt ?? undefined);
    const fresh = rows.filter((r) => seen ? !seen.has(r.id) : !(prev && r.received_at === prev.lastReceivedAt && prev.lastIds.includes(r.id)));
    // Rebuilds preserve known conflict tombstones, including after a raw file is removed.
    const start = prev ? stateOf(prev) : current
      ? { ...mergeCorpus(undefined, []), conflicts: stateOf(current).conflicts } : undefined;
    const read = await readObjects(fresh.map((r) => r.object_key), start);
    if (read.missed) throw new Error("upload object unreadable");
    const records = publicRecords(read.state);
    const lastReceivedAt = rows.length > 0 ? rows[rows.length - 1].received_at : prev?.lastReceivedAt ?? null;
    const lastIds = rows.length > 0 ? rows.filter((r) => r.received_at === lastReceivedAt).map((r) => r.id) : prev?.lastIds ?? [];
    const snapshot: Snapshot = {
      generatedAt: now().toISOString(),
      uploads: (prev?.uploads ?? 0) + fresh.length,
      records,
      corpusState: read.state,
      // A legacy watermark query covers only a suffix of the index. Stay in that
      // mode until a full rebuild supplies the complete upload inventory.
      seenUploadIds: seen || !prev ? [...new Set([...(prev?.seenUploadIds ?? []), ...rows.map((r) => r.id)])].sort() : undefined,
      lastReceivedAt,
      lastIds,
    };
    const put = await r2Fetch(SNAPSHOT_KEY, {
      method: "PUT",
      body: JSON.stringify(snapshot),
      // R2 supports conditional PutObject; a race fails instead of losing tombstones.
      // https://developers.cloudflare.com/r2/api/s3/api/
      headers: { "content-type": "application/json", ...(current ? { "if-match": current.etag! } : { "if-none-match": "*" }) },
    });
    if (!put.ok) throw new Error(`snapshot write failed (${put.status})`);
    cached = null; completionCached = null; censusCached = null;
    return { uploads: snapshot.uploads, added: fresh.length, dataAsOf: snapshot.generatedAt };
  }

  async function loadCorpus(): Promise<Corpus> {
    try {
      if (unavailable) throw new Error("Production storage is not configured");
      const corpus = cached && Date.now() - cached.at < cacheMs
        ? cached.corpus : cloud ? await readCloud() : await readLocal();
      if (corpus.unreachable) throw new Error("corpus unreachable");
      cached = { at: Date.now(), corpus };
      const records = opts.publication ? await opts.publication(corpus.state) : publicRecords(corpus.state);
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

  return { putUpload, loadCorpus, putWaitlist, snapshotWork, writeCronRun, writeSnapshot, snapshotHealth, writeMarket, loadMarket, writeCompletion, loadCompletion, loadCensus, installCensus };
}

/** The store the routes and pages use. */
const configuredCloud = cloudConfig();
const localDir = join(process.cwd(), "data");
export const sharingStore = createSharingStore({ cloud: configuredCloud, localDir });
export const uploadStore = createUploadStore({ cloud: configuredCloud, localDir, publication: sharingStore.publish });
