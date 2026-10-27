import { describe, expect, test } from "vitest";
import { fixture } from "./fixture";
import {
  addPoint, adoptOrder, canMovePoint, canRemovePoint, deriveOrder, emptySet, movedLater, movePoint, orderRefusalText, orderSteps,
  prefixRanks, removePoint, resetTree, validateOrder,
} from "./order";
import { canRemove, commit, pointsSpent, redo, startHistory, undo } from "./rules";
import { decodeOrder, encodeOrder } from "./share";
import type { PlanSet, Ranks, TalentCatalog, TalentNode } from "./types";

const ALL = 99;
const times = (id: number, n: number) => Array<number>(n).fill(id);

/** A set made by taking these points in turn, failing the test if any is refused. */
function planned(...ids: number[]): PlanSet {
  let set = emptySet();
  for (const id of ids) {
    const next = addPoint(fixture, set, id, ALL);
    expect(next, `point on ${id}`).not.toBe(set);
    set = next;
  }
  return set;
}

/** The fixture with an uneven point table: one point at 10, two at 12, the last at 20. */
const table: TalentCatalog = { ...fixture, rules: { ...fixture.rules, pointLevels: [10, 12, 12, 20] } };

const talent = (id: number, treeId: number, col: number, maxRanks: number, unlock?: TalentNode["unlock"]): TalentNode => ({
  id, treeId, row: 1, col, maxRanks, kind: "single",
  entries: [{ definitionId: null, spellId: null, name: `Talent ${id}` }],
  prereqs: [],
  ...(unlock ? { unlock } : {}),
});

// Two talents that each open once five points are spent anywhere else. With four other points, each
// counts the other and makes five, so a finished build may hold both, yet neither can be spent first.
const mutual: TalentCatalog = {
  ...fixture,
  nodes: [talent(1, 1, 1, 5), talent(2, 2, 1, 1, { pointsTotal: 5 }), talent(3, 2, 2, 1, { pointsTotal: 5 }), talent(4, 2, 3, 5)],
};

/** Freeze a value and everything in it, so any change to it throws. */
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) frozen(inner);
    Object.freeze(value);
  }
  return value;
}

describe("a plan set", () => {
  test("starts empty and planned, and each point taken goes on the end of its order", () => {
    expect(emptySet()).toEqual({ ranks: {}, order: [], orderOrigin: "planned" });
    expect(planned(11, 51, 11)).toEqual({ ranks: { 11: { rank: 2 }, 51: { rank: 1 } }, order: [11, 51, 11], orderOrigin: "planned" });
  });

  test("a point past the last one the levels give is refused, whatever budget comes in", () => {
    let set = emptySet();
    for (const id of [11, 11, 11, 11]) set = addPoint(table, set, id, ALL);
    expect(set.order).toEqual([11, 11, 11, 11]);
    expect(addPoint(table, set, 11, ALL)).toBe(set);
  });
});

describe("checking an order", () => {
  test("an order is legal when each point could be taken where it stands", () => {
    const ranks: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 2 }, 32: { rank: 1, choice: 1 } };
    expect(validateOrder(fixture, ranks, [11, 12, 11, 12, 11, 12, 11, 12, 11, 12, 21, 21, 32])).toEqual({ ok: true });
    expect(validateOrder(fixture, {}, [])).toEqual({ ok: true });
    expect(validateOrder(fixture, { 11: { rank: 0 } }, [])).toEqual({ ok: true });
  });

  test("it names each point of the build exactly as often as its rank", () => {
    expect(validateOrder(fixture, { 11: { rank: 2 } }, [11, 11, 11])).toEqual({ ok: false, reason: "extra-points" });
    expect(validateOrder(fixture, { 11: { rank: 2 } }, [11, 12])).toEqual({ ok: false, reason: "extra-points" });
    expect(validateOrder(fixture, { 11: { rank: 2 } }, [11])).toEqual({ ok: false, reason: "missing-points" });
    expect(validateOrder(fixture, { 11: { rank: 2 }, 12: { rank: 1 } }, [11, 11])).toEqual({ ok: false, reason: "missing-points" });
  });

  test("a point taken before its row opens or before its prerequisite is full is refused where it stands", () => {
    const gated: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
    expect(validateOrder(fixture, gated, [11, 11, 11, 11, 21, 11])).toEqual({ ok: false, reason: "gate", index: 4, id: 21 });
    expect(validateOrder(fixture, gated, [...times(11, 5), 21])).toEqual({ ok: true });
    const needs: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 22: { rank: 1 } };
    expect(validateOrder(fixture, needs, [...times(11, 5), ...times(12, 4), 22, 12])).toEqual({ ok: false, reason: "prereq", index: 9, id: 22 });
    expect(validateOrder(fixture, { 51: { rank: 2 }, 55: { rank: 1 } }, [51, 55, 51])).toEqual({ ok: false, reason: "gate", index: 1, id: 55 });
  });

  test("a gate on points anywhere counts only the points spent before it, in any tree", () => {
    const ranks: Ranks = { 51: { rank: 5 }, 11: { rank: 1 }, 52: { rank: 1 } };
    expect(validateOrder(fixture, ranks, [...times(51, 5), 52, 11])).toEqual({ ok: false, reason: "gate", index: 5, id: 52 });
    expect(validateOrder(fixture, ranks, [...times(51, 5), 11, 52])).toEqual({ ok: true });
    expect(validateOrder(fixture, ranks, [11, ...times(51, 5), 52])).toEqual({ ok: true });
  });

  test("a tiered talent takes its ranks a point at a time, and one that needs any full parent waits for it", () => {
    const ranks: Ranks = { 53: { rank: 3 }, 54: { rank: 1 } };
    expect(validateOrder(fixture, ranks, [53, 53, 54, 53])).toEqual({ ok: false, reason: "prereq", index: 2, id: 54 });
    expect(validateOrder(fixture, ranks, [53, 53, 53, 54])).toEqual({ ok: true });
    expect(validateOrder(fixture, { 53: { rank: 4 } }, times(53, 4))).toEqual({ ok: false, reason: "max-rank", index: 3, id: 53 });
  });

  test("the k-th point arrives at the k-th level of the point table, and past the last there is none", () => {
    expect(validateOrder(table, { 11: { rank: 4 } }, times(11, 4))).toEqual({ ok: true });
    expect(validateOrder(table, { 11: { rank: 5 } }, times(11, 5))).toEqual({ ok: false, reason: "no-points", index: 4, id: 11 });
  });

  test("a talent this tree does not have is refused", () => {
    expect(validateOrder(fixture, { 999: { rank: 1 } }, [999])).toEqual({ ok: false, reason: "unknown-node", index: 0, id: 999 });
  });
});

describe("labels", () => {
  test("edits keep a provisional label until the set has no points left", () => {
    let set = deriveOrder(fixture, adoptOrder(fixture, { 11: { rank: 5 }, 51: { rank: 2 } }, null, null));
    expect(set).toEqual({ ranks: { 11: { rank: 5 }, 51: { rank: 2 } }, order: [...times(11, 5), 51, 51], orderOrigin: "provisional" });
    set = addPoint(fixture, set, 21, ALL);
    set = removePoint(fixture, set, 51);
    set = movePoint(fixture, set, 5, 0);
    expect(set).toEqual({ ranks: { 11: { rank: 5 }, 21: { rank: 1 }, 51: { rank: 1 } }, order: [51, ...times(11, 5), 21], orderOrigin: "provisional" });
    set = resetTree(fixture, set, 2);
    expect(set).toEqual({ ranks: { 11: { rank: 5 }, 21: { rank: 1 } }, order: [...times(11, 5), 21], orderOrigin: "provisional" });
    // Emptied a point at a time, it starts over: what comes next is the player's.
    for (const id of [21, 11, 11, 11, 11, 11]) set = removePoint(fixture, set, id);
    expect(set).toEqual(emptySet());
    expect(addPoint(fixture, set, 11, ALL).orderOrigin).toBe("planned");
    // So does a set whose only tree is reset.
    expect(resetTree(fixture, deriveOrder(fixture, adoptOrder(fixture, { 51: { rank: 2 } }, null, null)), 2)).toEqual(emptySet());
  });

  test("edits keep a planned label", () => {
    let set = planned(11, 11, 51);
    set = removePoint(fixture, set, 11);
    set = movePoint(fixture, set, 1, 0);
    set = addPoint(fixture, set, 12, ALL);
    expect(set).toEqual({ ranks: { 11: { rank: 1 }, 12: { rank: 1 }, 51: { rank: 1 } }, order: [51, 11, 12], orderOrigin: "planned" });
  });

  test("an unknown order stays unknown through edits: nothing guesses it", () => {
    let set = adoptOrder(fixture, { 11: { rank: 5 } }, null, null);
    expect(set).toEqual({ ranks: { 11: { rank: 5 } }, order: null, orderOrigin: null });
    set = addPoint(fixture, set, 21, ALL);
    expect(set).toEqual({ ranks: { 11: { rank: 5 }, 21: { rank: 1 } }, order: null, orderOrigin: null });
    set = addPoint(fixture, removePoint(fixture, set, 21), 51, ALL);
    set = resetTree(fixture, set, 2);
    expect(set).toEqual({ ranks: { 11: { rank: 5 } }, order: null, orderOrigin: null });
    expect(orderSteps(fixture, set)).toBeNull();
    expect(prefixRanks(set, 3)).toBeNull();
  });

  test("a loaded order is kept with its own label only when it is complete and legal", () => {
    const ranks: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
    const order = [...times(11, 5), 21];
    // A full replacement takes the label its order came with, whatever the set held before.
    expect(adoptOrder(fixture, ranks, order, "planned")).toEqual({ ranks, order, orderOrigin: "planned" });
    expect(adoptOrder(fixture, ranks, order, "provisional")).toEqual({ ranks, order, orderOrigin: "provisional" });
    const unknown = { ranks, order: null, orderOrigin: null };
    expect(adoptOrder(fixture, ranks, [21, ...times(11, 5)], "planned")).toEqual(unknown);
    expect(adoptOrder(fixture, ranks, times(11, 5), "planned")).toEqual(unknown);
    expect(adoptOrder(fixture, ranks, order, null)).toEqual(unknown);
    expect(adoptOrder(fixture, ranks, null, "planned")).toEqual(unknown);
    // A stored label that is neither is not trusted.
    expect(adoptOrder(fixture, ranks, order, "player" as PlanSet["orderOrigin"])).toEqual(unknown);
    expect(adoptOrder(fixture, {}, null, null)).toEqual(emptySet());
  });

  test("a set's label rides in its token, O1p planned and O1g provisional, and reads back as itself", () => {
    const ranks: Ranks = { 11: { rank: 5 }, 21: { rank: 1 }, 51: { rank: 1 } };
    const mine = adoptOrder(fixture, ranks, [11, 51, 11, 11, 11, 11, 21], "planned");
    const made = deriveOrder(fixture, adoptOrder(fixture, ranks, null, null));
    expect(made.orderOrigin).toBe("provisional");
    const tokens = [mine, made].map((set) => encodeOrder(set.ranks, set.order!, set.orderOrigin!)!);
    // By ascending node id, 11 is A, 21 is B and 51 is C.
    expect(tokens).toEqual(["O1p-ACAAAAB", "O1g-AAAAABC"]);
    for (const [i, set] of [mine, made].entries()) {
      const read = decodeOrder(tokens[i], ranks);
      if (!read.ok) throw new Error(tokens[i]);
      expect(adoptOrder(fixture, ranks, read.order, read.origin)).toEqual(set);
    }
  });
});

describe("a generated order", () => {
  test("is made only on request, is legal, and labels the whole set provisional", () => {
    const ranks: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 2 }, 32: { rank: 1, choice: 1 }, 51: { rank: 2 } };
    const unknown = adoptOrder(fixture, ranks, null, null);
    const made = deriveOrder(fixture, unknown);
    expect(made).toEqual({ ranks, order: [...times(11, 5), ...times(12, 5), 21, 21, 32, 51, 51], orderOrigin: "provisional" });
    expect(validateOrder(fixture, ranks, made.order!)).toEqual({ ok: true });
    expect(unknown.order).toBeNull();
  });

  test("follows the tree's reading order, and a talent whose gate is not met yet waits for it", () => {
    const made = deriveOrder(fixture, adoptOrder(fixture, { 51: { rank: 5 }, 52: { rank: 1 }, 53: { rank: 1 } }, null, null));
    expect(made.order).toEqual([...times(51, 5), 53, 52]);
  });

  test("asking again changes nothing, and a planned order asked for one becomes provisional", () => {
    const made = deriveOrder(fixture, adoptOrder(fixture, { 11: { rank: 2 }, 51: { rank: 1 } }, null, null));
    expect(deriveOrder(fixture, made)).toBe(made);
    expect(deriveOrder(fixture, planned(51, 11, 11))).toEqual(made);
  });

  test("with no points, or no legal order for them, the set comes back as it was", () => {
    const empty = emptySet();
    expect(deriveOrder(fixture, empty)).toBe(empty);
    const stuck = adoptOrder(mutual, { 1: { rank: 4 }, 2: { rank: 1 }, 3: { rank: 1 } }, null, null);
    expect(deriveOrder(mutual, stuck)).toBe(stuck);
    const tooMany = adoptOrder(table, { 11: { rank: 5 } }, null, null);
    expect(deriveOrder(table, tooMany)).toBe(tooMany);
    const elsewhere = adoptOrder(fixture, { 11: { rank: 1 }, 999: { rank: 1 } }, null, null);
    expect(deriveOrder(fixture, elsewhere)).toBe(elsewhere);
  });
});

describe("choice nodes", () => {
  const open = () => planned(...times(11, 5), ...times(12, 5));

  test("swapping the entry costs no point and keeps the order and the label", () => {
    const before = addPoint(fixture, open(), 32, ALL, 0);
    expect(before.ranks[32]).toEqual({ rank: 1, choice: 0 });
    const swapped = addPoint(fixture, before, 32, ALL, 1);
    expect(swapped.ranks[32]).toEqual({ rank: 1, choice: 1 });
    expect(swapped.order).toBe(before.order);
    expect(pointsSpent(swapped.ranks)).toBe(11);
    expect(addPoint(fixture, before, 32, 11, 1).ranks[32]).toEqual({ rank: 1, choice: 1 });
    const made = deriveOrder(fixture, adoptOrder(fixture, before.ranks, null, null));
    expect(addPoint(fixture, made, 32, ALL, 1)).toEqual({ ...made, ranks: { ...made.ranks, 32: { rank: 1, choice: 1 } } });
  });

  test("the same entry again, or one the node does not have, is refused", () => {
    const set = addPoint(fixture, open(), 32, ALL, 1);
    expect(addPoint(fixture, set, 32, ALL, 1)).toBe(set);
    expect(addPoint(fixture, set, 32, ALL, 5)).toBe(set);
  });
});

describe("taking a point back", () => {
  test("the node's latest point leaves; the points after it come a level sooner and nothing moves past them", () => {
    const set = planned(11, 12, 11, 51, 12);
    const after = removePoint(fixture, set, 11);
    expect(after).toEqual({ ranks: { 11: { rank: 1 }, 12: { rank: 2 }, 51: { rank: 1 } }, order: [11, 12, 51, 12], orderOrigin: "planned" });
    expect(orderSteps(fixture, after)?.map((s) => s.level)).toEqual([10, 11, 12, 13]);
    expect(movedLater(fixture, set, after)).toEqual([]);
  });

  test("a point that could no longer be taken where it stands waits behind the points it needs, and every point that changed places is disclosed", () => {
    const set = planned(...times(11, 5), 21, 51, 51, 12);
    const after = removePoint(fixture, set, 11);
    expect(after.order).toEqual([...times(11, 4), 51, 51, 12, 21]);
    expect(validateOrder(fixture, after.ranks, after.order!)).toEqual({ ok: true });
    // Talent 21 waited; the three points that went ahead of it are listed too, each with its real levels.
    expect(movedLater(fixture, set, after)).toEqual([
      { id: 21, rank: 1, from: 15, to: 17 },
      { id: 51, rank: 1, from: 16, to: 14 },
      { id: 51, rank: 2, from: 17, to: 15 },
      { id: 12, rank: 1, from: 18, to: 16 },
    ]);
  });

  test("a point that keeps its place number but now sits between other points is disclosed too", () => {
    // Talent 3 needs 1 or 4 at full rank, and 4 opens once two other points are spent. With 1 gone,
    // 3 waits for 4 and 4 waits for 5; 4 stays the third point but now comes after 5 and before 3.
    const passing: TalentCatalog = {
      ...fixture,
      nodes: [talent(1, 1, 1, 1), talent(2, 1, 2, 1), { ...talent(3, 1, 3, 1), anyOf: [1, 4] }, talent(4, 1, 4, 1, { pointsTotal: 2 }), talent(5, 1, 5, 1)],
    };
    let set = emptySet();
    for (const id of [1, 2, 3, 4, 5]) set = addPoint(passing, set, id, ALL);
    expect(set.order).toEqual([1, 2, 3, 4, 5]);
    const after = removePoint(passing, set, 1);
    expect(after.order).toEqual([2, 5, 4, 3]);
    expect(movedLater(passing, set, after)).toEqual([
      { id: 3, rank: 1, from: 12, to: 13 },
      { id: 4, rank: 1, from: 13, to: 12 },
      { id: 5, rank: 1, from: 14, to: 11 },
    ]);
  });

  test("a point the rules will not give back stays, and the reason is the rules' own", () => {
    const set = planned(...times(11, 5), ...times(12, 5), 22);
    expect(removePoint(fixture, set, 12)).toBe(set);
    expect(canRemovePoint(fixture, set, 12)).toEqual({ ok: false, reason: "dependents" });
    expect(canRemovePoint(fixture, set, 31)).toEqual({ ok: false, reason: "empty" });
    expect(canRemovePoint(fixture, set, 999)).toEqual({ ok: false, reason: "unknown-node" });
    expect(canRemovePoint(fixture, set, 22)).toEqual({ ok: true });
  });

  test("a removal that would leave no legal order is refused, though the finished build alone would allow it", () => {
    let set = emptySet();
    for (const id of [...times(1, 5), 2, 3]) set = addPoint(mutual, set, id, ALL);
    expect(set.order).toEqual([...times(1, 5), 2, 3]);
    expect(canRemove(mutual, set.ranks, 1)).toEqual({ ok: true });
    expect(removePoint(mutual, set, 1)).toBe(set);
    expect(canRemovePoint(mutual, set, 1)).toEqual({ ok: false, reason: "dependents" });
    // With the order unknown there is none to keep, and the rules decide alone, as before orders.
    expect(removePoint(mutual, adoptOrder(mutual, set.ranks, null, null), 1))
      .toEqual({ ranks: { 1: { rank: 4 }, 2: { rank: 1 }, 3: { rank: 1 } }, order: null, orderOrigin: null });
  });
});

describe("resetting a tree", () => {
  test("takes that tree's points out of the order and keeps the rest in theirs", () => {
    const set = planned(11, 51, 11, 53, 12);
    expect(resetTree(fixture, set, 2)).toEqual({ ranks: { 11: { rank: 2 }, 12: { rank: 1 } }, order: [11, 11, 12], orderOrigin: "planned" });
    expect(resetTree(fixture, set, 1)).toEqual({ ranks: { 51: { rank: 1 }, 53: { rank: 1 } }, order: [51, 53], orderOrigin: "planned" });
  });

  test("is refused while another tree's talents need its points, and does nothing to an empty tree", () => {
    const set = planned(...times(11, 5), 51, 52);
    expect(resetTree(fixture, set, 1)).toBe(set);
    const left = planned(11);
    expect(resetTree(fixture, left, 2)).toBe(left);
  });

  test("a point that could no longer be taken where it stands waits behind the points it needs, and every point that changed places is disclosed", () => {
    const set = planned(...times(11, 5), 12, 51, 52, ...times(51, 4), 53);
    const after = resetTree(fixture, set, 1);
    expect(after.order).toEqual([...times(51, 5), 53, 52]);
    // With six points gone, the one that waited still arrives a level earlier than it did. The first 51
    // only comes sooner because points before it left, and is not listed.
    expect(movedLater(fixture, set, after)).toEqual([
      { id: 52, rank: 1, from: 17, to: 16 },
      { id: 51, rank: 2, from: 18, to: 11 },
      { id: 51, rank: 3, from: 19, to: 12 },
      { id: 51, rank: 4, from: 20, to: 13 },
      { id: 51, rank: 5, from: 21, to: 14 },
      { id: 53, rank: 1, from: 22, to: 15 },
    ]);
  });

  test("a reset that would leave no legal order is refused", () => {
    let set = emptySet();
    for (const id of [...times(4, 4), 1, 2, 3]) set = addPoint(mutual, set, id, ALL);
    expect(set.order).toEqual([...times(4, 4), 1, 2, 3]);
    expect(resetTree(mutual, set, 1)).toBe(set);
  });
});

describe("moving a point", () => {
  test("a point moves to any place the rules allow, and the label stays", () => {
    const set = deriveOrder(fixture, adoptOrder(fixture, { 11: { rank: 5 }, 51: { rank: 2 } }, null, null));
    const moved = movePoint(fixture, set, 5, 0);
    expect(moved).toEqual({ ranks: set.ranks, order: [51, ...times(11, 5), 51], orderOrigin: "provisional" });
    expect(movePoint(fixture, moved, 0, 6)).toEqual(set);
  });

  test("a move that would take a point too soon is refused, and canMovePoint says which point and why", () => {
    const set = planned(...times(11, 5), ...times(12, 5), 22, 21);
    expect(movePoint(fixture, set, 11, 0)).toBe(set);
    expect(canMovePoint(fixture, set, 11, 0)).toEqual({ ok: false, reason: "gate", index: 0, id: 21 });
    // Moving the prerequisite's last point after the talent that needs it breaks that talent instead.
    expect(movePoint(fixture, set, 9, 10)).toBe(set);
    expect(canMovePoint(fixture, set, 9, 10)).toEqual({ ok: false, reason: "prereq", index: 9, id: 22 });
    expect(canMovePoint(fixture, set, 10, 11)).toEqual({ ok: true });
  });

  test("there is nothing to move in an unknown order, outside the order, or where the order would not change", () => {
    const set = planned(11, 11, 12);
    for (const [from, to] of [[0, 1], [1, 1], [0, 3], [-1, 0], [0.5, 1]]) {
      expect(movePoint(fixture, set, from, to)).toBe(set);
      expect(canMovePoint(fixture, set, from, to)).toBeNull();
    }
    const unknown = adoptOrder(fixture, set.ranks, null, null);
    expect(movePoint(fixture, unknown, 2, 0)).toBe(unknown);
    expect(canMovePoint(fixture, unknown, 2, 0)).toBeNull();
  });
});

describe("prefixes and steps", () => {
  test("the ranks after any number of points, choices included", () => {
    const set = addPoint(fixture, planned(...times(11, 5), ...times(12, 5)), 32, ALL, 1);
    expect(prefixRanks(set, 0)).toEqual({});
    expect(prefixRanks(set, 2)).toEqual({ 11: { rank: 2 } });
    expect(prefixRanks(set, 10)).toEqual({ 11: { rank: 5 }, 12: { rank: 5 } });
    expect(prefixRanks(set, 11)).toEqual(set.ranks);
    expect(prefixRanks(set, ALL)).toEqual(set.ranks);
    expect(prefixRanks(set, -1)).toEqual({});
  });

  test("each step is a talent, the rank it reaches and the level it arrives at in the point table", () => {
    let set = emptySet();
    for (const id of [53, 51, 53, 53]) set = addPoint(table, set, id, ALL);
    expect(orderSteps(table, set)).toEqual([
      { id: 53, rank: 1, level: 10 }, { id: 51, rank: 1, level: 12 }, { id: 53, rank: 2, level: 12 }, { id: 53, rank: 3, level: 20 },
    ]);
    expect(orderSteps(fixture, set)?.map((s) => s.level)).toEqual([10, 11, 12, 13]);
    expect(orderSteps(fixture, emptySet())).toEqual([]);
  });
});

describe("undo and redo", () => {
  test("a refused edit is the same set, so committing it adds no undo step", () => {
    const set = planned(...times(11, 5), 51, 52);
    const made = deriveOrder(fixture, set);
    const empty = emptySet();
    const edits: [PlanSet, PlanSet][] = [
      [set, addPoint(fixture, set, 41, ALL)],
      [set, addPoint(fixture, set, 11, ALL)],
      [set, removePoint(fixture, set, 51)],
      [set, removePoint(fixture, set, 31)],
      [set, resetTree(fixture, set, 1)],
      [set, movePoint(fixture, set, 6, 0)],
      [made, deriveOrder(fixture, made)],
      [empty, deriveOrder(fixture, empty)],
    ];
    for (const [i, [before, after]] of edits.entries()) {
      expect(after, `edit ${i}`).toBe(before);
      const h = startHistory(before);
      expect(commit(h, after)).toBe(h);
    }
  });

  test("both sets come back exactly: each set's talents, order and label together", () => {
    type Pair = [PlanSet, PlanSet];
    const states: Pair[] = [[planned(11, 11, 12), adoptOrder(fixture, { 51: { rank: 2 } }, null, null)]];
    const edits: ((sets: Pair) => Pair)[] = [
      ([one, two]) => [addPoint(fixture, one, 51, ALL), two],
      ([one, two]) => [one, deriveOrder(fixture, two)],
      ([one, two]) => [one, addPoint(fixture, two, 53, ALL)],
      ([one, two]) => [removePoint(fixture, one, 11), two],
      ([one, two]) => [movePoint(fixture, one, 2, 0), two],
      ([one]) => [one, emptySet()],
    ];
    let h = startHistory(states[0]);
    for (const edit of edits) {
      const next = edit(h.present);
      expect(next[0] === h.present[0] && next[1] === h.present[1], "every edit here changes a set").toBe(false);
      states.push(next);
      h = commit(h, next);
    }
    const copies = structuredClone(states);
    expect(h.present[0]).toEqual({ ranks: { 11: { rank: 1 }, 12: { rank: 1 }, 51: { rank: 1 } }, order: [51, 11, 12], orderOrigin: "planned" });
    for (let i = states.length - 2; i >= 0; i--) {
      h = undo(h);
      expect(h.present).toBe(states[i]);
      expect(h.present).toEqual(copies[i]);
    }
    expect(h.present[1]).toEqual({ ranks: { 51: { rank: 2 } }, order: null, orderOrigin: null });
    for (let i = 1; i < states.length; i++) {
      h = redo(h);
      expect(h.present).toBe(states[i]);
      expect(h.present).toEqual(copies[i]);
    }
  });

  test("no edit changes a set it was given, so every earlier state stays exact", () => {
    const set = frozen(planned(...times(11, 5), 21, 51, 51, 12));
    const copy = structuredClone(set);
    removePoint(fixture, set, 11);
    resetTree(fixture, set, 2);
    movePoint(fixture, set, 6, 0);
    addPoint(fixture, set, 12, ALL);
    addPoint(fixture, addPoint(fixture, set, 12, ALL), 32, ALL, 1);
    deriveOrder(fixture, set);
    prefixRanks(set, 3);
    orderSteps(fixture, set);
    expect(set).toEqual(copy);
  });
});

describe("why an order is refused", () => {
  const text = (catalog: TalentCatalog, ranks: Ranks, order: number[]) => {
    const verdict = validateOrder(catalog, ranks, order);
    if (verdict.ok) throw new Error("the order is legal");
    return orderRefusalText(catalog, ranks, order, verdict);
  };

  test("one sentence, naming the talent and the level the point arrives at", () => {
    expect(text(fixture, { 11: { rank: 5 }, 21: { rank: 1 } }, [11, 11, 11, 11, 21, 11]))
      .toBe("Talent 21 at level 14: Needs 5 points spent in Left on rows above.");
    expect(text(fixture, { 11: { rank: 5 }, 12: { rank: 5 }, 22: { rank: 1 } }, [...times(11, 5), ...times(12, 4), 22, 12]))
      .toBe("Talent 22 at level 19: Needs the talent above it at full rank.");
    expect(text(fixture, { 51: { rank: 2 }, 55: { rank: 1 } }, [51, 55, 51])).toBe("Talent 55 at level 11: Needs 2 ranks in Talent 51.");
    expect(text(fixture, { 32: { rank: 1, choice: 1 } }, [32])).toBe("Choice B at level 10: Needs 10 points spent in Left on rows above.");
    expect(text(fixture, { 53: { rank: 2 }, 54: { rank: 1 } }, [53, 54, 53])).toBe("Talent 54 at level 11: Needs the talent above it at full rank.");
    expect(text(fixture, { 53: { rank: 4 } }, times(53, 4))).toBe("Tier two at level 13: Already at full rank.");
  });

  test("an order that is not this build's, a talent the tree lacks, or a point past the levels", () => {
    expect(text(fixture, { 11: { rank: 2 } }, [11, 11, 11])).toBe("The order spends points the build does not have.");
    expect(text(fixture, { 11: { rank: 2 } }, [11])).toBe("The order leaves out points the build has.");
    expect(text(fixture, { 999: { rank: 1 } }, [999])).toBe("The order spends a point on a talent this tree does not have.");
    expect(text(table, { 11: { rank: 5 } }, times(11, 5))).toBe("Talent 11 would be point 5, but only 4 points come by level 60.");
  });
});
