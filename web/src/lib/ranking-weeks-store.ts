import { AwsClient } from "aws4fetch";
import { keep } from "./kept";
import type { RankingWeek } from "./rankings";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import type { CensusRead, R2Config } from "./upload-store";

/**
 * The weeks the rankings pages draw (lib/rankings.ts rankingWeeks), stored by the stored-views job from the census
 * rollup. Before this file, /rankings and every /rankings/<slug> page read and parsed every stored census row (59,428
 * rows on 2026-11-23: about 18 MB of JSON, 27 MB of Node heap once parsed) to draw at most a few weeks of counts that
 * fit in 20 KB. /rankings answered 503 in the warm-up of three deploys on 2026-11-22 (#1354). The weeks are worked
 * out from the same rows with the same function, as of the census's own time, so the pages show the same numbers.
 * With no file, the pages read the census as before.
 */

export const RANKING_WEEKS_KEY = "snapshots/ranking-weeks.json";
/** The file's shape in its stamp. Change it when the weeks change shape, so the next job run rewrites the file. */
export const RANKING_WEEKS_REVISION = "weeks-1";
const KEEP_MS = 5 * 60_000;
const RETRY_MS = 60_000;

export interface RankingWeeksFile { version: 1; revision: string; dataAsOf: string | null; weeks: RankingWeek[] }
export type StoredRankingWeeks = Pick<RankingWeeksFile, "dataAsOf" | "weeks">;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isWeek = (v: unknown) => isObject(v) && typeof v.start === "string" && typeof v.to === "string" && typeof v.current === "boolean"
  && isObject(v.window) && Array.isArray(v.window.classes) && Array.isArray(v.window.races) && Array.isArray(v.window.factions);

/** The file as read, or null for text that is not the file (the pages then read the census). Never throws. */
export function parseRankingWeeks(text: string): StoredRankingWeeks | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObject(raw) || raw.version !== 1 || (raw.dataAsOf !== null && typeof raw.dataAsOf !== "string") || !Array.isArray(raw.weeks) || !raw.weeks.every(isWeek)) return null;
  return { dataAsOf: raw.dataAsOf as string | null, weeks: raw.weeks as RankingWeek[] };
}

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}
const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${RANKING_WEEKS_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/**
 * The job's write: the weeks as of the census's own time, rewritten whenever the census has moved on (the file is
 * stamped with the census's `dataAsOf`, not the corpus snapshot's). `census` reads the rows, `weeks` works them out:
 * the same `rankingWeeks` the pages ran. An unreadable census writes nothing; the pages keep the last file.
 */
export async function writeRankingWeeks(deps: {
  census: () => Promise<CensusRead>; weeks: (rows: CensusRead["rows"], asOf: string | Date) => RankingWeek[];
  cloud?: R2Config | null; fetch?: typeof fetch; now?: () => Date;
}): Promise<{ written: boolean; weeks?: number; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored ranking weeks need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  const read = await deps.census();
  if (read.unreachable) throw new Error("census unreachable");
  if (!await storedViewNeedsWrite(r2(cloud), r2Url(cloud), read.dataAsOf, doFetch, RANKING_WEEKS_REVISION)) return { written: false };
  const weeks = deps.weeks(read.rows, read.dataAsOf ?? (deps.now?.() ?? new Date()));
  const body = JSON.stringify({ version: 1, revision: RANKING_WEEKS_REVISION, dataAsOf: read.dataAsOf, weeks } satisfies RankingWeeksFile);
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(read.dataAsOf, RANKING_WEEKS_REVISION) } }));
  if (!put.ok) throw new Error(`ranking weeks write failed (${put.status})`);
  return { written: true, weeks: weeks.length, bytes: new TextEncoder().encode(body).length };
}

type Read = { file: StoredRankingWeeks | null; etag?: string };

/** The file, kept KEEP_MS per server instance; a re-read sends its ETag. A missing or unreadable file retries after a minute. */
const stored = keep<Read, { cloud: R2Config; fetch: typeof fetch }>(async ({ cloud, fetch: doFetch }, kept) => {
  const retry = { keepMs: RETRY_MS };
  try {
    const etag = kept?.value.file ? kept.value.etag : undefined;
    const res = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } }));
    if (res.status === 304 && kept?.value.file) return { value: kept.value };
    if (res.ok) {
      const file = parseRankingWeeks(await res.text());
      return file ? { value: { file, etag: res.headers.get("etag") ?? undefined } } : { value: { file: null }, ...retry };
    }
    return kept?.value.file && res.status !== 404 ? { value: kept.value, ...retry } : { value: { file: null }, ...retry };
  } catch {
    return kept?.value.file ? { value: kept.value, ...retry } : { value: { file: null }, ...retry };
  }
}, { ttlMs: KEEP_MS });

/** The stored weeks, or null when there is no file, no cloud settings, or it cannot be read. Never throws. */
export async function loadStoredRankingWeeks(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<StoredRankingWeeks | null> {
  const now = (deps.now ?? Date.now)();
  const hit = stored.fresh(now);
  if (hit) return hit.value.file;
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) return null;
  return (await stored.get({ cloud, fetch: deps.fetch ?? fetch }, now)).file;
}

/** For tests: forget the kept file. */
export const forgetStoredRankingWeeks = () => stored.forget();
