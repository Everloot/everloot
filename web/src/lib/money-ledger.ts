/**
 * A player's own gold ledger from the records in their Everloot.lua: gold per character, money in and out per
 * day and per category, the money events themselves and gold over time. Pure, so the page can run it in the
 * browser on a file that never leaves the computer.
 *
 * Ported from the Desktop App's summariser (desktop/src/main/characters.ts); the two should become one later.
 * Categories are the ones the records carry; nothing is added or renamed. In and out follow the server ledger
 * (kb/src/gold-ledger.ts): `vendor` is money in, since the addon writes it only for gold gained at a merchant.
 * The Desktop App counts `vendor` as spending.
 */
import { SPENDING_CATEGORIES } from "../../../kb/src/gold-ledger";

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const RIVER_DAYS = 30;
export const RECEIPTS_SHOWN = 100;
export const HISTORY_POINTS = 60;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type Direction = "in" | "out";

export interface RosterRow {
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
  character: string;
  realm: string;
  category: string;
  direction: Direction;
  copper: number;
}

export interface GoldSeries {
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
  /** Gold over time per character, oldest first, thinned to HISTORY_POINTS. */
  history: GoldSeries[];
}

export function directionOf(category: string): Direction {
  return (SPENDING_CATEGORIES as readonly string[]).includes(category) ? "out" : "in";
}

/** Keeps at most `max` points of a series, always the first and the last. */
export function thin<T>(points: T[], max = HISTORY_POINTS): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The ledger for the parsed records of one Everloot.lua (parseEverlootLua(text).records). */
export function summarizeMoney(records: ReadonlyArray<Record<string, unknown>>, now = Date.now()): MoneyLedger {
  const roster = new Map<string, RosterRow>();
  const series = new Map<string, GoldSeries>();
  const events: (Receipt & { ms: number })[] = [];
  const totals = new Map<string, CategoryTotal>();

  const rosterRow = (r: Record<string, unknown>): RosterRow | null => {
    const character = str(r.character), realm = str(r.realm);
    if (!character || !realm) return null;
    const id = `${character}-${realm}`;
    let row = roster.get(id);
    if (!row) { row = { character, realm, copper: null, peakCopper: null, at: null }; roster.set(id, row); }
    return row;
  };

  for (const r of records) {
    if (r.kind === "gold_snapshot") {
      const row = rosterRow(r);
      if (!row) continue;
      const at = str(r.capturedAt), ms = Date.parse(at);
      const dated = Number.isFinite(ms);
      // The newest snapshot is the current gold; one without a time counts only when nothing dated is known.
      if (row.copper === null || (dated && (!row.at || ms >= Date.parse(row.at)))) { row.copper = num(r.currentCopper); if (dated) row.at = at; }
      row.peakCopper = Math.max(row.peakCopper ?? 0, num(r.peakCopper), num(r.currentCopper));
      if (dated) {
        const id = `${row.character}-${row.realm}`;
        const s = series.get(id) ?? { character: row.character, realm: row.realm, points: [] };
        s.points.push({ at, copper: num(r.currentCopper) });
        series.set(id, s);
      }
    } else if (r.kind === "money_event") {
      const row = rosterRow(r);
      const category = str(r.category), copper = num(r.copper);
      if (!row || !category || copper <= 0) continue;
      const direction = directionOf(category);
      const t = totals.get(category) ?? { category, direction, copper: 0, events: 0 };
      t.copper += copper; t.events += 1;
      totals.set(category, t);
      const at = str(r.capturedAt), ms = Date.parse(at);
      if (Number.isFinite(ms)) events.push({ at, ms, character: row.character, realm: row.realm, category, direction, copper });
    }
  }

  const today = new Date(now);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = end - (RIVER_DAYS - 1) * DAY_MS;
  const river: RiverDay[] = Array.from({ length: RIVER_DAYS }, (_, i) => ({ date: dayOf(start + i * DAY_MS), in: 0, out: 0, byCategory: {} }));
  const week = { in: 0, out: 0, net: 0 };
  for (const e of events) {
    if (e.ms > now) continue;
    if (e.ms >= start) {
      const day = river[Math.floor((e.ms - start) / DAY_MS)];
      if (day) { day[e.direction] += e.copper; day.byCategory[e.category] = (day.byCategory[e.category] ?? 0) + e.copper; }
    }
    if (now - e.ms <= WEEK_MS) week[e.direction] += e.copper;
  }
  week.net = week.in - week.out;

  events.sort((a, b) => b.ms - a.ms);
  return {
    madeAt: new Date(now).toISOString(),
    roster: [...roster.values()].sort((a, b) => (b.copper ?? -1) - (a.copper ?? -1) || a.character.localeCompare(b.character)),
    river,
    week,
    categories: [...totals.values()].sort((a, b) => b.copper - a.copper || a.category.localeCompare(b.category)),
    receipts: events.slice(0, RECEIPTS_SHOWN).map(({ ms: _ms, ...e }) => e),
    eventCount: events.length,
    history: [...series.values()]
      .map((s) => ({ ...s, points: thin(s.points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) }))
      .sort((a, b) => a.character.localeCompare(b.character)),
  };
}

/** A category as the page shows it: the record's own name, underscores as spaces ("auction_spend" → "auction spend"). */
export const categoryLabel = (category: string) => category.replaceAll("_", " ");

/** Checks a summary read back from localStorage still has the shape this version writes. */
export function isMoneyLedger(value: unknown): value is MoneyLedger {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.madeAt === "string" && Array.isArray(v.roster) && Array.isArray(v.river) && Array.isArray(v.categories)
    && Array.isArray(v.receipts) && Array.isArray(v.history) && typeof v.eventCount === "number"
    && typeof v.week === "object" && v.week !== null;
}
