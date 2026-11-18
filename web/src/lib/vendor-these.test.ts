import { expect, test } from "vitest";
import type { MarketRow } from "./auction-house";
import { vendorCandidates, vendorThese } from "./vendor-these";

const realm = { key: "forever", name: "Forever", slug: "forever", ruleset: "forever" };
const row = (itemId: number, market: number | null, over: Partial<MarketRow["value"]> = {}): MarketRow => ({
  realm, house: "Horde", points: [], listings: null, updatedAt: null,
  value: { itemId, market, min: market ?? 1, historical: market ?? 1, quantity: 20, day: "2026-11-17", ageDays: 0, reporters: 3, thin: false, ...over },
});
const prices = (map: Record<number, number>) => (id: number) => map[id];

test("an item is listed when the market after the cut equals the vendor price, and not when the vendor pays a copper less", () => {
  // 100 less 5% is 95.
  expect(vendorThese([row(1, 100)], "Horde", prices({ 1: 95 })).map((v) => [v.itemId, v.afterCut, v.more])).toEqual([[1, 95, 0]]);
  expect(vendorThese([row(1, 100)], "Horde", prices({ 1: 94 }))).toEqual([]);
});

test("the after-cut value is rounded down, as the addon does", () => {
  // 33 less 5% is 31.35: 31.
  expect(vendorThese([row(1, 33)], "Alliance", prices({ 1: 31 }))[0]?.afterCut).toBe(31);
});

test("the neutral house takes 15%, so an item a faction house keeps can belong on the neutral list", () => {
  expect(vendorThese([row(1, 100)], "Neutral", prices({ 1: 85 })).map((v) => v.afterCut)).toEqual([85]);
  expect(vendorThese([row(1, 100)], "Horde", prices({ 1: 85 }))).toEqual([]);
});

test("no market value, a thin market or a stale one is left out; two days old still counts", () => {
  const rows = [row(1, null), row(2, 100, { thin: true, quantity: 5 }), row(3, 100, { ageDays: 3 }), row(4, 100, { ageDays: 2 })];
  const sell = prices({ 1: 500, 2: 500, 3: 500, 4: 500 });
  expect(vendorThese(rows, "Horde", sell).map((v) => v.itemId)).toEqual([4]);
  expect(vendorCandidates(rows)).toEqual([4]);
});

test("an item with no vendor price, or one a vendor will not buy, is left out", () => {
  expect(vendorThese([row(1, 10), row(2, 10)], "Horde", prices({ 2: 0 }))).toEqual([]);
});

test("the biggest difference per unit comes first, ties by item id", () => {
  const rows = [row(1, 100), row(2, 100), row(3, 100), row(4, 100)];
  // After the cut each is 95.
  const out = vendorThese(rows, "Horde", prices({ 1: 100, 2: 300, 3: 100, 4: 200 }));
  expect(out.map((v) => [v.itemId, v.more])).toEqual([[2, 205], [4, 105], [1, 5], [3, 5]]);
});
