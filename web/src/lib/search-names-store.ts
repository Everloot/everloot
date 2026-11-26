import { AwsClient } from "aws4fetch";
import { objectList } from "@kb/object-page";
import { npcReportedName } from "@kb/world-pages";
import type { AggregateSet } from "./aggregate-set";
import { keep } from "./kept";
import { publicVendors } from "./world-lists";
import { itemNames, npcNames, objectNames, questTitles, type Names } from "./names";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import type { R2Config } from "./upload-store";

/**
 * The names the site's own search matches (/search and /search/suggest), stored by the snapshot cron as one small file
 * beside the aggregates (aggregate-store.ts). Before this file a fresh server instance downloaded and parsed the whole
 * aggregate set (13.9 MB on 2026-11-19) for a keystroke; this file is a few hundred KB and holds only what the search
 * needs: the names 3 installs agree on per kind (names.ts, the same functions), the one- or two-install unanimous NPC
 * names a Warcraft Wiki name may stand in for (shown-item-names.ts wikiNpcNames), the item ids with a public drop
 * rate (which, with the agreed and game-file names, decide whether an item row shows its icon), and the object ids
 * /database/objects lists (the ones an object hit may name; site-search.ts objectHits), and the vendor ids
 * /database/vendors lists (the vendor group's rows, named by the NPC names here). Nothing here is a
 * name a page would not print, and no game-file name is in it: those stay in the private bucket and are merged in
 * by the reader. With no file, the search reads the aggregates as before.
 */

export const SEARCH_NAMES_KEY = "snapshots/search-names.json";
/** The file's shape in its stamp. Change it when the file gains a list, so the next cron rewrites it. */
export const SEARCH_NAMES_REVISION = "names-2";
/** How long one server instance keeps the file before asking for it again; the cron rewrites it at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;
/** A missing or unreadable file is asked for again after a minute. */
const RETRY_MS = 60_000;

/** The file as written: id and name pairs per kind, in id order. */
export interface SearchNamesFile {
  version: 1; revision: string; generatedAt: string; dataAsOf: string | null;
  items: [number, string][]; npcs: [number, string][]; quests: [number, string][]; objects: [number, string][];
  /** NPCs with no agreed name whose one or two reports agree on one: the name, for the wiki match. */
  npcCandidates: [number, string][];
  /** Items with a public drop rate: their rows show an icon even without an agreed name. */
  dropped: number[];
  /** The objects /database/objects lists: the ones with a public loot window (kb object-page objectList). */
  objectIds: number[];
  /** The vendors /database/vendors lists: an item and price 3 installs agree on (world-lists publicVendors). */
  vendorIds: number[];
}

/** The file as read: the maps the search matches against, kept per instance so each keystroke reuses them. */
/** `vendorIds` is undefined for a file written before the list: the vendor group then waits for the next cron. */
export interface SearchNames { generatedAt: string; dataAsOf: string | null; names: Names; candidates: Map<number, string>; dropped: Set<number>; objectIds: Set<number>; vendorIds?: Set<number> }

const pairs = (names: Map<number, string>): [number, string][] => [...names].sort((a, b) => a[0] - b[0]);

/** The names the search needs, from the set the cron just stored. */
export function buildSearchNames(set: AggregateSet, generatedAt: string): SearchNamesFile {
  const agreedNpcs = npcNames(set.world);
  const byNpc = new Map<number, AggregateSet["world"]["npcs"]>();
  for (const row of set.world.npcs) { const rows = byNpc.get(row.npcId); if (rows) rows.push(row); else byNpc.set(row.npcId, [row]); }
  const candidates = new Map<number, string>();
  for (const [id, npcs] of byNpc) {
    if (agreedNpcs.has(id)) continue;
    const candidate = npcReportedName(id, { ...set.world, npcs });
    if (candidate) candidates.set(id, candidate);
  }
  const dropped = [...new Set(set.items.rates.filter((r) => r.public).map((r) => r.itemId))].sort((a, b) => a - b);
  // The same list /database/objects and the search's object group draw: the drop rollup's public windows.
  const objectIds = objectList({ rates: set.drops.rates, measuredZeros: set.drops.measuredZeros, names: set.items.names }).map((o) => o.objectId).sort((a, b) => a - b);
  return {
    version: 1, revision: SEARCH_NAMES_REVISION, generatedAt, dataAsOf: set.dataAsOf,
    items: pairs(itemNames(set.items)), npcs: pairs(agreedNpcs), quests: pairs(questTitles(set.world)), objects: pairs(objectNames(set.items)),
    npcCandidates: pairs(candidates), dropped, objectIds,
    vendorIds: publicVendors(set.world).map((v) => v.vendorNpcId).sort((a, b) => a - b),
  };
}

export const encodeSearchNames = (file: SearchNamesFile): string => JSON.stringify(file);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPairs = (v: unknown): v is [number, string][] => Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && Number.isInteger(p[0]) && typeof p[1] === "string");

/** The file as read, or null for text that is not the file (the search then falls back to the aggregates). Never throws. */
export function parseSearchNames(text: string): SearchNames | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObject(raw) || raw.version !== 1 || typeof raw.generatedAt !== "string" || (raw.dataAsOf !== null && typeof raw.dataAsOf !== "string")) return null;
  const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => Number.isInteger(n));
  if (![raw.items, raw.npcs, raw.quests, raw.objects, raw.npcCandidates].every(isPairs) || !isIds(raw.dropped) || !isIds(raw.objectIds)) return null;
  if (raw.vendorIds !== undefined && !isIds(raw.vendorIds)) return null;
  const map = (v: unknown) => new Map(v as [number, string][]);
  return {
    generatedAt: raw.generatedAt, dataAsOf: raw.dataAsOf as string | null,
    names: { items: map(raw.items), npcs: map(raw.npcs), quests: map(raw.quests), objects: map(raw.objects) },
    candidates: map(raw.npcCandidates), dropped: new Set(raw.dropped), objectIds: new Set(raw.objectIds),
    ...(raw.vendorIds === undefined ? {} : { vendorIds: new Set(raw.vendorIds as number[]) }),
  };
}

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}
const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${SEARCH_NAMES_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/**
 * The cron's write, right after the aggregates and from the same set: when the run added uploads or rebuilt, or when
 * the file is missing or stamped for another snapshot or revision. `build` hands over the set the aggregates were
 * written from, so the corpus is replayed once per run, not twice.
 */
export async function writeSearchNames(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build: () => Promise<AggregateSet>; now?: () => Date;
}): Promise<{ written: boolean; bytes?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored search names need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(r2(cloud), r2Url(cloud), opts.dataAsOf, doFetch, SEARCH_NAMES_REVISION)) return { written: false };
  const body = encodeSearchNames(buildSearchNames(await deps.build(), (deps.now?.() ?? new Date()).toISOString()));
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf, SEARCH_NAMES_REVISION) } }));
  if (!put.ok) throw new Error(`search names write failed (${put.status})`);
  return { written: true, bytes: new TextEncoder().encode(body).length };
}

type Read = { file: SearchNames | null; etag?: string; failed?: boolean };
type Deps = { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number };

/**
 * The file, kept KEEP_MS per server instance (one shared download for concurrent readers). A re-read sends the kept
 * file's ETag, so an unchanged file is neither downloaded nor parsed again, and a file with the same `generatedAt`
 * keeps the maps already read (and every memo keyed on them). A failed re-read keeps the file for another minute; a
 * missing file or an unknown shape drops it, and the search reads the aggregates instead.
 */
const stored = keep<Read, { cloud: R2Config; fetch: typeof fetch }>(async ({ cloud, fetch: doFetch }, kept) => {
  const retry = { keepMs: RETRY_MS };
  try {
    const etag = kept?.value.file ? kept.value.etag : undefined;
    const res = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } }));
    if (res.status === 304 && kept?.value.file) return { value: { ...kept.value, failed: false } };
    if (res.ok) {
      const read = parseSearchNames(await res.text());
      if (!read) return { value: { file: null }, ...retry };
      const same = kept?.value.file && kept.value.file.generatedAt === read.generatedAt;
      return { value: { file: same ? kept!.value.file : read, etag: res.headers.get("etag") ?? undefined } };
    }
    if (res.status === 404 || !kept?.value.file) return { value: { file: null }, ...retry };
    return { value: { ...kept.value, failed: true }, ...retry };
  } catch {
    return kept?.value.file ? { value: { ...kept.value, failed: true }, ...retry } : { value: { file: null }, ...retry };
  }
}, { ttlMs: KEEP_MS });

/** The stored names, or null when there is no file, no cloud settings, or it cannot be read. Never throws. */
export async function loadStoredSearchNames(deps: Deps = {}): Promise<SearchNames | null> {
  const now = (deps.now ?? Date.now)();
  const hit = stored.fresh(now);
  if (hit) return hit.value.file;
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) return null;
  return (await stored.get({ cloud, fetch: deps.fetch ?? fetch }, now)).file;
}

/** For tests: forget the kept file. */
export const forgetStoredSearchNames = () => stored.forget();
