import { expect, test } from "vitest";
import { planGuideShopping, type GuideShoppingRecipe } from "./profession-guide-shopping";

const step = (recipeId: number, fromSkill: number, plannedCrafts: number, ...reagents: [number, number][]) => ({
  recipeId, fromSkill, plannedCrafts, reagents: reagents.map(([itemId, count]) => ({ itemId, count })),
});

const craft = (id: number, itemId: number, minimum: number | null, reagents: [number, number][], repeatable = true): GuideShoppingRecipe => ({
  id, name: `Recipe ${id}`, output: { itemId, minimum }, repeatable,
  reagents: reagents.map(([itemId, count]) => ({ itemId, count })),
});

const prices = (copper: Record<number, number>) => (itemId: number) => copper[itemId] ?? null;

test("adds a rank quest's ingredients once after earlier craft output and before crossing its cap", () => {
  const plan = planGuideShopping([
    { ...step(10, 1, 2, [101, 2]), toSkill: 3 },
    { ...step(11, 3, 2, [102, 1]), toSkill: 5 },
  ], [craft(10, 102, 2, [[101, 1]])], prices({ 101: 5, 102: 30 }), {
    rankRequirements: [{ beforeSkill: 4, reagents: [{ itemId: 102, count: 4 }] }],
  });
  expect(plan.purchases).toMatchObject([{ itemId: 101, count: 2 }, { itemId: 102, count: 1 }]);
});

test("uses earlier output once across consecutive steps and buys the remaining shortfall", () => {
  const plan = planGuideShopping([
    step(10, 1, 2, [101, 2]),
    step(11, 3, 1, [102, 3]),
    step(12, 4, 1, [102, 2]),
  ], [craft(10, 102, 2, [[101, 1]])], prices({ 101: 5, 102: 30 }));

  expect(plan.purchases).toEqual([
    { itemId: 101, count: 2, unitCopper: 5, copper: 10 },
    { itemId: 102, count: 1, unitCopper: 30, copper: 30 },
  ]);
  expect(plan).toMatchObject({ crafts: [], leftovers: [], copper: 40, knownCopper: 40 });
});

test("plans whole intermediate batches only after the route has learned that recipe and carries forward leftovers", () => {
  const plan = planGuideShopping([
    step(11, 1, 1, [102, 1]),
    step(10, 2, 1, [101, 2]),
    step(12, 4, 2, [102, 5]),
    step(13, 6, 1, [102, 1]),
  ], [craft(10, 102, 2, [[101, 2]])], prices({ 101: 5, 102: 20 }), { makeIfCheaper: true });

  expect(plan.purchases).toMatchObject([{ itemId: 101, count: 6 }, { itemId: 102, count: 1 }]);
  expect(plan.crafts).toEqual([{ recipeId: 10, recipeName: "Recipe 10", itemId: 102, crafts: 2, outputCount: 4, beforeSkill: 4 }]);
  expect(plan.leftovers).toEqual([]);
  expect(plan.copper).toBe(50);
});

test("uses an explicitly known recipe only at or after its available skill", () => {
  const plan = planGuideShopping([step(20, 2, 1, [102, 1]), step(21, 3, 1, [102, 1])], [
    craft(10, 102, 1, [[101, 1]]),
    craft(11, 102, 1, [[103, 1]], false),
    craft(12, 102, null, [[103, 1]]),
  ], prices({ 101: 3, 102: 15, 103: 0 }), {
    makeIfCheaper: true, knownFromSkill: new Map([[10, 3], [11, 1], [12, 1]]),
  });

  expect(plan.purchases).toMatchObject([{ itemId: 101, count: 1 }, { itemId: 102, count: 1 }]);
  expect(plan.crafts).toMatchObject([{ recipeId: 10, beforeSkill: 3 }]);
  expect(plan.copper).toBe(18);
});

test("buys direct when a crafting chain loops and preserves a missing quote beside priced leaves", () => {
  const plan = planGuideShopping([step(20, 5, 1, [101, 1], [103, 2])], [
    craft(10, 101, 3, [[102, 1]]),
    craft(11, 102, 1, [[101, 1]]),
  ], prices({ 101: 25 }), { makeIfCheaper: true, knownFromSkill: new Map([[10, 1], [11, 1]]) });

  expect(plan.purchases).toEqual([
    { itemId: 101, count: 1, unitCopper: 25, copper: 25 },
    { itemId: 103, count: 2, unitCopper: null, copper: null },
  ]);
  expect(plan).toMatchObject({ crafts: [], copper: null, knownCopper: 25 });
});

test("lists nested crafts in dependency order using known leaf costs when direct price is missing", () => {
  const plan = planGuideShopping([step(20, 5, 1, [103, 3])], [
    craft(10, 103, 2, [[102, 2]]),
    craft(11, 102, 3, [[101, 1]]),
  ], prices({ 101: 4, 102: 30 }), { makeIfCheaper: true, knownFromSkill: new Map([[10, 1], [11, 1]]) });

  expect(plan.purchases).toMatchObject([{ itemId: 101, count: 2 }]);
  expect(plan.crafts).toMatchObject([
    { recipeId: 11, crafts: 2, outputCount: 6 },
    { recipeId: 10, crafts: 2, outputCount: 4 },
  ]);
  expect(plan.leftovers).toEqual([{ itemId: 102, count: 2 }, { itemId: 103, count: 1 }]);
  expect(plan.copper).toBe(8);
});

test("does not spend stock while evaluating a losing craft alternative", () => {
  const plan = planGuideShopping([step(10, 1, 1, [100, 1]), step(20, 2, 1, [103, 1], [102, 1])], [
    craft(10, 102, 1, [[100, 1]]),
    craft(11, 103, 1, [[102, 1], [101, 1]]),
  ], prices({ 100: 4, 101: 50, 102: 90, 103: 10 }), { makeIfCheaper: true, knownFromSkill: new Map([[11, 1]]) });

  expect(plan.purchases).toMatchObject([{ itemId: 100, count: 1 }, { itemId: 103, count: 1 }]);
  expect(plan).toMatchObject({ crafts: [], leftovers: [], copper: 14 });
});

test("includes quest unlock reagents once and can use materials carried from previous steps", () => {
  const steps = [step(10, 1, 1, [101, 1]), step(11, 2, 1, [103, 2]), step(11, 3, 1, [103, 2])];
  const recipes = [craft(10, 102, 2, [[101, 1]]), {
    ...craft(11, 104, 1, [[103, 2]]), unlockReagents: [{ itemId: 102, count: 3 }, { itemId: 103, count: 1 }],
  }];
  const quote = prices({ 101: 1, 102: 4, 103: 2 });

  const firstLearn = planGuideShopping(steps, recipes, quote);
  expect(firstLearn.purchases).toMatchObject([{ itemId: 101, count: 1 }, { itemId: 102, count: 1 }, { itemId: 103, count: 5 }]);
  expect(firstLearn.copper).toBe(15);

  const knownRecipe = planGuideShopping(steps, recipes, quote, { knownFromSkill: new Map([[11, 2]]) });
  expect(knownRecipe.purchases).toMatchObject([{ itemId: 101, count: 1 }, { itemId: 103, count: 4 }]);
  expect(knownRecipe.copper).toBe(9);
});
