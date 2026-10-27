import { describe, expect, test } from "vitest";
import type { Block } from "../../../kb/src/wiki/page";
import { guideFreshness, guideIndexable, REVIEW_AFTER_DAYS, type GuideFreshness, type GuidePlanFields } from "./guide-freshness";
import { freshnessLines, planFreshness } from "./talents/freshness";
import { classTalentChanges } from "./talents/freshness-records";
import { fixture } from "./talents/fixture";
import { importPlan } from "./talents/import";
import { orderRefusalText, validateOrder } from "./talents/order";
import { encodeBuild, encodeOrder } from "./talents/share";
import type { Ranks, TalentCatalog, TalentNode } from "./talents/types";

// Change records in the shape the build watch writes (kb/src/build-watch/changes.ts), as freshness.test.ts makes
// them. Made-up builds and talents on the test tree, not game data.
const EMPTY = { classesAdded: [], classesRemoved: [], added: [], removed: [], moved: [], ranks: [], gates: [], prereqs: [], replaced: [], spellValues: [], pointLevels: [] };
const ref = (version: string) => ({ version, buildId: Number(version.split(".").at(-1)), buildConfig: `config-${version}` });

function record(build: string, previous: string | null, talents: Record<string, unknown[]> = {}, extra: Record<string, unknown> = {}) {
  return {
    schema: "everloot.game-changes/2", label: "found in game files, unconfirmed", id: `test-${ref(build).buildId}`, product: "test",
    live: true, spoiler: false, detectedAt: "2026-10-01T00:00:00.000Z", build: ref(build), previous: previous ? ref(previous) : null,
    initial: previous === null, encryptedBlocks: { total: 0, tables: [] }, source: { definitions: null, library: "test", extractedAt: "2026-10-01T00:00:00.000Z" },
    catalog: { classes: 9, nodes: 12 }, talents: previous === null ? null : { ...EMPTY, ...talents }, raidBuffs: null, mapChanges: null, readSet: null, warnings: [],
    ...extra,
  };
}
const at = (nodeId: number, extra: Record<string, unknown> = {}) => ({ classId: 8, className: "Mage", tree: "Left", nodeId, name: `Talent ${nodeId}`, spoiler: false, ...extra });
const spellChange = (nodeId: number) => at(nodeId, { spellId: nodeId, spellName: `Spell ${nodeId}`, changes: [{ field: "effect 1 basePoints", before: 1, after: 2 }] });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** The test tree at a build, with some nodes changed or gone. */
function tree(build: string, edit: (nodes: TalentNode[]) => TalentNode[] = (n) => n, rules: Partial<TalentCatalog["rules"]> = {}): TalentCatalog {
  return { ...fixture, build, rules: { ...fixture.rules, ...rules }, nodes: edit(fixture.nodes) };
}
const changes = (records: unknown[]) => classTalentChanges(records, 8);

// Set 1: 11 points, 21 taken once row 1 holds 5. Set 2: 7 points on the right, 52 once 6 are spent anywhere.
const RANKS: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 1 } };
const ORDER = [11, 11, 11, 11, 11, 21, 12, 12, 12, 12, 12];
const RANKS2: Ranks = { 51: { rank: 5 }, 53: { rank: 1 }, 52: { rank: 1 } };
const ORDER2 = [51, 51, 51, 51, 51, 53, 52];

const code = (ranks: Ranks, build = "1.0.0.1") => encodeBuild({ classSlug: "mage", specId: fixture.specId, build, ranks });
const token = (ranks: Ranks, order: number[], origin: "planned" | "provisional" = "planned") => encodeOrder(ranks, order, origin)!;
const REVIEWED = { by: "Kai", on: "2026-10-20", build: "1.0.0.1" };
const TODAY = "2026-10-27";

function guide(over: Partial<GuidePlanFields> = {}): GuidePlanFields {
  return { classSlug: "mage", levels: { from: 10, to: 60 }, code: code(RANKS), order: token(RANKS, ORDER), reviewed: REVIEWED, ...over };
}

describe("guideFreshness", () => {
  test("a guide reviewed on its tree's build, within the review window and with no newer build, is current and says nothing", () => {
    const f = guideFreshness(guide(), tree("1.0.0.1"), changes([]), TODAY);
    expect(f.state).toBe("current");
    expect(f.reasons).toEqual([]);
    expect(f.sets).toHaveLength(1);
    expect(f.sets[0]).toMatchObject({ set: 1, code: guide().code, order: guide().order, problems: [], changes: [], stale: false });
    expect(f.sets[0].plan).toMatchObject({ ranks: RANKS, order: ORDER, orderOrigin: "planned" });
  });

  test(`${REVIEW_AFTER_DAYS} days after its review a guide is due for another one, and not a day before`, () => {
    expect(REVIEW_AFTER_DAYS).toBe(60);
    expect(guideFreshness(guide(), tree("1.0.0.1"), changes([]), "2026-12-18")).toMatchObject({ state: "current", reasons: [] });
    const due = guideFreshness(guide(), tree("1.0.0.1"), changes([]), "2026-12-19");
    expect(due.state).toBe("review-due");
    expect(due.reasons).toEqual(["Last reviewed 60 days ago, on 2026-10-20; a guide is due for another review after 60 days."]);
    expect(guideFreshness(guide(), tree("1.0.0.1"), changes([]), "2027-03-01").reasons).toEqual(["Last reviewed 132 days ago, on 2026-10-20; a guide is due for another review after 60 days."]);
  });

  test("a live build newer than the one the guide was reviewed against makes it due for review; one players cannot play yet, or a record that does not read, does not", () => {
    const due = guideFreshness(guide(), tree("1.0.0.3"), changes([record("1.0.0.3", "1.0.0.1"), record("1.0.0.2", "1.0.0.1")]), TODAY);
    expect(due.state).toBe("review-due");
    // The newest one is named.
    expect(due.reasons).toEqual(["Game build 1.0.0.3 is live and newer than 1.0.0.1, the build this guide was reviewed against."]);
    // Nothing the records show touched the plan, so it is not stale, and the set says so in the change engine's words.
    expect(due.sets[0].changes).toEqual(freshnessLines(planFreshness(tree("1.0.0.3"), changes([record("1.0.0.3", "1.0.0.1")]), "1.0.0.1", RANKS)));
    expect(due.sets[0].stale).toBe(false);

    const beta = guideFreshness(guide(), tree("1.0.0.3"), changes([record("1.0.0.3", "1.0.0.1", {}, { live: false, spoiler: true })]), TODAY);
    expect(beta).toMatchObject({ state: "current", reasons: [] });
    const unread = guideFreshness(guide(), tree("1.0.0.3"), changes([{ build: { version: "1.0.0.3" }, talents: "junk" }]), TODAY);
    expect(unread).toMatchObject({ state: "current", reasons: [] });
    expect(unread.sets[0].changes).toContain("The change record for game build 1.0.0.3 cannot be read, so changes between 1.0.0.1 and 1.0.0.3 are unknown.");
  });

  test("a recorded change to the plan's talents after the build it was reviewed against makes it stale, in the change engine's own words", () => {
    const records = [record("1.0.0.5", "1.0.0.3", { spellValues: [spellChange(12)] }), record("1.0.0.3", "1.0.0.1")];
    const f = guideFreshness(guide(), tree("1.0.0.5"), changes(records), TODAY);
    const lines = freshnessLines(planFreshness(tree("1.0.0.5"), changes(records), "1.0.0.1", RANKS));
    expect(lines).toContain("Talent 12: its spell changed in build 1.0.0.5: 1 number.");
    expect(f.state).toBe("stale");
    expect(f.sets[0]).toMatchObject({ changes: lines, stale: true, problems: [] });
    // The worst first: the changes, then why it is also due for review.
    expect(f.reasons).toEqual([...lines, "Game build 1.0.0.5 is live and newer than 1.0.0.1, the build this guide was reviewed against."]);

    // A change to the levels talent points arrive at is evidence too.
    const levels = [record("1.0.0.3", "1.0.0.1", { pointLevels: [{ classId: 8, className: "Mage", before: [10, 11, 12], after: [10, 12, 14], spoiler: false }] })];
    expect(guideFreshness(guide(), tree("1.0.0.3"), changes(levels), TODAY).state).toBe("stale");
  });

  test("a change made before the build the guide was reviewed against is one the review saw: shown with the plan, not stale", () => {
    const records = [record("1.0.0.5", "1.0.0.3"), record("1.0.0.3", "1.0.0.1", { spellValues: [spellChange(12)] })];
    const reviewedLater = guide({ reviewed: { by: "Kai", on: "2026-10-20", build: "1.0.0.5" } });
    const f = guideFreshness(reviewedLater, tree("1.0.0.5"), changes(records), TODAY);
    expect(f).toMatchObject({ state: "current", reasons: [] });
    expect(f.sets[0].stale).toBe(false);
    expect(f.sets[0].changes).toContain("Talent 12: its spell changed in build 1.0.0.3: 1 number.");
    // Reviewed against 1.0.0.3, the same change came at the review's own build: still seen.
    expect(guideFreshness(guide({ reviewed: { ...REVIEWED, build: "1.0.0.3" } }), tree("1.0.0.5"), changes(records), TODAY).sets[0].stale).toBe(false);
    // Reviewed against 1.0.0.1, the review could not have seen it.
    expect(guideFreshness(guide(), tree("1.0.0.5"), changes(records), TODAY).state).toBe("stale");
  });

  test("missing or incomplete records are never read as a change: the set says what is unknown and the guide is not stale", () => {
    const none = guideFreshness(guide(), tree("1.0.0.5"), changes([]), TODAY);
    expect(none).toMatchObject({ state: "current", reasons: [] });
    expect(none.sets[0].changes).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "There is no change record for game build 1.0.0.5, so changes between 1.0.0.1 and 1.0.0.5 are unknown.",
      "Check each talent before you follow the plan.",
    ]);
    const limited = guideFreshness(guide(), tree("1.0.0.3"), changes([record("1.0.0.3", "1.0.0.1", {}, { live: false, spoiler: true, warnings: ["no committed spell values to compare with, so spell number changes are not listed"] })]), TODAY);
    expect(limited).toMatchObject({ state: "current", reasons: [] });
    expect(limited.sets[0].changes).toContain("The change record for game build 1.0.0.3 had no spell numbers to compare with, so changes to spell numbers in that build are unknown.");
  });

  test("a set that no longer fits the tree makes the guide broken, in the calculator's own words, ahead of stale and review-due", () => {
    const gone = tree("1.0.0.1", (nodes) => nodes.filter((n) => n.id !== 21));
    const f = guideFreshness(guide(), gone, changes([]), "2027-01-30");
    expect(f.state).toBe("broken");
    expect(f.sets[0].problems).toEqual([
      "1 talent in the code is not in this tree and was left out: node 21 (1 point).",
      "Not every point in the code placed on this tree, so the plan's spend order is unknown.",
    ]);
    expect(f.reasons).toEqual([...f.sets[0].problems, "Last reviewed 102 days ago, on 2026-10-20; a guide is due for another review after 60 days."]);
    // The plan as the calculator opens it: what placed, with no order.
    expect(f.sets[0].plan).toEqual({ ranks: { 11: { rank: 5 }, 12: { rank: 5 } }, order: null, orderOrigin: null });

    const cut = guideFreshness(guide(), tree("1.0.0.1", (nodes) => nodes.map((n) => (n.id === 11 ? { ...n, maxRanks: 3 } : n))), changes([]), TODAY);
    expect(cut.state).toBe("broken");
    expect(cut.sets[0].problems[0]).toBe("Talent 11: the code asked for rank 5, but the most this tree allows is 3.");

    // The build line of the calculator's report is the change records' to explain: a plan that fits is not broken by it.
    const moved = guideFreshness(guide({ code: code(RANKS, "1.0.0.0") }), tree("1.0.0.1"), changes([]), TODAY);
    expect(moved.sets[0].problems).toEqual([]);
    expect(moved.state).toBe("current");
    const movedAndGone = guideFreshness(guide({ code: code(RANKS, "1.0.0.0") }), gone, changes([]), TODAY);
    expect(movedAndGone.sets[0].problems[0]).toBe("1 talent in the code is not in this tree and was left out: node 21 (1 point).");
  });

  test("a spend order the tree's rules now refuse leaves the order unknown, never repaired, and the guide broken, with the reason", () => {
    // Row 2 now opens at 10 points: the talents still fit, but the order takes Talent 21 at its 6th point.
    const later = tree("1.0.0.1", (nodes) => nodes.map((n) => (n.id === 21 ? { ...n, unlock: { pointsInTree: 10 } } : n)));
    const verdict = validateOrder(later, RANKS, ORDER);
    if (verdict.ok) throw new Error("the order should be refused");
    const f = guideFreshness(guide(), later, changes([]), TODAY);
    expect(f.state).toBe("broken");
    expect(f.sets[0].problems).toEqual([`The plan's spend order breaks this tree's rules, so the order is unknown. ${orderRefusalText(later, RANKS, ORDER, verdict)} The talents still loaded.`]);
    expect(f.sets[0].plan).toEqual({ ranks: RANKS, order: null, orderOrigin: null });
  });

  test("a provisional order a tool made is refused in a guide: it is broken, whatever the order's legality", () => {
    const f = guideFreshness(guide({ order: token(RANKS, ORDER, "provisional") }), tree("1.0.0.1"), changes([]), TODAY);
    expect(f.state).toBe("broken");
    expect(f.reasons).toEqual(["The spend order is provisional, made by the calculator when asked; a published guide carries only an order a player planned."]);
  });

  test("a plan the tree's points or the guide's levels cannot hold is broken", () => {
    const short = guideFreshness(guide(), tree("1.0.0.1", (n) => n, { maxLevel: 19 }), changes([]), TODAY);
    expect(short.state).toBe("broken");
    expect(short.sets[0].problems).toContain("It spends 11 points, and this tree gives 10 by level 19.");
    const levels = guideFreshness(guide({ levels: { from: 10, to: 19 } }), tree("1.0.0.1"), changes([]), TODAY);
    expect(levels.sets[0].problems).toEqual(["It needs level 20, above level 19, the last this guide covers."]);
  });

  test("a guide without a spend order is valid: the order is unknown, and none is made up", () => {
    const f = guideFreshness(guide({ order: undefined }), tree("1.0.0.1"), changes([]), TODAY);
    expect(f).toMatchObject({ state: "current", reasons: [] });
    expect(f.sets[0]).toMatchObject({ order: null, problems: [] });
    expect(f.sets[0].plan).toEqual({ ranks: RANKS, order: null, orderOrigin: null });
  });

  test("the second set is read on its own, and its reasons say which set", () => {
    const two = guide({ code2: code(RANKS2), order2: token(RANKS2, ORDER2) });
    const fine = guideFreshness(two, tree("1.0.0.1"), changes([]), TODAY);
    expect(fine.state).toBe("current");
    expect(fine.sets.map((s) => [s.set, s.code, s.order])).toEqual([[1, two.code, two.order], [2, two.code2, two.order2]]);
    expect(fine.sets[1].plan).toMatchObject({ ranks: RANKS2, order: ORDER2, orderOrigin: "planned" });

    const f = guideFreshness(two, tree("1.0.0.1", (nodes) => nodes.filter((n) => n.id !== 53)), changes([]), TODAY);
    expect(f.state).toBe("broken");
    expect(f.sets[0].problems).toEqual([]);
    expect(f.sets[1].problems[0]).toBe("1 talent in the code is not in this tree and was left out: node 53 (1 point).");
    expect(f.reasons.every((r) => r.startsWith("Set 2: "))).toBe(true);
    expect(f.reasons[0]).toBe("Set 2: 1 talent in the code is not in this tree and was left out: node 53 (1 point).");
  });

  test("each set is the one the calculator opens from the guide's link", () => {
    const two = guide({ code2: code(RANKS2), order2: undefined });
    const f = guideFreshness(two, tree("1.0.0.1"), changes([]), TODAY);
    const opened = (c: string, o: string | null) => {
      const r = importPlan(tree("1.0.0.1"), c, o);
      if (!r.ok) throw new Error(r.message);
      return r.set;
    };
    expect(f.sets[0].plan).toEqual(opened(two.code, two.order!));
    expect(f.sets[1].plan).toEqual(opened(two.code2!, null));
  });

  test("reading a guide's freshness changes nothing: the guide keeps its codes, its build and its review", () => {
    const records = deepFreeze([record("1.0.0.5", "1.0.0.3", { spellValues: [spellChange(12)] }), record("1.0.0.3", "1.0.0.1")]);
    const frozen = deepFreeze(guide());
    const before = JSON.stringify(frozen);
    const f = guideFreshness(frozen, deepFreeze(tree("1.0.0.5")), changes(records), TODAY);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(f.sets[0].code).toBe(frozen.code);
    expect(f.sets[0].order).toBe(frozen.order);
  });

  test("a version with no review on record is never current", () => {
    expect(guideFreshness(guide({ reviewed: null }), tree("1.0.0.1"), changes([]), TODAY)).toMatchObject({ state: "review-due", reasons: ["This version has no review on record."] });
  });
});

describe("guideIndexable", () => {
  const words = (n: number): Block[] => [{ type: "paragraph", inline: [{ kind: "text", text: Array.from({ length: n }, (_, i) => `word${i}`).join(" ") }], line: 1 }];
  const page = (over: Partial<{ status: "draft" | "published"; reviewed: GuidePlanFields["reviewed"]; blocks: Block[] }> = {}) => ({ status: "published" as const, reviewed: REVIEWED, blocks: words(150), ...over });
  const at = (state: GuideFreshness["state"]): GuideFreshness => ({ state, reasons: [], sets: [] });

  test("only a published, reviewed guide with 150 words of its own, current or due for review, is indexed", () => {
    expect(guideIndexable(page(), at("current"))).toBe(true);
    expect(guideIndexable(page(), at("review-due"))).toBe(true);
    expect(guideIndexable(page(), at("stale"))).toBe(false);
    expect(guideIndexable(page(), at("broken"))).toBe(false);
    expect(guideIndexable(page({ blocks: words(149) }), at("current"))).toBe(false);
    expect(guideIndexable(page({ status: "draft" }), at("current"))).toBe(false);
    expect(guideIndexable(page({ reviewed: null }), at("current"))).toBe(false);
  });
});
