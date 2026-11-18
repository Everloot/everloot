import { expect, test } from "vitest";
import { lootWindowsFromRecords, rollupDrops } from "../src/drop-rollup.js";
import { measureDropRate, meetsDropRateSettlingRule } from "../src/drop-rate-settling.js";

const dataAsOf = "2026-10-21T12:00:00.000Z";
const measure = (drops: number, kills: number, reporters = 5) =>
  measureDropRate({ drops, kills, reporters }, dataAsOf);

test("50 windows can settle, but 49 cannot, with the same five voters", () => {
  expect(measure(25, 49).settled).toBe(false);
  expect(measure(25, 50).settled).toBe(true);
});

test("five source voters can settle, but four cannot", () => {
  expect(measure(25, 50, 4).settled).toBe(false);
  expect(measure(25, 50, 5).settled).toBe(true);
});

test("a measurement states its numerator, window denominator, voters, date and method", () => {
  const result = measure(25, 50);
  expect(result).toMatchObject({
    drops: 25, windows: 50, voters: 5, rate: 0.5, dataAsOf,
    method: "wilson", confidence: 0.95, settled: true,
  });
  expect(result.interval!.lower).toBeCloseTo(0.3664451432, 9);
  expect(result.interval!.upper).toBeCloseTo(0.6335548568, 9);
  expect(result.interval!.halfWidth).toBeCloseTo(0.1335548568, 9);
});

test("the absolute limit includes exactly three percentage points", () => {
  const counts = { windows: 500, voters: 5, rate: 0.01 };
  expect(meetsDropRateSettlingRule({ ...counts, halfWidth: 0.03 })).toBe(true);
  expect(meetsDropRateSettlingRule({ ...counts, halfWidth: 0.030000001 })).toBe(false);
});

test("the relative limit includes exactly thirty percent of the rate", () => {
  const counts = { windows: 50, voters: 5, rate: 0.5 };
  expect(meetsDropRateSettlingRule({ ...counts, halfWidth: 0.15 })).toBe(true);
  expect(meetsDropRateSettlingRule({ ...counts, halfWidth: 0.150000001 })).toBe(false);
});

test("precision can keep a rate open after both sample minimums are met", () => {
  expect(measure(5, 50).settled).toBe(false);
  expect(measure(50, 500).settled).toBe(true);
  // Here the absolute allowance is larger than the relative allowance.
  expect(measure(1, 100).settled).toBe(true);
});

test("no windows means an unknown rate and interval, never a measured zero", () => {
  expect(measure(0, 0, 0)).toMatchObject({
    drops: 0, windows: 0, voters: 0, rate: null, interval: null, settled: false, dataAsOf,
  });
});

test("zero and all-success samples retain Wilson uncertainty and bounded intervals", () => {
  const zero = measure(0, 50);
  expect(zero.interval!.lower).toBeCloseTo(0, 12);
  expect(zero.interval!.upper).toBeCloseTo(0.0713475991, 9);
  expect(zero.settled).toBe(false);
  expect(measure(0, 100).settled).toBe(true);
  const all = measure(50, 50);
  expect(all.interval!.lower).toBeCloseTo(0.9286524009, 9);
  expect(all.interval!.upper).toBe(1);
  expect(all.settled).toBe(true);
});

test("source-attributed windows count once per item, with empty windows and source voters", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    kind: "loot", sourceEvidence: "loot-api", installId: `voter-${i % 5}`,
    sourceObjectId: 900,
    items: i < 25 ? [{ itemId: 77, count: 2 }, { itemId: 77, count: 3 }] : [],
  }));
  const { rates } = rollupDrops(lootWindowsFromRecords(rows));
  expect(measureDropRate(rates[0], dataAsOf)).toMatchObject({
    drops: 25, windows: 50, voters: 5, rate: 0.5, settled: true,
  });
  expect(rates[0]).toEqual({
    sourceObjectId: 900, itemId: 77, kills: 50, drops: 25, units: 125, rate: 0.5, reporters: 5, public: true,
  });
});

test("pending Recorder loot cannot supply the fiftieth window or fifth voter", () => {
  const attributed = Array.from({ length: 49 }, (_, i) => ({
    kind: "loot", sourceEvidence: "loot-api", installId: `voter-${i % 4}`,
    sourceNpcId: 7, items: i < 25 ? [{ itemId: 11, count: 1 }] : [],
  }));
  const pending = Array.from({ length: 100 }, (_, i) => ({
    kind: "loot", installId: `ps-char${i}-addr${i}`,
    sourceNpcId: 7, items: [{ itemId: 11, count: 1 }],
  }));
  const { rates } = rollupDrops(lootWindowsFromRecords([...attributed, ...pending]));
  expect(measureDropRate(rates[0], dataAsOf)).toMatchObject({
    drops: 25, windows: 49, voters: 4, settled: false,
  });
});
