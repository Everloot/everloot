import { describe, expect, test } from "vitest";
import { planProfessionGuide, type GuideRecipe, type GuideWindow } from "../src/profession-guide.js";

const certain = (fromSkill: number, toSkill: number): GuideWindow => ({
  fromSkill, toSkill, points: 1, chance: 1, evidence: "observed",
});

function recipe(id: number, windows: GuideWindow[], materialCost: number | null, other: Partial<GuideRecipe> = {}): GuideRecipe {
  return { id, name: `Recipe ${id}`, windows, prices: { materials: materialCost }, reagents: [{ itemId: id + 1000, count: 1 }], ...other };
}

describe("profession leveling guide", () => {
  test("keeps the smallest unsupported interval when taking a multi-point craft would skip a better unlock", () => {
    const route = planProfessionGuide([
      recipe(1, [{ ...certain(1, 2), points: 2 }], 1),
      recipe(2, [{ ...certain(2, 3), points: 4 }], 10),
    ], { fromSkill: 1, toSkill: 6, mode: "materials" });
    expect(route.gaps).toEqual([{ fromSkill: 1, toSkill: 2 }]);
    expect(route.steps).toMatchObject([{ recipeId: 2, fromSkill: 2, toSkill: 6 }]);
  });

  test("profit modes exclude low-chance crafts that otherwise rank higher just for presumed resale", () => {
    const uncertain = { ...certain(11, 12), chance: 0.05, evidence: "modeled" } as const;
    const all = [
      recipe(1, [uncertain], 1, { prices: { materials: 1, auction: -50 } }),
      recipe(2, [certain(11, 12)], 100, { prices: { materials: 100, auction: 10 } }),
    ];
    expect(planProfessionGuide(all, { fromSkill: 11, toSkill: 12, mode: "auction" }).steps[0]?.recipeId).toBe(2);
    expect(planProfessionGuide(all, { fromSkill: 11, toSkill: 12, mode: "materials" }).steps[0]?.recipeId).toBe(1);
  });
  test("compares cost per expected skill point and shows an alternate over the same skill range", () => {
    const uncertain = { ...certain(10, 13), chance: 0.4, evidence: "modeled" } as const;
    const route = planProfessionGuide([recipe(1, [uncertain], 20), recipe(2, [certain(10, 13)], 55)], {
      fromSkill: 10, toSkill: 13, mode: "materials",
    });

    expect(route.steps).toMatchObject([{
      recipeId: 1, fromSkill: 10, toSkill: 13, expectedCrafts: 7.5, plannedCrafts: 8,
      expectedCopper: 150, evidence: "modeled", probabilistic: true,
      reagents: [{ itemId: 1001, count: 8 }],
      alternatives: [{ recipeId: 2, expectedCrafts: 3, plannedCrafts: 3, expectedCopper: 165, probabilistic: false }],
    }]);
    expect(route).toMatchObject({ totalExpectedCrafts: 7.5, totalPlannedCrafts: 8, expectedCopper: 150, probabilistic: true });
  });

  test("rounds consecutive modeled ranks of the same recipe once for the shopping list", () => {
    const modeled = (fromSkill: number, chance: number) => ({ ...certain(fromSkill, fromSkill + 1), chance, evidence: "modeled" as const });
    const route = planProfessionGuide([recipe(1, [certain(1, 2), modeled(2, 0.8), modeled(3, 0.7)], 25)], {
      fromSkill: 1, toSkill: 4, mode: "materials",
    });
    expect(route.steps).toMatchObject([
      { fromSkill: 1, toSkill: 2, plannedCrafts: 1, probabilistic: false },
      { fromSkill: 2, toSkill: 4, plannedCrafts: 3, probabilistic: true },
    ]);
    expect(route.steps[1]?.expectedCrafts).toBeCloseTo(1 / 0.8 + 1 / 0.7);
    expect(route.reagents).toEqual([{ itemId: 1001, count: 4 }]);
  });

  test("interpolates a compact modeled window at each skill without re-anchoring a mid-window request", () => {
    const modeled = { ...certain(20, 24), chance: 1, chanceAtEnd: 0, evidence: "modeled" as const };
    const route = planProfessionGuide([recipe(1, [modeled], 10)], { fromSkill: 21, toSkill: 24, mode: "materials" });
    expect(route.steps).toMatchObject([{ fromSkill: 21, toSkill: 24, plannedCrafts: 8, probabilistic: true }]);
    expect(route.totalExpectedCrafts).toBeCloseTo(4 / 3 + 2 + 4);
  });

  test("recommends switching at a recipe unlock and counts a multi-point craft in full", () => {
    const route = planProfessionGuide([
      recipe(1, [certain(1, 6)], 60),
      recipe(2, [{ ...certain(3, 6), points: 2 }], 30),
    ], { fromSkill: 1, toSkill: 6, mode: "materials" });

    expect(route.steps).toMatchObject([
      { recipeId: 1, fromSkill: 1, toSkill: 3, plannedCrafts: 2 },
      { recipeId: 2, fromSkill: 3, toSkill: 6, plannedCrafts: 2 },
    ]);
    expect(route.expectedCopper).toBe(180);
  });

  test("looks ahead to avoid a costly skill bracket instead of picking the cheapest immediate craft", () => {
    const route = planProfessionGuide([
      recipe(1, [certain(1, 2)], 10),
      recipe(2, [certain(2, 3)], 100),
      recipe(3, [{ ...certain(1, 2), points: 2 }], 30),
      recipe(4, [certain(3, 4)], 5),
    ], { fromSkill: 1, toSkill: 4, mode: "materials" });

    expect(route.steps).toMatchObject([
      { recipeId: 3, fromSkill: 1, toSkill: 3, plannedCrafts: 1 },
      { recipeId: 4, fromSkill: 3, toSkill: 4, plannedCrafts: 1 },
    ]);
    expect(route.expectedCopper).toBe(35);
  });

  test("plans around unpriced alternatives and preserves gaps and unknown estimates", () => {
    const route = planProfessionGuide([
      recipe(1, [certain(1, 2)], null), recipe(2, [certain(1, 2)], 12), recipe(3, [certain(4, 5)], null),
    ], { fromSkill: 1, toSkill: 5, mode: "materials" });

    expect(route).toMatchObject({
      expectedCopper: null, knownExpectedCopper: 12,
      gaps: [{ fromSkill: 2, toSkill: 4 }],
      steps: [{ recipeId: 2, expectedCopper: 12 }, { recipeId: 3, expectedCopper: null }],
    });
  });

  test("ranks by the selected recovery mode and keeps an unavailable mode unknown", () => {
    const first = recipe(1, [certain(1, 3)], 20, { prices: { materials: 20, auction: 15, vendor: 10, disenchant: null } });
    const second = recipe(2, [certain(1, 3)], 50, { prices: { materials: 50, auction: -8, vendor: 30, disenchant: null } });
    const all = [first, second];

    expect(planProfessionGuide(all, { fromSkill: 1, toSkill: 3, mode: "auction" })).toMatchObject({ steps: [{ recipeId: 2 }], expectedCopper: -16 });
    expect(planProfessionGuide(all, { fromSkill: 1, toSkill: 3, mode: "vendor" })).toMatchObject({ steps: [{ recipeId: 1 }], expectedCopper: 20 });
    expect(planProfessionGuide(all, { fromSkill: 1, toSkill: 3, mode: "disenchant" })).toMatchObject({ expectedCopper: null });
  });

  test("merges required quantities by item ID and counts training once across recipe windows", () => {
    const route = planProfessionGuide([
      recipe(1, [certain(1, 2), { ...certain(2, 3), chance: 0.8 }], 10, {
        reagents: [{ itemId: 42, count: 2 }], trainingCopper: 50,
      }),
      recipe(2, [certain(3, 4)], 20, { reagents: [{ itemId: 42, count: 3 }], trainingCopper: null }),
    ], { fromSkill: 1, toSkill: 4, mode: "materials" });

    expect(route.reagents).toEqual([{ itemId: 42, count: 9 }]);
    expect(route).toMatchObject({ trainingCopper: null, knownTrainingCopper: 50, unknownTrainingCount: 1 });
    expect(route.steps[0]?.trainingCopper).toBe(50);
    expect(route.steps[1]?.trainingCopper).toBeUndefined();
    expect(route.steps[2]?.trainingCopper).toBeNull();
  });

  test("handles no-skill windows, exclusions, ties and invalid ranges consistently", () => {
    const all = [recipe(7, [certain(1, 2)], 5), recipe(3, [certain(1, 2)], 5), recipe(2, [{ ...certain(1, 3), chance: 0 }], 0)];
    const opts = { fromSkill: 1, toSkill: 3, mode: "materials" } as const;

    expect(planProfessionGuide(all, opts)).toMatchObject({ steps: [{ recipeId: 3 }], gaps: [{ fromSkill: 2, toSkill: 3 }] });
    expect(planProfessionGuide([...all].reverse(), opts)).toEqual(planProfessionGuide(all, opts));
    expect(planProfessionGuide(all, { ...opts, excludedRecipeIds: [3] })).toMatchObject({ steps: [{ recipeId: 7 }] });
    expect(() => planProfessionGuide(all, { ...opts, fromSkill: 3 })).toThrow(RangeError);
    expect(() => planProfessionGuide(all, { ...opts, toSkill: 501 })).toThrow(RangeError);
  });
});
