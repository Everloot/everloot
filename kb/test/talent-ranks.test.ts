import { expect, test } from "vitest";
import { curveValueAt, rankBasePoints, rankFacts, type CurvePointRow } from "../src/assets/talent-ranks.js";
import { resolveTooltip, type SpellFacts } from "../src/assets/tooltip.js";

const points = (curveId: number, pairs: [number, number][]): CurvePointRow[] =>
  pairs.map(([x, y], i) => ({ CurveID: curveId, OrderIndex: i, Pos: [x, y] }));

test("a curve gives the value at a rank only where it has a point at that rank", () => {
  // Wand Specialization's curve in build 71139 (Curve 83116): 13 at rank 1, 25 at rank 2.
  const wand = points(83116, [[1, 13], [2, 25]]);
  expect(curveValueAt(wand, 1)).toBe(13);
  expect(curveValueAt(wand, 2)).toBe(25);
  // No point at rank 3: not interpolated, not clamped, not guessed.
  expect(curveValueAt(wand, 3)).toBeNull();
  expect(curveValueAt([], 1)).toBeNull();
});

test("each rank's base points come from the trait definition's curves, or nothing when one cannot be read", () => {
  const curves = new Map([[1, points(1, [[1, 2], [2, 4], [3, 6]])], [2, points(2, [[1, -10], [2, -20], [3, -30]])], [3, points(3, [[1, 5]])]]);
  const two = [{ EffectIndex: 0, OperationType: 0, CurveID: 1 }, { EffectIndex: 1, OperationType: 0, CurveID: 2 }];
  expect(rankBasePoints(two, curves, 2)).toEqual(new Map([[0, 4], [1, -20]]));
  expect(rankBasePoints(two, curves, 3)).toEqual(new Map([[0, 6], [1, -30]]));
  // A curve with no point at the rank, a missing curve, or an operation other than "set" (0): no answer.
  expect(rankBasePoints([{ EffectIndex: 0, OperationType: 0, CurveID: 3 }], curves, 2)).toBeNull();
  expect(rankBasePoints([{ EffectIndex: 0, OperationType: 0, CurveID: 99 }], curves, 1)).toBeNull();
  expect(rankBasePoints([{ EffectIndex: 0, OperationType: 1, CurveID: 1 }], curves, 1)).toBeNull();
});

test("a spell's tooltip at a rank uses that rank's amounts in place of the stored ones", () => {
  const stored: SpellFacts = { effects: [{ index: 0, basePoints: 13, dieSides: 0, periodMs: 0, chainTargets: 0, radiusYards: null }], durationMs: null };
  const curves = new Map([[83116, points(83116, [[1, 13], [2, 25]])]]);
  const rows = [{ EffectIndex: 0, OperationType: 0, CurveID: 83116 }];
  const at = (rank: number) => resolveTooltip("Wand damage +$s1%.", rankFacts(stored, rankBasePoints(rows, curves, rank)!)).text;
  expect(at(1)).toBe("Wand damage +13%.");
  expect(at(2)).toBe("Wand damage +25%.");
  // An effect the spell does not have is left alone, as the game skips it.
  expect(rankFacts(stored, new Map([[0, 25], [3, 7]])).effects).toEqual([{ ...stored.effects[0], basePoints: 25 }]);
});
