import { cache } from "react";
import { AwsClient } from "aws4fetch";
import type { AuctionHouse } from "@everloot/protocol";
import type { MarketState } from "../../../kb/src/market";
import { HOUSES, realmBoards } from "./auction-house";
import { STAMP, stampOf } from "./stored-view-freshness";
import type { R2Config } from "./upload-store";
import { VENDOR_SHOWN, vendorCandidates, vendorThese } from "./vendor-these";

/**
 * "Vendor these" as a stored view: the snapshot cron works out each realm's lists once, from the market rollup and the
 * game files' sell prices, and writes one small object per realm, all its houses in it. The realm page reads the index
 * and that one object when a house is picked, and reads no tooltip for the list. One object per realm rather than per
 * house: a realm has at most three houses of VENDOR_SHOWN rows, a third of the writes, and a realm's houses always
 * share one snapshot.
 *
 * Each build is a generation: its realm objects go under `g/<generation>/`, and the index, written last, says which
 * generation holds each realm. A page therefore never reads a mix of builds, nor an object not written yet.
 */
const ROOT = "snapshots/vendor-these";
const INDEX = `${ROOT}/index.json`;
/** Names the stored shape; an index of another revision makes the next run rebuild. */
const REVISION = "vendor-these-2";

export interface StoredVendorRow {
  itemId: number;
  /** The name the auction tool shows; null reads "Item N". */
  name: string | null;
  vendor: number;
  market: number;
  afterCut: number;
  more: number;
  quantity: number;
  /** The newest public day behind the market value. */
  day: string;
}

export interface StoredVendorHouse {
  house: AuctionHouse;
  /** Items with a current market on the house. */
  candidates: number;
  /** Candidates whose sell price could not be read: the list leaves them out and is incomplete. */
  unread: number;
  /** Every item on the list; only the first VENDOR_SHOWN are kept. */
  total: number;
  rows: StoredVendorRow[];
}

export interface StoredVendorRealm {
  version: 1;
  /** The market rollup's time, the snapshot the list came from. */
  dataAsOf: string | null;
  builtAt: string;
  realm: string;
  houses: StoredVendorHouse[];
}

export interface SellPrices {
  /** Sell price per unit in copper, for each item whose tooltip was read; 0 when a vendor will not buy it. */
  prices: Map<number, number>;
  names: Map<number, string>;
  /** Items whose tooltip could not be read: a failed read, or left for the build's budget. */
  unread: Set<number>;
  /** Tooltip shards left unread for the budget. */
  skipped: number;
}

const realmKey = (generation: string, slug: string) => `${ROOT}/g/${generation}/${slug}.json`;
const validSlug = (slug: string) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(slug);
const validGeneration = (id: string) => /^[A-Za-z0-9-]{1,64}$/.test(id);

/** Every realm's lists, from one read of the sell prices for every realm's candidates. */
export async function buildVendorLists(state: MarketState, now: Date, dataAsOf: string | null, read: (ids: number[]) => Promise<SellPrices>): Promise<Map<string, StoredVendorRealm>> {
  const boards = HOUSES.flatMap((house) => realmBoards(state, now, house).map((board) => ({ house, board })));
  const ids = [...new Set(boards.flatMap(({ board }) => vendorCandidates(board.rows)))];
  const sell = await read(ids);
  const out = new Map<string, StoredVendorRealm>();
  for (const { house, board } of boards) {
    const candidates = vendorCandidates(board.rows);
    const list = vendorThese(board.rows, house, (id) => sell.prices.get(id));
    const realm = out.get(board.realm.slug) ?? { version: 1 as const, dataAsOf, builtAt: now.toISOString(), realm: board.realm.name, houses: [] };
    realm.houses.push({
      house,
      candidates: candidates.length,
      unread: candidates.filter((id) => sell.unread.has(id)).length,
      total: list.length,
      rows: list.slice(0, VENDOR_SHOWN).map((v) => ({
        itemId: v.itemId, name: sell.names.get(v.itemId) ?? null, vendor: v.vendor, market: v.market, afterCut: v.afterCut, more: v.more,
        quantity: v.row.value.quantity, day: v.row.value.day,
      })),
    });
    out.set(board.realm.slug, realm);
  }
  return out;
}

type Deps = { cloud?: R2Config | null; fetch?: typeof fetch };
const config = (): R2Config | null => {
  const c = { r2AccountId: process.env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: process.env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: process.env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? c as R2Config : null;
};
function storage(deps: Deps) {
  const c = deps.cloud === undefined ? config() : deps.cloud;
  if (!c) return null;
  const client = new AwsClient({ accessKeyId: c.r2AccessKeyId, secretAccessKey: c.r2SecretAccessKey, service: "s3", region: "auto" });
  const url = (key: string) => `https://${c.r2AccountId}.r2.cloudflarestorage.com/${c.r2Bucket}/${key}`;
  const request = async (key: string, init?: RequestInit) => (deps.fetch ?? fetch)(await client.sign(url(key), init), { cache: "no-store" });
  return { client, url, request };
}
type Storage = NonNullable<ReturnType<typeof storage>>;

/** At most one build attempt an hour, complete or not, apart from the first after a UTC day change. */
export const VENDOR_REBUILD_MS = 60 * 60_000;
/** A build's lease: another run that sees one younger than this skips. Well over a build's wall-time cap. */
export const VENDOR_LEASE_MS = 15 * 60_000;
/**
 * A build's budget for tooltip shards: read 4 at a time (the Worker opens about 6 connections at once, and a read
 * queued behind others times out), at most 120 in all, and none started after 60 s. Past it the build stops reading,
 * publishes what it has and is marked incomplete with counts; the next attempt is an hour later.
 */
export const VENDOR_BUDGET = { concurrency: 4, maxShards: 120, wallMs: 60_000 };

/** The game files' sell prices and the auction tool's names, read in the cron within the build's budget. */
async function readSellPrices(ids: number[], deadline: number): Promise<SellPrices> {
  const [{ loadSiteAssets, readItemTips }, { loadShownNames }, { shownItemName }] = await Promise.all([import("./game-assets"), import("./shown-item-names"), import("./items")]);
  const assets = ids.length ? await loadSiteAssets() : null;
  const read = await readItemTips(assets, ids, undefined, { concurrency: VENDOR_BUDGET.concurrency, maxShards: VENDOR_BUDGET.maxShards, deadline });
  const prices = new Map([...read.tips].map(([id, tip]) => [id, tip.sellPrice]));
  const names = new Map<number, string>();
  const listed = ids.filter((id) => (read.tips.get(id)?.sellPrice ?? 0) > 0);
  if (listed.length) {
    const { agreed, matched } = await loadShownNames();
    for (const id of listed) {
      const shown = shownItemName(id, agreed, matched?.names, read.tips.get(id));
      if (shown) names.set(id, shown.name);
    }
  }
  return { prices, names, unread: read.unread, skipped: read.skipped };
}

interface VendorIndex {
  version: 2;
  revision: string;
  /** The generation of the last published build; null before the first. */
  generation: string | null;
  /** Each realm's generation: this build's, or the last one that wrote it when this build's write failed. */
  realms: Record<string, string>;
  /** The previous build's map, kept so a page that read the old index mid-switch still finds its object. */
  retired: Record<string, string>;
  dataAsOf: string | null;
  builtAt: string | null;
  complete: boolean;
  failed: number;
  unread: number;
  skipped: number;
  /** When the last build started: the hourly cap counts from here, so a build that throws or never publishes still counts. */
  attemptAt: string | null;
  /** The lease of a build in progress. */
  building: { since: string; id: string } | null;
}

const isMap = (x: unknown): x is Record<string, string> =>
  typeof x === "object" && x !== null && !Array.isArray(x) && Object.entries(x).every(([k, v]) => validSlug(k) && typeof v === "string" && validGeneration(v));
const isTime = (x: unknown): x is string | null => x === null || (typeof x === "string" && Number.isFinite(Date.parse(x)));

/** The index when it is an object of this shape; anything else (JSON null, an older shape) is no usable index. */
function parseIndex(raw: unknown): VendorIndex | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const x = raw as Partial<VendorIndex>;
  const lease = x.building;
  const leaseOk = lease === null || (typeof lease === "object" && lease !== undefined && typeof lease.since === "string" && isTime(lease.since) && typeof lease.id === "string");
  const generationOk = x.generation === null || (typeof x.generation === "string" && validGeneration(x.generation));
  if (x.version !== 2 || typeof x.revision !== "string" || !generationOk || !isMap(x.realms) || !isMap(x.retired) ||
    !isTime(x.dataAsOf) || !isTime(x.builtAt) || !isTime(x.attemptAt) || typeof x.complete !== "boolean" ||
    ![x.failed, x.unread, x.skipped].every(Number.isInteger) || !leaseOk) return null;
  return x as VendorIndex;
}

type IndexRead = { ok: false } | { ok: true; index: VendorIndex | null; etag: string | null; exists: boolean };
async function readIndex(s: Storage): Promise<IndexRead> {
  try {
    const res = await s.request(INDEX, { method: "GET", headers: { "accept-encoding": "identity" } });
    if (res.status === 404) return { ok: true, index: null, etag: null, exists: false };
    if (!res.ok) return { ok: false };
    let raw: unknown = null;
    try { raw = await res.json(); } catch { raw = null; }
    return { ok: true, index: parseIndex(raw), etag: res.headers.get("etag"), exists: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Write the index only if it is still the copy this run read: R2 honours `if-match` (and `if-none-match: *` for a
 * first write), as the market rollup's writes rely on, so two runs cannot both claim or both publish. A 412 means
 * another run wrote it first.
 */
async function putIndex(s: Storage, index: VendorIndex, read: { etag: string | null; exists: boolean }): Promise<{ ok: true } | { ok: false; lost: boolean; status: number }> {
  if (read.exists && !read.etag) throw new Error("vendor list index has no ETag: cannot write it safely");
  const condition: Record<string, string> = read.exists ? { "if-match": read.etag! } : { "if-none-match": "*" };
  const res = await s.request(INDEX, {
    method: "PUT", body: JSON.stringify(index),
    headers: { "content-type": "application/json", [STAMP]: stampOf(index.dataAsOf, REVISION), ...condition },
  });
  if (res.ok) return { ok: true };
  return { ok: false, lost: res.status === 412, status: res.status };
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Why this run does not build, or null when it does. */
function notDue(index: VendorIndex | null, dataAsOf: string | null, now: number): "building" | "throttled" | "current" | null {
  if (index?.building && now - Date.parse(index.building.since) < VENDOR_LEASE_MS) return "building";
  if (!index || index.revision !== REVISION || index.attemptAt === null) return null;
  const attempt = Date.parse(index.attemptAt);
  // The first run of a new UTC day builds: a market goes stale by the calendar.
  if (utcDay(attempt) !== utcDay(now)) return null;
  // Within the hour nothing builds, a retry after an incomplete build included.
  if (now - attempt < VENDOR_REBUILD_MS) return "throttled";
  return index.complete && index.dataAsOf === dataAsOf ? "current" : null;
}

const emptyIndex = (): VendorIndex => ({
  version: 2, revision: REVISION, generation: null, realms: {}, retired: {}, dataAsOf: null, builtAt: null, complete: false,
  failed: 0, unread: 0, skipped: 0, attemptAt: null, building: null,
});

export type VendorRun =
  | { written: false; reason: "index unreadable" | "building" | "throttled" | "current" | "lost the lease" }
  | { written: true; realms: number; failed: number; unread: number; skipped: number };

/**
 * One build of every realm's lists, when due (`notDue`): at most one attempt an hour whether the last one was complete
 * or not, except the first run of a new UTC day. Builds never overlap:
 * 1. The run claims the index with a lease and the attempt time, by a conditional write, before any expensive work.
 *    A run that sees a lease younger than VENDOR_LEASE_MS skips; a build that throws keeps its attempt time, so the
 *    hourly cap holds, and its lease runs out.
 * 2. It reads sell prices within VENDOR_BUDGET and writes each realm under its own generation, each realm in its own try.
 * 3. It reads the index again, gives up if another run took the lease, and publishes the index pointing at its
 *    generation with a conditional write. A realm whose write failed keeps its last generation.
 * 4. Best effort, it deletes the objects that only the build before the previous one used.
 */
export async function writeVendorThese(now = new Date(), deps: Deps & {
  market?: () => Promise<{ state: MarketState | null; dataAsOf: string | null }>;
  read?: (ids: number[], deadline: number) => Promise<SellPrices>;
  /** For tests: the generation id, and the wall clock the budget runs on. */
  id?: string;
  clock?: () => number;
} = {}): Promise<VendorRun> {
  const s = storage(deps);
  if (!s) throw new Error("the vendor lists need the cloud store");
  const market = await (deps.market ?? (async () => (await import("./upload-store")).uploadStore.loadMarket()))();
  if (!market.state) throw new Error("market unavailable");
  const first = await readIndex(s);
  if (!first.ok) {
    console.warn("vendor list index unreadable; skipping this run");
    return { written: false, reason: "index unreadable" };
  }
  const reason = notDue(first.index, market.dataAsOf, now.getTime());
  if (reason) return { written: false, reason };

  const id = deps.id ?? crypto.randomUUID();
  if (!validGeneration(id)) throw new Error("unusable generation id");
  const at = now.toISOString();
  const previous = first.index ?? emptyIndex();
  const claim = await putIndex(s, { ...previous, revision: REVISION, attemptAt: at, building: { since: at, id } }, first);
  if (!claim.ok) {
    if (claim.lost) return { written: false, reason: "building" };
    throw new Error(`vendor list lease failed (${claim.status})`);
  }

  const deadline = (deps.clock ?? Date.now)() + VENDOR_BUDGET.wallMs;
  let skipped = 0;
  const realms = await buildVendorLists(market.state, now, market.dataAsOf, async (ids) => {
    const sell = await (deps.read ?? readSellPrices)(ids, deadline);
    skipped = sell.skipped;
    return sell;
  });
  const written: string[] = [];
  let failed = 0;
  let unread = 0;
  for (const [slug, realm] of realms) {
    unread += realm.houses.reduce((n, h) => n + h.unread, 0);
    try {
      if (!validSlug(slug)) throw new Error(`unusable realm slug ${JSON.stringify(slug)}`);
      const put = await s.request(realmKey(id, slug), { method: "PUT", body: JSON.stringify(realm), headers: { "content-type": "application/json", [STAMP]: stampOf(market.dataAsOf, REVISION) } });
      if (!put.ok) throw new Error(`write failed (${put.status})`);
      written.push(slug);
    } catch (err) {
      failed++;
      console.error(`vendor list failed for ${slug}`, err);
    }
  }
  const forget = (keys: string[]) => Promise.allSettled(keys.map((key) => s.request(key, { method: "DELETE" })));

  const before = await readIndex(s);
  if (!before.ok || before.index?.building?.id !== id) {
    await forget(written.map((slug) => realmKey(id, slug)));
    return { written: false, reason: "lost the lease" };
  }
  const map: Record<string, string> = {};
  for (const slug of realms.keys()) {
    if (written.includes(slug)) map[slug] = id;
    else if (previous.realms[slug]) map[slug] = previous.realms[slug]!;
  }
  const published: VendorIndex = {
    version: 2, revision: REVISION, generation: id, realms: map, retired: previous.realms, dataAsOf: market.dataAsOf, builtAt: at,
    complete: failed === 0 && unread === 0 && skipped === 0, failed, unread, skipped, attemptAt: at, building: null,
  };
  const put = await putIndex(s, published, before);
  if (!put.ok) {
    await forget(written.map((slug) => realmKey(id, slug)));
    if (put.lost) return { written: false, reason: "lost the lease" };
    throw new Error(`vendor list index write failed (${put.status})`);
  }
  // The build before the previous one: drop what neither this map nor the previous one (kept for pages mid-switch) uses.
  const kept = new Set([...Object.entries(map), ...Object.entries(previous.realms)].map(([slug, gen]) => realmKey(gen, slug)));
  await forget(Object.entries(previous.retired).map(([slug, gen]) => realmKey(gen, slug)).filter((key) => !kept.has(key)));
  return { written: true, realms: realms.size, failed, unread, skipped };
}

const isHouse = (h: unknown): h is StoredVendorHouse => {
  const x = h as StoredVendorHouse;
  return typeof x === "object" && x !== null && typeof x.house === "string" && [x.candidates, x.unread, x.total].every(Number.isInteger) && Array.isArray(x.rows);
};

/**
 * A realm's stored lists, from the generation the index names for it: `missing` when the index or the realm is not
 * there yet ("not built yet"), `realm: null` without `missing` when a read failed. No market or tooltip fallback: the
 * page never builds the list itself.
 */
async function readVendorThese(slug: string, deps: Deps = {}): Promise<{ realm: StoredVendorRealm | null; missing: boolean }> {
  if (!validSlug(slug)) return { realm: null, missing: true };
  const s = storage(deps);
  if (!s) return { realm: null, missing: false };
  const index = await readIndex(s);
  if (!index.ok) return { realm: null, missing: false };
  if (!index.exists) return { realm: null, missing: true };
  if (!index.index) return { realm: null, missing: false };
  const generation = index.index.realms[slug];
  if (!generation) return { realm: null, missing: true };
  try {
    const res = await s.request(realmKey(generation, slug), { method: "GET", headers: { "accept-encoding": "identity" } });
    if (!res.ok) return { realm: null, missing: false };
    const raw = await res.json() as StoredVendorRealm;
    const ok = typeof raw === "object" && raw !== null && raw.version === 1 && (raw.dataAsOf === null || typeof raw.dataAsOf === "string") &&
      typeof raw.realm === "string" && Array.isArray(raw.houses) && raw.houses.every(isHouse);
    return ok ? { realm: raw, missing: false } : { realm: null, missing: false };
  } catch {
    return { realm: null, missing: false };
  }
}
export const storedVendorThese = cache(readVendorThese);
