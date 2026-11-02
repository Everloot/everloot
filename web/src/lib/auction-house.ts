import { AUCTION_HOUSES, type AuctionHouse } from "@everloot/protocol";
import { AUCTION_AGREEMENT } from "../../../kb/src/auction-history";
import {
  TRIM_FACTOR, TRIM_MIN_DAYS, formatCopper, houseKey, itemListings, itemMarket, parseHouse, validRealm,
  type ItemDays, type MarketState, type MarketValue, type PublicDay, type RealmDays,
} from "../../../kb/src/market";
import { AFTER_LAUNCH, DEFAULT_RULESET, RULESET_SLUGS, isRulesetSlug, mappedRulesets, realmRuleset, type RulesetSlug } from "./realms";

/**
 * The Auction House pages' view of the market rollup (kb/src/market.ts): realms, the rows each one
 * shows, the price moves, and which pages are indexed. Only public values reach here: a realm/item day
 * is public when 3 reporters scanned it. Reporter hashes and install ids are counted, never returned.
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

/** The houses in the game's order; the switch's "All" is the realm-wide blend (`state.realms`). */
export const HOUSES: readonly AuctionHouse[] = AUCTION_HOUSES;
export const houseSlug = (house: AuctionHouse) => house.toLowerCase();

/** `?house=horde`: the house; absent or "all": null (the blend); anything else: undefined (not a house). */
export function houseParam(raw: string | undefined): AuctionHouse | null | undefined {
  if (raw === undefined || raw === "" || raw === "all") return null;
  const house = parseHouse(raw);
  return house && houseSlug(house) === raw ? house : undefined;
}

export interface MarketRow {
  realm: RealmRef;
  /** The house the row is from; null for the realm-wide blend. */
  house: AuctionHouse | null;
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
  house: AuctionHouse | null;
  /** Items with a public value, most units listed first. */
  rows: MarketRow[];
  byItem: Map<number, MarketRow>;
  /** Distinct reporters behind the public days still open (the last 7). */
  reporters: number;
  updatedAt: number | null;
}

/** Reporter groups of one open day, as the rollup counts them: installs behind one upload address are one. */
function groupsOf(installs: ItemDays["open"][string]): Set<string> {
  return new Set(Object.entries(installs).map(([installId, scan]) => scan[5] || `install:${installId}`));
}

/** One realm's view: the realm-wide blend, or one of its houses. The realm's name is the realm-wide one. */
function realmBoard(state: MarketState, key: string, now: Date, house: AuctionHouse | null): RealmBoard | null {
  const stored: RealmDays | undefined = house ? state.houses?.[houseKey(key, house)] : state.realms[key];
  const name = state.realms[key]?.name ?? stored?.name;
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
      if (groups.size < AUCTION_AGREEMENT) continue;
      for (const g of groups) reporters.add(g);
      for (const scan of Object.values(installs)) updatedAt = Math.max(updatedAt ?? 0, scan[4]);
    }
    if (updatedAt !== null) realmUpdated = Math.max(realmUpdated ?? 0, updatedAt);
    const listings = itemListings(state, key, Number(id), now, house)[value.day] ?? null;
    rows.push({ realm, house, value, points, listings, updatedAt });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => b.value.quantity - a.value.quantity || a.value.itemId - b.value.itemId);
  return { realm, house, rows, byItem: new Map(rows.map((r) => [r.value.itemId, r])), reporters: reporters.size, updatedAt: realmUpdated };
}

const boardsMemo = new WeakMap<MarketState, Map<string, { day: number; boards: RealmBoard[] }>>();

/**
 * Every realm with a public value, the busiest first: the realm-wide blend, or with `house` that house's own
 * market on each realm. Kept per rollup, house and day: the store hands back the same rollup until it reloads.
 */
export function realmBoards(state: MarketState, now: Date = new Date(), house: AuctionHouse | null = null): RealmBoard[] {
  const memo = boardsMemo.get(state) ?? new Map<string, { day: number; boards: RealmBoard[] }>();
  boardsMemo.set(state, memo);
  const hit = memo.get(house ?? "all");
  if (hit && hit.day === todayNumber(now)) return hit.boards;
  const keys = house
    ? Object.keys(state.houses ?? {}).filter((k) => k.endsWith(`|${houseSlug(house)}`)).map((k) => k.slice(0, k.lastIndexOf("|")))
    : Object.keys(state.realms);
  const boards = keys
    .map((key) => realmBoard(state, key, now, house))
    .filter((b): b is RealmBoard => b !== null)
    .sort((a, b) => b.rows.length - a.rows.length || a.realm.name.localeCompare(b.realm.name));
  memo.set(house ?? "all", { day: todayNumber(now), boards });
  return boards;
}

/** Items with a public value on each house of a realm (or across realms without `slug`, or a ruleset's realms), for the house switch. */
export function houseCounts(state: MarketState, now: Date, slug?: string, ruleset: RulesetSlug | null = null): Map<AuctionHouse | null, number> {
  const count = (boards: RealmBoard[]) => {
    const mine = slug === undefined ? onRuleset(boards, ruleset) : boards.filter((b) => b.realm.slug === slug);
    return new Set(mine.flatMap((b) => b.rows.map((r) => r.value.itemId))).size;
  };
  return new Map<AuctionHouse | null, number>([null, ...HOUSES].map((h) => [h, count(realmBoards(state, now, h))]));
}

/** One item on one realm in each house that has a public value for it, in the game's house order. */
export function itemByHouse(state: MarketState, now: Date, slug: string, itemId: number): MarketRow[] {
  return HOUSES
    .map((h) => findBoard(realmBoards(state, now, h), slug)?.byItem.get(itemId))
    .filter((r): r is MarketRow => r !== undefined);
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
 * The boards grouped ruleset, then realm (each board is one realm's house or blend): the rulesets in the game's
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
 * One line per ruleset for the hub: the launch rulesets always, Hardcore once a realm is mapped to it, and
 * "forever" when a realm with prices is not in the map yet. Counts come from public values only.
 */
export function rulesetSummaries(state: MarketState, now: Date, house: AuctionHouse | null = null): RulesetSummary[] {
  const groups = boardsByRuleset(realmBoards(state, now, house));
  const mapped = mappedRulesets();
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
  const buckets = house
    ? Object.entries(state.houses ?? {}).filter(([k]) => k.endsWith(`|${houseSlug(house)}`)).map(([, v]) => v)
    : Object.values(state.realms);
  for (const stored of buckets) {
    if (!validRealm(stored.name) || realmSlug(stored.name) !== slug) continue;
    const items = itemId === undefined ? Object.values(stored.items) : [stored.items[String(itemId)]].filter(Boolean) as ItemDays[];
    for (const days of items) for (const installs of Object.values(days.open)) most = Math.max(most, groupsOf(installs).size);
  }
  return Math.min(most, AUCTION_AGREEMENT - 1);
}

/** A slug read back as words, for a realm with nothing public: "argent-dawn" is "Argent Dawn". */
export const slugWords = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/**
 * Indexing rule: a price page is in the sitemap and indexable only when it has a market value, that is a
 * public day (3 reporters) with more than 5 units listed in the last 14 days. Every other price page says noindex.
 */
export const indexable = (value: MarketValue | null | undefined) => Boolean(value && value.market !== null);

/** Every Auction House page the sitemap lists: realms, an item on a realm, an item across realms. */
export function sitemapPaths(boards: RealmBoard[]): string[] {
  const realms: string[] = [];
  const items: string[] = [];
  const cross = new Set<number>();
  for (const board of boards) {
    const listed = board.rows.filter((r) => indexable(r.value));
    if (!listed.length) continue;
    realms.push(realmHref(board.realm));
    for (const row of listed) {
      items.push(itemHref(board.realm, row.value.itemId));
      cross.add(row.value.itemId);
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

/** An item on every realm that has a public value for it, by realm name. */
export function itemAcrossRealms(boards: RealmBoard[], itemId: number): MarketRow[] {
  return boards
    .map((b) => b.byItem.get(itemId))
    .filter((r): r is MarketRow => r !== undefined)
    .sort((a, b) => a.realm.name.localeCompare(b.realm.name));
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export { timeAgo } from "./time";

/** "+12%", "−8%" (a true minus sign). */
export function percent(change: number): string {
  const n = Math.round(change * 100);
  return n > 0 ? `+${n}%` : n < 0 ? `−${Math.abs(n)}%` : "0%";
}
