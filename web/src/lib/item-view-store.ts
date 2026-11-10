import { AwsClient } from "aws4fetch";
import { STAMP, stampOf, storedViewNeedsWrite } from "./stored-view-freshness";
import { agreedItemNames } from "../../../kb/src/item-page";
import { loadItemSeen, type ItemSeen } from "./item-seen";
import { SOURCES, type SourceSlug } from "./items";
import { loadItemFacts } from "./rollup-compute";
import { uploadStore, type Corpus, type R2Config } from "./upload-store";

/**
 * What the item lists read from players' uploads, stored by the cron instead of worked out on each view: the names 3
 * installs agree on, the items with a public drop, and the items players have seen with where they came from. The
 * cron writes it after the corpus snapshot (`writeItemView`), only when that run added uploads or rebuilt, or when
 * the file is missing or stale. A page reads one small file (`loadListNames`, `loadListSeen` in item-view.ts) instead of downloading and
 * replaying the whole corpus, which cost seconds of CPU on every new server instance. Every value is the same one
 * `loadShownNames` and `loadItemSeen` compute, from the same functions, so a page shows the same thing either way;
 * with no file yet (the first minutes after a deploy, or storage out of reach) the pages fall back to those.
 *
 * This file holds only the players' agreed names, never the game-file names, so the cron (API code) may import it;
 * the page loaders that add the names file live in item-view.ts.
 */

export const ITEM_VIEW_KEY = "snapshots/item-view.json";
/** How long one server instance keeps the file before reading it again: the cron rewrites it at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;

export interface ItemView {
  version: 1;
  generatedAt: string;
  /** The corpus snapshot's time: when the facts last changed. */
  dataAsOf: string | null;
  /** [item id, name] for every name 3 installs agree on. */
  agreed: [number, string][];
  /** Items with a public drop rate. */
  dropped: number[];
  /** Items players have seen (an agreed name, a public drop, a vendor, a quest reward or a recipe). */
  seen: number[];
  /** Where each seen item came from, in SOURCES order; an item seen only by name has none. */
  from: [number, SourceSlug[]][];
}

/** The uploads bucket's settings, read here rather than through upload-store so a page that mocks the store still renders. */
function r2FromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const c = { r2AccountId: env.R2_ACCOUNT_ID?.trim(), r2AccessKeyId: env.R2_ACCESS_KEY_ID?.trim(), r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim(), r2Bucket: env.R2_BUCKET?.trim() };
  return Object.values(c).every(Boolean) ? (c as R2Config) : null;
}

const r2Url = (cloud: R2Config) => `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${ITEM_VIEW_KEY}`;
const r2 = (cloud: R2Config) => new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });

/**
 * The view from the corpus as it stands, through the same functions the pages used before. Throws when the corpus is out
 * of reach. The cron passes the corpus it read (`read`), so the view is worked out from it and never from the stored
 * aggregates, which the same run writes only afterwards (aggregate-store.ts).
 */
export async function buildItemView(dataAsOf: string | null, now = new Date(), read?: Corpus): Promise<ItemView> {
  const [facts, seen] = await Promise.all([loadItemFacts(read), loadItemSeen(read)]);
  if (facts.unreachable || seen.unreachable) throw new Error("corpus unreachable");
  return {
    version: 1,
    generatedAt: now.toISOString(),
    dataAsOf,
    agreed: [...agreedItemNames(facts)].sort((a, b) => a[0] - b[0]),
    dropped: [...new Set(facts.rates.filter((r) => r.public).map((r) => r.itemId))].sort((a, b) => a - b),
    seen: [...seen.seen].sort((a, b) => a - b),
    from: [...seen.from].sort((a, b) => a[0] - b[0]),
  };
}

/**
 * The cron's step: writes the view when this run added uploads or rebuilt, or when the file is missing, unstamped or stale. An idle run
 * with a current file reads only a HEAD, falling back to GET if HEAD fails.
 */
export async function writeItemView(opts: { added: number; rebuild?: boolean; dataAsOf: string | null }, deps: {
  cloud?: R2Config | null; fetch?: typeof fetch; build?: () => Promise<ItemView>;
} = {}): Promise<{ written: boolean; items?: number }> {
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) throw new Error("the item view needs the cloud store");
  const doFetch = deps.fetch ?? fetch;
  if (opts.added <= 0 && !opts.rebuild && !await storedViewNeedsWrite(r2(cloud), r2Url(cloud), opts.dataAsOf, doFetch)) return { written: false };
  const view = await (deps.build ?? (async () => buildItemView(opts.dataAsOf, new Date(), await uploadStore.loadCorpus())))();
  const put = await doFetch(await r2(cloud).sign(r2Url(cloud), { method: "PUT", body: JSON.stringify(view), headers: { "content-type": "application/json", [STAMP]: stampOf(opts.dataAsOf) } }));
  if (!put.ok) throw new Error(`item view write failed (${put.status})`);
  return { written: true, items: view.seen.length };
}

const isIds = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => Number.isInteger(x));
const SOURCE_SLUGS = new Set<string>(SOURCES.map((s) => s.slug));

/** The file as read, or null for a shape this code does not know (the pages then fall back). */
export function parseItemView(raw: unknown): ItemView | null {
  const v = raw as Partial<ItemView> | null;
  if (!v || v.version !== 1 || typeof v.generatedAt !== "string") return null;
  if (!isIds(v.dropped) || !isIds(v.seen)) return null;
  if (!Array.isArray(v.agreed) || !v.agreed.every((e) => Array.isArray(e) && Number.isInteger(e[0]) && typeof e[1] === "string")) return null;
  if (!Array.isArray(v.from) || !v.from.every((e) => Array.isArray(e) && Number.isInteger(e[0]) && Array.isArray(e[1]) && e[1].every((s) => SOURCE_SLUGS.has(s)))) return null;
  return { version: 1, generatedAt: v.generatedAt, dataAsOf: typeof v.dataAsOf === "string" ? v.dataAsOf : null, agreed: v.agreed, dropped: v.dropped, seen: v.seen, from: v.from };
}

/** The read view with its maps built once, so each page view only looks things up. */
export interface ReadView { view: ItemView; agreed: Map<number, string>; dropped: Set<number>; seen: ItemSeen }
let kept: { at: number; read: ReadView | null } | null = null;

/** The stored view, kept KEEP_MS per server instance; null when there is none or it cannot be read. Never throws. */
export async function loadItemView(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number } = {}): Promise<ReadView | null> {
  const now = (deps.now ?? Date.now)();
  if (kept && now - kept.at < KEEP_MS) return kept.read;
  const cloud = deps.cloud === undefined ? r2FromEnv() : deps.cloud;
  if (!cloud) return null;
  let read: ReadView | null = null;
  try {
    const res = await (deps.fetch ?? fetch)(await r2(cloud).sign(r2Url(cloud), { method: "GET", headers: { "accept-encoding": "identity" } }));
    const view = res.ok ? parseItemView(JSON.parse(await res.text())) : null;
    if (view) {
      read = {
        view,
        agreed: new Map(view.agreed),
        dropped: new Set(view.dropped),
        seen: { seen: new Set(view.seen), from: new Map(view.from), unreachable: false },
      };
    }
  } catch {
    read = null;
  }
  // A missing or unreadable file is asked for again after a minute, not after the full KEEP_MS.
  kept = { at: read ? now : now - KEEP_MS + 60_000, read };
  return read;
}

/** For tests: forget the kept file. */
export const forgetItemView = () => { kept = null; };
