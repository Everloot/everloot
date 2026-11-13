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
export const RIVER_DAYS = 30;
export const RECEIPTS_SHOWN = 100;
export const HISTORY_POINTS = 60;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

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
  category: string;
  direction: Direction;
  copper: number;
  /** Gold moved to or from one of the player's own characters (the addon's ownAlt); only ledger rows carry it. */
  ownAlt?: true;
}

export interface GoldSeries {
  install: number;
  character: string;
  realm: string;
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
  /** Gold over time per character, oldest first, thinned to HISTORY_POINTS. */
  history: GoldSeries[];
  /** The same money summaries for each character alone, keyed by characterKey. */
  byCharacter: Record<string, CharacterMoney>;
}

/** The parts of a ledger that change when it is narrowed to one character; the roster does not. */
export type CharacterMoney = Pick<MoneyLedger, "river" | "week" | "categories" | "receipts" | "eventCount" | "history" | "moved">;

/**
 * The two local-only tables beside the records, as parseEverlootTable reads them, and the file's own install id
 * (the ledger and roster belong to it). Any of them may be missing from a file written before they existed.
 */
export interface LocalTables { installId?: string; ledger?: unknown; roster?: unknown }

type Who = { install: number; character: string; realm: string };

/** One character's key in byCharacter: install, name and realm ("1:Thrall-Moon Guard"). */
export const characterKey = (r: Who) => `${r.install}:${r.character}-${r.realm}`;

/** The same character on the same install: never by name and realm alone. */
const sameCharacter = (a: Who, b: Who) => a.install === b.install && a.character === b.character && a.realm === b.realm;

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

/**
 * River, week, categories, receipts and history for the given money events and gold series. `netted` (more than one
 * character) leaves gold moved between the player's own characters out of everything but the receipts.
 */
function summarizeFlows(money: MoneyEvent[], series: GoldSeries[], now: number, netted: boolean): CharacterMoney {
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
  return {
    river,
    week,
    categories: [...totals.values()].sort((a, b) => b.copper - a.copper || a.category.localeCompare(b.category)),
    receipts: events.slice(0, RECEIPTS_SHOWN).map(({ ms: _ms, ...e }) => e),
    eventCount: events.length,
    history: series
      .map((s) => ({ ...s, points: thin([...s.points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) }))
      .sort((a, b) => a.character.localeCompare(b.character) || a.realm.localeCompare(b.realm) || a.install - b.install),
    moved,
  };
}

const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

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

  const rosterRow = (r: Record<string, unknown>): RosterRow | null => {
    const character = str(r.character), realm = str(r.realm);
    if (!character || !realm) return null;
    const raw = str(r.installId);
    const install = installs.get(raw) ?? installs.size + 1;
    installs.set(raw, install);
    const id = characterKey({ install, character, realm });
    let row = roster.get(id);
    if (!row) { row = { install, character, realm, copper: null, peakCopper: null, at: null }; roster.set(id, row); }
    return row;
  };
  const point = (row: RosterRow, at: string, copper: number) => {
    const id = characterKey(row);
    const s = series.get(id) ?? { install: row.install, character: row.character, realm: row.realm, points: [] };
    s.points.push({ at, copper });
    series.set(id, s);
  };

  // The local roster names each ledger key; a key it cannot name is left out, as the addon leaves it out.
  const named = new Map<string, Record<string, unknown>>();
  const rosterTable = own ? table(local.roster) : null;
  for (const [key, raw] of Object.entries(rosterTable ?? {})) {
    const r = table(raw);
    const character = str(r?.name), realm = str(r?.realm);
    if (!r || !character || !realm) continue;
    const who = { installId: own, character, realm };
    named.set(key, who);
    const row = rosterRow(who)!;
    // The roster keeps gold only while the gold module is on, with the time the character was last seen.
    if (whole(r.copper, 0)) {
      const at = whole(r.lastSeen, 1) ? isoSeconds(r.lastSeen * 1000) : null;
      if (row.copper === null || (at && (!row.at || Date.parse(at) >= Date.parse(row.at)))) { row.copper = r.copper; if (at) row.at = at; }
      row.peakCopper = Math.max(row.peakCopper ?? 0, r.copper, whole(r.peakCopper, 0) ? r.peakCopper : 0);
    }
  }

  const ledgerTable = table(local.ledger);
  const ledgerRows: MoneyEvent[] = [];
  const ledgerEvents = ledgerTable?.events;
  for (const raw of Array.isArray(ledgerEvents) ? ledgerEvents as unknown[] : []) {
    const e = table(raw);
    const who = e && typeof e.key === "string" ? named.get(e.key) : undefined;
    if (!e || !who || !whole(e.at, 0) || !whole(e.copper, 1) || typeof e.category !== "string" || !LEDGER_CATEGORIES.has(e.category)) continue;
    const row = rosterRow(who)!;
    const ms = e.at * 1000;
    ledgerRows.push({
      at: isoSeconds(ms), ms, install: row.install, character: row.character, realm: row.realm, category: e.category,
      direction: directionOf(e.category), copper: e.copper, ...(e.ownAlt === true ? { ownAlt: true as const } : {}),
    });
  }
  // Each character's closing gold per UTC day is a point in its history.
  for (const [key, closes] of Object.entries(table(ledgerTable?.daily) ?? {})) {
    const who = named.get(key);
    if (!who) continue;
    const row = rosterRow(who)!;
    for (const [ymd, copper] of Object.entries(table(closes) ?? {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && whole(copper, 0)) point(row, `${ymd}T23:59:59Z`, copper);
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
      money.push({ at, ms: Number.isFinite(ms) ? ms : null, install: row.install, character: row.character, realm: row.realm, category, direction: directionOf(category), copper });
    }
  }

  const byCharacter: Record<string, CharacterMoney> = {};
  for (const [id, row] of roster) {
    const own = series.get(id);
    byCharacter[id] = summarizeFlows(money.filter((e) => sameCharacter(e, row)), own ? [own] : [], now, false);
  }
  return {
    madeAt: new Date(now).toISOString(),
    roster: [...roster.values()].sort((a, b) => (b.copper ?? -1) - (a.copper ?? -1) || a.character.localeCompare(b.character) || a.install - b.install),
    ...summarizeFlows(money, [...series.values()], now, roster.size > 1),
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

/** "install 2" when another row shares this row's name and realm, else "". */
export function installHint(row: Who, rows: readonly Who[]): string {
  const twin = rows.some((r) => r.install !== row.install && r.character === row.character && r.realm === row.realm);
  return twin ? `install ${row.install}` : "";
}

/** A category as the page shows it: the addon's name for it ("auction_spend" → "Auction purchases"), else its own name with spaces. */
export const categoryLabel = (category: string) => LEDGER_LABELS[category] ?? category.replaceAll("_", " ");

/** Checks a summary read back from localStorage still has the shape this version writes. */
export function isMoneyLedger(value: unknown): value is MoneyLedger {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // A summary saved before rows kept their install has none: it is read again from the file rather than merged by name.
  // One saved before the local ledger was read has no `moved`, and is read again too.
  return typeof v.madeAt === "string" && Array.isArray(v.roster) && v.roster.every((r) => typeof (r as { install?: unknown })?.install === "number")
    && Array.isArray(v.river) && Array.isArray(v.categories)
    && Array.isArray(v.receipts) && Array.isArray(v.history) && typeof v.eventCount === "number" && typeof v.moved === "number"
    && typeof v.week === "object" && v.week !== null && typeof v.byCharacter === "object" && v.byCharacter !== null;
}
