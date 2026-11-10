/**
 * Forever market values from full auction scans players uploaded on purpose.
 * Design: docs/design/specs/2026-10-16-forever-market-design.md
 *
 * A realm/item day is public when 3 reporters scanned it. A reporter is one upload address (the
 * intake route stores only a keyed hash of it, never the address), so many installs behind one
 * address count once: a day's value is the median of the reporters' values, each the median of
 * that reporter's installs' last scans. Market value is a weighted mean of the public days up to 14 calendar days
 * old, newer days weighing more; historical is the median of the public days in the last 60 calendar days.
 *
 * Outliers: with 5 or more solid days, a day further than TRIM_FACTOR from historical (either way) is
 * trimmed from market value, minimum and quantity, so a few forged days cannot move the price.
 * Thin days (THIN_UNITS or fewer units listed) show in the history but never feed market value.
 * Install age is not used as a weight: ids are anonymous and random, an attacker can age one by
 * waiting, and the reporter rule plus the trim already bound what a new install can do.
 *
 * Late arrivals: the last OPEN_DAYS days keep one scan per install, so an upload that reaches the
 * site up to a week late still counts, and a day below 3 reporters is not published. A day older
 * than that is closed and ignores later scans.
 *
 * Size: realms, items per realm, installs per item-day and the open install scans are capped (MARKET_LIMITS),
 * so the rollup cannot grow with what a stranger uploads; a scan a cap drops is counted (FoldStats) so the
 * cron can say so. Days past the open window collapse to their public medians (or are dropped if they never
 * were). MARKET_MAX_BYTES is the last guard: past it, trimMarket drops the oldest closed days until the
 * rollup fits, so history shortens before prices stop.
 *
 * Auction houses: the game files list Alliance, Horde and neutral (Blackwater) houses with different
 * cuts, so they are separate markets. Every scan still feeds the realm-wide view (`realms`, what every
 * reader got before houses were recorded). A scan that names its house, or failing that its scanner's
 * faction, also feeds that house's own view (`houses`), with the same 3-reporter rule per house.
 *
 * Trusted installs (trusted-source.ts): while few players upload, a scan from one of Everloot's own installs
 * is folded with TRUSTED_REPORTER as its reporter, and a day with that reporter in it is public under 3.
 */
import { AUCTION_HOUSES, UPLOAD_LIMITS, validRealm, type AuctionHouse } from "@everloot/protocol";
import { z } from "zod";
import { AUCTION_AGREEMENT } from "./auction-history.js";
import { TRUSTED_REPORTER, TRUSTED_SOURCE_LABEL } from "./trusted-source.js";

export const MARKET_WINDOW_DAYS = 14;
export const HISTORY_DAYS = 60;
/** Today and the six days before take new scans; a later upload for an older day is ignored. */
export const OPEN_DAYS = 7;
/** An item day with this many units listed or fewer is thin: shown, never averaged into market value. */
export const THIN_UNITS = 5;
/** Days further than this factor from historical are trimmed (needs TRIM_MIN_DAYS solid days). */
export const TRIM_FACTOR = 3;
export const TRIM_MIN_DAYS = 5;
/** Most rows one realm's price file carries: the items with the most units listed. */
export const MAX_PRICE_ROWS = 2000;
export const MARKET_LIMITS = {
  realms: 40,
  itemsPerRealm: 20_000,
  installsPerItemDay: 25,
  /**
   * Open install scans across every realm, about 92 bytes each. Closed days do not count: they are bounded by
   * items × HISTORY_DAYS (about 36 bytes each) and, past MARKET_MAX_BYTES, trimmed oldest first. Counting them
   * here let a realm's history crowd out its new scans within days.
   */
  entries: 60_000,
  /** Distinct realms read from one upload (the protocol's limit). */
  realmsPerUpload: UPLOAD_LIMITS.realmsPerUpload as number,
};
/** market.json is refused above this size, whatever the other caps allow. */
export const MARKET_MAX_BYTES = 10 * 1024 * 1024;
const DAY_MS = 86_400_000;

/** A realm name, as the protocol defines it: letters, digits, spaces, apostrophes and hyphens, 2 to 40 characters once trimmed. */
export { validRealm };

/** One install's last scan of an item on an open day: [minUnit, marketUnit, quantity, auctions, capturedAt epoch ms, reporter]. */
export type InstallScan = [number, number, number, number, number, string];
/** A closed day's public values: [min, market, quantity, reporters]. */
export type ClosedDay = [number, number, number, number];

export interface ItemDays {
  open: Record<string, Record<string, InstallScan>>;
  closed: Record<string, ClosedDay>;
}

export interface RealmDays { name: string; items: Record<string, ItemDays> }

export interface MarketState {
  version: 3;
  /** Keyed by the trimmed realm with ASCII letters lower-cased (as Lua's string.lower does); `name` is the first spelling seen. Every house blended. */
  realms: Record<string, RealmDays>;
  /** One auction house of a realm, keyed by `houseKey`. Only scans that named a house or a faction; absent until one did. */
  houses?: Record<string, RealmDays>;
}

export interface PublicDay { day: string; min: number; market: number; quantity: number; reporters: number; thin: boolean }

export interface MarketValue {
  itemId: number;
  /** Null when no solid public day falls in the last 14: the value is unrecorded, not zero. */
  market: number | null;
  min: number;
  historical: number;
  quantity: number;
  day: string;
  ageDays: number;
  reporters: number;
  /** The newest day lists THIN_UNITS units or fewer. */
  thin: boolean;
}

export function emptyMarket(): MarketState {
  return { version: 3, realms: {} };
}

/** ASCII-only lower case, so the site, the companion and the addon's string.lower agree on every realm. */
export function realmKey(realm: string): string {
  return realm.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** The key of one auction house of a realm: `forever|horde`. */
export function houseKey(realm: string, house: AuctionHouse): string {
  return `${realmKey(realm)}|${house.toLowerCase()}`;
}

/** An auction house named in any case (`horde`, `Horde`), or null. */
export function parseHouse(text: string): AuctionHouse | null {
  const lower = text.trim().toLowerCase();
  return AUCTION_HOUSES.find((h) => h.toLowerCase() === lower) ?? null;
}

const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const today = (now: Date) => Math.floor(now.getTime() / DAY_MS);

function dayNumber(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : null;
}

/** Days from the last 60 up to one day ahead (client clocks drift). */
function inHistory(n: number, now: Date): boolean {
  return n > today(now) - HISTORY_DAYS && n <= today(now) + 1;
}

const isOpen = (n: number, now: Date) => n > today(now) - OPEN_DAYS;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * The fold reads only what this schema accepts: an upload's auction parts, with the reporter hash the
 * intake route added. Prices are per unit and at least 1 copper (a buyout below its stack size is not a price).
 */
const unit = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const scanItem = z.tuple([z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), unit, unit, unit, unit]);
const scanRecord = z.object({
  kind: z.literal("auction_snapshot"),
  installId: z.string().min(8).max(64),
  capturedAt: z.string().datetime({ offset: true }),
  realm: z.string().refine(validRealm),
  faction: z.enum(["Alliance", "Horde"]).optional(),
  house: z.enum(AUCTION_HOUSES).optional(),
  reporter: z.string().regex(/^[a-f0-9]{16}$/).optional(),
  items: z.array(z.unknown()).max(1000),
});
type ScanRecord = z.infer<typeof scanRecord>;

/**
 * The house a scan counts for: the one it read, else its scanner's faction (a faction can only use its
 * own faction's house and the neutral ones, and most scans happen in a capital). Null for older scans.
 */
function houseOf(row: ScanRecord): AuctionHouse | null {
  return row.house ?? row.faction ?? null;
}

/**
 * One upload's auction parts, at most `limit` distinct realms: a stranger cannot make one file name
 * dozens of realms. `reporter` is the intake route's keyed hash of the upload address. Records that
 * do not parse are dropped.
 */
export function uploadScans(records: readonly unknown[], reporter?: string, limit = MARKET_LIMITS.realmsPerUpload): ScanRecord[] {
  const realms = new Set<string>();
  const kept: ScanRecord[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== "auction_snapshot") continue;
    const parsed = scanRecord.safeParse({ ...(raw as object), reporter });
    if (!parsed.success) continue;
    const key = realmKey(parsed.data.realm);
    if (!realms.has(key) && realms.size >= limit) continue;
    realms.add(key);
    kept.push(parsed.data);
  }
  return kept;
}

/** Reporter groups: installs sharing an upload address vote once. Without a reporter an install is its own group. */
function reporterGroups(installs: Record<string, InstallScan>): InstallScan[][] {
  const groups = new Map<string, InstallScan[]>();
  for (const [installId, scan] of Object.entries(installs)) {
    const key = scan[5] || `install:${installId}`;
    groups.set(key, [...(groups.get(key) ?? []), scan]);
  }
  return [...groups.values()];
}

/** A day is public at AUCTION_AGREEMENT reporters, or with Everloot's own installs among them (trusted-source.ts). */
export function agreed(reporters: readonly string[]): boolean {
  return reporters.length >= AUCTION_AGREEMENT || reporters.includes(TRUSTED_REPORTER);
}

const groupKeys = (groups: InstallScan[][]) => groups.map((g) => g[0]![5]);

function publicOf(installs: Record<string, InstallScan>): ClosedDay | null {
  const groups = reporterGroups(installs);
  if (!agreed(groupKeys(groups))) return null;
  const per = (index: number) => median(groups.map((g) => median(g.map((s) => s[index] as number))));
  return [per(0), per(1), per(2), groups.length];
}

/** Every bucket of the state: the realm-wide views, then the per-house views. */
const buckets = (state: MarketState): Record<string, RealmDays>[] => [state.realms, state.houses ?? {}];

/** Open install scans in the state: what MARKET_LIMITS.entries bounds. */
function entryCount(state: MarketState): number {
  let n = 0;
  for (const realm of buckets(state).flatMap((map) => Object.values(map))) {
    for (const days of Object.values(realm.items)) {
      for (const installs of Object.values(days.open)) n += Object.keys(installs).length;
    }
  }
  return n;
}

/** Bytes of the serialised rollup, for the MARKET_MAX_BYTES guard. */
export const marketBytes = (state: MarketState) => Buffer.byteLength(JSON.stringify(state));

/** What a fold left out, so a full rollup is reported rather than silent. */
export interface FoldStats {
  /** Item scans a cap dropped (a new realm, item, install or entry past its limit). Late scans for closed days are not counted. */
  dropped: number;
}

/**
 * Fold auction_snapshot records into the state, then close days that left the open window and prune
 * days that left the 60-day window. A scan for a day that is already closed is ignored. A record that
 * would exceed a cap (new realm, new item, an install past the day's limit, or an entry past the total)
 * is dropped and counted in `stats`; scans from installs already counted still update. Every scan is folded
 * into the realm-wide view before any is folded into a house's view, so the caps favour the realm-wide view.
 * A scan from a `trusted` install, and any open scan already stored from one, gets TRUSTED_REPORTER as its reporter.
 */
export function foldMarket(previous: MarketState, records: readonly unknown[], now: Date, limits: Partial<typeof MARKET_LIMITS> = {}, stats?: FoldStats, trusted: ReadonlySet<string> = new Set()): MarketState {
  const cap = { ...MARKET_LIMITS, ...limits };
  const state: MarketState = structuredClone(previous);
  let entries = entryCount(state);
  const itemCounts = new Map<RealmDays, number>();
  const countOf = (realm: RealmDays) => itemCounts.get(realm) ?? Object.keys(realm.items).length;
  const drop = (n = 1) => { if (stats) stats.dropped += n; };
  /** One install's scan of one item into one bucket. False when the bucket is new and the map is full. */
  const place = (map: Record<string, RealmDays>, key: string, maxKeys: number, name: string, day: string, itemId: number, installId: string, scan: InstallScan): boolean => {
    const existing = map[key]?.items[String(itemId)];
    if (existing?.closed[day]) return true;
    if (!map[key]) {
      if (Object.keys(map).length >= maxKeys) return false;
      map[key] = { name, items: {} };
    }
    const realm = map[key]!;
    if (!existing && countOf(realm) >= cap.itemsPerRealm) { drop(); return true; }
    if (!existing) itemCounts.set(realm, countOf(realm) + 1);
    const days = (realm.items[String(itemId)] ??= { open: {}, closed: {} });
    const installs = (days.open[day] ??= {});
    const prev = installs[installId];
    if (prev && prev[4] >= scan[4]) return true;
    if (!prev && (Object.keys(installs).length >= cap.installsPerItemDay || entries >= cap.entries)) { drop(); return true; }
    if (!prev) entries++;
    installs[installId] = scan;
    return true;
  };
  const scans: { row: ScanRecord; at: number; day: string }[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== "auction_snapshot") continue;
    const parsed = scanRecord.safeParse(raw);
    if (!parsed.success) continue;
    const at = Date.parse(parsed.data.capturedAt);
    const n = Math.floor(at / DAY_MS);
    if (inHistory(n, now)) scans.push({ row: parsed.data, at, day: dayString(n) });
  }
  // Realm-wide first, for every record, so a full cap never trades a realm-wide entry for a house entry.
  for (const byHouse of [false, true]) {
    for (const { row, at, day } of scans) {
      const house = houseOf(row);
      if (byHouse && (!house || !state.realms[realmKey(row.realm)])) continue;
      const map = byHouse ? (state.houses ??= {}) : state.realms;
      const key = byHouse ? houseKey(row.realm, house!) : realmKey(row.realm);
      const maxKeys = byHouse ? cap.realms * AUCTION_HOUSES.length : cap.realms;
      for (let i = 0; i < row.items.length; i++) {
        const scan = scanItem.safeParse(row.items[i]);
        if (!scan.success) continue;
        const [itemId, auctions, quantity, minUnit, marketUnit] = scan.data;
        const reporter = trusted.has(row.installId) ? TRUSTED_REPORTER : row.reporter ?? "";
        const values: InstallScan = [minUnit, marketUnit, quantity, auctions, at, reporter];
        if (!place(map, key, maxKeys, row.realm.trim(), day, itemId, row.installId, values)) { drop(row.items.length - i); break; }
      }
    }
  }
  for (const map of buckets(state)) {
    for (const [key, realm] of Object.entries(map)) {
      for (const [itemId, days] of Object.entries(realm.items)) {
        for (const [day, installs] of Object.entries(days.open)) {
          for (const [installId, scan] of Object.entries(installs)) if (trusted.has(installId)) scan[5] = TRUSTED_REPORTER;
          const n = dayNumber(day)!;
          if (isOpen(n, now) && inHistory(n, now)) continue;
          delete days.open[day];
          const closed = publicOf(installs);
          if (closed && inHistory(n, now)) days.closed[day] = closed;
        }
        for (const day of Object.keys(days.closed)) if (!inHistory(dayNumber(day)!, now)) delete days.closed[day];
        if (!Object.keys(days.open).length && !Object.keys(days.closed).length) delete realm.items[itemId];
      }
      if (!Object.keys(realm.items).length) delete map[key];
    }
  }
  if (state.houses && !Object.keys(state.houses).length) delete state.houses;
  return state;
}

/**
 * Drop the oldest closed days, one day at a time across every realm and house, until the serialised state
 * fits in `maxBytes`. Open days are never dropped: they are the scans still waiting for their third reporter.
 * The input is left as it was. `trimmedDays` says how many days went, so the cron can report it.
 */
export function trimMarket(state: MarketState, maxBytes: number): { state: MarketState; trimmedDays: number } {
  let bytes = marketBytes(state);
  if (bytes <= maxBytes) return { state, trimmedDays: 0 };
  const out: MarketState = structuredClone(state);
  let trimmedDays = 0;
  while (bytes > maxBytes) {
    let oldest: string | null = null;
    for (const realm of buckets(out).flatMap((map) => Object.values(map))) {
      for (const days of Object.values(realm.items)) {
        for (const day of Object.keys(days.closed)) if (oldest === null || day < oldest) oldest = day;
      }
    }
    if (oldest === null) break;
    for (const map of buckets(out)) {
      for (const [key, realm] of Object.entries(map)) {
        for (const [itemId, days] of Object.entries(realm.items)) {
          delete days.closed[oldest];
          if (!Object.keys(days.open).length && !Object.keys(days.closed).length) delete realm.items[itemId];
        }
        if (!Object.keys(realm.items).length) delete map[key];
      }
    }
    if (out.houses && !Object.keys(out.houses).length) delete out.houses;
    trimmedDays++;
    bytes = marketBytes(out);
  }
  return { state: out, trimmedDays };
}

function publicDays(days: ItemDays, now: Date): PublicDay[] {
  const points: PublicDay[] = [];
  const add = (day: string, [min, market, quantity, reporters]: ClosedDay) =>
    points.push({ day, min, market, quantity, reporters, thin: quantity <= THIN_UNITS });
  for (const [day, values] of Object.entries(days.closed)) if (inHistory(dayNumber(day)!, now)) add(day, values);
  for (const [day, installs] of Object.entries(days.open)) {
    const values = inHistory(dayNumber(day)!, now) ? publicOf(installs) : null;
    if (values) add(day, values);
  }
  return points.sort((a, b) => a.day.localeCompare(b.day));
}

function valueOf(itemId: number, points: PublicDay[], now: Date): MarketValue | null {
  if (!points.length) return null;
  const solid = points.filter((p) => !p.thin);
  const historical = median((solid.length ? solid : points).map((p) => p.market));
  // With enough solid days, one that sits far from the rest is an outlier, not a price move.
  const trimmed = new Set<PublicDay>();
  if (solid.length >= TRIM_MIN_DAYS) {
    for (const p of solid) if (p.market > historical * TRIM_FACTOR || p.market * TRIM_FACTOR < historical) trimmed.add(p);
  }
  const trusted = points.filter((p) => !trimmed.has(p));
  const newest = trusted.at(-1)!;
  let weighted = 0;
  let weights = 0;
  for (const p of trusted) {
    if (p.thin) continue;
    // A day ahead of the server clock (client drift) counts as today.
    const age = Math.max(0, today(now) - dayNumber(p.day)!);
    if (age > MARKET_WINDOW_DAYS) continue;
    const weight = MARKET_WINDOW_DAYS + 1 - age;
    weighted += p.market * weight;
    weights += weight;
  }
  return {
    itemId,
    market: weights ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(weighted / weights)) : null,
    min: newest.min,
    historical,
    quantity: newest.quantity,
    day: newest.day,
    ageDays: Math.max(0, today(now) - dayNumber(newest.day)!),
    reporters: newest.reporters,
    thin: newest.thin,
  };
}

/** The realm-wide view, or one house's view when `house` is given. */
function bucketOf(state: MarketState, realm: string, house?: AuctionHouse | null): RealmDays | undefined {
  return house ? state.houses?.[houseKey(realm, house)] : state.realms[realmKey(realm)];
}

export function itemMarket(state: MarketState, realm: string, itemId: number, now: Date, house?: AuctionHouse | null): { value: MarketValue | null; points: PublicDay[] } {
  const days = bucketOf(state, realm, house)?.items[String(itemId)];
  const points = days ? publicDays(days, now) : [];
  return { value: valueOf(itemId, points, now), points };
}

/**
 * Listings (auctions) of an item on each public day still open: the median of the reporters' counts, as the
 * prices are. A closed day keeps no count, so a day older than the open window has none. A count only: no
 * listing, seller or buyer is kept.
 */
export function itemListings(state: MarketState, realm: string, itemId: number, now: Date, house?: AuctionHouse | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [day, installs] of Object.entries(bucketOf(state, realm, house)?.items[String(itemId)]?.open ?? {})) {
    if (!inHistory(dayNumber(day)!, now)) continue;
    const groups = reporterGroups(installs);
    if (agreed(groupKeys(groups))) out[day] = median(groups.map((g) => median(g.map((s) => s[3]))));
  }
  return out;
}

/** Every item with a public value on the realm (or on one of its houses), most units first. */
export function realmMarket(state: MarketState, realm: string, now: Date, house?: AuctionHouse | null): MarketValue[] {
  const items = bucketOf(state, realm, house)?.items ?? {};
  return Object.entries(items)
    .map(([itemId, days]) => valueOf(Number(itemId), publicDays(days, now), now))
    .filter((v): v is MarketValue => v !== null)
    .sort((a, b) => b.quantity - a.quantity || a.itemId - b.itemId);
}

/** Realms that hold any public value, by display name. */
export function marketRealms(state: MarketState, now: Date = new Date()): string[] {
  // A realm name is free text from an upload; it is published only if it passes the realm rules and
  // 3 reporters made a value public there.
  return Object.values(state.realms)
    .filter((r) => validRealm(r.name) && Object.values(r.items).some((days) => publicDays(days, now).length > 0))
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Per realm (display name), the houses that hold a public value of their own, in AUCTION_HOUSES order. */
export function marketHouses(state: MarketState, now: Date = new Date()): Record<string, AuctionHouse[]> {
  const out: Record<string, AuctionHouse[]> = {};
  for (const [key, bucket] of Object.entries(state.houses ?? {})) {
    const house = parseHouse(key.slice(key.lastIndexOf("|") + 1));
    if (!house || !validRealm(bucket.name) || !Object.values(bucket.items).some((days) => publicDays(days, now).length > 0)) continue;
    const name = realmName(state, bucket.name);
    out[name] = [...(out[name] ?? []), house].sort((a, b) => AUCTION_HOUSES.indexOf(a) - AUCTION_HOUSES.indexOf(b));
  }
  return out;
}

/** How a realm name was read against the rollup (resolveRealm). */
export type RealmLookup =
  | { status: "exact"; realm: string }
  | { status: "alias"; realm: string; asked: string }
  | { status: "ambiguous"; asked: string; candidates: string[] }
  | { status: "unknown"; asked: string; candidates: string[] };

/** Most realms an unknown-realm answer suggests. */
export const REALM_CANDIDATES = 5;

const realmWords = (realm: string) => realmKey(realm).split(/\s+/).filter(Boolean);

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}

/** The listed realms closest to a name: most words in common first, then the fewest letters changed. */
function closestRealms(listed: readonly string[], asked: string): string[] {
  const want = new Set(realmWords(asked));
  const scored = listed.map((name) => ({
    name,
    shared: realmWords(name).filter((w) => want.has(w)).length,
    distance: editDistance(realmKey(asked), realmKey(name)),
  }));
  scored.sort((a, b) => b.shared - a.shared || a.distance - b.distance || a.name.localeCompare(b.name));
  return scored.slice(0, REALM_CANDIDATES).map((s) => s.name);
}

/**
 * The realm a name means, read the way the fold keys realms (realmKey). A name the rollup holds is exact. Otherwise a
 * name that is the end of exactly one public realm's full name, in whole words and at least two of them, is an alias
 * for it: "US1 Realm 4 PvP" for "CAMWOW US1 Realm 4 PvP". The words it ends in are the realm's own, so an alias never
 * crosses a ruleset, and a realm is never merged with another: the answer reads the one realm the name resolved to.
 * A name that ends several realms' names is ambiguous; anything else is unknown, with the closest public realms.
 */
export function resolveRealm(state: MarketState, asked: string, now: Date = new Date()): RealmLookup {
  const name = asked.trim();
  const own = state.realms[realmKey(name)];
  if (own) return { status: "exact", realm: own.name };
  const listed = marketRealms(state, now);
  const want = realmWords(name);
  const tail = ` ${want.join(" ")}`;
  const matches = want.length >= 2 ? listed.filter((realm) => ` ${realmWords(realm).join(" ")}`.endsWith(tail)) : [];
  if (matches.length === 1) return { status: "alias", realm: matches[0]!, asked: name };
  if (matches.length > 1) return { status: "ambiguous", asked: name, candidates: matches };
  return { status: "unknown", asked: name, candidates: closestRealms(listed, name) };
}

/** The realm a lookup settled on, or null when it named none or several. */
export function lookupRealm(lookup: RealmLookup): string | null {
  return lookup.status === "exact" || lookup.status === "alias" ? lookup.realm : null;
}

/** What an answer says about how the realm was read: nothing for an exact name. */
export function realmLookupText(lookup: RealmLookup): string | null {
  switch (lookup.status) {
    case "exact":
      return null;
    case "alias":
      return `Read "${lookup.asked}" as ${lookup.realm}: the only realm with public prices whose full name ends that way.`;
    case "ambiguous":
      return `Ambiguous realm "${lookup.asked}": several realms' full names end that way, and they are separate markets. Ask again with one of: ${lookup.candidates.join(", ")}.`;
    case "unknown":
      return lookup.candidates.length
        ? `Unknown realm "${lookup.asked}": no scan names a realm that way, so this is not a measured empty market. Closest realms with public prices: ${lookup.candidates.join(", ")}. Ask again with the full name as the game's realm list shows it.`
        : `Unknown realm "${lookup.asked}": no scan names a realm that way, and no realm has public prices yet. This is not a measured empty market.`;
  }
}

/** The structured page's account of the lookup: `realmStatus`, and the name asked or the candidates when they matter. */
export function realmLookupFields(lookup: RealmLookup): { realmStatus: RealmLookup["status"]; askedRealm?: string; candidates?: string[] } {
  if (lookup.status === "exact") return { realmStatus: "exact" };
  if (lookup.status === "alias") return { realmStatus: "alias", askedRealm: lookup.asked };
  return { realmStatus: lookup.status, candidates: lookup.candidates };
}

/** The realm's display name: the first spelling seen, or the name as asked. */
export function realmName(state: MarketState, realm: string): string {
  return state.realms[realmKey(realm)]?.name ?? realm.trim();
}

/**
 * The companion's price file for one realm: [itemId, market|null, min, historical, quantity, day, reporters].
 * Tuples keep the file small; at most `limit` rows, the items with the most units listed. A thin item
 * has no market value (null), only its minimum.
 */
export function marketPrices(state: MarketState, realm: string, now: Date, limit = MAX_PRICE_ROWS, house?: AuctionHouse | null) {
  return {
    realm: realmName(state, realm),
    ...(house ? { house } : {}),
    items: realmMarket(state, realm, now, house).slice(0, limit)
      .map((v) => [v.itemId, v.market, v.min, v.historical, v.quantity, v.day, v.reporters] as const),
  };
}

export function formatCopper(value: number): string {
  const gold = Math.floor(value / 10000);
  const silver = Math.floor((value % 10000) / 100);
  const coins = value % 100;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}g`);
  if (silver > 0 || gold > 0) parts.push(`${silver}s`);
  parts.push(`${coins}c`);
  return parts.join(" ");
}

export const MARKET_RULE =
  "A day is public when 3 reporters scanned this item on this realm with a full scan (installs behind one upload address count once); each value is the median of their last scans that day. While few players upload, a day Everloot's own installs scanned is public with fewer, and its reporters say so. " +
  "Market value is a weighted mean of the public days up to 14 calendar days old, newer days weighing more, skipping thin days (5 units listed or fewer) and days far from the historical value. Historical is the median of the public days in the last 60 calendar days, of those that are not thin when there are any.";

/** "3 reporters", or "1 reporter (includes Everloot's own scans)" for a day public under 3 because a trusted install scanned it. */
export function reportersText(reporters: number): string {
  const count = `${reporters} reporter${reporters === 1 ? "" : "s"}`;
  return reporters < AUCTION_AGREEMENT ? `${count} (${TRUSTED_SOURCE_LABEL})` : count;
}

/** One public day as the answers list it: market_value's history and auction_history's full-scan days. */
export function scanDayLine(p: PublicDay): string {
  return `${p.day}  value ${formatCopper(p.market)}  min ${formatCopper(p.min)}  ${p.quantity} units${p.thin ? " (thin)" : ""}  ${reportersText(p.reporters)}`;
}

export function handleMarketValue(args: { realm: string; itemId: number }, state: MarketState | null, now: Date): string {
  if (!args.realm.trim()) return "Name a realm.";
  if (!Number.isInteger(args.itemId) || args.itemId < 1) return "Name an item id.";
  if (!state) return "Market values are unavailable. They are unrecorded, not zero.";
  const lookup = resolveRealm(state, args.realm, now);
  const realm = lookupRealm(lookup);
  const note = realmLookupText(lookup);
  if (!realm) return [`${args.realm.trim()} item ${args.itemId}`, note!].join("\n");
  const { value, points } = itemMarket(state, realm, args.itemId, now);
  const lines = [`${lookup.status === "alias" ? realm : args.realm.trim()} item ${args.itemId}`, ...(note ? [note] : []), MARKET_RULE];
  if (!value) {
    lines.push("No public market value yet. A day becomes public when 3 reporters scanned this item.");
    return lines.join("\n");
  }
  lines.push(
    `Market value: ${value.market === null ? "unrecorded (no solid public day in the last 14)" : formatCopper(value.market)}`,
    `Minimum buyout: ${formatCopper(value.min)} (${value.day}, ${value.ageDays} days ago, ${reportersText(value.reporters)})`,
    `Historical: ${formatCopper(value.historical)}`,
    `Units listed: ${value.quantity}${value.thin ? " (thin: not counted in the market value)" : ""}`,
    "History:",
    ...points.map(scanDayLine),
  );
  return lines.join("\n");
}
