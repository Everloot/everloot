import { AwsClient } from "aws4fetch";
import { agreedNpcsOf, NPC_RANKS, NPC_REACTIONS, type AgreedNpc } from "@kb/world-pages";
import type { AggregateSet } from "./aggregate-set";
import { keep } from "./kept";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import type { R2Config } from "./upload-store";

/**
 * What the agreement rules give each NPC (kb world-pages.ts `agreedNpcFacts`: name, pins, level, reaction, creature
 * type, rank, coverage zone, drop source name, the name's reporters and candidate, and the pin dates), stored by the
 * stored-views job from the aggregate set. The aggregates file used to carry every raw NPC sighting instead (45,545
 * rows, 12 MB of its 19.3 MB on 2026-11-23), and each page that read it ran the rules over them again. The job now
 * writes this table first and leaves the sightings out of the aggregates file; `loadStoredAggregates` puts the table
 * back on the set's world facts, and every NPC reader answers from it (#1464). An aggregates file that still holds
 * the sightings (written before this file, or by a run whose write of it failed) is read as before.
 */

export const NPC_FACTS_KEY = "snapshots/npc-facts.json";
/** The table's shape in the file's stamp. Change it when a row changes shape, so the next job run rewrites the file. */
export const NPC_FACTS_REVISION = "npc-facts-1";
const KEEP_MS = 5 * 60_000;
const RETRY_MS = 60_000;

export interface NpcFactsFile { version: 1; revision: string; dataAsOf: string | null; npcs: Partial<AgreedNpc>[] }
export interface StoredNpcFacts { dataAsOf: string | null; npcs: ReadonlyMap<number, AgreedNpc> }

/** A row's fields that hold nothing are left out of the file and filled back in on reading; `listName` is always kept as it is. */
const emptyRow = (): Omit<AgreedNpc, "npcId"> => ({
  name: null, pins: [], level: null, reaction: null, creatureType: null, rank: null, zone: null, dropName: null,
  nameReporters: 0, reportedName: null, pinDates: [],
});
const isEmpty = (k: string, v: unknown) => v === null || (Array.isArray(v) && v.length === 0) || (k === "nameReporters" && v === 0);

function compact(npc: AgreedNpc): Partial<AgreedNpc> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(npc)) if (k === "npcId" || k === "listName" || !isEmpty(k, v)) out[k] = v;
  return out as Partial<AgreedNpc>;
}

/** The table from the set the job just stored, in the order its NPCs were first seen (the order the name maps keep). */
export function buildNpcFacts(set: AggregateSet): NpcFactsFile {
  return { version: 1, revision: NPC_FACTS_REVISION, dataAsOf: set.dataAsOf, npcs: [...agreedNpcsOf(set.world).values()].map(compact) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => v === null || typeof v === "string";
const int = (v: unknown) => Number.isInteger(v);
const isPin = (v: unknown) => isObject(v) && int(v.mapId) && Number.isFinite(v.x) && Number.isFinite(v.y) && int(v.reporters);
const isRow = (n: Record<string, unknown>) => int(n.npcId) && text(n.name) && Array.isArray(n.pins) && n.pins.every(isPin)
  && (n.level === null || Number.isFinite(n.level)) && (n.reaction === null || NPC_REACTIONS.includes(n.reaction as never))
  && text(n.creatureType) && (n.rank === null || NPC_RANKS.includes(n.rank as never)) && (n.zone === null || int(n.zone))
  && (n.listName === undefined || text(n.listName)) && (n.dropName === null || (isObject(n.dropName) && typeof n.dropName.name === "string" && typeof n.dropName.tier === "string"))
  && int(n.nameReporters) && text(n.reportedName)
  && Array.isArray(n.pinDates) && n.pinDates.every((d) => Array.isArray(d) && d.length === 2 && int(d[0]) && typeof d[1] === "string");

/** The file as read, or null for text that is not the file (the set then counts as unread). Never throws. */
export function parseNpcFacts(text: string): StoredNpcFacts | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObject(raw) || raw.version !== 1 || (raw.dataAsOf !== null && typeof raw.dataAsOf !== "string") || !Array.isArray(raw.npcs)) return null;
  const npcs = new Map<number, AgreedNpc>();
  for (const row of raw.npcs) {
    if (!isObject(row)) return null;
    const npc: Record<string, unknown> = { ...emptyRow(), ...row };
    if (!isRow(npc)) return null;
    npcs.set(npc.npcId as number, npc as unknown as AgreedNpc);
  }
  return { dataAsOf: raw.dataAsOf as string | null, npcs };
}

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}
const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${NPC_FACTS_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/**
 * The job's write, from the set the aggregates are written from (`build`), whenever the file is missing or stamped
 * for another snapshot or revision. It runs before the aggregates step, so an aggregates file without the sightings
 * always has a table beside it.
 */
export async function writeNpcFacts(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build: () => Promise<AggregateSet>;
}): Promise<{ written: boolean; npcs?: number; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored NPC facts need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(r2(cloud), r2Url(cloud), opts.dataAsOf, doFetch, NPC_FACTS_REVISION)) return { written: false };
  const file = buildNpcFacts(await deps.build());
  const body = JSON.stringify(file);
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf, NPC_FACTS_REVISION) } }));
  if (!put.ok) throw new Error(`NPC facts write failed (${put.status})`);
  return { written: true, npcs: file.npcs.length, bytes: new TextEncoder().encode(body).length };
}

type Read = { file: StoredNpcFacts | null; etag?: string };

/** The file, kept KEEP_MS per server instance; a re-read sends its ETag. A missing or unreadable file retries after a minute. */
const stored = keep<Read, { cloud: R2Config; fetch: typeof fetch }>(async ({ cloud, fetch: doFetch }, kept) => {
  const retry = { keepMs: RETRY_MS };
  try {
    const etag = kept?.value.file ? kept.value.etag : undefined;
    const res = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } }));
    if (res.status === 304 && kept?.value.file) return { value: kept.value };
    if (res.ok) {
      const file = parseNpcFacts(await res.text());
      return file ? { value: { file, etag: res.headers.get("etag") ?? undefined } } : { value: { file: null }, ...retry };
    }
    return kept?.value.file && res.status !== 404 ? { value: kept.value, ...retry } : { value: { file: null }, ...retry };
  } catch {
    return kept?.value.file ? { value: kept.value, ...retry } : { value: { file: null }, ...retry };
  }
}, { ttlMs: KEEP_MS });

/** The stored table, or null when there is no file, no cloud settings, or it cannot be read. Never throws. */
export async function loadStoredNpcFacts(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<StoredNpcFacts | null> {
  const now = (deps.now ?? Date.now)();
  const hit = stored.fresh(now);
  if (hit) return hit.value.file;
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) return null;
  return (await stored.get({ cloud, fetch: deps.fetch ?? fetch }, now)).file;
}

/** For tests: forget the kept file. */
export const forgetStoredNpcFacts = () => stored.forget();
