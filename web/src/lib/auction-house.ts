import { AUCTION_HOUSES, type AuctionHouse } from "@everloot/protocol";
import { AUCTION_AGREEMENT } from "../../../kb/src/auction-history";
import {
  MARKET_LIMITS, TRIM_FACTOR, TRIM_MIN_DAYS, agreed, formatCopper, houseKey, itemListings, itemMarket, parseHouse, realmName, validRealm,
  type ItemDays, type MarketState, type MarketValue, type PublicDay, type RealmDays,
} from "../../../kb/src/market";
import { AFTER_LAUNCH, DEFAULT_RULESET, RULESET_SLUGS, inRegion, isRulesetSlug, mappedRulesets, realmInfo, realmRuleset, rulesetFromName, type RegionFilter, type RulesetSlug } from "./realms";

/**
 * The Auction House pages' view of the market rollup (kb/src/market.ts): realms, the rows each one
 * shows, the price moves, and which pages are indexed. Only public values reach here: a realm/item day
 * is public when 3 reporters scanned it, or one of Everloot's own installs did (kb/src/trusted-source.ts). Reporter hashes and install ids are counted, never returned.
 * Every row is one auction house's price: Alliance, Horde and neutral houses are separate markets. The rollup's
 * house-unknown view (older scans, and days folded before houses were kept apart) may mix houses, so no page shows it.
 */

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const todayNumber = (now: Date) => Math.floor(now.getTime() / DAY_MS);

export const AH_PATH = "/tools/auctions";

export interface RealmRef {
  /** The rollup's key (trimmed, ASCII lower case). */
  key: string;
  /** The first spelling seen. */
  name: string;
  slug: string;
  /** The realm map's ruleset (../data/realms.ts), or "forever" while the map does not list the realm. */
  ruleset: string;
}

/**
 * The realm's URL segment: lower case, apostrophes dropped, spaces and hyphens one dash. "Mal'Ganis" is
 * "malganis". A realm called Item gets "item-realm", since /tools/auctions/item/<id> is the cross-realm page.
 */
export function realmSlug(name: string): string {
  const slug = name.trim().toLowerCase().replace(/['’]/g, "").replace(/[\s-]+/g, "-").replace(/-+$/, "");
  return slug === "item" ? "item-realm" : slug;
}

/** A slug as it may arrive in a URL; null when it cannot be one. */
export function slugParam(raw: string): string | null {
  let slug: string;
  try { slug = decodeURIComponent(raw).toLowerCase(); } catch { return null; }
  return slug.length <= 40 && /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(slug) ? slug : null;
}

export const realmHref = (realm: Pick<RealmRef, "slug">) => `${AH_PATH}/${encodeURIComponent(realm.slug)}`;
export const itemHref = (realm: Pick<RealmRef, "slug">, itemId: number) => `${realmHref(realm)}/${itemId}`;
export const crossRealmHref = (itemId: number) => `${AH_PATH}/item/${itemId}`;

/** An item id as it may arrive in a URL or the search box; null when it is not one. */
export function itemIdParam(raw: string): number | null {
  return /^[1-9]\d{0,9}$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

/**
 * The names the Auction House shows, by item id: the item pages' names (players' agreed name, the game files
 * and wiki match, or the tooltip of an item 3 reporters scanned), read in ./tools/auctions/art.ts. An item
 * without one reads "Item N".
 */
export type ItemNames = ReadonlyMap<number, string>;
export const itemLabel = (itemId: number, names?: ItemNames) => names?.get(itemId) ?? `Item ${itemId}`;

export const money = (copper: number | null) => (copper === null ? "unrecorded" : formatCopper(copper));

/* ---------- Auction houses ---------- */

/** The houses in the game's order; the switch's "All" lists every house's own rows side by side, never a blend. */
export const HOUSES: readonly AuctionHouse[] = AUCTION_HOUSES;
export const houseSlug = (house: AuctionHouse) => house.toLowerCase();

/** `?house=horde`: the house; absent or "all": null (every house, each apart); anything else: undefined (not a house). */
export function houseParam(raw: string | undefined): AuctionHouse | null | undefined {
  if (raw === undefined || raw === "" || raw === "all") return null;
  const house = parseHouse(raw);
  return house && houseSlug(house) === raw ? house : undefined;
}

export interface MarketRow {
  realm: RealmRef;
  /** The auction house the price is for. */
  house: AuctionHouse;
  value: MarketValue;
  /** Public days, oldest first. */
  points: PublicDay[];
  /** Listings (auctions) on the newest public day, while that day is open; null once it closed or before counts were kept. */
  listings: number | null;
  /** When the scans behind the newest open public day were taken (epoch ms); null when only closed days remain. */
  updatedAt: number | null;
}

export interface RealmBoard {
  realm: RealmRef;
  /** The one house the board shows; null when it lists every house's rows apart. */
  house: AuctionHouse | null;
  /** One row per item and house with a public value, most units listed first. */
  rows: MarketRow[];
  /** An item's rows, one per house, in the game's house order. */
  byItem: Map<number, MarketRow[]>;
  /** Distinct items with a public value. */
  items: number;
  /** Distinct reporters behind the public days still open (the last 7). */
  reporters: number;
  updatedAt: number | null;
}

/** Reporter groups of one open day, as the rollup counts them: installs behind one upload address are one. */
function groupsOf(installs: ItemDays["open"][string]): Set<string> {
  return new Set(Object.entries(installs).map(([installId, scan]) => scan[5] || `install:${installId}`));
}

/** One house of one realm, and the reporter groups behind its open public days. */
function houseBoard(state: MarketState, key: string, now: Date, house: AuctionHouse): { board: RealmBoard; groups: Set<string> } | null {
  const stored: RealmDays | undefined = state.houses?.[houseKey(key, house)];
  const name = stored && realmName(state, stored.name);
  if (!stored || !name || !validRealm(name)) return null;
  const realm: RealmRef = { key, name, slug: realmSlug(name), ruleset: realmRuleset(name) };
  const reporters = new Set<string>();
  let realmUpdated: number | null = null;
  const rows: MarketRow[] = [];
  for (const [id, days] of Object.entries(stored.items)) {
    const { value, points } = itemMarket(state, key, Number(id), now, house);
    if (!value) continue;
    let updatedAt: number | null = null;
    for (const installs of Object.values(days.open)) {
      const groups = groupsOf(installs);
      if (!agreed([...groups])) continue;
      for (const g of groups) reporters.add(g);
      for (const scan of Object.values(installs)) updatedAt = Math.max(updatedAt ?? 0, scan[4]);
    }
    if (updatedAt !== null) realmUpdated = Math.max(realmUpdated ?? 0, updatedAt);
    const listings = itemListings(state, key, Number(id), now, house)[value.day] ?? null;
    rows.push({ realm, house, value, points, listings, updatedAt });
  }
  if (!rows.length) return null;
  return { board: board(realm, house, rows, reporters.size, realmUpdated), groups: reporters };
}

const byUnits = (a: MarketRow, b: MarketRow) =>
  b.value.quantity - a.value.quantity || a.value.itemId - b.value.itemId || HOUSES.indexOf(a.house) - HOUSES.indexOf(b.house);

function board(realm: RealmRef, house: AuctionHouse | null, rows: MarketRow[], reporters: number, updatedAt: number | null): RealmBoard {
  rows.sort(byUnits);
  const byItem = new Map<number, MarketRow[]>();
  for (const r of [...rows].sort((a, b) => HOUSES.indexOf(a.house) - HOUSES.indexOf(b.house))) {
    byItem.set(r.value.itemId, [...(byItem.get(r.value.itemId) ?? []), r]);
  }
  return { realm, house, rows, byItem, items: byItem.size, reporters, updatedAt };
}

/** Every house of one realm, each row still its own house's: reporters counted once across houses. */
function allHouses(parts: { board: RealmBoard; groups: Set<string> }[]): RealmBoard {
  const updated = parts.map((p) => p.board.updatedAt).filter((t): t is number => t !== null);
  const groups = new Set(parts.flatMap((p) => [...p.groups]));
  return board(parts[0]!.board.realm, null, parts.flatMap((p) => p.board.rows), groups.size, updated.length ? Math.max(...updated) : null);
}

/** The realm keys that have a bucket for `house`. */
const houseRealmKeys = (state: MarketState, house: AuctionHouse) =>
  Object.keys(state.houses ?? {}).filter((k) => k.endsWith(`|${houseSlug(house)}`)).map((k) => k.slice(0, k.lastIndexOf("|")));

const boardsMemo = new WeakMap<MarketState, Map<string, { day: number; boards: RealmBoard[] }>>();

/**
 * Every realm with a public value, the busiest first: with `house` that house's own market on each realm; without it
 * each realm's houses side by side, every row its own house's. Kept per rollup, house and day: the store hands back
 * the same rollup until it reloads.
 */
export function realmBoards(state: MarketState, now: Date = new Date(), house: AuctionHouse | null = null): RealmBoard[] {
  const memo = boardsMemo.get(state) ?? new Map<string, { day: number; boards: RealmBoard[] }>();
  boardsMemo.set(state, memo);
  const hit = memo.get(house ?? "all");
  if (hit && hit.day === todayNumber(now)) return hit.boards;
  const keys = house ? houseRealmKeys(state, house) : [...new Set(HOUSES.flatMap((h) => houseRealmKeys(state, h)))];
  const boards = keys
    .map((key) => {
      const parts = (house ? [house] : HOUSES).map((h) => houseBoard(state, key, now, h)).filter((p) => p !== null);
      return !parts.length ? null : house ? parts[0]!.board : allHouses(parts);
    })
    .filter((b): b is RealmBoard => b !== null)
    .sort((a, b) => b.items - a.items || a.realm.name.localeCompare(b.realm.name));
  memo.set(house ?? "all", { day: todayNumber(now), boards });
  return boards;
}

/** Items with a public value on each house of a realm (or across realms without `slug`, or a ruleset's realms), for the house switch. */
export function houseCounts(state: MarketState, now: Date, slug?: string, ruleset: RulesetSlug | null = null, region?: RegionFilter): Map<AuctionHouse | null, number> {
  const count = (boards: RealmBoard[]) => {
    const mine = slug === undefined ? onRuleset(boards, ruleset) : boards.filter((b) => b.realm.slug === slug);
    return new Set(mine.filter((b) => inRegion(b.realm.name, region)).flatMap((b) => b.rows.map((r) => r.value.itemId))).size;
  };
  return new Map<AuctionHouse | null, number>([null, ...HOUSES].map((h) => [h, count(realmBoards(state, now, h))]));
}

/** One item on one realm in each house that has a public value for it, in the game's house order. */
export function itemByHouse(state: MarketState, now: Date, slug: string, itemId: number): MarketRow[] {
  return findBoard(realmBoards(state, now), slug)?.byItem.get(itemId) ?? [];
}

export function findBoard(boards: RealmBoard[], slug: string): RealmBoard | null {
  return boards.find((b) => b.realm.slug === slug) ?? null;
}

/* ---------- Rulesets ---------- */

/** The boards of realms the map puts on `ruleset`; null keeps every realm. */
export function onRuleset(boards: RealmBoard[], ruleset: RulesetSlug | null): RealmBoard[] {
  return ruleset === null ? boards : boards.filter((b) => b.realm.ruleset === ruleset);
}

/**
 * The boards grouped ruleset, then realm (each board is one realm's house, or its houses side by side): the rulesets in the game's
 * order, "forever" (realms the map does not list yet) last. Only rulesets with a board are keys.
 */
export function boardsByRuleset(boards: RealmBoard[]): Map<string, RealmBoard[]> {
  const groups = new Map<string, RealmBoard[]>();
  for (const r of [...RULESET_SLUGS, DEFAULT_RULESET]) {
    const mine = boards.filter((b) => b.realm.ruleset === r);
    if (mine.length) groups.set(r, mine);
  }
  return groups;
}

export interface RulesetSummary {
  /** A ruleset's slug, or "forever" for the realms the map does not list yet. */
  ruleset: string;
  /** Whether the realm map puts any realm on this ruleset; always true for "forever". */
  mapped: boolean;
  realms: number;
  /** Distinct items with a public value on its realms. */
  items: number;
  /** The newest scan behind an open public day there (epoch ms); null with none. */
  updatedAt: number | null;
  /** The biggest week moves there, by size, at most `MOVES_SHOWN`. */
  moves: Move[];
}

export const MOVES_SHOWN = 3;

/**
 * One line per ruleset for the hub: the launch rulesets always, Hardcore once a realm is mapped to it or a realm
 * with prices is named for it, and "forever" when a realm with prices has neither. Counts come from public values only.
 */
export function rulesetSummaries(state: MarketState, now: Date, house: AuctionHouse | null = null, region?: RegionFilter): RulesetSummary[] {
  const groups = boardsByRuleset(realmBoards(state, now, house).filter((b) => inRegion(b.realm.name, region)));
  const mapped = new Set<string>([...mappedRulesets(), ...groups.keys()]);
  const shown: string[] = RULESET_SLUGS.filter((r) => !AFTER_LAUNCH.has(r) || mapped.has(r));
  if (groups.has(DEFAULT_RULESET)) shown.push(DEFAULT_RULESET);
  return shown.map((ruleset) => {
    const boards = groups.get(ruleset) ?? [];
    const rows = boards.flatMap((b) => b.rows);
    const updated = boards.map((b) => b.updatedAt).filter((t): t is number => t !== null);
    const moves = rows.map((r) => priceMove(r, 7, now)).filter((m): m is Move => m !== null)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.row.value.itemId - b.row.value.itemId)
      .slice(0, MOVES_SHOWN);
    return {
      ruleset, mapped: !isRulesetSlug(ruleset) || mapped.has(ruleset), realms: boards.length,
      items: new Set(rows.map((r) => r.value.itemId)).size, updatedAt: updated.length ? Math.max(...updated) : null, moves,
    };
  });
}

/**
 * How close a realm or an item there is to public, for the agreement meter: the most reporters any one
 * open day has. Below the gate this is 0 to 2; the realm's name is never read back from the rollup.
 */
export function agreementSoFar(state: MarketState, slug: string, itemId?: number, house: AuctionHouse | null = null): number {
  let most = 0;
  for (const stored of houseBuckets(state, house)) {
    if (!validRealm(stored.name) || realmSlug(stored.name) !== slug) continue;
    const items = itemId === undefined ? Object.values(stored.items) : [stored.items[String(itemId)]].filter(Boolean) as ItemDays[];
    most = Math.max(most, mostOnOneDay(items));
  }
  return Math.min(most, AUCTION_AGREEMENT - 1);
}

/** The stored days of one house on every realm, or of every house; never the house-unknown view. */
function houseBuckets(state: MarketState, house: AuctionHouse | null): RealmDays[] {
  return Object.entries(state.houses ?? {}).filter(([k]) => !house || k.endsWith(`|${houseSlug(house)}`)).map(([, v]) => v);
}

/** The most reporters on any one item's open day. */
function mostOnOneDay(items: ItemDays[]): number {
  let most = 0;
  for (const days of items) for (const installs of Object.values(days.open)) most = Math.max(most, groupsOf(installs).size);
  return most;
}

/**
 * Forever's realm list names a realm like "CAMWOW US1 Realm 4 PvP": a word, a region and number, "Realm" and a
 * number, then the ruleset. A realm with no public price is listed by name only when its name has that shape or
 * the realm map lists it, so one upload cannot put any text it likes on the page.
 */
const FOREVER_REALM_NAME = /^[A-Za-z0-9]+ [A-Za-z]{2}\d+ Realm \d+[\s-]/;
const listableName = (name: string) => validRealm(name) && (realmInfo(name) !== null || (FOREVER_REALM_NAME.test(name) && rulesetFromName(name) !== null));

export interface PendingRealm { realm: string; slug: string; reporters: number }

/**
 * Realms with scans but no public price yet, and how close each is: the most reporters (upload addresses, so
 * installs behind one address count once) that scanned one item in one house there on one open day, the last 7. That is 1 or
 * 2: at 3 the day is public and the realm has a board. A count only, never a value. The closest first, at most
 * `limit` (the rollup keeps no more realms than that anyway).
 */
export function pendingRealms(state: MarketState, now: Date = new Date(), limit: number = MARKET_LIMITS.realms): PendingRealm[] {
  const public_ = new Set(realmBoards(state, now).map((b) => b.realm.key));
  const most = new Map<string, number>();
  for (const [bucketKey, stored] of Object.entries(state.houses ?? {})) {
    const key = bucketKey.slice(0, bucketKey.lastIndexOf("|"));
    most.set(key, Math.max(most.get(key) ?? 0, mostOnOneDay(Object.values(stored.items))));
  }
  const out: PendingRealm[] = [];
  for (const [key, count] of most) {
    const name = realmName(state, key);
    if (public_.has(key) || !listableName(name)) continue;
    const reporters = Math.min(count, AUCTION_AGREEMENT - 1);
    if (reporters > 0) out.push({ realm: name, slug: realmSlug(name), reporters });
  }
  return out.sort((a, b) => b.reporters - a.reporters || a.realm.localeCompare(b.realm)).slice(0, Math.max(0, limit));
}

/** A slug read back as words, for a realm with nothing public: "argent-dawn" is "Argent Dawn". */
export const slugWords = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/**
 * Indexing rule: a price page is in the sitemap and indexable only when it has a market value, that is a
 * public day (3 reporters, or Everloot's own scans) with more than 5 units listed in the last 14 days. Every other price page says noindex.
 */
export const indexable = (value: MarketValue | null | undefined) => Boolean(value && value.market !== null);

/** Every Auction House page the sitemap lists: realms, an item on a realm, an item across realms. */
export function sitemapPaths(boards: RealmBoard[]): string[] {
  const realms: string[] = [];
  const items: string[] = [];
  const cross = new Set<number>();
  for (const board of boards) {
    const listed = [...new Set(board.rows.filter((r) => indexable(r.value)).map((r) => r.value.itemId))];
    if (!listed.length) continue;
    realms.push(realmHref(board.realm));
    for (const itemId of listed) {
      items.push(itemHref(board.realm, itemId));
      cross.add(itemId);
    }
  }
  return [...realms, ...items, ...[...cross].sort((a, b) => a - b).map(crossRealmHref)];
}

/** Public days that can carry a move: not thin, and not an outlier the market value trims. */
function solidDays(points: PublicDay[]): PublicDay[] {
  const solid = points.filter((p) => !p.thin);
  if (solid.length < TRIM_MIN_DAYS) return solid;
  const sorted = solid.map((p) => p.market).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const historical = sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return solid.filter((p) => p.market <= historical * TRIM_FACTOR && p.market * TRIM_FACTOR >= historical);
}

export type MoveSpan = 1 | 7;

export interface Move {
  row: MarketRow;
  from: PublicDay;
  to: PublicDay;
  /** (to - from) / from. */
  change: number;
}

/**
 * The market value's move over a day or a week: the newest solid day (today or yesterday) against the
 * solid day `span` days before it (a week allows up to three days earlier, as scans are not daily).
 */
export function priceMove(row: MarketRow, span: MoveSpan, now: Date): Move | null {
  const solid = solidDays(row.points);
  const to = solid.at(-1);
  if (!to || todayNumber(now) - dayNumber(to.day) > 1) return null;
  const target = dayNumber(to.day) - span;
  const slack = span === 1 ? 0 : 3;
  const from = [...solid].reverse().find((p) => dayNumber(p.day) <= target && dayNumber(p.day) >= target - slack);
  if (!from || from.market <= 0 || from.market === to.market) return null;
  return { row, from, to, change: (to.market - from.market) / from.market };
}

export const SPARK_DAYS = 14;
export const SPARK_BOX = { width: 64, height: 16 } as const;

/**
 * The tiny trend line in a results row: the market value of the solid days (the ones a move compares) in the
 * last SPARK_DAYS, placed by day, as SVG polyline points in SPARK_BOX. Null with fewer than two such days.
 */
export function sparkline(points: PublicDay[], now: Date): string | null {
  const last = todayNumber(now);
  const recent = solidDays(points).filter((p) => last - dayNumber(p.day) < SPARK_DAYS);
  if (recent.length < 2) return null;
  const { width, height } = SPARK_BOX;
  const values = recent.map((p) => p.market);
  const low = Math.min(...values), high = Math.max(...values);
  const x = (day: string) => ((Math.min(last, dayNumber(day)) - (last - SPARK_DAYS + 1)) / (SPARK_DAYS - 1)) * (width - 2) + 1;
  const y = (v: number) => (high === low ? height / 2 : 1 + (1 - (v - low) / (high - low)) * (height - 2));
  return recent.map((p) => `${x(p.day).toFixed(1)},${y(p.market).toFixed(1)}`).join(" ");
}

/** An item in every house of every realm that has a public value for it, by realm name, then the game's house order. */
export function itemAcrossRealms(boards: RealmBoard[], itemId: number): MarketRow[] {
  return boards
    .flatMap((b) => b.byItem.get(itemId) ?? [])
    .sort((a, b) => a.realm.name.localeCompare(b.realm.name) || HOUSES.indexOf(a.house) - HOUSES.indexOf(b.house));
}

/** The row a single-price view leads with: the house with the most units listed, so the page names a house, never a blend. */
export function busiestHouse(rows: readonly MarketRow[]): MarketRow | null {
  return [...rows].sort(byUnits)[0] ?? null;
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export { timeAgo } from "./time";

/** "+12%", "−8%" (a true minus sign). */
export function percent(change: number): string {
  const n = Math.round(change * 100);
  return n > 0 ? `+${n}%` : n < 0 ? `−${Math.abs(n)}%` : "0%";
}
