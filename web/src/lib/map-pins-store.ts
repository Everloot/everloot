import { AwsClient } from "aws4fetch";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import { RECHECK_SCOPES } from "./recheck-scopes";
import { observedFacts } from "./world-map";
import { uploadStore, type R2Config } from "./upload-store";

/**
 * Anonymous facts stored by the snapshot cron; pages fall back to the corpus until the file can be read. The file holds
 * the reported rows only: `facts.recheck` is the build's curated recheck list (recheck-scopes.ts), set again on read,
 * so a deploy that changes the list shows at once instead of after the next upload.
 */
export interface MapPinsView { dataAsOf: string | null; facts: ReturnType<typeof observedFacts>; }

export const MAP_PINS_KEY = "snapshots/map-pins.json";
/** How long one server instance keeps the file before asking for it again: the cron rewrites it at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;
/** A missing or unreadable file is asked for again after a minute, not after the full KEEP_MS. */
const RETRY_MS = 60_000;

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}

const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${MAP_PINS_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

export function buildMapPins(corpus: { records: unknown[]; dataAsOf?: string | null }): MapPinsView {
  return { dataAsOf: corpus.dataAsOf ?? null, facts: observedFacts(corpus.records) };
}

export function encodeMapPins(set: MapPinsView, generatedAt: string): string {
  const { recheck: _recheck, ...facts } = set.facts;
  return JSON.stringify({ version: 1, generatedAt, set: { ...set, facts } });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arrays = (v: unknown, ...keys: string[]) => isObject(v) && keys.every((k) => Array.isArray(v[k]));

/** Unknown or unreadable files fall back to the corpus. A `recheck` list in an older file is ignored. */
export function parseMapPins(text: string): { generatedAt: string; set: MapPinsView } | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObject(raw) || raw.version !== 1 || typeof raw.generatedAt !== "string" || !isObject(raw.set)) return null;
    const s = raw.set;
    if (!(s.dataAsOf === null || typeof s.dataAsOf === "string") || !arrays(s.facts, "npcs", "quests", "vendors")) return null;
    const set = s as unknown as MapPinsView;
    return { generatedAt: raw.generatedAt, set: { ...set, facts: { ...set.facts, recheck: RECHECK_SCOPES } } };
  } catch {
    return null;
  }
}

/** The set the cron stores, from the corpus as it stands. Throws when the corpus is out of reach. */
async function currentSet(): Promise<MapPinsView> {
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) throw new Error("corpus unreachable");
  return buildMapPins(corpus);
}

/**
 * The cron's step: writes the set when this run added uploads or rebuilt, when there is no file yet, or when the file
 * was built from another snapshot than `dataAsOf` (an earlier write failed, or the file predates the stamp). An idle
 * run with a current file reads only a HEAD, falling back to GET if HEAD fails. `bytes` is the file's size, for the run's log.
 */
export async function writeMapPins(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build?: () => Promise<MapPinsView>; now?: () => Date;
} = {}): Promise<{ written: boolean; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored map-pins need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(r2(cloud), r2Url(cloud), opts.dataAsOf, doFetch)) return { written: false };
  const body = encodeMapPins(await (deps.build ?? currentSet)(), (deps.now?.() ?? new Date()).toISOString());
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf) } }));
  if (!put.ok) throw new Error(`map-pins write failed (${put.status})`);
  return { written: true, bytes: new TextEncoder().encode(body).length };
}

/** The read set and what identifies the file it came from. */
let kept: { at: number; set: MapPinsView | null; generatedAt?: string; etag?: string } | null = null;

/**
 * The stored set, kept KEEP_MS per server instance; null when there is none or it cannot be read, and the caller works
 * the set out from the corpus. Never throws. A re-read sends the kept file's ETag, so an unchanged file is not
 * downloaded again, and a file with the same `generatedAt` keeps the set already read (and every memo keyed on it).
 * A failed re-read keeps the set already read for another minute; a missing file or an unknown shape drops it.
 */
export async function loadStoredMapPins(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<MapPinsView | null> {
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
      const read = parseMapPins(await res.text());
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
export const forgetStoredMapPins = () => { kept = null; };

/** Stored facts when available; a failed corpus read stays unrecorded. */
export async function loadMapPins(): Promise<MapPinsView & { unreachable: boolean }> {
  const stored = await loadStoredMapPins();
  if (stored) return { ...stored, unreachable: false };
  const corpus = await uploadStore.loadCorpus();
  return { ...buildMapPins({ ...corpus, records: corpus.unreachable ? [] : corpus.records }), unreachable: Boolean(corpus.unreachable) };
}
