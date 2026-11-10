import { AwsClient } from "aws4fetch";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import { namedRecord } from "../../../kb/src/corpus";
import { buildAggregates, type AggregateSet } from "./aggregate-set";
import { uploadStore, type Corpus, type R2Config } from "./upload-store";

/**
 * The aggregate set (aggregate-set.ts) stored by the snapshot cron instead of worked out on each new server instance.
 * Item pages, search, zones, instances, NPCs, objects, loot, edges and addons all read it through `loadAggregates` in
 * rollup-compute.ts; before this file, each new instance downloaded the corpus snapshot, replayed every event, applied
 * publication and built every table, which cost seconds of CPU. The cron writes the file after the item view
 * (`writeAggregates`), only when that run added uploads or rebuilt, or when the file is missing or stale; a page reads it once
 * per instance and again after five minutes (`loadStoredAggregates`). With no file yet, or one this code cannot read,
 * the pages work the set out from the corpus as before.
 *
 * Publication stays live. Named rows (`namedRecord`: guild, character and collection rows) are published only under a
 * grant that is valid now and with hidden characters left out, checked on every corpus read. None of the tables in the
 * set reads a named kind, so the stored copy is built from the anonymous rows alone (`anonymousAggregates`): a grant,
 * a revoke or a hide cannot change it, and the file never holds anything a hide should remove. The test beside this
 * file adds named rows of every kind to a corpus and checks that no table changes.
 *
 * This file holds no game-file names, so the cron (API code) may import it.
 */

export const AGGREGATES_KEY = "snapshots/aggregates.json";
/** How long one server instance keeps the file before asking for it again: the cron rewrites it at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;
/** A missing or unreadable file is asked for again after a minute, not after the full KEEP_MS. */
const RETRY_MS = 60_000;

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}

const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${AGGREGATES_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/** The set the cron stores: the tables of the corpus's anonymous rows. Every table reads anonymous kinds only. */
export function anonymousAggregates(corpus: Pick<Corpus, "uploads" | "records" | "dataAsOf">): AggregateSet {
  return buildAggregates({ ...corpus, records: corpus.records.filter((row) => !namedRecord(row)) });
}

/**
 * The file's text. Maps and Sets, which JSON has no form for, are written as `{"$map": [[key, value], ...]}` and
 * `{"$set": [value, ...]}` wherever they sit; the addon history, worked out lazily on a page, is worked out here.
 */
export function encodeAggregates(set: AggregateSet, generatedAt: string): string {
  const { addonTrends, ...rest } = set;
  return JSON.stringify({ version: 1, generatedAt, set: { ...rest, addonTrends: addonTrends() } }, (_, value: unknown) =>
    value instanceof Map ? { $map: [...value] } : value instanceof Set ? { $set: [...value] } : value);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arrays = (v: unknown, ...keys: string[]) => isObject(v) && keys.every((k) => Array.isArray(v[k]));

/** The file as read, or null for text that is not JSON or a shape this code does not know (the pages then fall back). Never throws. */
export function parseAggregates(text: string): { generatedAt: string; set: AggregateSet } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text, (_, value: unknown) => {
      if (!isObject(value)) return value;
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === "$map" && Array.isArray(value.$map)) return new Map(value.$map as [unknown, unknown][]);
      if (keys.length === 1 && keys[0] === "$set" && Array.isArray(value.$set)) return new Set(value.$set);
      return value;
    });
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.version !== 1 || typeof raw.generatedAt !== "string" || !isObject(raw.set)) return null;
  const s = raw.set;
  const ok = typeof s.key === "string" && [s.uploads, s.records, s.windows].every(Number.isFinite) &&
    (s.dataAsOf === null || typeof s.dataAsOf === "string") &&
    arrays(s.drops, "rates", "measuredZeros", "rejected") && arrays(s.items, "rates", "names", "npcs") &&
    arrays(s.world, "npcs", "quests", "vendors") && arrays(s.instances, "entrances", "encounters") &&
    Array.isArray(s.sightings) && s.itemFacts instanceof Map && s.crafted instanceof Set &&
    arrays(s.addons, "addons") && Number.isFinite((s.addons as Record<string, unknown>).reportingInstalls) &&
    isObject(s.addonTrends) && Array.isArray(s.edges) &&
    isObject(s.loot) && s.loot.sources instanceof Map && Number.isFinite(s.loot.leftOut);
  if (!ok) return null;
  const trends = s.addonTrends;
  return { generatedAt: raw.generatedAt, set: { ...(s as unknown as AggregateSet), addonTrends: () => trends as ReturnType<AggregateSet["addonTrends"]> } };
}

/** The set the cron stores, from the corpus as it stands. Throws when the corpus is out of reach. */
async function currentSet(): Promise<AggregateSet> {
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) throw new Error("corpus unreachable");
  return anonymousAggregates(corpus);
}

/**
 * The cron's step: writes the set when this run added uploads or rebuilt, or when the file is missing, unstamped or stale. An idle run
 * with a current file reads only a HEAD, falling back to GET if HEAD fails. `bytes` is the file's size, for the run's log.
 */
export async function writeAggregates(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build?: () => Promise<AggregateSet>; now?: () => Date;
} = {}): Promise<{ written: boolean; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored aggregates need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(r2(cloud), r2Url(cloud), opts.dataAsOf, doFetch)) return { written: false };
  const body = encodeAggregates(await (deps.build ?? currentSet)(), (deps.now?.() ?? new Date()).toISOString());
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf) } }));
  if (!put.ok) throw new Error(`aggregates write failed (${put.status})`);
  return { written: true, bytes: new TextEncoder().encode(body).length };
}

/** The read set and what identifies the file it came from. */
let kept: { at: number; set: AggregateSet | null; generatedAt?: string; etag?: string; failed?: boolean } | null = null;

/**
 * The stored set, kept KEEP_MS per server instance; null when there is none or it cannot be read, and the caller works
 * the set out from the corpus. Never throws. A re-read sends the kept file's ETag, so an unchanged file is not
 * downloaded again, and a file with the same `generatedAt` keeps the set already read (and every memo keyed on it).
 * A failed re-read keeps the set already read for another minute; a missing file or an unknown shape drops it.
 * Strict readers (complete hover cards) receive null during a failed re-read, including that retry minute.
 */
export async function loadStoredAggregates(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number; strict?: boolean } = {}): Promise<AggregateSet | null> {
  const now = (deps.now ?? Date.now)();
  if (kept && now - kept.at < KEEP_MS) return deps.strict && kept.failed ? null : kept.set;
  try {
    const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
    if (!cloud) return null;
    const etag = kept?.set ? kept.etag : undefined;
    const res = await (deps.fetch ?? fetch)(await r2(cloud).sign(r2Url(cloud), {
      method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) },
    }));
    if (res.status === 304 && kept?.set) {
      kept = { ...kept, at: now, failed: false };
    } else if (res.ok) {
      const read = parseAggregates(await res.text());
      const same = read && kept?.set && kept.generatedAt === read.generatedAt;
      kept = read
        ? { at: now, set: same ? kept!.set : read.set, generatedAt: read.generatedAt, etag: res.headers.get("etag") ?? undefined }
        : { at: now - KEEP_MS + RETRY_MS, set: null };
    } else if (res.status === 404 || !kept?.set) {
      kept = { at: now - KEEP_MS + RETRY_MS, set: null };
    } else {
      kept = { ...kept, at: now - KEEP_MS + RETRY_MS, failed: true };
    }
  } catch {
    kept = kept?.set ? { ...kept, at: now - KEEP_MS + RETRY_MS, failed: true } : { at: now - KEEP_MS + RETRY_MS, set: null };
  }
  return deps.strict && kept.failed ? null : kept.set;
}

/** For tests: forget the kept file. */
export const forgetStoredAggregates = () => { kept = null; };
