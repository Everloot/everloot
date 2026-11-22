import { AwsClient } from "aws4fetch";
import type { AggregateSet } from "./aggregate-set";
import { farmingAreas, type FarmArea, type MobFarm } from "./farming";
import { keep } from "./kept";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import type { R2Config } from "./upload-store";
import { npcRows } from "./world-lists";

/**
 * The zones whose mobs back each mob farm (lib/farming.ts farmingAreas: gold, leather, cloth), stored by the
 * stored-views job beside the aggregates and from the same set. Before this file, the farming page and the Tailoring,
 * Leatherworking and Skinning pages each downloaded and parsed the whole aggregate set (18.9 MB on 2026-11-22) to
 * list a few dozen zones. With the market rollup beside it on the AH Ledger professions, that ran the site Worker out
 * of memory: every exceededMemory the site logged in a tail on 2026-11-22 was /tools/professions/tailoring (#1354).
 * This file is a few KB. With no file, the pages work the areas out from the aggregates as before.
 */

export const FARM_AREAS_KEY = "snapshots/farm-areas.json";
/** The file's shape in its stamp. Change it when the file changes shape, so the next job run rewrites it. */
export const FARM_AREAS_REVISION = "farm-1";
const KEEP_MS = 5 * 60_000;
const RETRY_MS = 60_000;

export interface FarmAreasFile { version: 1; revision: string; dataAsOf: string | null; areas: Record<MobFarm, FarmArea[]> }
export type FarmAreas = Pick<FarmAreasFile, "dataAsOf" | "areas">;

/** The areas from the set the job just stored. */
export function buildFarmAreas(set: AggregateSet): FarmAreasFile {
  return { version: 1, revision: FARM_AREAS_REVISION, dataAsOf: set.dataAsOf, areas: farmingAreas(npcRows(set.world, set.drops.rates), set.drops.rates) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isArea = (v: unknown) => isObject(v) && typeof v.key === "string" && isObject(v.zone) && Number.isInteger(v.zone.mapId)
  && typeof v.zone.name === "string" && Number.isInteger(v.mobs) && Number.isInteger(v.nodes)
  && (v.levels === null || (isObject(v.levels) && Number.isFinite(v.levels.min) && Number.isFinite(v.levels.max)));

/** The file as read, or null for text that is not the file (the pages then use the aggregates). Never throws. */
export function parseFarmAreas(text: string): FarmAreas | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObject(raw) || raw.version !== 1 || (raw.dataAsOf !== null && typeof raw.dataAsOf !== "string") || !isObject(raw.areas)) return null;
  const areas = raw.areas;
  if (!(["gold", "leather", "cloth"] as const).every((k) => Array.isArray(areas[k]) && (areas[k] as unknown[]).every(isArea))) return null;
  return { dataAsOf: raw.dataAsOf as string | null, areas: areas as FarmAreasFile["areas"] };
}

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}
const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${FARM_AREAS_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/**
 * The job's write, from the set the aggregates were written from (`build`), whenever the file is missing or stamped
 * for another snapshot or revision: the set is built only then, and shared with the aggregates when they were due too.
 */
export async function writeFarmAreas(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build: () => Promise<AggregateSet>;
}): Promise<{ written: boolean; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored farm areas need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(r2(cloud), r2Url(cloud), opts.dataAsOf, doFetch, FARM_AREAS_REVISION)) return { written: false };
  const body = JSON.stringify(buildFarmAreas(await deps.build()));
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf, FARM_AREAS_REVISION) } }));
  if (!put.ok) throw new Error(`farm areas write failed (${put.status})`);
  return { written: true, bytes: new TextEncoder().encode(body).length };
}

type Read = { file: FarmAreas | null; etag?: string };

/** The file, kept KEEP_MS per server instance; a re-read sends its ETag. A missing or unreadable file retries after a minute. */
const stored = keep<Read, { cloud: R2Config; fetch: typeof fetch }>(async ({ cloud, fetch: doFetch }, kept) => {
  const retry = { keepMs: RETRY_MS };
  try {
    const etag = kept?.value.file ? kept.value.etag : undefined;
    const res = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } }));
    if (res.status === 304 && kept?.value.file) return { value: kept.value };
    if (res.ok) {
      const file = parseFarmAreas(await res.text());
      return file ? { value: { file, etag: res.headers.get("etag") ?? undefined } } : { value: { file: null }, ...retry };
    }
    return kept?.value.file && res.status !== 404 ? { value: kept.value, ...retry } : { value: { file: null }, ...retry };
  } catch {
    return kept?.value.file ? { value: kept.value, ...retry } : { value: { file: null }, ...retry };
  }
}, { ttlMs: KEEP_MS });

/** The stored areas, or null when there is no file, no cloud settings, or it cannot be read. Never throws. */
export async function loadStoredFarmAreas(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<FarmAreas | null> {
  const now = (deps.now ?? Date.now)();
  const hit = stored.fresh(now);
  if (hit) return hit.value.file;
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) return null;
  return (await stored.get({ cloud, fetch: deps.fetch ?? fetch }, now)).file;
}

/** For tests: forget the kept file. */
export const forgetStoredFarmAreas = () => stored.forget();
