import { AwsClient } from "aws4fetch";
import type { AuctionHouse } from "@everloot/protocol";
import type { MarketState, PublicDay } from "@kb/market";
import {
  HOUSES, agreementSoFar, board, busiestFirst, pendingRealms, realmBoards, realmSlug,
  type MarketRow, type PendingRealm, type RealmBoard, type RealmRef,
} from "./auction-house";
import { realmRuleset } from "./realms";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import type { Market, R2Config } from "./upload-store";

/**
 * The Auction House boards, stored by the snapshot cron beside the market rollup so the browse, realm, bags and
 * disenchanting pages read one file instead of building every realm's board on each request (`realmBoards` runs the
 * market value of every item in every house). The file holds, per realm and house, the rows those pages show (the
 * same `MarketRow`s `realmBoards` builds), the realms still below the gate with their reporter counts, the agreement
 * meter's count per realm slug and house, and the name each item is shown under.
 *
 * A board depends on the rollup and on the UTC day (a market value reads the last 14 days), so the file is stamped
 * with both. A page uses it only when it was built from the rollup the page holds, or a newer one, on the same UTC day;
 * otherwise, and with no file, the page builds the boards itself as before.
 *
 * Privacy: nothing here is new to a page. The rows are public values only; reporters are counted, never named; the
 * names are the ones the Auction House pages already show (`auctionNames` in app/tools/auctions/art.ts: players'
 * agreed name, then the game files and wiki match, then the tooltip). The file sits in the uploads bucket under
 * `snapshots/`, beside the rollup, and is never public.
 */

export const BOARDS_KEY = "snapshots/market-boards.json";
/** The file's shape. Change it when the shape changes, so the next cron rewrites the file and pages never read an old one. */
export const BOARDS_REVISION = "boards-1";
/** How long one server instance keeps the file before asking again (with its ETag): the cron rewrites it at most every 10 minutes. */
const KEEP_MS = 60_000;

const DAY_MS = 86_400_000;
const utcDay = (now: Date) => new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);

type StoredPoint = [day: string, min: number, market: number, quantity: number, reporters: number, thin: 0 | 1];
interface StoredRow { value: MarketRow["value"]; points: StoredPoint[]; listings: number | null; updatedAt: number | null }
interface StoredHouse { reporters: number; updatedAt: number | null; rows: StoredRow[] }
interface StoredRealm { key: string; name: string; reporters: number; updatedAt: number | null; houses: Partial<Record<AuctionHouse, StoredHouse>> }

export interface BoardsFile {
  version: 1;
  revision: string;
  generatedAt: string;
  /** The rollup's `generatedAt` the boards were built from. */
  marketAsOf: string;
  /** The UTC day the boards were built for. */
  day: string;
  /** `${marketAsOf};${day}`: what the cron's freshness check compares. */
  dataAsOf: string;
  realms: StoredRealm[];
  /** Every item on a board: [shown name or null for "Item N", quality or null]. */
  items: Record<string, [string | null, string | null]>;
  pending: PendingRealm[];
  /** The agreement meter per realm slug: "all" and each house; a slug or house absent is 0. */
  agreement: Record<string, Partial<Record<AuctionHouse | "all", number>>>;
}

/** What the pages read: one house's boards (null: every house apart), the realms below the gate, the meter, the names. */
export interface MarketBoards {
  source: "file" | "live";
  boards: (house: AuctionHouse | null) => RealmBoard[];
  pending: () => PendingRealm[];
  agreement: (slug: string, house: AuctionHouse | null) => number;
  /** The shown name of each item on a board (null: none, read "Item N"); null when built live, and the page reads the names itself. */
  names: ReadonlyMap<number, string | null> | null;
}

const point = (p: PublicDay): StoredPoint => [p.day, p.min, p.market, p.quantity, p.reporters, p.thin ? 1 : 0];
const unpoint = ([day, min, market, quantity, reporters, thin]: StoredPoint): PublicDay => ({ day, min, market, quantity, reporters, thin: thin === 1 });

/**
 * The file from the rollup: the boards exactly as `realmBoards` builds them for `now`, with each item's shown name.
 * `names` labels the ids (the cron passes the Auction House pages' rule).
 */
export async function buildMarketBoards(state: MarketState, marketAsOf: string, now: Date,
  names: (ids: number[]) => Promise<Map<number, { name: string | null; quality: string | null }>>): Promise<BoardsFile> {
  const realms = new Map<string, StoredRealm>();
  for (const b of realmBoards(state, now)) realms.set(b.realm.key, { key: b.realm.key, name: b.realm.name, reporters: b.reporters, updatedAt: b.updatedAt, houses: {} });
  for (const house of HOUSES) for (const b of realmBoards(state, now, house)) {
    realms.get(b.realm.key)!.houses[house] = {
      reporters: b.reporters, updatedAt: b.updatedAt,
      rows: b.rows.map((r) => ({ value: r.value, points: r.points.map(point), listings: r.listings, updatedAt: r.updatedAt })),
    };
  }
  const ids = [...new Set([...realms.values()].flatMap((r) => Object.values(r.houses).flatMap((h) => h.rows.map((row) => row.value.itemId))))].sort((a, b) => a - b);
  const named = await names(ids);
  const items: BoardsFile["items"] = {};
  for (const id of ids) items[id] = [named.get(id)?.name ?? null, named.get(id)?.quality ?? null];
  const agreement: BoardsFile["agreement"] = {};
  for (const stored of Object.values(state.houses ?? {})) {
    const slug = realmSlug(stored.name);
    if (agreement[slug]) continue;
    const counts: Partial<Record<AuctionHouse | "all", number>> = {};
    for (const h of [null, ...HOUSES]) {
      const n = agreementSoFar(state, slug, undefined, h);
      if (n > 0) counts[h ?? "all"] = n;
    }
    agreement[slug] = counts;
  }
  const day = utcDay(now);
  return {
    version: 1, revision: BOARDS_REVISION, generatedAt: new Date().toISOString(), marketAsOf, day, dataAsOf: `${marketAsOf};${day}`,
    realms: [...realms.values()], items, pending: pendingRealms(state, now), agreement,
  };
}

/** The pages' view of a stored file: the boards put back together once per house and kept with the file. */
export function boardsFromFile(file: BoardsFile): MarketBoards {
  const refs = new Map<string, RealmRef>(file.realms.map((r) => [r.key, { key: r.key, name: r.name, slug: realmSlug(r.name), ruleset: realmRuleset(r.name) }]));
  const rowsOf = (r: StoredRealm, house: AuctionHouse): MarketRow[] => (r.houses[house]?.rows ?? []).map((row) => ({
    realm: refs.get(r.key)!, house, value: row.value, points: row.points.map(unpoint), listings: row.listings, updatedAt: row.updatedAt,
  }));
  const made = new Map<AuctionHouse | null, RealmBoard[]>();
  const boards = (house: AuctionHouse | null) => {
    let hit = made.get(house);
    if (!hit) {
      hit = file.realms.flatMap((r) => {
        if (house) {
          const h = r.houses[house];
          return h ? [board(refs.get(r.key)!, house, rowsOf(r, house), h.reporters, h.updatedAt)] : [];
        }
        // Each house's rows built once and shared with the all-houses board, as realmBoards' rows are equal either way.
        return [board(refs.get(r.key)!, null, HOUSES.flatMap((h) => rowsOf(r, h)), r.reporters, r.updatedAt)];
      }).sort(busiestFirst);
      made.set(house, hit);
    }
    return hit;
  };
  const names = new Map<number, string | null>(Object.entries(file.items).map(([id, [name]]) => [Number(id), name]));
  return {
    source: "file", boards, names,
    pending: () => file.pending,
    agreement: (slug, house) => file.agreement[slug]?.[house ?? "all"] ?? 0,
  };
}

/** The boards built from the rollup on this request, as before the file. */
export function liveBoards(state: MarketState, now: Date): MarketBoards {
  return {
    source: "live", names: null,
    boards: (house) => realmBoards(state, now, house),
    pending: () => pendingRealms(state, now),
    agreement: (slug, house) => agreementSoFar(state, slug, undefined, house),
  };
}

/** The file as read, or null for text that is not one this code wrote. Never throws. */
export function parseBoards(text: string): BoardsFile | null {
  try {
    const raw = JSON.parse(text) as Partial<BoardsFile> | null;
    if (!raw || raw.version !== 1 || raw.revision !== BOARDS_REVISION || typeof raw.marketAsOf !== "string" || typeof raw.day !== "string"
      || !Array.isArray(raw.realms) || !Array.isArray(raw.pending) || typeof raw.items !== "object" || typeof raw.agreement !== "object") return null;
    return raw as BoardsFile;
  } catch {
    return null;
  }
}

/**
 * Whether a file may stand in for the boards of `market` at `now`: built from that rollup or a newer one, on the same
 * UTC day. A rollup newer than the file means the cron has not caught up yet, and the page builds the boards itself.
 */
export function fileIsCurrent(file: Pick<BoardsFile, "marketAsOf" | "day">, market: Pick<Market, "dataAsOf">, now: Date): boolean {
  if (!market.dataAsOf || file.day !== utcDay(now)) return false;
  const built = Date.parse(file.marketAsOf), rollup = Date.parse(market.dataAsOf);
  return Number.isFinite(built) && Number.isFinite(rollup) && built >= rollup;
}

/* ---------- Storage ---------- */

function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}
const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${BOARDS_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/** The Auction House pages' names for the ids, with each tooltip's quality: the rule of `auctionNames` (app/tools/auctions/art.ts). */
async function shownNames(ids: number[]): Promise<Map<number, { name: string | null; quality: string | null }>> {
  const [{ loadShownNames }, { shownItemName }, { loadSiteAssets, loadItemTips }] = await Promise.all([
    import("./shown-item-names"), import("./items"), import("./game-assets"),
  ]);
  const shown = await loadShownNames();
  // A degraded read would store "Item N" for names the pages can show; the pages build live until the next run.
  if (shown.degraded) throw new Error("item names unreachable");
  const tips = ids.length ? await loadItemTips(await loadSiteAssets(), ids) : new Map();
  return new Map(ids.map((id) => [id, { name: shownItemName(id, shown.agreed, shown.matched?.names, tips.get(id))?.name ?? null, quality: tips.get(id)?.quality ?? null }]));
}

/**
 * The cron's step: writes the file when the rollup or the UTC day changed since the last one, or the file is missing or of
 * another revision. An idle run with a current file reads only a HEAD. `ms` is how long building took, for the run's log.
 */
export async function writeMarketBoards(now: Date = new Date(), deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; market?: () => Promise<Market>;
  names?: (ids: number[]) => Promise<Map<number, { name: string | null; quality: string | null }>>;
} = {}): Promise<{ written: boolean; bytes?: number; ms?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the stored boards need the cloud store");
  const doFetch = deps.fetch ?? fetch;
  const market = await (deps.market ?? (async () => (await import("./upload-store")).uploadStore.loadMarket()))();
  if (!market.state || !market.dataAsOf) throw new Error("market unavailable");
  const dataAsOf = `${market.dataAsOf};${utcDay(now)}`;
  if (!await storedViewNeedsWrite(r2(cloud), r2Url(cloud), dataAsOf, doFetch, BOARDS_REVISION)) return { written: false };
  const started = Date.now();
  const body = JSON.stringify(await buildMarketBoards(market.state, market.dataAsOf, now, deps.names ?? shownNames));
  const ms = Date.now() - started;
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body, headers: { "content-type": "application/json", [STAMP]: stampOf(dataAsOf, BOARDS_REVISION) } }));
  if (!put.ok) throw new Error(`boards write failed (${put.status})`);
  return { written: true, bytes: new TextEncoder().encode(body).length, ms };
}

/** The read file, its ETag and its page view, kept KEEP_MS per server instance. */
let kept: { at: number; file: BoardsFile | null; view: MarketBoards | null; etag?: string } | null = null;
let pending: Promise<void> | null = null;

async function refresh(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now: number }): Promise<void> {
  const { now } = deps;
  try {
    const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
    if (!cloud) { kept = { at: now, file: null, view: null }; return; }
    const etag = kept?.file ? kept.etag : undefined;
    const res = await (deps.fetch ?? fetch)(await r2(cloud).sign(r2Url(cloud), {
      method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) },
    }));
    if (res.status === 304 && kept?.file) kept = { ...kept, at: now };
    else if (res.ok) {
      const file = parseBoards(await res.text());
      kept = { at: now, file, view: file ? boardsFromFile(file) : null, etag: res.headers.get("etag") ?? undefined };
    } else kept = { at: now, file: null, view: null };
  } catch {
    kept = { at: now, file: null, view: null };
  }
}

/**
 * The boards a page shows: the stored file when it is current for this rollup and day, else built live from the rollup;
 * null without a rollup. Never throws: an unreadable file is the live build.
 */
export async function loadMarketBoards(market: Market, now: Date = new Date(), deps: { cloud?: R2Config | null; fetch?: typeof fetch; clock?: () => number } = {}): Promise<MarketBoards | null> {
  if (!market.state) return null;
  const at = (deps.clock ?? Date.now)();
  if (!kept || at - kept.at >= KEEP_MS) {
    pending ??= refresh({ ...deps, now: at }).finally(() => { pending = null; });
    await pending;
  }
  return kept?.file && kept.view && fileIsCurrent(kept.file, market, now) ? kept.view : liveBoards(market.state, now);
}

/** For tests: forget the kept file. */
export const forgetMarketBoards = () => { kept = null; pending = null; };
