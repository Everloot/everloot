import type { PublicDay } from "@kb/market";
import { priceMove, solidDays, type Move, type MarketRow, type RealmBoard } from "./auction-house";

/**
 * The Market changes view (app/tools/auctions/[realm]/changes): one realm and house's week, as `priceMove` defines a
 * week move (the newest solid day, today or yesterday, against the solid day 7 days before it, up to 3 days earlier
 * when scans are not daily). Thin days and days the market value trims never drive a move. Every row that has no
 * move says why, in one of the states below; nothing invents a change when a baseline is absent. The output is
 * bounded: `CHANGES_SHOWN` risers, as many fallers and as many rows without a comparison.
 */

/** Rows each table shows at most. */
export const CHANGES_SHOWN = 25;
export const WEEK = 7;
/** How many days earlier than the week mark the baseline may fall (as `priceMove` allows). */
export const WEEK_SLACK = 3;

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const todayNumber = (now: Date) => Math.floor(now.getTime() / DAY_MS);
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Why a row has no week comparison. */
export type NoChangeState = "new" | "thin" | "trimmed" | "stale" | "no baseline";
/** The states in the order the list groups them. */
export const NO_CHANGE_STATES: readonly NoChangeState[] = ["new", "thin", "trimmed", "stale", "no baseline"];

/** One sentence per state, for the page's key. */
export const STATE_RULE: Record<NoChangeState, string> = {
  new: "first public day inside the last 7 days, so there is no day a week earlier to compare with",
  thin: "the newest public day lists 5 units or fewer, and no solid day is today or yesterday",
  trimmed: "the newest public day is far from the historical value and the market value trims it, and no solid day is today or yesterday",
  stale: "the newest public day is older than yesterday, so the week has no current end",
  "no baseline": "no solid day falls 7 to 10 days before the newest solid day",
};

export interface Compared {
  row: MarketRow;
  move: Move;
  /** Set when the row's newest public day is not the move's end day: a thin or trimmed day after the compared one. */
  newestExcluded: "thin" | "trimmed" | null;
}

export interface NotCompared {
  row: MarketRow;
  state: NoChangeState;
}

export interface WeeklyChanges {
  /** The newest solid day among the compared rows: the comparison's end. Null with no comparison. */
  endDay: string | null;
  /** 7 days before `endDay`; a baseline falls on it or up to WEEK_SLACK days earlier. Null with no comparison. */
  startDay: string | null;
  /** The earliest and latest baseline days the compared rows use. Null with no comparison. */
  baselineDays: { earliest: string; latest: string } | null;
  risers: Compared[];
  fallers: Compared[];
  risersTotal: number;
  fallersTotal: number;
  /** Rows with a baseline whose value did not change. */
  unchanged: number;
  notCompared: NotCompared[];
  notComparedTotal: number;
  counts: Record<NoChangeState, number>;
  /** Rows whose newest public day is public under 3 reporters (Everloot's own scans). */
  ownScans: boolean;
}

/** The day `priceMove` compares a row from, when it has one: the same search, so the states agree with the move. */
function baselineOf(solid: PublicDay[], to: PublicDay): PublicDay | undefined {
  const target = dayNumber(to.day) - WEEK;
  return [...solid].reverse().find((p) => dayNumber(p.day) <= target && dayNumber(p.day) >= target - WEEK_SLACK);
}

/** Why a row has no move, by the same rules `priceMove` applies; "unchanged" when it has a baseline at the same value. */
export function noChangeState(row: MarketRow, now: Date): NoChangeState | "unchanged" {
  const today = todayNumber(now);
  const newest = row.points.at(-1);
  if (!newest) return "stale";
  if (today - dayNumber(row.points[0]!.day) < WEEK) return "new";
  if (today - dayNumber(newest.day) > 1) return "stale";
  const solid = solidDays(row.points);
  const to = solid.at(-1);
  if (!to || today - dayNumber(to.day) > 1) return newest.thin ? "thin" : "trimmed";
  const from = baselineOf(solid, to);
  if (!from || from.market <= 0) return "no baseline";
  return "unchanged";
}

const byItem = (a: MarketRow, b: MarketRow) => a.value.itemId - b.value.itemId;

/**
 * The week on one board (one realm, one house, or its houses apart): risers and fallers by percentage, ties by item id,
 * each at most CHANGES_SHOWN, then the rows with no comparison grouped by state, the most units listed first.
 */
export function weeklyChanges(board: Pick<RealmBoard, "rows">, now: Date): WeeklyChanges {
  const compared: Compared[] = [];
  const notCompared: NotCompared[] = [];
  const counts: Record<NoChangeState, number> = { new: 0, thin: 0, trimmed: 0, stale: 0, "no baseline": 0 };
  let unchanged = 0;
  let ownScans = false;
  for (const row of board.rows) {
    if (row.value.reporters < 3) ownScans = true;
    const move = priceMove(row, WEEK, now);
    if (move) {
      const newest = row.points.at(-1)!;
      compared.push({ row, move, newestExcluded: newest.day === move.to.day ? null : newest.thin ? "thin" : "trimmed" });
      continue;
    }
    const state = noChangeState(row, now);
    if (state === "unchanged") { unchanged++; continue; }
    counts[state]++;
    notCompared.push({ row, state });
  }
  const risers = compared.filter((c) => c.move.change > 0).sort((a, b) => b.move.change - a.move.change || byItem(a.row, b.row));
  const fallers = compared.filter((c) => c.move.change < 0).sort((a, b) => a.move.change - b.move.change || byItem(a.row, b.row));
  const ends = compared.map((c) => c.move.to.day).sort();
  const starts = compared.map((c) => c.move.from.day).sort();
  const endDay = ends.at(-1) ?? null;
  notCompared.sort((a, b) => NO_CHANGE_STATES.indexOf(a.state) - NO_CHANGE_STATES.indexOf(b.state) || b.row.value.quantity - a.row.value.quantity || byItem(a.row, b.row));
  return {
    endDay,
    startDay: endDay ? dayString(dayNumber(endDay) - WEEK) : null,
    baselineDays: starts.length ? { earliest: starts[0]!, latest: starts.at(-1)! } : null,
    risers: risers.slice(0, CHANGES_SHOWN),
    fallers: fallers.slice(0, CHANGES_SHOWN),
    risersTotal: risers.length,
    fallersTotal: fallers.length,
    unchanged,
    notCompared: notCompared.slice(0, CHANGES_SHOWN),
    notComparedTotal: notCompared.length,
    counts,
    ownScans,
  };
}
