import { expect, test } from "vitest";
import { priceGuideRecipe, requestedGuideItems } from "./profession-guide-prices";

const recipe = {
  reagents: [{ itemId: 1, count: 2 }, { itemId: 2, count: 1 }],
  output: { itemId: 3, minimum: 1, maximum: 3, vendorSellCopper: 10 },
};

test("compares reagent acquisition and applies the selected house cut to estimated sales and disenchant returns", () => {
  const quotes = { buy: new Map([[1, 18], [2, 12], [3, 100]]), resale: new Map([[3, 80], [4, 20]]) };
  expect(requestedGuideItems([{ ...recipe, unlockReagents: [{ itemId: 5, count: 1 }] }], { 3: [{ itemId: 4, count: 1.5 }] })).toEqual([1, 2, 3, 4, 5]);
  expect(priceGuideRecipe(recipe, quotes, { 1: 15 }, "Neutral", [{ itemId: 4, count: 1.5 }])).toEqual({
    materials: 42, vendor: 22, auction: -94, disenchant: -9,
  });
});

test("keeps missing purchases, resale prices, or yields unknown and preserves real zero prices", () => {
  expect(priceGuideRecipe(recipe, { buy: new Map([[1, 0]]), resale: new Map() }, {}, "Alliance")).toEqual({
    materials: null, vendor: null, auction: null, disenchant: null,
  });
  expect(priceGuideRecipe({ ...recipe, output: { itemId: 3, minimum: null, maximum: null } }, { buy: new Map([[1, 0], [2, 0]]), resale: new Map([[3, 50]]) }, {}, "Alliance")).toEqual({
    materials: 0, vendor: null, auction: null, disenchant: null,
  });
});

test("keeps an unfiltered auction minimum out of resale and uses vendor recovery only for known zero disenchant value", () => {
  const quotes = { buy: new Map([[1, 15], [2, 12], [3, 100]]), resale: new Map([[4, 0]]) };
  const costs = { materials: 42, vendor: 22, auction: null };
  expect(priceGuideRecipe(recipe, quotes, {}, "Neutral")).toEqual({ ...costs, disenchant: null });
  expect(priceGuideRecipe(recipe, quotes, {}, "Neutral", [{ itemId: 5, count: 1 }])).toEqual({ ...costs, disenchant: null });
  expect(priceGuideRecipe(recipe, quotes, {}, "Neutral", [])).toEqual({ ...costs, disenchant: 22 });
  expect(priceGuideRecipe(recipe, quotes, {}, "Neutral", [{ itemId: 4, count: 1.5 }])).toEqual({ ...costs, disenchant: 22 });
  expect(priceGuideRecipe({ ...recipe, output: null }, quotes, {}, "Neutral")).toEqual({
    materials: 42, vendor: 42, auction: 42, disenchant: 42,
  });
});
