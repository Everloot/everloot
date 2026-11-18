import { cache } from "react";
import { AwsClient } from "aws4fetch";
import type { AuctionHouse } from "@everloot/protocol";
import type { MarketState } from "../../../kb/src/market";
import { HOUSES, realmBoards } from "./auction-house";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import type { R2Config } from "./upload-store";
import { VENDOR_SHOWN, vendorCandidates, vendorThese } from "./vendor-these";

/**
 * "Vendor these" as a stored view: the snapshot cron works out each realm's lists once, from the market rollup and the
 * game files' sell prices, and writes one small object per realm, all its houses in it. The realm page reads that one
 * object when a house is picked, and reads no tooltip for the list. One object per realm rather than per house: a
 * realm has at most three houses of VENDOR_SHOWN rows, a third of the writes, and a realm's houses always share one stamp.
 */
const ROOT = "snapshots/vendor-these";
const INDEX = `${ROOT}/index.json`;
/** Names the stored shape; a file of another revision is rewritten by the next run. */
const REVISION = "vendor-these-1";

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
  /** Items whose tooltip could not be read. */
  unread: Set<number>;
}

const realmKey = (slug: string) => `${ROOT}/${slug}.json`;
const validSlug = (slug: string) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(slug);

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

/** The game files' sell prices and the auction tool's names, read in the cron where its longer budget applies. */
async function readSellPrices(ids: number[]): Promise<SellPrices> {
  const [{ loadSiteAssets, readItemTips }, { loadShownNames }, { shownItemName }] = await Promise.all([import("./game-assets"), import("./shown-item-names"), import("./items")]);
  const assets = ids.length ? await loadSiteAssets() : null;
  const read = await readItemTips(assets, ids);
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
  return { prices, names, unread: read.unread };
}

/**
 * Rebuild every realm's lists when the market rollup has changed, on a new UTC day (a market goes stale by the
 * calendar), or after a run that was incomplete. Each realm is written in its own try; the index is written last and,
 * when a realm failed or a sell price could not be read, stamped so the next run tries again. A realm that failed keeps
 * its last object, which carries its own snapshot time.
 */
export async function writeVendorThese(now = new Date(), deps: Deps & { market?: () => Promise<{ state: MarketState | null; dataAsOf: string | null }>; read?: (ids: number[]) => Promise<SellPrices> } = {}): Promise<{ written: boolean; realms?: number; failed?: number; unread?: number }> {
  const s = storage(deps);
  if (!s) throw new Error("the vendor lists need the cloud store");
  const market = await (deps.market ?? (async () => (await import("./upload-store")).uploadStore.loadMarket()))();
  if (!market.state) throw new Error("market unavailable");
  const revision = `${REVISION};${now.toISOString().slice(0, 10)}`;
  if (!await storedViewNeedsWrite(s.client, s.url(INDEX), market.dataAsOf, deps.fetch ?? fetch, revision)) return { written: false };
  const realms = await buildVendorLists(market.state, now, market.dataAsOf, deps.read ?? readSellPrices);
  let failed = 0;
  let unread = 0;
  for (const [slug, realm] of realms) {
    unread += realm.houses.reduce((n, h) => n + h.unread, 0);
    try {
      if (!validSlug(slug)) throw new Error(`unusable realm slug ${JSON.stringify(slug)}`);
      const put = await s.request(realmKey(slug), { method: "PUT", body: JSON.stringify(realm), headers: { "content-type": "application/json", [STAMP]: stampOf(market.dataAsOf, revision) } });
      if (!put.ok) throw new Error(`write failed (${put.status})`);
    } catch (err) {
      failed++;
      console.error(`vendor list failed for ${slug}`, err);
    }
  }
  const complete = failed === 0 && unread === 0;
  const index = { version: 1, dataAsOf: market.dataAsOf, builtAt: now.toISOString(), realms: realms.size, failed, unread };
  const put = await s.request(INDEX, {
    method: "PUT", body: JSON.stringify(index),
    headers: { "content-type": "application/json", [STAMP]: stampOf(market.dataAsOf, complete ? revision : `${revision};incomplete`) },
  });
  if (!put.ok) throw new Error(`vendor list index write failed (${put.status})`);
  return { written: true, realms: realms.size, failed, unread };
}

const isHouse = (h: unknown): h is StoredVendorHouse => {
  const x = h as StoredVendorHouse;
  return typeof x === "object" && x !== null && typeof x.house === "string" && [x.candidates, x.unread, x.total].every(Number.isInteger) && Array.isArray(x.rows);
};

/**
 * A realm's stored lists: null when the object is not there yet, or cannot be read ("not built yet" and "unavailable"
 * are told apart by `missing`). No market or tooltip fallback: the page never builds the list itself.
 */
async function readVendorThese(slug: string, deps: Deps = {}): Promise<{ realm: StoredVendorRealm | null; missing: boolean }> {
  if (!validSlug(slug)) return { realm: null, missing: true };
  const s = storage(deps);
  if (!s) return { realm: null, missing: false };
  try {
    const res = await s.request(realmKey(slug), { method: "GET", headers: { "accept-encoding": "identity" } });
    if (res.status === 404) return { realm: null, missing: true };
    if (!res.ok) return { realm: null, missing: false };
    const raw = await res.json() as StoredVendorRealm;
    const ok = raw?.version === 1 && (raw.dataAsOf === null || typeof raw.dataAsOf === "string") && typeof raw.realm === "string" && Array.isArray(raw.houses) && raw.houses.every(isHouse);
    return ok ? { realm: raw, missing: false } : { realm: null, missing: false };
  } catch {
    return { realm: null, missing: false };
  }
}
export const storedVendorThese = cache(readVendorThese);
