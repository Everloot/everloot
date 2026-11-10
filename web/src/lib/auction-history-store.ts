import { AwsClient } from "aws4fetch";
import { auctionHistories, auctionHistoryKey, auctionSightingsFromRecords, type AuctionPoint } from "../../../kb/src/auction-history";
import { uploadStore, type Corpus, type R2Config } from "./upload-store";

/**
 * Every realm and item's public auction days, stored by the cron instead of worked out on each view. The history page
 * (/tools/auctions/[realm]/[itemId]) and the auction_history tool used to download the corpus snapshot and replay every
 * scan on each request, which cost seconds of CPU on every new server instance; they now read one file. The cron writes
 * it after the corpus snapshot (`writeAuctionHistory`), only when that run added uploads or rebuilt, or when the file is
 * missing. Every value comes from the same functions the corpus path uses (kb/src/auction-history.ts), so the page and
 * the tool answer the same either way; with no file yet (the first minutes after a deploy, or storage out of reach) they
 * read the corpus as before. The file holds each pair's public days only: no install id and no single scan.
 */

export const AUCTION_HISTORY_KEY = "snapshots/auction-history.json";
/** How long one server instance keeps the file before reading it again: the cron rewrites it at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;

export interface AuctionHistoryFile {
  version: 1;
  generatedAt: string;
  /** The corpus snapshot's time: when the scans last changed. */
  dataAsOf: string | null;
  /** [auctionHistoryKey, public days] for every realm and item with one. */
  histories: [string, AuctionPoint[]][];
}

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}

const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${AUCTION_HISTORY_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/** The file from a corpus read, dated by the corpus. Throws when the corpus is out of reach. */
export function buildAuctionHistory(corpus: Corpus, now = new Date()): AuctionHistoryFile {
  if (corpus.unreachable) throw new Error("corpus unreachable");
  return {
    version: 1,
    generatedAt: now.toISOString(),
    dataAsOf: corpus.dataAsOf ?? null,
    histories: auctionHistories(auctionSightingsFromRecords(corpus.records)),
  };
}

/**
 * The object metadata that says which corpus snapshot the file was built from, so a run that finds the file can tell
 * whether it is behind. Without it a write that failed after new uploads would leave the file stale until the next
 * upload, since idle runs only check that the file exists.
 */
const STAMP = "x-amz-meta-data-as-of";
const stampOf = (dataAsOf: string | null) => dataAsOf ?? "none";

/** The stamp of the stored file, null when it has none, undefined when there is no file or the HEAD failed. */
async function storedStamp(cloud: R2Config, doFetch: typeof fetch): Promise<string | null | undefined> {
  try {
    const res = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "HEAD" }));
    return res.ok ? res.headers.get(STAMP) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The cron's step: writes the file when this run added uploads or rebuilt, when there is no file yet, or when the file
 * was built from another snapshot than `dataAsOf` (an earlier write failed). An idle run with a current file reads
 * nothing but that one HEAD. Without `dataAsOf` the stamp is not compared.
 */
export async function writeAuctionHistory(opts: { added: number; rebuild?: boolean; dataAsOf?: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build?: () => Promise<AuctionHistoryFile>;
} = {}): Promise<{ written: boolean; items?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the auction history needs the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild) {
    const stamp = await storedStamp(cloud, doFetch);
    if (stamp !== undefined && (opts.dataAsOf === undefined || stamp === stampOf(opts.dataAsOf))) return { written: false };
  }
  const file = await (deps.build ?? (async () => buildAuctionHistory(await uploadStore.loadCorpus())))();
  const stamp = stampOf(opts.dataAsOf === undefined ? file.dataAsOf : opts.dataAsOf);
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body: JSON.stringify(file), headers: { "content-type": "application/json", [STAMP]: stamp } }));
  if (!put.ok) throw new Error(`auction history write failed (${put.status})`);
  return { written: true, items: file.histories.length };
}

const isPoint = (p: unknown): p is AuctionPoint => {
  const v = p as Partial<AuctionPoint> | null;
  return !!v && typeof v.day === "string" && Number.isInteger(v.copper) && Number.isInteger(v.reporters);
};

/** The file as read, or null for a shape this code does not know (the readers then fall back). */
export function parseAuctionHistory(raw: unknown): AuctionHistoryFile | null {
  const v = raw as Partial<AuctionHistoryFile> | null;
  if (!v || v.version !== 1 || typeof v.generatedAt !== "string" || !Array.isArray(v.histories)) return null;
  if (!v.histories.every((e) => Array.isArray(e) && typeof e[0] === "string" && Array.isArray(e[1]) && e[1].every(isPoint))) return null;
  return { version: 1, generatedAt: v.generatedAt, dataAsOf: typeof v.dataAsOf === "string" ? v.dataAsOf : null, histories: v.histories };
}

let kept: { at: number; read: { dataAsOf: string | null; byKey: Map<string, AuctionPoint[]> } | null } | null = null;

/**
 * One realm and item's public days from the stored file, kept KEEP_MS per server instance. Null when there is no file
 * or it cannot be read, and the caller reads the corpus instead. Never throws.
 */
export async function storedAuctionHistory(realm: string, itemId: number, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number;
} = {}): Promise<{ points: AuctionPoint[]; dataAsOf: string | null } | null> {
  const now = (deps.now ?? Date.now)();
  if (!kept || now - kept.at >= KEEP_MS) {
    const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
    if (!cloud) return null;
    let read: NonNullable<typeof kept>["read"] = null;
    try {
      const res = await (deps.fetch ?? fetch)(await r2(cloud).sign(r2Url(cloud), { method: "GET", headers: { "accept-encoding": "identity" } }));
      const file = res.ok ? parseAuctionHistory(JSON.parse(await res.text())) : null;
      if (file) read = { dataAsOf: file.dataAsOf, byKey: new Map(file.histories) };
    } catch {
      read = null;
    }
    // A missing or unreadable file is asked for again after a minute, not after the full KEEP_MS.
    kept = { at: read ? now : now - KEEP_MS + 60_000, read };
  }
  if (!kept.read) return null;
  return { points: kept.read.byKey.get(auctionHistoryKey(realm, itemId)) ?? [], dataAsOf: kept.read.dataAsOf };
}

/** For tests: forget the kept file. */
export const forgetAuctionHistory = () => { kept = null; };
