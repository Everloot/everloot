import { expect, test } from "vitest";
import type { PublicDay } from "@kb/market";
import type { MarketRow, RealmRef } from "./auction-house";
import { CHANGES_SHOWN, NO_CHANGE_STATES, STATE_RULE, noChangeState, weeklyChanges } from "./market-changes";

const now = new Date("2026-11-19T12:00:00.000Z");
const DAY_MS = 86_400_000;
const day = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
const realm: RealmRef = { key: "forever", name: "Forever", slug: "forever", ruleset: "forever" };

/** A public day `daysAgo` at `market` copper; 40 units unless given, 3 reporters unless given. Thin follows the units. */
const at = (daysAgo: number, market: number, quantity = 40, reporters = 3): PublicDay =>
  ({ day: day(daysAgo), min: market, market, quantity, reporters, thin: quantity <= 5 });

/** One Horde row from its days (any order); the value is the newest day's, as the rollup makes it. */
function row(itemId: number, days: PublicDay[]): MarketRow {
  const points = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const newest = points.at(-1)!;
  return {
    realm, house: "Horde", points, listings: null, updatedAt: null,
    value: { itemId, market: newest.market, min: newest.min, historical: newest.market, quantity: newest.quantity, day: newest.day, ageDays: 0, reporters: newest.reporters, thin: newest.thin },
  };
}

test("a plain rise and fall are compared on the newest solid day and the day a week before, each row naming its days", () => {
  const c = weeklyChanges({ rows: [row(1, [at(7, 100), at(0, 125)]), row(2, [at(7, 200), at(0, 150)])] }, now);
  expect(c.risers.map((r) => [r.row.value.itemId, r.move.change, r.move.from.day, r.move.to.day])).toEqual([[1, 0.25, day(7), day(0)]]);
  expect(c.fallers.map((r) => [r.row.value.itemId, r.move.change])).toEqual([[2, -0.25]]);
  expect(c.risersTotal).toBe(1);
  expect(c.fallersTotal).toBe(1);
  expect([c.endDay, c.startDay]).toEqual([day(0), day(7)]);
  expect(c.baselineDays).toEqual({ earliest: day(7), latest: day(7) });
  expect(c.notCompared).toEqual([]);
  expect(c.unchanged).toBe(0);
  expect(c.ownScans).toBe(false);
  expect(c.risers[0]!.newestExcluded).toBeNull();
});

test("a baseline may fall up to three days before the week mark, and the period says which days the rows use", () => {
  const c = weeklyChanges({ rows: [row(1, [at(10, 100), at(0, 110)]), row(2, [at(8, 100), at(1, 90)])] }, now);
  expect(c.risers[0]!.move.from.day).toBe(day(10));
  expect(c.fallers[0]!.move.from.day).toBe(day(8));
  expect(c.fallers[0]!.move.to.day).toBe(day(1));
  // The end is the newest compared day; the baselines span the rows' own days.
  expect([c.endDay, c.startDay]).toEqual([day(0), day(7)]);
  expect(c.baselineDays).toEqual({ earliest: day(10), latest: day(8) });
  // Four days before the mark is too far: no baseline.
  const far = weeklyChanges({ rows: [row(3, [at(11, 100), at(0, 110)])] }, now);
  expect(far.risers).toEqual([]);
  expect(far.notCompared.map((n) => n.state)).toEqual(["no baseline"]);
});

test("a thin spike on the newest day never drives a move: the move uses the last solid day and says the newest was not used", () => {
  // Yesterday solid at 120 (up 20% on the week before it), today 5 units at 900.
  const spike = row(1, [at(8, 100), at(1, 120), at(0, 900, 5)]);
  const c = weeklyChanges({ rows: [spike] }, now);
  expect(c.risers.map((r) => [r.move.from.day, r.move.to.day, r.move.to.market, r.newestExcluded])).toEqual([[day(8), day(1), 120, "thin"]]);
  expect(c.risers[0]!.move.change).toBeCloseTo(0.2);
  // With no solid day today or yesterday, the thin spike leaves the row without a comparison, not with a +800% rise.
  const only = weeklyChanges({ rows: [row(2, [at(7, 100), at(0, 900, 5)])] }, now);
  expect(only.risers).toEqual([]);
  expect(only.notCompared.map((n) => [n.row.value.itemId, n.state])).toEqual([[2, "thin"]]);
});

test("a day the market value trims as an outlier never drives a move either, and the row says it was trimmed", () => {
  // Five solid days around 100, then today at 1000: with 5 or more solid days, a day over 3x the median is trimmed.
  // Yesterday (99) against the week before it (day 8: 99) is the comparison: unchanged, not a +910% rise.
  const trimmed = row(1, [at(12, 100), at(10, 102), at(8, 99), at(7, 101), at(1, 99), at(0, 1000)]);
  const c = weeklyChanges({ rows: [trimmed] }, now);
  expect([c.risers, c.fallers, c.notCompared, c.unchanged]).toEqual([[], [], [], 1]);
  const spiked = row(2, [at(12, 100), at(10, 102), at(9, 90), at(1, 110), at(0, 1000)]);
  const s = weeklyChanges({ rows: [spiked] }, now);
  expect(s.risers.map((r) => [r.move.from.day, r.move.to.day, r.newestExcluded])).toEqual([[day(9), day(1), "trimmed"]]);
  expect(s.risers[0]!.move.change).toBeCloseTo(110 / 90 - 1);
  // The same days with the spike as the only current day: trimmed, so no comparison.
  const alone = row(3, [at(13, 100), at(12, 102), at(11, 98), at(10, 101), at(9, 99), at(0, 1000)]);
  expect(weeklyChanges({ rows: [alone] }, now).notCompared.map((n) => n.state)).toEqual(["trimmed"]);
});

test("a new item, a missing baseline and a stale newest day are named, and none of them gets a number", () => {
  const rows = [
    row(1, [at(3, 100), at(0, 150)]),
    row(2, [at(20, 100), at(0, 150)]),
    row(3, [at(9, 100), at(2, 150)]),
    // Stale before new: the first day is inside the week, so it reads new.
    row(4, [at(5, 100), at(4, 150)]),
  ];
  const c = weeklyChanges({ rows }, now);
  expect(c.risers).toEqual([]);
  expect(c.fallers).toEqual([]);
  expect(c.notCompared.map((n) => [n.row.value.itemId, n.state])).toEqual([[1, "new"], [4, "new"], [3, "stale"], [2, "no baseline"]]);
  expect(c.counts).toEqual({ new: 2, thin: 0, trimmed: 0, stale: 1, "no baseline": 1 });
  expect([c.endDay, c.startDay, c.baselineDays]).toEqual([null, null, null]);
  expect(noChangeState(row(5, [at(7, 100), at(0, 100)]), now)).toBe("unchanged");
  expect(noChangeState(row(6, [at(7, 0), at(0, 100)]), now)).toBe("no baseline");
});

test("partial coverage: only the rows with a week pair are compared, the rest are listed by state, most units first", () => {
  const rows = [
    row(1, [at(7, 100), at(0, 130)]),
    row(2, [at(2, 100), at(0, 130)]),
    row(3, [at(7, 100), at(0, 100)]),
    row(4, [at(15, 100), at(0, 130, 200)]),
    row(5, [at(15, 100), at(0, 130, 300)]),
    row(6, [at(7, 100), at(0, 130, 40, 1)]),
  ];
  const c = weeklyChanges({ rows }, now);
  expect(c.risers.map((r) => r.row.value.itemId)).toEqual([1, 6]);
  expect(c.unchanged).toBe(1);
  expect(c.notCompared.map((n) => [n.row.value.itemId, n.state])).toEqual([[2, "new"], [5, "no baseline"], [4, "no baseline"]]);
  expect(c.notComparedTotal).toBe(3);
  // Row 6's newest day is public under 3 reporters.
  expect(c.ownScans).toBe(true);
});

test("the output is bounded: 26 risers show 25 by percentage, ties by item id, and the totals say how many there are", () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(100 - i, [at(7, 100), at(0, 100 + (i % 26) + 1)]));
  rows.push(row(1000, [at(7, 100), at(0, 50)]), row(999, [at(7, 100), at(0, 50)]));
  const c = weeklyChanges({ rows }, now);
  expect(c.risers).toHaveLength(CHANGES_SHOWN);
  expect(c.risersTotal).toBe(30);
  expect(c.risers[0]!.move.change).toBeCloseTo(0.26);
  // The second lap (i = 26 to 29) repeats +1% to +4%: among equals the lower item id comes first.
  const changes = c.risers.map((r) => r.move.change);
  expect([...changes].sort((a, b) => b - a)).toEqual(changes);
  for (let i = 1; i < c.risers.length; i++) {
    if (c.risers[i]!.move.change === c.risers[i - 1]!.move.change) expect(c.risers[i]!.row.value.itemId).toBeGreaterThan(c.risers[i - 1]!.row.value.itemId);
  }
  expect(c.fallers.map((r) => r.row.value.itemId)).toEqual([999, 1000]);
  const many = weeklyChanges({ rows: Array.from({ length: 40 }, (_, i) => row(i + 1, [at(2, 100), at(0, 110)])) }, now);
  expect(many.notCompared).toHaveLength(CHANGES_SHOWN);
  expect(many.notComparedTotal).toBe(40);
});

test("an empty board and every state have words", () => {
  const c = weeklyChanges({ rows: [] }, now);
  expect(c).toMatchObject({ endDay: null, startDay: null, risers: [], fallers: [], notCompared: [], risersTotal: 0, fallersTotal: 0, notComparedTotal: 0, unchanged: 0 });
  for (const s of NO_CHANGE_STATES) expect(STATE_RULE[s]).toMatch(/\S/);
});
