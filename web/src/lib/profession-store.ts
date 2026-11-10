import { AwsClient } from "aws4fetch";
import { derivedSteps, pathFactsFromRecords } from "../../../kb/src/recipe-thresholds";
import { objectSpawnRowsFromRecords } from "../../../kb/src/object-spawns";
import { uploadStore, type Corpus, type R2Config } from "./upload-store";

/**
 * Anonymous facts stored by the snapshot cron; pages fall back to the corpus until the file can be read. The file holds
 * the reported rows only: `facts.derived` depends on the game-file recipe list bundled with the build, so it is worked
 * out again on read, and a deploy that changes the list shows at once instead of after the next upload.
 */
export interface ProfessionsView { dataAsOf: string | null; facts: ReturnType<typeof pathFactsFromRecords>; sightings: ReturnType<typeof objectSpawnRowsFromRecords>; }

export const PROFESSIONS_KEY = "snapshots/professions.json";
/** How long one server instance keeps the file before asking for it again: the cron rewrites it at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;
/** A missing or unreadable file is asked for again after a minute, not after the full KEEP_MS. */
const RETRY_MS = 60_000;

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}

const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${PROFESSIONS_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

export function buildProfessions(corpus: { records: unknown[]; dataAsOf?: string | null }): ProfessionsView {
  return { dataAsOf: corpus.dataAsOf ?? null, facts: pathFactsFromRecords(corpus.records), sightings: objectSpawnRowsFromRecords(corpus.records) };
}

export function encodeProfessions(set: ProfessionsView, generatedAt: string): string {
  const { derived: _derived, ...facts } = set.facts;
  return JSON.stringify({ version: 1, generatedAt, set: { ...set, facts } }, (_, value: unknown) => value instanceof Map ? { $map: [...value] } : value);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arrays = (v: unknown, ...keys: string[]) => isObject(v) && keys.every((k) => Array.isArray(v[k]));

/** Unknown or unreadable files fall back to the corpus. A `derived` list in an older file is ignored and worked out again. */
export function parseProfessions(text: string): { generatedAt: string; set: ProfessionsView } | null {
  try {
    const raw: unknown = JSON.parse(text, (_, value: unknown) =>
      isObject(value) && Object.keys(value).length === 1 && Array.isArray(value.$map) ? new Map(value.$map as [unknown, unknown][]) : value);
    if (!isObject(raw) || raw.version !== 1 || typeof raw.generatedAt !== "string" || !isObject(raw.set)) return null;
    const s = raw.set;
    if (!(s.dataAsOf === null || typeof s.dataAsOf === "string") || !(arrays(s.facts, "sightings", "prices", "observations", "trainers") && isObject(s.facts) && s.facts.vendorPrices instanceof Map && Array.isArray(s.sightings))) return null;
    const facts = s.facts as unknown as ProfessionsView["facts"];
    return { generatedAt: raw.generatedAt, set: { ...(s as unknown as ProfessionsView), facts: { ...facts, derived: derivedSteps(facts.observations, facts.trainers) } } };
  } catch {
    return null;
  }
}

/** The set the cron stores, from the corpus as it stands. Throws when the corpus is out of reach. */
async function currentSet(): Promise<ProfessionsView> {
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) throw new Error("corpus unreachable");
  return buildProfessions(corpus);
}

/**
 * The object metadata that says which corpus snapshot the file was built from, so a run that finds the file can tell
 * whether it is behind. Without it a write that failed after new uploads would leave the file stale until the next
 * upload, since idle runs would only check that the file exists.
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
 * The cron's step: writes the set when this run added uploads or rebuilt, when there is no file yet, or when the file
 * was built from another snapshot than `dataAsOf` (an earlier write failed, or the file predates the stamp). An idle
 * run with a current file reads nothing but that one HEAD. `bytes` is the file's size, for the run's log.
 */
export async function writeProfessions(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build?: () => Promise<ProfessionsView>; now?: () => Date;
} = {}): Promise<{ written: boolean; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored professions need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild && await storedStamp(cloud, doFetch) === stampOf(opts.dataAsOf)) return { written: false };
  const body = encodeProfessions(await (deps.build ?? currentSet)(), (deps.now?.() ?? new Date()).toISOString());
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf) } }));
  if (!put.ok) throw new Error(`professions write failed (${put.status})`);
  return { written: true, bytes: new TextEncoder().encode(body).length };
}

/** The read set and what identifies the file it came from. */
let kept: { at: number; set: ProfessionsView | null; generatedAt?: string; etag?: string } | null = null;

/**
 * The stored set, kept KEEP_MS per server instance; null when there is none or it cannot be read, and the caller works
 * the set out from the corpus. Never throws. A re-read sends the kept file's ETag, so an unchanged file is not
 * downloaded again, and a file with the same `generatedAt` keeps the set already read (and every memo keyed on it).
 * A failed re-read keeps the set already read for another minute; a missing file or an unknown shape drops it.
 */
export async function loadStoredProfessions(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<ProfessionsView | null> {
  const now = (deps.now ?? Date.now)();
  if (kept && now - kept.at < KEEP_MS) return kept.set;
  try {
    const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
    if (!cloud) return null;
    const etag = kept?.set ? kept.etag : undefined;
    const res = await (deps.fetch ?? fetch)(await r2(cloud).sign(r2Url(cloud), {
      method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) },
    }));
    if (res.status === 304 && kept?.set) {
      kept = { ...kept, at: now };
    } else if (res.ok) {
      const read = parseProfessions(await res.text());
      const same = read && kept?.set && kept.generatedAt === read.generatedAt;
      kept = read
        ? { at: now, set: same ? kept!.set : read.set, generatedAt: read.generatedAt, etag: res.headers.get("etag") ?? undefined }
        : { at: now - KEEP_MS + RETRY_MS, set: null };
    } else if (res.status === 404 || !kept?.set) {
      kept = { at: now - KEEP_MS + RETRY_MS, set: null };
    } else {
      kept = { ...kept, at: now - KEEP_MS + RETRY_MS };
    }
  } catch {
    kept = kept?.set ? { ...kept, at: now - KEEP_MS + RETRY_MS } : { at: now - KEEP_MS + RETRY_MS, set: null };
  }
  return kept.set;
}

/** For tests: forget the kept file. */
export const forgetStoredProfessions = () => { kept = null; };

/** Stored facts when available; a failed corpus read stays unrecorded. */
export async function loadProfessions(): Promise<ProfessionsView & { unreachable: boolean; corpus?: Corpus }> {
  const stored = await loadStoredProfessions();
  if (stored) return { ...stored, unreachable: false };
  const corpus = await uploadStore.loadCorpus();
  return { ...buildProfessions({ ...corpus, records: corpus.unreachable ? [] : corpus.records }), unreachable: Boolean(corpus.unreachable), corpus };
}
