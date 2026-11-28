import { AwsClient } from "aws4fetch";
import type { InstanceFacts } from "@kb/instances";
import type { AggregateSet } from "./aggregate-set";
import { asciiJsonText } from "./ascii-json";
import { keep } from "./kept";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import type { R2Config } from "./upload-store";

/**
 * The instance entrances and encounters players reported (the aggregate set's `instances`), stored by the stored-views
 * job beside the aggregates and from the same set. The armory character and guild pages need only these, to say which
 * instances are open and to link them, but read the whole aggregate set for them (10 MB on 2026-11-27): a fresh server
 * instance spent about 200 ms of CPU and 40 MB of heap on it, and armory views mostly land on fresh instances. This
 * file is about 160 KB. The rows are the ones the aggregates file holds, in the same private bucket. With no file, the
 * pages read the aggregates as before.
 */

export const INSTANCE_FACTS_KEY = "snapshots/instance-facts.json";
/** The file's shape in its stamp. Change it when the file changes shape, so the next job run rewrites it. */
export const INSTANCE_FACTS_REVISION = "instance-facts-2";
const KEEP_MS = 5 * 60_000;
const RETRY_MS = 60_000;

export interface InstanceFactsFile { version: 1; revision: string; dataAsOf: string | null; instances: InstanceFacts }
export type StoredInstanceFacts = Pick<InstanceFactsFile, "dataAsOf" | "instances">;

/** The facts from the set the job just stored. */
export function buildInstanceFacts(set: AggregateSet): InstanceFactsFile {
  return { version: 1, revision: INSTANCE_FACTS_REVISION, dataAsOf: set.dataAsOf, instances: { entrances: set.instances.entrances, encounters: set.instances.encounters } };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isEntrance = (v: unknown) => isObject(v) && Number.isInteger(v.instanceMapId) && typeof v.installId === "string";
const isEncounter = (v: unknown) => isObject(v) && Number.isInteger(v.instanceMapId) && Number.isInteger(v.encounterId) && typeof v.success === "boolean";

/** The file as read, or null for text that is not the file (the pages then read the aggregates). Never throws. */
export function parseInstanceFacts(text: string): StoredInstanceFacts | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObject(raw) || raw.version !== 1 || (raw.dataAsOf !== null && typeof raw.dataAsOf !== "string") || !isObject(raw.instances)) return null;
  const { entrances, encounters } = raw.instances;
  if (!Array.isArray(entrances) || !entrances.every(isEntrance) || !Array.isArray(encounters) || !encounters.every(isEncounter)) return null;
  return { dataAsOf: raw.dataAsOf as string | null, instances: raw.instances as unknown as InstanceFacts };
}

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}
const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${INSTANCE_FACTS_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/**
 * The job's write, from the set the aggregates were written from (`build`), whenever the file is missing or stamped
 * for another snapshot or revision: the set is built only then, and shared with the aggregates when they were due too.
 */
export async function writeInstanceFacts(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build: () => Promise<AggregateSet>;
}): Promise<{ written: boolean; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored instance facts need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(r2(cloud), r2Url(cloud), opts.dataAsOf, doFetch, INSTANCE_FACTS_REVISION)) return { written: false };
  const body = JSON.stringify(buildInstanceFacts(await deps.build()));
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf, INSTANCE_FACTS_REVISION) } }));
  if (!put.ok) throw new Error(`instance facts write failed (${put.status})`);
  return { written: true, bytes: new TextEncoder().encode(body).length };
}

type Read = { file: StoredInstanceFacts | null; etag?: string };

/** The file, kept KEEP_MS per server instance; a re-read sends its ETag. A missing or unreadable file retries after a minute. */
const stored = keep<Read, { cloud: R2Config; fetch: typeof fetch }>(async ({ cloud, fetch: doFetch }, kept) => {
  const retry = { keepMs: RETRY_MS };
  try {
    const etag = kept?.value.file ? kept.value.etag : undefined;
    const res = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } }));
    if (res.status === 304 && kept?.value.file) return { value: kept.value };
    if (res.ok) {
      // ASCII text (ascii-json.ts): instance names reported in other alphabets would make `res.text()` two bytes a character.
      const file = parseInstanceFacts(await asciiJsonText(res));
      return file ? { value: { file, etag: res.headers.get("etag") ?? undefined } } : { value: { file: null }, ...retry };
    }
    return kept?.value.file && res.status !== 404 ? { value: kept.value, ...retry } : { value: { file: null }, ...retry };
  } catch {
    return kept?.value.file ? { value: kept.value, ...retry } : { value: { file: null }, ...retry };
  }
}, { ttlMs: KEEP_MS });

/** The stored facts, or null when there is no file, no cloud settings, or it cannot be read. Never throws. */
export async function loadStoredInstanceFacts(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<StoredInstanceFacts | null> {
  const now = (deps.now ?? Date.now)();
  const hit = stored.fresh(now);
  if (hit) return hit.value.file;
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) return null;
  return (await stored.get({ cloud, fetch: deps.fetch ?? fetch }, now)).file;
}

/** For tests: forget the kept file. */
export const forgetStoredInstanceFacts = () => stored.forget();
