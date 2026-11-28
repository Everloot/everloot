import { expect, test } from "vitest";
import type { BlizzardHouseItem } from "@/lib/blizzard-auctions";
import { blackwaterHouse, crossHousePrices, factionHouseForComparison } from "./compare";

const now = Date.parse("2026-11-27T22:00:00Z");
const at = "2026-11-27T21:30:00Z";
const row = (itemId: number, minUnit: number, typicalUnit: number, snapshotAt = at): BlizzardHouseItem =>
  ({ itemId, kind: "items", snapshotAt, minUnit, typicalUnit, quantity: 10, auctions: 3 });

test("only pairs the faction house and Blackwater on the same ruleset", () => {
  expect([blackwaterHouse(110), blackwaterHouse(114), blackwaterHouse(119), blackwaterHouse(124)]).toEqual([116, 117, 121, 125]);
  expect(blackwaterHouse(121)).toBeNull();
  expect(factionHouseForComparison(125)).toBe(123);
  expect(factionHouseForComparison(124)).toBe(124);
});

test("quotes one unit, includes both directions and applies cut and deposit to the destination", () => {
  const alliance = [row(1, 100, 110), row(2, 450, 480)];
  const neutral = [row(1, 145, 200), row(2, 150, 160)];
  expect(crossHousePrices(alliance, neutral, now, 10)).toMatchObject([
    { itemId: 2, to: "faction", buy: 150, resale: 480, net: 296, breakEven: 169 },
    { itemId: 1, to: "blackwater", buy: 100, resale: 200, net: 60, breakEven: 130 },
  ]);
});

test("omits stale or mismatched documents and exposes a pre-deposit estimate", () => {
  const alliance = [row(1, 100, 110), row(2, 90, 100), row(3, 5, 10)];
  const neutral = [row(1, 145, 200), row(2, 130, 200, "2026-11-27T18:00:00Z"), { ...row(3, 90, 100), kind: "commodities" as const }];
  expect(crossHousePrices(alliance, neutral, now, null)).toMatchObject([{ itemId: 1, net: 70, breakEven: 118 }]);
});
