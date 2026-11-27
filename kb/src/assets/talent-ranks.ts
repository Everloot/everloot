/**
 * A talent's amounts at each rank. A multi-rank talent's spell stores one amount per effect; the amount at a rank
 * is in TraitDefinitionEffectPoints, which names a Curve for an effect of the trait definition's spell, and the
 * curve's CurvePoint rows give the value by rank (x = rank, y = the effect's base points). The game's talent window
 * asks the client for the entry's text at a rank (`tooltip:AppendInfo("GetTraitEntry", entryID, rank)` in
 * Blizzard_SharedTalentUI/Blizzard_TalentDisplay.lua), so the text is the spell's description with these values.
 *
 * Only a curve point at exactly the rank is used. Between or beyond points the client interpolates in a way the files
 * do not spell out, so such a rank has no answer here, and neither does an operation other than "set" (0).
 */
import type { SpellFacts } from "./tooltip.js";

export interface CurvePointRow { CurveID: number; OrderIndex: number; Pos: [number, number] }
export interface EffectPointsRow { EffectIndex: number; OperationType: number; CurveID: number }

/** TraitDefinitionEffectPoints.OperationType 0: the curve's value is the effect's base points. */
const SET = 0;

/** The curve's value at x, from a point at exactly x; null when it has none. */
export function curveValueAt(points: readonly CurvePointRow[], x: number): number | null {
  const at = points.filter((p) => p.Pos[0] === x).sort((a, b) => a.OrderIndex - b.OrderIndex);
  return at.length ? at[0].Pos[1] : null;
}

/** Effect index -> base points at `rank`, for every effect a definition's curves set; null when any one cannot be read. */
export function rankBasePoints(rows: readonly EffectPointsRow[], curves: ReadonlyMap<number, readonly CurvePointRow[]>, rank: number): Map<number, number> | null {
  const out = new Map<number, number>();
  for (const r of rows) {
    if (r.OperationType !== SET) return null;
    const v = curveValueAt(curves.get(r.CurveID) ?? [], rank);
    if (v === null) return null;
    out.set(r.EffectIndex, v);
  }
  return out;
}

/** The spell's facts with the rank's base points in place of the stored ones. An index the spell has no effect for is skipped, as the game does. */
export function rankFacts(facts: SpellFacts, basePoints: ReadonlyMap<number, number>): SpellFacts {
  return { ...facts, effects: facts.effects.map((e) => (basePoints.has(e.index) ? { ...e, basePoints: basePoints.get(e.index)! } : e)) };
}
