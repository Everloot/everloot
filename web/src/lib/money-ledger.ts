/**
 * A player's own gold ledger from the records in their Everloot.lua: gold per character, money in and out per
 * day and per category, the money events themselves and gold over time. Pure, so the page can run it in the
 * browser on a file that never leaves the computer.
 *
 * Ported from the Desktop App's summariser (desktop/src/main/characters.ts); the two should become one later.
 * Besides the records, the file holds two local-only tables the upload never reads: `EverlootDB.ledger` (the
 * addon window's money events, keyed by an opaque character key) and `EverlootDB.roster` (which names each key).
 * When the ledger has events, they are the money: a `money_event` record counts only when it is dated before the
 * ledger's oldest event, the way the addon's Gold tab and the Desktop App read the same file.
 * In and out follow the addon's ledger (addon/modules/ledger.lua, L.INCOME and L.SPENDING): `vendor` is money in,
 * since the addon writes it only for gold gained at a merchant; `vendor_spend` is out.
 */

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const whole = (v: unknown, least: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= least;
/** An item name as the addon keeps it (ledger.lua validName): a string of 1 to 80 characters. */
const itemName = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 80;
const table = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** The addon's ledger categories, in its order (addon/modules/ledger.lua; desktop/src/shared/ledger.ts holds the same). */
export const LEDGER_INCOME: readonly string[] = ["loot", "quest", "vendor", "auction", "trade_in", "mail_in"];
export const LEDGER_SPENDING: readonly string[] = ["flight", "postage", "barber", "respec", "auction_spend", "repair", "vendor_spend", "trade_out", "mail_out"];
/** The addon's own names for them (L.LABELS). */
export const LEDGER_LABELS: Readonly<Record<string, string>> = {
  loot: "Loot", quest: "Quest rewards", vendor: "Vendor sales", auction: "Auction sales",
  trade_in: "Trades in", mail_in: "Mail in",
  flight: "Flight paths", postage: "Postage", barber: "Barber", respec: "Respecs", auction_spend: "Auction purchases",
  repair: "Repairs", vendor_spend: "Vendor purchases", trade_out: "Trades out", mail_out: "Mail out",
};
const LEDGER_CATEGORIES = new Set([...LEDGER_INCOME, ...LEDGER_SPENDING]);
/** The addon keeps 90 days of ledger events (addon/modules/ledger.lua), so the daily series covers as many. */
export const RIVER_DAYS = 90;
/** The periods the page can look at: today and the 6, 29 or 89 whole UTC days before it, as the addon's Gold tab. */
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const RECEIPTS_SHOWN = 100;
export const LARGEST_SHOWN = 5;
export const SALE_ITEMS_SHOWN = 10;
export const HISTORY_POINTS = 60;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** A sale whose letter has not come is still waiting for 48 hours, then the addon stops waiting (L.PENDING_SECONDS). */
const PENDING_MS = 48 * 3600 * 1000;

export type Direction = "in" | "out";

/**
 * Every summary row keeps the install it came from: one name and realm on two installs (two accounts, or two
 * computers) are two characters. The name and realm are labels. `install` numbers the file's installs 1, 2, ... in the
 * order they first appear; the install id itself is never kept, so a remembered summary does not hold it.
 */
export interface RosterRow {
  install: number;
  character: string;
  realm: string;
  twin?: number;
  /** Gold in the newest snapshot, in copper; null when the file has money events but no snapshot. */
  copper: number | null;
  /** The highest peak any snapshot recorded, in copper. */
  peakCopper: number | null;
  /** When the newest snapshot was taken. */
  at: string | null;
}

export interface RiverDay {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  in: number;
  out: number;
  /** Copper per category that day, only for categories with money. */
  byCategory: Record<string, number>;
}

export interface CategoryTotal {
  category: string;
  direction: Direction;
  copper: number;
  events: number;
}

export interface Receipt {
  at: string;
  install: number;
  character: string;
  realm: string;
  twin?: number;
  category: string;
  direction: Direction;
  copper: number;
  /** Gold moved to or from one of the player's own characters (the addon's ownAlt); only ledger rows carry it. */
  ownAlt?: true;
  /** The item the money was for, when the ledger row names one. */
  itemName?: string;
  /** How many of the item, when the ledger row says. */
  count?: number;
}

/** One item's paid auction sales: units, the gold received after the house cut, and the cut itself. */
export interface SaleItem { itemName: string; units: number; total: number; cut: number; sales: number }

/**
 * An item both bought and sold at the auction house in the window: units and copper each way, and the margin per
 * unit (average received after the cut minus average paid). `profit` counts only the units both bought and sold.
 */
export interface ResaleItem { itemName: string; bought: number; paid: number; sold: number; received: number; margin: number; profit: number }

/** The ledger's paid auction sales within RIVER_DAYS, and the sales still waiting for their letter. */
export interface SalesSummary {
  /** The best-selling items by gold received, at most SALE_ITEMS_SHOWN. */
  items: SaleItem[];
  total: number;
  /** What the auction house kept from those sales. */
  cut: number;
  sales: number;
  units: number;
  /** Sales the sold notice announced in the last 48 hours whose letter has not been taken yet. */
  pending: number;
  /** Items both bought (auction purchases that name the item and count) and sold, largest profit first, at most SALE_ITEMS_SHOWN. */
  resale: ResaleItem[];
}

export interface GoldSeries {
  install: number;
  character: string;
  realm: string;
  twin?: number;
  points: { at: string; copper: number }[];
}

export interface MoneyLedger {
  /** When the summary was made (ISO); the river and the week end on this day. */
  madeAt: string;
  roster: RosterRow[];
  /** The last RIVER_DAYS UTC days, oldest first, today last. */
  river: RiverDay[];
  /** The last 7 days up to madeAt. */
  week: { in: number; out: number; net: number };
  /** Every money event in the file, per category, largest first. */
  categories: CategoryTotal[];
  /** Money events, newest first, at most RECEIPTS_SHOWN. */
  receipts: Receipt[];
  /** How many money events with a time the file holds (receipts shows the newest of them). */
  eventCount: number;
  /**
   * Copper sent from one of the player's characters to another (each transfer once). With more than one character
   * those rows stay out of the river, week and categories, since the gold never left the player; they are still
   * receipts. One character alone keeps them in its totals.
   */
  moved: number;
  /** The oldest dated money event counted, so a period that starts before it is not compared with an empty one. */
  firstAt: string | null;
  /** The largest single payments of each period, largest first, at most LARGEST_SHOWN. */
  largest: Record<Period, Receipt[]>;
  sales: SalesSummary;
  /** Gold over time per character, oldest first, thinned to HISTORY_POINTS. */
  history: GoldSeries[];
  /** The same money summaries for each character alone, keyed by characterKey. */
  byCharacter: Record<string, CharacterMoney>;
}

/** The parts of a ledger that change when it is narrowed to one character; the roster does not. */
export type CharacterMoney = Pick<MoneyLedger, "river" | "week" | "categories" | "receipts" | "eventCount" | "history" | "moved" | "firstAt" | "largest" | "sales">;

/**
 * The two local-only tables beside the records, as parseEverlootTable reads them, and the file's own install id
 * (the ledger and roster belong to it). Any of them may be missing from a file written before they existed.
 */
export interface LocalTables { installId?: string; ledger?: unknown; roster?: unknown }

/**
 * `twin` tells apart two characters of the local roster that share a name and realm on one install (one deleted and
 * made again): numbered 1, 2, ... from the one seen longest ago. A character with no twin has none.
 */
type Who = { install: number; character: string; realm: string; twin?: number };

/** One character's key in byCharacter: install, name and realm ("1:Thrall-Moon Guard"), and "#2" for a twin. */
export const characterKey = (r: Who) => `${r.install}:${r.character}-${r.realm}${r.twin ? `#${r.twin}` : ""}`;

/** The same character on the same install: never by name and realm alone. */
const sameCharacter = (a: Who, b: Who) => characterKey(a) === characterKey(b);

export function directionOf(category: string): Direction {
  return LEDGER_SPENDING.includes(category) ? "out" : "in";
}

/** Keeps at most `max` points of a series, always the first and the last. */
export function thin<T>(points: T[], max = HISTORY_POINTS): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

type MoneyEvent = Omit<Receipt, "at"> & { at: string; ms: number | null };
type SaleRow = Who & { ms: number; itemName: string; units: number; total: number; cut: number; paid: boolean };

/** Paid sales from the last RIVER_DAYS UTC days by item, and the sales still waiting for their letter. */
function summarizeSales(rows: SaleRow[], now: number, from: number, purchases: MoneyEvent[] = []): SalesSummary {
  const byItem = new Map<string, SaleItem>();
  const out: SalesSummary = { items: [], total: 0, cut: 0, sales: 0, units: 0, pending: 0, resale: [] };
  for (const s of rows) {
    if (s.ms > now) continue;
    if (!s.paid) { if (now - s.ms <= PENDING_MS) out.pending += 1; continue; }
    if (s.ms < from) continue;
    const item = byItem.get(s.itemName) ?? { itemName: s.itemName, units: 0, total: 0, cut: 0, sales: 0 };
    item.units += s.units; item.total += s.total; item.cut += s.cut; item.sales += 1;
    byItem.set(s.itemName, item);
    out.total += s.total; out.cut += s.cut; out.sales += 1; out.units += s.units;
  }
  // Resale: auction purchases that name the item and its count, in the same window, against that item's sales.
  const bought = new Map<string, { units: number; copper: number }>();
  for (const e of purchases) {
    if (e.category !== "auction_spend" || e.ownAlt || !e.itemName || !e.count || e.ms === null || e.ms < from || e.ms > now) continue;
    const b = bought.get(e.itemName) ?? { units: 0, copper: 0 };
    b.units += e.count; b.copper += e.copper;
    bought.set(e.itemName, b);
  }
  out.resale = [...bought].flatMap(([itemName, b]) => {
    const s = byItem.get(itemName);
    if (!s || !s.units) return [];
    const margin = Math.floor(s.total / s.units) - Math.floor(b.copper / b.units);
    return [{ itemName, bought: b.units, paid: b.copper, sold: s.units, received: s.total, margin, profit: margin * Math.min(b.units, s.units) }];
  }).sort((a, b) => b.profit - a.profit || a.itemName.localeCompare(b.itemName)).slice(0, SALE_ITEMS_SHOWN);
  out.items = [...byItem.values()].sort((a, b) => b.total - a.total || a.itemName.localeCompare(b.itemName)).slice(0, SALE_ITEMS_SHOWN);
  return out;
}

/**
 * River, week, categories, receipts and history for the given money events and gold series. `netted` (more than one
 * character) leaves gold moved between the player's own characters out of everything but the receipts.
 */
function summarizeFlows(money: MoneyEvent[], series: GoldSeries[], now: number, netted: boolean, sales: SaleRow[] = []): CharacterMoney {
  const totals = new Map<string, CategoryTotal>();
  let moved = 0;
  for (const e of money) {
    // One transfer has an out row and an in row; only the out side counts, so it is not counted twice.
    if (e.ownAlt && e.direction === "out") moved += e.copper;
    if (e.ownAlt && netted) continue;
    const t = totals.get(e.category) ?? { category: e.category, direction: e.direction, copper: 0, events: 0 };
    t.copper += e.copper; t.events += 1;
    totals.set(e.category, t);
  }
  const events = money.filter((e): e is MoneyEvent & { ms: number } => e.ms !== null);

  const today = new Date(now);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = end - (RIVER_DAYS - 1) * DAY_MS;
  const river: RiverDay[] = Array.from({ length: RIVER_DAYS }, (_, i) => ({ date: dayOf(start + i * DAY_MS), in: 0, out: 0, byCategory: {} }));
  const week = { in: 0, out: 0, net: 0 };
  for (const e of events) {
    if (e.ms > now || (e.ownAlt && netted)) continue;
    if (e.ms >= start) {
      const day = river[Math.floor((e.ms - start) / DAY_MS)];
      if (day) { day[e.direction] += e.copper; day.byCategory[e.category] = (day.byCategory[e.category] ?? 0) + e.copper; }
    }
    if (now - e.ms <= WEEK_MS) week[e.direction] += e.copper;
  }
  week.net = week.in - week.out;

  events.sort((a, b) => b.ms - a.ms);
  const receipt = ({ ms: _ms, ...e }: MoneyEvent): Receipt => e;
  const counted = events.filter((e) => e.ms <= now && !(e.ownAlt && netted));
  const spent = counted.filter((e) => e.direction === "out").sort((a, b) => b.copper - a.copper || b.ms - a.ms);
  const largest = Object.fromEntries(PERIODS.map((p) => {
    const from = end - (p - 1) * DAY_MS;
    return [p, spent.filter((e) => e.ms >= from).slice(0, LARGEST_SHOWN).map(receipt)];
  })) as Record<Period, Receipt[]>;
  const first = counted.at(-1);
  return {
    river,
    week,
    categories: [...totals.values()].sort((a, b) => b.copper - a.copper || a.category.localeCompare(b.category)),
    receipts: events.slice(0, RECEIPTS_SHOWN).map(receipt),
    eventCount: events.length,
    history: series
      .map((s) => ({ ...s, points: thin([...s.points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) }))
      .sort((a, b) => a.character.localeCompare(b.character) || a.realm.localeCompare(b.realm) || a.install - b.install),
    moved,
    firstAt: first ? first.at : null,
    largest,
    sales: summarizeSales(sales, now, start, money),
  };
}

/** One category's spending (or income) in a period, and in the period of the same length just before it. */
export interface PeriodCategory { category: string; copper: number; previous: number | null }

export interface PeriodStats {
  days: Period;
  /** First and last UTC day of the period, YYYY-MM-DD. */
  from: string;
  to: string;
  in: number;
  out: number;
  net: number;
  /** Copper spent per day, over the days of the period that have passed since the data began. */
  outPerDay: number;
  /** The period before, the same length, or null when the data does not reach back that far. */
  previous: { in: number; out: number } | null;
  spending: PeriodCategory[];
  income: PeriodCategory[];
  /** The period's days, oldest first. */
  river: RiverDay[];
}

/**
 * A period's totals from the daily series: the last `days` UTC days of `river` (today last), each category's share,
 * and the same-length period before it when `firstAt` says the data covers all of it.
 */
export function periodStats(ledger: Pick<MoneyLedger, "river" | "firstAt">, days: Period): PeriodStats {
  const river = ledger.river.slice(-days);
  const before = ledger.river.length >= days * 2 ? ledger.river.slice(-days * 2, -days) : null;
  const from = river[0]?.date ?? "", to = river.at(-1)?.date ?? "";
  const firstDay = ledger.firstAt ? ledger.firstAt.slice(0, 10) : null;
  // The period before counts only when the data began by its first midnight: a first event late on that day leaves the
  // day mostly unseen.
  const covered = before !== null && ledger.firstAt !== null && Date.parse(ledger.firstAt) <= Date.parse(`${before[0]!.date}T00:00:00Z`);
  const sum = (list: RiverDay[], direction: Direction) => list.reduce((n, d) => n + d[direction], 0);
  const byCategory = (list: RiverDay[], direction: Direction) => {
    const out = new Map<string, number>();
    for (const d of list) for (const [c, v] of Object.entries(d.byCategory)) if (directionOf(c) === direction) out.set(c, (out.get(c) ?? 0) + v);
    return out;
  };
  const categories = (direction: Direction): PeriodCategory[] => {
    const now = byCategory(river, direction), then = covered ? byCategory(before!, direction) : null;
    return [...now].map(([category, copper]) => ({ category, copper, previous: then ? then.get(category) ?? 0 : null }))
      .sort((a, b) => b.copper - a.copper || a.category.localeCompare(b.category));
  };
  const totalIn = sum(river, "in"), totalOut = sum(river, "out");
  // Days before the data began are not days with no spending; a period that started earlier is averaged over fewer.
  const counted = firstDay ? river.filter((d) => d.date >= firstDay).length : 0;
  return {
    days, from, to, in: totalIn, out: totalOut, net: totalIn - totalOut,
    outPerDay: counted ? Math.round(totalOut / counted) : 0,
    previous: covered ? { in: sum(before!, "in"), out: sum(before!, "out") } : null,
    spending: categories("out"),
    income: categories("in"),
    river,
  };
}

/** The change from `previous` to `now` in percent, rounded; null when there is nothing to compare with. */
export function change(now: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((now - previous) / previous) * 100);
}

const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** A time() value in seconds as milliseconds, or null when it is not one a date can hold. */
const MAX_SECONDS = 8_640_000_000_000;
const secondsMs = (v: unknown): number | null => (whole(v, 0) && v <= MAX_SECONDS ? v * 1000 : null);
/** A real UTC calendar day "YYYY-MM-DD", or false. */
const isDay = (ymd: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && Number.isFinite(Date.parse(`${ymd}T00:00:00Z`))
  && new Date(`${ymd}T00:00:00Z`).toISOString().startsWith(ymd);

/**
 * The ledger for one Everloot.lua: its parsed records (parseEverlootLua(text).records) and, when given, the local
 * ledger and roster beside them (parseEverlootTable(text)) with the file's install id.
 */
export function summarizeMoney(records: ReadonlyArray<Record<string, unknown>>, now = Date.now(), local: LocalTables = {}): MoneyLedger {
  const roster = new Map<string, RosterRow>();
  const series = new Map<string, GoldSeries>();
  const money: MoneyEvent[] = [];
  const installs = new Map<string, number>();
  const own = str(local.installId);
  // The file's own install is install 1, so the ledger's characters keep their number whatever the records hold.
  if (own) installs.set(own, 1);

  // `twin` comes only from the local roster below, never from a record's own fields.
  const rosterRow = (r: Record<string, unknown>, twin?: number): RosterRow | null => {
    const character = str(r.character), realm = str(r.realm);
    if (!character || !realm) return null;
    const raw = str(r.installId);
    const install = installs.get(raw) ?? installs.size + 1;
    installs.set(raw, install);
    const id = characterKey({ install, character, realm, twin });
    let row = roster.get(id);
    if (!row) { row = { install, character, realm, ...(twin ? { twin } : {}), copper: null, peakCopper: null, at: null }; roster.set(id, row); }
    return row;
  };
  const point = (row: RosterRow, at: string, copper: number) => {
    const id = characterKey(row);
    const s = series.get(id) ?? { install: row.install, character: row.character, realm: row.realm, ...(row.twin ? { twin: row.twin } : {}), points: [] };
    s.points.push({ at, copper });
    series.set(id, s);
  };
  const who = (row: RosterRow) => ({ install: row.install, character: row.character, realm: row.realm, ...(row.twin ? { twin: row.twin } : {}) });

  // The local roster names each ledger key; a key it cannot name is left out, as the addon leaves it out. Two keys
  // with one name and realm stay two characters (twins), and records, which carry only the name, join neither.
  const named = new Map<string, { id: Record<string, unknown>; twin?: number }>();
  const rosterTable = own ? table(local.roster) : null;
  const entries = Object.entries(rosterTable ?? {}).flatMap(([key, raw]) => {
    const r = table(raw);
    const character = str(r?.name), realm = str(r?.realm);
    return r && character && realm ? [{ key, r, character, realm, seen: secondsMs(r.lastSeen) ?? 0 }] : [];
  });
  const twins = new Map<string, typeof entries>();
  for (const e of entries) twins.set(`${e.character}\0${e.realm}`, [...(twins.get(`${e.character}\0${e.realm}`) ?? []), e]);
  for (const group of twins.values()) {
    group.sort((a, b) => a.seen - b.seen || a.key.localeCompare(b.key));
    group.forEach(({ key, r, character, realm, seen }, i) => {
      const ref = { id: { installId: own, character, realm }, twin: group.length > 1 ? i + 1 : undefined };
      named.set(key, ref);
      const row = rosterRow(ref.id, ref.twin)!;
      // The roster keeps gold only while the gold module is on, with the time the character was last seen.
      if (whole(r.copper, 0)) {
        const at = seen ? isoSeconds(seen) : null;
        if (row.copper === null || (at && (!row.at || Date.parse(at) >= Date.parse(row.at)))) { row.copper = r.copper; if (at) row.at = at; }
        row.peakCopper = Math.max(row.peakCopper ?? 0, r.copper, whole(r.peakCopper, 0) ? r.peakCopper : 0);
      }
    });
  }

  const ledgerTable = table(local.ledger);
  const ledgerRows: MoneyEvent[] = [];
  const ledgerEvents = ledgerTable?.events;
  for (const raw of Array.isArray(ledgerEvents) ? ledgerEvents as unknown[] : []) {
    const e = table(raw);
    const ref = e && typeof e.key === "string" ? named.get(e.key) : undefined;
    const ms = e ? secondsMs(e.at) : null;
    if (!e || !ref || ms === null || !whole(e.copper, 1) || typeof e.category !== "string" || !LEDGER_CATEGORIES.has(e.category)) continue;
    const row = rosterRow(ref.id, ref.twin)!;
    ledgerRows.push({
      at: isoSeconds(ms), ms, ...who(row), category: e.category,
      direction: directionOf(e.category), copper: e.copper, ...(e.ownAlt === true ? { ownAlt: true as const } : {}),
      ...(itemName(e.itemName) ? { itemName: e.itemName as string } : {}),
      ...(whole(e.count, 1) ? { count: e.count } : {}),
    });
  }
  // Auction sales by item: paid ones carry the count, the gold after the cut and the cut; a pending one only its item.
  const sales: SaleRow[] = [];
  const ledgerSales = ledgerTable?.sales;
  for (const raw of Array.isArray(ledgerSales) ? ledgerSales as unknown[] : []) {
    const s = table(raw);
    const ref = s && typeof s.key === "string" ? named.get(s.key) : undefined;
    const ms = s ? secondsMs(s.at) : null;
    if (!s || !ref || ms === null || !itemName(s.itemName)) continue;
    const paid = s.status === "paid";
    if (paid ? !(whole(s.count, 1) && whole(s.total, 1)) : s.status !== "pending") continue;
    const row = rosterRow(ref.id, ref.twin)!;
    sales.push({
      ...who(row), ms, itemName: s.itemName as string,
      units: paid ? s.count as number : 0, total: paid ? s.total as number : 0, cut: paid && whole(s.cut, 0) ? s.cut : 0, paid,
    });
  }
  // Each character's closing gold per UTC day is a point in its history, placed at noon UTC (the same calendar day
  // in every time zone the page may show it in) and never later than now: today's close is still moving.
  for (const [key, closes] of Object.entries(table(ledgerTable?.daily) ?? {})) {
    const ref = named.get(key);
    if (!ref) continue;
    const row = rosterRow(ref.id, ref.twin)!;
    for (const [ymd, copper] of Object.entries(table(closes) ?? {})) {
      if (isDay(ymd) && whole(copper, 0)) point(row, isoSeconds(Math.min(Date.parse(`${ymd}T12:00:00Z`), now)), copper);
    }
  }
  const ledgerFrom = ledgerRows.reduce((min, e) => Math.min(min, e.ms!), Infinity);
  money.push(...ledgerRows);

  for (const r of records) {
    if (r.kind === "gold_snapshot") {
      const row = rosterRow(r);
      if (!row) continue;
      const at = str(r.capturedAt), ms = Date.parse(at);
      const dated = Number.isFinite(ms);
      // The newest snapshot is the current gold; one without a time counts only when nothing dated is known.
      if (row.copper === null || (dated && (!row.at || ms >= Date.parse(row.at)))) { row.copper = num(r.currentCopper); if (dated) row.at = at; }
      row.peakCopper = Math.max(row.peakCopper ?? 0, num(r.peakCopper), num(r.currentCopper));
      if (dated) point(row, at, num(r.currentCopper));
    } else if (r.kind === "money_event") {
      const category = str(r.category), copper = num(r.copper);
      const at = str(r.capturedAt), ms = Date.parse(at);
      // With a ledger, this install's uploaded row counts only when it is dated before the ledger's first event: later
      // ones are the same money the ledger already holds. Another install's rows are not in this ledger.
      const mine = !str(r.installId) || str(r.installId) === own;
      if (ledgerRows.length && mine && !(Number.isFinite(ms) && ms < ledgerFrom)) continue;
      const row = rosterRow(r);
      if (!row || !category || copper <= 0) continue;
      // Undated events count in the category totals only.
      money.push({ at, ms: Number.isFinite(ms) ? ms : null, ...who(row), category, direction: directionOf(category), copper });
    }
  }

  const byCharacter: Record<string, CharacterMoney> = {};
  for (const [id, row] of roster) {
    const own = series.get(id);
    byCharacter[id] = summarizeFlows(money.filter((e) => sameCharacter(e, row)), own ? [own] : [], now, false, sales.filter((s) => sameCharacter(s, row)));
  }
  return {
    madeAt: new Date(now).toISOString(),
    roster: [...roster.values()].sort((a, b) => (b.copper ?? -1) - (a.copper ?? -1) || a.character.localeCompare(b.character) || a.install - b.install),
    ...summarizeFlows(money, [...series.values()], now, roster.size > 1, sales),
    byCharacter,
  };
}

/**
 * The ledger as one character sees it: river, week, categories, receipts and history for that character alone.
 * The roster stays whole. An unknown key, or null, gives the ledger back unchanged.
 */
export function narrowLedger(ledger: MoneyLedger, key: string | null): MoneyLedger {
  const own = key === null ? undefined : ledger.byCharacter[key];
  return own ? { ...ledger, ...own } : ledger;
}

/** A roster row's label: name and realm, and when another row has the same name and realm, which install it is. */
export function rosterLabel(row: RosterRow, roster: readonly RosterRow[]): string {
  const hint = installHint(row, roster);
  return `${row.character} (${row.realm}${hint ? `, ${hint}` : ""})`;
}

/**
 * "install 2" when a row of another install shares this row's name and realm, "character 2" for a twin on one
 * install (both when both apply), else "".
 */
export function installHint(row: Who, rows: readonly Who[]): string {
  const other = rows.some((r) => r.install !== row.install && r.character === row.character && r.realm === row.realm);
  return [other ? `install ${row.install}` : "", row.twin ? `character ${row.twin}` : ""].filter(Boolean).join(", ");
}

/** A category as the page shows it: the addon's name for it ("auction_spend" → "Auction purchases"), else its own name with spaces. */
export const categoryLabel = (category: string): string =>
  Object.hasOwn(LEDGER_LABELS, category) ? LEDGER_LABELS[category]! : String(category).replaceAll("_", " ");

/** Checks a summary read back from localStorage still has the shape this version writes. */
export function isMoneyLedger(value: unknown): value is MoneyLedger {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // A summary saved before rows kept their install has none: it is read again from the file rather than merged by name.
  // One saved before the local ledger was read has no `moved`, and is read again too.
  // One saved before the spending insights has a 30-day river and no largest payments or sales: read again too. The
  // parts the page computes on are checked for every character, so an edited summary cannot break the page.
  return typeof v.madeAt === "string" && Array.isArray(v.roster) && v.roster.every((r) => typeof (r as { install?: unknown })?.install === "number")
    && isCharacterMoney(v) && typeof v.byCharacter === "object" && v.byCharacter !== null && !Array.isArray(v.byCharacter)
    && Object.values(v.byCharacter).every(isCharacterMoney);
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The shape of the money parts a narrowed ledger replaces, as periodStats and the insights read them. */
function isCharacterMoney(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const week = v.week as Record<string, unknown> | null;
  const sales = v.sales as Record<string, unknown> | null;
  const largest = v.largest as Record<number, unknown> | null;
  return Array.isArray(v.river) && v.river.length === RIVER_DAYS
    && v.river.every((d: unknown) => {
      const day = d as Record<string, unknown> | null;
      return !!day && typeof day.date === "string" && isNumber(day.in) && isNumber(day.out) && typeof day.byCategory === "object" && day.byCategory !== null;
    })
    && Array.isArray(v.categories) && Array.isArray(v.receipts) && Array.isArray(v.history)
    && isNumber(v.eventCount) && isNumber(v.moved)
    && (v.firstAt === null || (typeof v.firstAt === "string" && Number.isFinite(Date.parse(v.firstAt))))
    && typeof week === "object" && week !== null && isNumber(week.in) && isNumber(week.out) && isNumber(week.net)
    && typeof largest === "object" && largest !== null && PERIODS.every((p) => Array.isArray(largest[p]))
    && typeof sales === "object" && sales !== null && Array.isArray(sales.items) && Array.isArray(sales.resale)
    && ["total", "cut", "sales", "units", "pending"].every((k) => isNumber(sales[k]));
}
