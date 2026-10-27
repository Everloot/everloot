import { describe, expect, test } from "vitest";
import { comparePlans, compareHash, planRef, readCompareHash, replaceCompareHash, type CompareResult } from "./compare";
import { fixture } from "./fixture";
import { encodeBuild, encodeOrder, type OrderOrigin } from "./share";
import type { Ranks } from "./types";

// Two plans on the made-up test tree (fixture.ts): one point a level from 10, so level 20 holds 11 points and level 30
// holds 21.

const code = (ranks: Ranks, { build = fixture.build, classSlug = "mage" } = {}) => encodeBuild({ classSlug, specId: fixture.specId, build, ranks });
const token = (ranks: Ranks, order: number[], origin: OrderOrigin = "planned") => encodeOrder(ranks, order, origin)!;
const times = (id: number, n: number) => Array<number>(n).fill(id);

function compared(result: CompareResult) {
  if (!result.ok) throw new Error(`expected a comparison, got ${JSON.stringify(result.errors)}`);
  return result.comparison;
}
function errors(result: CompareResult) {
  if (result.ok) throw new Error("expected the comparison to fail");
  return result.errors;
}

// The same 21 points in two orders: P fills the left tree first, Q starts on the right.
const P: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 5 }, 51: { rank: 5 }, 52: { rank: 1 } };
const leftFirst = [...times(11, 5), ...times(12, 5), ...times(21, 5), ...times(51, 5), 52];
const rightFirst = [...times(51, 5), ...times(11, 5), 52, ...times(12, 5), ...times(21, 5)];

// Two different 11- and 13-point plans.
const X: Ranks = { 11: { rank: 5 }, 21: { rank: 5 }, 31: { rank: 1 } };
const Y: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 22: { rank: 1 }, 51: { rank: 2 } };

describe("identical plans", () => {
  test("the same code twice: no talent differs and every tree has the same points", () => {
    const c = compared(comparePlans(fixture, { code: code(P) }, { code: code(P) }));
    expect(c.same).toBe(true);
    expect(c.differences).toEqual([]);
    expect(c.splits).toEqual([{ tree: "Left", a: 15, b: 15 }, { tree: "Right", a: 6, b: 6 }]);
    expect(c.a.rejected).toEqual([]);
    expect(c.b.rejected).toEqual([]);
  });

  test("two codes for the same talents, made on different game builds, are the same plan", () => {
    const c = compared(comparePlans(fixture, { code: code(P, { build: "0.9.0.1" }) }, { code: code(P) }));
    expect(c.same).toBe(true);
    expect(c.differences).toEqual([]);
  });
});

describe("different plans", () => {
  test("each talent whose rank differs, in the tree's reading order, with the points per tree", () => {
    const c = compared(comparePlans(fixture, { code: code(X) }, { code: code(Y) }));
    expect(c.same).toBe(false);
    expect(c.differences.map((d) => [d.id, d.name, d.a, d.b, d.maxRanks])).toEqual([
      [12, "Talent 12", 0, 5, 5],
      [21, "Talent 21", 5, 0, 5],
      [22, "Talent 22", 0, 1, 1],
      [31, "Talent 31", 1, 0, 5],
      [51, "Talent 51", 0, 2, 5],
    ]);
    expect(c.differences.map((d) => d.treeId)).toEqual([1, 1, 1, 1, 2]);
    expect(c.splits).toEqual([{ tree: "Left", a: 11, b: 11 }, { tree: "Right", a: 0, b: 2 }]);
    expect([c.a.summary.split, c.b.summary.split]).toEqual(["11/0", "11/2"]);
    expect([c.a.summary.spent, c.b.summary.spent]).toEqual([11, 13]);
    expect([c.a.minLevel, c.b.minLevel]).toEqual([20, 22]);
  });

  test("a choice node both plans took differs when they picked different entries, and names each pick", () => {
    const base = { 11: { rank: 5 }, 12: { rank: 5 } };
    const c = compared(comparePlans(fixture, { code: code({ ...base, 32: { rank: 1, choice: 0 } }) }, { code: code({ ...base, 32: { rank: 1, choice: 1 } }) }));
    expect(c.same).toBe(false);
    expect(c.differences).toEqual([{ id: 32, treeId: 1, name: "Choice A or Choice B", maxRanks: 1, a: 1, b: 1, choices: { a: "Choice A", b: "Choice B" } }]);
    const one = compared(comparePlans(fixture, { code: code({ ...base, 32: { rank: 1, choice: 1 } }) }, { code: code(base) }));
    expect(one.differences).toEqual([{ id: 32, treeId: 1, name: "Choice A or Choice B", maxRanks: 1, a: 1, b: 0, choices: { a: "Choice B", b: null } }]);
  });
});

describe("points a code asked for that the tree did not place", () => {
  // 22 asks for more ranks than it has, 41's row needs 16 points above it, and node 99 is not in this tree.
  const asked: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 22: { rank: 3 }, 41: { rank: 1 }, 99: { rank: 2 } };

  test("are listed per plan with what was asked and what was placed, and the import report says why", () => {
    const c = compared(comparePlans(fixture, { code: code(asked) }, { code: code(Y) }));
    expect(c.a.rejected).toEqual([
      { id: 22, name: "Talent 22", asked: 3, placed: 1 },
      { id: 41, name: "Talent 41", asked: 1, placed: 0 },
      { id: 99, name: null, asked: 2, placed: 0 },
    ]);
    expect(c.a.report.problems).toEqual([
      "1 talent in the code is not in this tree and was left out: node 99 (2 points).",
      "Talent 22: the code asked for rank 3, but the most this tree allows is 1.",
      "Talent 41: 1 point not placed. Needs 16 points spent in Left on rows above.",
    ]);
    expect(c.b.rejected).toEqual([]);
  });

  test("the plans are compared as this tree places them", () => {
    const c = compared(comparePlans(fixture, { code: code(asked) }, { code: code({ 11: { rank: 5 }, 12: { rank: 5 }, 22: { rank: 1 } }) }));
    expect(c.same).toBe(true);
    expect(c.differences).toEqual([]);
    expect(c.a.summary.spent).toBe(11);
  });

  test("a plan none of whose points place on this tree cannot be compared, and the message says why", () => {
    const [error] = errors(comparePlans(fixture, { code: code({ 98: { rank: 3 }, 99: { rank: 2 } }) }, { code: code(Y) }));
    expect(error.side).toBe("a");
    expect(error.message).toBe("None of plan A's 5 points place on this tree. 2 talents in the code are not in this tree and were left out: node 98 (3 points), 99 (2 points).");
  });
});

describe("plans that cannot be compared", () => {
  test("a plan for another class says which class it is for", () => {
    const druid = code(X, { classSlug: "druid" });
    expect(errors(comparePlans(fixture, { code: code(X) }, { code: druid }))).toEqual([
      { side: "b", message: "Plan B is a Druid code. Both plans must be Mage plans to compare them here." },
    ]);
    expect(errors(comparePlans(fixture, { code: druid }, { code: druid })).map((e) => e.side)).toEqual(["a", "b"]);
  });

  test("a damaged code, or text that is not a code, says so with the import's words", () => {
    expect(errors(comparePlans(fixture, { code: "EL1-mage-1482" }, { code: code(X) }))).toEqual([
      { side: "a", message: "Plan A: That share code is damaged or cut short." },
    ]);
    expect(errors(comparePlans(fixture, { code: code(X) }, { code: "EL1-mage-1482-1.0.0.1-%%%" }))).toEqual([
      { side: "b", message: "Plan B: That is not a share code. Codes start with EL1 and use letters, digits, - and _ only." },
    ]);
    expect(errors(comparePlans(fixture, { code: "EL2-mage-1482-1.0.0.1-AAAA" }, { code: code(X) }))[0].message).toMatch(/^Plan A: That code was made by a newer version of this tool\./);
  });

  test("an empty side, or a code with no points, asks for a plan", () => {
    expect(errors(comparePlans(fixture, { code: "  " }, { code: code(X) }))).toEqual([
      { side: "a", message: "Plan A is empty. Paste a share code or a calculator link." },
    ]);
    expect(errors(comparePlans(fixture, { code: code(X) }, { code: code({}) }))).toEqual([
      { side: "b", message: "Plan B has no talent points to compare." },
    ]);
    expect(errors(comparePlans(fixture, { code: "" }, { code: "" })).map((e) => e.side)).toEqual(["a", "b"]);
  });
});

describe("spend orders and milestones", () => {
  test("with both orders known: each milestone level, the points by then, each plan's split and what differs", () => {
    const c = compared(comparePlans(fixture, { code: code(P), order: token(P, leftFirst) }, { code: code(P), order: token(P, rightFirst) }));
    expect(c.same).toBe(true);
    expect(c.sameOrder).toBe(false);
    expect(c.a.set.order).toEqual(leftFirst);
    expect(c.b.set.order).toEqual(rightFirst);
    expect(c.milestones!.map((m) => [m.level, m.points, m.a.split, m.b.split])).toEqual([
      [20, 11, "11/0", "5/6"],
      [30, 21, "15/6", "15/6"],
      [40, 31, "15/6", "15/6"],
      [50, 41, "15/6", "15/6"],
      [60, 51, "15/6", "15/6"],
    ]);
    expect(c.milestones![0].differences.map((d) => [d.id, d.a, d.b])).toEqual([[12, 5, 0], [21, 1, 0], [51, 0, 5], [52, 0, 1]]);
    expect(c.milestones!.slice(1).every((m) => m.differences.length === 0)).toBe(true);
  });

  test("the same order on both sides says so", () => {
    const c = compared(comparePlans(fixture, { code: code(P), order: token(P, leftFirst) }, { code: code(P), order: token(P, leftFirst) }));
    expect(c.sameOrder).toBe(true);
    expect(c.milestones!.every((m) => m.differences.length === 0)).toBe(true);
  });

  test("an unknown order gets no milestones and no invented order: missing, damaged, or against the tree's rules", () => {
    const known = { code: code(P), order: token(P, leftFirst) };
    const illegal = [21, ...times(11, 5), ...times(12, 5), ...times(21, 4), ...times(51, 5), 52];
    for (const other of [{ code: code(P) }, { code: code(P), order: null }, { code: code(P), order: "O1p-%%" }, { code: code(P), order: token(P, illegal) }]) {
      const c = compared(comparePlans(fixture, known, other));
      expect(c.milestones, JSON.stringify(other)).toBeNull();
      expect(c.sameOrder, JSON.stringify(other)).toBeNull();
      expect(c.b.set).toEqual({ ranks: P, order: null, orderOrigin: null });
      expect(c.a.set.order).toEqual(leftFirst);
    }
    const damaged = compared(comparePlans(fixture, known, { code: code(P), order: "O1p-%%" }));
    expect(damaged.b.report.problems).toEqual(["The plan's spend order is damaged, so the order is unknown. The talents still loaded."]);
    const broken = compared(comparePlans(fixture, known, { code: code(P), order: token(P, illegal) }));
    expect(broken.b.report.problems[0]).toMatch(/^The plan's spend order breaks this tree's rules, so the order is unknown\./);
  });

  test("an order that does not fit the points that placed is unknown, so the plans get no milestones", () => {
    // Node 99 is not in this tree, so the order, which names its points, no longer fits.
    const asked: Ranks = { ...P, 99: { rank: 1 } };
    const c = compared(comparePlans(fixture, { code: code(asked), order: token(asked, [...leftFirst, 99]) }, { code: code(P), order: token(P, leftFirst) }));
    expect(c.a.set.order).toBeNull();
    expect(c.milestones).toBeNull();
  });

  test("a provisional order keeps its label; the milestones follow it", () => {
    const c = compared(comparePlans(fixture, { code: code(P), order: token(P, leftFirst, "provisional") }, { code: code(P), order: token(P, rightFirst) }));
    expect([c.a.set.orderOrigin, c.b.set.orderOrigin]).toEqual(["provisional", "planned"]);
    expect(c.milestones).toHaveLength(5);
  });

  test("a plan done before a milestone shows all its points there", () => {
    const small: Ranks = { 11: { rank: 5 } };
    const c = compared(comparePlans(fixture, { code: code(small), order: token(small, times(11, 5)) }, { code: code(P), order: token(P, leftFirst) }));
    expect(c.milestones!.map((m) => m.a.spent)).toEqual([5, 5, 5, 5, 5]);
    expect(c.milestones!.map((m) => m.b.spent)).toEqual([11, 21, 21, 21, 21]);
  });
});

describe("the codes and orders as given", () => {
  test("a plan keeps the code and order token it came with, even from an older game build", () => {
    const old = code(P, { build: "0.9.0.1" });
    const t = token(P, leftFirst);
    const c = compared(comparePlans(fixture, { code: old, order: t }, { code: code(X) }));
    expect(c.a.code).toBe(old);
    expect(c.a.token).toBe(t);
    expect(c.b.token).toBeNull();
    expect(c.a.report.codeBuild).toBe("0.9.0.1");
    expect(c.a.report.problems[0]).toBe("Made on game build 0.9.0.1; this tree is from build 1.0.0.1. Check each talent.");
  });

  test("a calculator link names its first set's code and order; a link to set two alone names that one", () => {
    const t = token(P, leftFirst);
    const link = `https://everloot.app/tools/talents/mage#plan=${code(P)}&plan2=${code(X)}&order=${t}`;
    expect(planRef(link)).toEqual({ code: code(P), order: t });
    expect(planRef(`https://everloot.app/tools/talents/mage#plan2=${code(X)}&order2=${t}`)).toEqual({ code: code(X), order: t });
    expect(planRef(`  ${code(X)}  `)).toEqual({ code: code(X), order: null });
    const c = compared(comparePlans(fixture, { code: link }, { code: code(P), order: t }));
    expect([c.a.code, c.a.token]).toEqual([code(P), t]);
    expect(c.sameOrder).toBe(true);
  });
});

describe("the comparison's address", () => {
  const [a, b] = [code(P), code(X)];
  const t = token(P, leftFirst);

  test("#a=, &ao=, &b= and &bo= carry each plan's code and order", () => {
    expect(compareHash({ code: a, order: t }, { code: b, order: null })).toBe(`#a=${a}&ao=${t}&b=${b}`);
    expect(readCompareHash(`#a=${a}&ao=${t}&b=${b}`)).toEqual({ a: { code: a, order: t }, b: { code: b, order: null } });
    expect(readCompareHash(`#b=${b}&bo=${t}`)).toEqual({ a: null, b: { code: b, order: t } });
    expect(compareHash(null, null)).toBe("");
  });

  test("empty parts are empty sides, and a calculator's #plan= is not a comparison", () => {
    expect(readCompareHash("#a=&ao=&b=&bo=")).toEqual({ a: null, b: null });
    expect(readCompareHash(`#plan=${a}&plan2=${b}&order=${t}`)).toEqual({ a: null, b: null });
  });

  test("text that is not a code stays out of the address", () => {
    expect(compareHash({ code: "not a code", order: null }, { code: b, order: "O1p-%%" })).toBe(`#b=${b}`);
  });

  test("replacing the comparison keeps the address's other parts, such as a cookie choice", () => {
    expect(replaceCompareHash(`#a=OLD&everloot-cookie-rejected&bo=OLD`, `#a=${a}&b=${b}`)).toBe(`#a=${a}&b=${b}&everloot-cookie-rejected`);
    expect(replaceCompareHash("#everloot-cookie-rejected", "")).toBe("#everloot-cookie-rejected");
    expect(replaceCompareHash(`#a=${a}`, "")).toBe("");
  });
});
