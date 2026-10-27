import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fixture } from "./fixture";
import { compareGameBuilds, freshnessLines, planFreshness, type HistoryGap, type PlanFreshness } from "./freshness";
import { PUBLISHED_CHANGES, classTalentChanges } from "./freshness-records";
import type { Ranks, TalentCatalog } from "./types";

// Change records in the shape the build watch writes (kb/src/build-watch/changes.ts). Made-up builds and
// talents on the test tree, not game data.
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
const pos = (row: number, col: number, tree = "Left") => ({ tree, x: col * 600, y: row * 600, row, col });
const gate = (amount: number, scope: "tree" | "class" | "unconfirmed") => ({ spentRequired: { amount, scope, gateGroupId: 1, currencyId: 1, traitTreeId: 1 } });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

// The tree on screen is build 1.0.0.5. 1.0.0.3 lies between it and plans made on 1.0.0.1.
const tree: TalentCatalog = { ...fixture, build: "1.0.0.5" };
const plan: Ranks = { 11: { rank: 5 }, 12: { rank: 5 }, 21: { rank: 2 }, 22: { rank: 1 }, 31: { rank: 1 }, 32: { rank: 1, choice: 1 } };

/** Two recorded builds that change six of the plan's talents and two others. */
const changedRecords = () => [
  record("1.0.0.5", "1.0.0.3", {
    ranks: [at(11, { before: 5, after: 3 }), at(51, { before: 5, after: 4 })],
    replaced: [at(32, { before: [1], after: [2] })],
    spellValues: [at(12, { spellId: 1, spellName: "Spell 12", changes: [{ field: "text", before: "aa", after: "bb" }, { field: "effect 1 basePoints", before: 1, after: 2 }] })],
    added: [at(56, { kind: "single", maxRanks: 1 })],
  }),
  record("1.0.0.3", "1.0.0.1", {
    moved: [at(11, { from: pos(0, 0), to: pos(1, 0) })],
    removed: [at(21, { maxRanks: 5 })],
    gates: [at(31, { before: gate(10, "unconfirmed"), after: gate(10, "tree") })],
    prereqs: [at(22, { before: [{ nodeId: 12, rule: "all" }], after: [] })],
  }),
];

describe("compareGameBuilds", () => {
  test("orders builds by their numbers, part by part, not as text", () => {
    expect(compareGameBuilds("1.60.1.9999", "1.60.1.70450")).toBe(-1);
    expect(compareGameBuilds("1.60.1.70532", "1.60.1.70450")).toBe(1);
    expect(compareGameBuilds("1.60.10.1", "1.60.9.99999")).toBe(1);
    expect(compareGameBuilds("1.60.1.70450", "1.60.1.70450")).toBe(0);
    expect(compareGameBuilds("1.060.1.070450", "1.60.1.70450")).toBe(0);
    // Past what a JavaScript number holds exactly.
    expect(compareGameBuilds("1.60.1.90071992547409931", "1.60.1.90071992547409930")).toBe(1);
  });

  test("anything that is not a build has no order, rather than a guessed one", () => {
    const junk = ["", "abc", "1..2", ".1", "1.", "1.60.x.1", " 1.60.1.70450", "1.60.1.70450 ", "-1.60.1.70450", "1e3.0.0.1", "1,60,1,70450", "１.６０.１.７０４５０"];
    for (const build of junk) {
      expect(compareGameBuilds(build, "1.60.1.70450"), build).toBeNull();
      expect(compareGameBuilds("1.60.1.70450", build), build).toBeNull();
    }
    for (const build of [null, undefined, 1.6, {}, ["1.60.1.70450"]]) expect(compareGameBuilds(build, "1.60.1.70450")).toBeNull();
    // A short label is not a build: 1.60.1 says nothing about 70450.
    expect(compareGameBuilds("1.60.1", "1.60.1.70450")).toBeNull();
  });
});

describe("classTalentChanges", () => {
  test("reads the published record of build 1.60.1.70532: compared with 70450, a spoiler, no Mage talent changed", () => {
    const step = classTalentChanges(PUBLISHED_CHANGES, 8).steps.find((s) => s.build === "1.60.1.70532");
    // Its one warning, that the table layouts differ, is about where a listed change may come from: nothing is missing.
    expect(step).toEqual({ build: "1.60.1.70532", previous: "1.60.1.70450", readable: true, baseline: false, spoiler: true, classChanged: false, talents: [], pointLevels: [], limits: [] });
  });

  test("every warning the build watch writes is read: a missing spell number comparison limits the evidence, and so does a warning it does not know", () => {
    const root = join(src, "../..");
    const producer = ["kb/src/build-watch/diff.ts", "kb/src/build-watch/client-digests.ts"].map((f) => readFileSync(join(root, f), "utf8")).join("\n");
    const written = [...producer.matchAll(/warnings\.push\((`[^`]*`|"[^"]*")\)/g)].map((m) => m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, "x"));
    const limits = (warning: string) => classTalentChanges([record("1.0.0.5", "1.0.0.1", {}, { warnings: [warning] })], 8).steps[0].limits;
    expect(written.map((w) => [w, limits(w)])).toEqual([
      ["table definitions differ (WoWDBDefs x vs x): a change may come from the layouts, not the game", []],
      ["no committed spell values to compare with, so spell number changes are not listed", ["spellValues"]],
      ["no committed client digests to compare with, so client table changes are not listed", []],
      ["client table x was read before and is absent from this build (x), so it is not counted as removed", []],
    ]);
    expect(limits("Mage: 3 nodes have no entries")).toEqual(["unknown"]);
  });

  test("a record from a build that is not live is a spoiler, whatever its own spoiler flags say", () => {
    const read = classTalentChanges([record("1.0.0.5", "1.0.0.1", {
      ranks: [at(11, { before: 5, after: 3 })],
      pointLevels: [{ classId: 8, className: "Mage", before: [10, 11, 12], after: [10, 12, 14], spoiler: false }],
    }, { live: false, spoiler: false })], 8);
    expect(read.steps[0]).toMatchObject({ spoiler: true, talents: [{ spoiler: true }], pointLevels: [{ spoiler: true }] });
    expect(freshnessLines(planFreshness(tree, read, "1.0.0.1", { 11: { rank: 3 } }))).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "1 of this plan's talents and the levels talent points arrive at changed in a build players cannot play yet (1.0.0.5). Spoilers are not shown here.",
      "Check each talent before you follow the plan.",
    ]);
  });

  test("keeps one class's talent changes and orders the records by build number, oldest first", () => {
    const read = classTalentChanges([
      record("1.0.0.10", "1.0.0.9", { ranks: [at(11, { before: 5, after: 3 }), { ...at(11, { before: 5, after: 3 }), classId: 5, className: "Priest" }] }),
      record("1.0.0.9", "1.0.0.1", { moved: [at(12, { from: pos(0, 1), to: pos(2, 0, "Right") })] }),
    ], 8);
    expect(read.steps.map((s) => s.build)).toEqual(["1.0.0.9", "1.0.0.10"]);
    expect(read.steps[1].talents).toEqual([{ kind: "ranks", build: "1.0.0.10", nodeId: 11, name: "Talent 11", spoiler: false, before: 5, after: 3 }]);
    // Positions are 1-based, as on the calculator.
    expect(read.steps[0].talents).toEqual([{ kind: "moved", build: "1.0.0.9", nodeId: 12, name: "Talent 12", spoiler: false, from: { tree: "Left", row: 1, col: 2 }, to: { tree: "Right", row: 3, col: 1 } }]);
    expect(read.unplaced).toBe(0);
  });

  test("a record that does not read stays at its build when it names one, and is counted when it does not", () => {
    const read = classTalentChanges([null, "junk", 42, {}, { build: { version: "1.0.0.4" }, talents: "junk" }, record("1.0.0.5", "1.0.0.4")], 8);
    expect(read.unplaced).toBe(4);
    expect(read.steps.map((s) => [s.build, s.readable])).toEqual([["1.0.0.4", false], ["1.0.0.5", true]]);
    expect(classTalentChanges(null as never, 8)).toEqual({ classId: 8, steps: [], unplaced: 1 });
  });
});

describe("planFreshness", () => {
  test("a plan made on this tree's build has nothing to check", () => {
    const f = planFreshness(tree, classTalentChanges(changedRecords(), 8), "1.0.0.5", plan);
    expect(f).toEqual({ relation: "same", madeOn: "1.0.0.5", treeBuild: "1.0.0.5", touched: [], pointLevels: [], gaps: [], others: 0, changed: false });
    expect(freshnessLines(f)).toEqual([]);
  });

  test("with a record for every build since the plan and none touching it, nothing changed; the published record proves it for 70450", () => {
    const real = planFreshness({ ...fixture, build: "1.60.1.70532" }, classTalentChanges(PUBLISHED_CHANGES, 8), "1.60.1.70450", plan);
    expect(real).toMatchObject({ relation: "older", touched: [], pointLevels: [], gaps: [], others: 0, changed: false });
    expect(freshnessLines(real)).toEqual([
      "Made on game build 1.60.1.70450; this tree is build 1.60.1.70532.",
      "Since then, the game files changed none of this plan's talents, nor the levels talent points arrive at.",
    ]);
    // Other talents of the class changed in between; this plan has none of them.
    const elsewhere = planFreshness(tree, classTalentChanges(changedRecords(), 8), "1.0.0.1", { 41: { rank: 1 }, 52: { rank: 1 } });
    expect(elsewhere).toMatchObject({ relation: "older", touched: [], gaps: [], others: 8, changed: false });
    expect(freshnessLines(elsewhere)[1]).toBe("Since then, the game files changed none of this plan's talents, nor the levels talent points arrive at; they changed 8 other talents of this class.");
  });

  test("lists each of the plan's talents a later build changed, oldest change first, with what changed and in which build", () => {
    const f = planFreshness(tree, classTalentChanges(changedRecords(), 8), "1.0.0.1", plan);
    expect(f).toMatchObject({ relation: "older", changed: true, gaps: [], others: 2 });
    expect(f.touched.map((t) => [t.nodeId, t.points, t.changes.map((c) => `${c.kind}@${c.build}`)])).toEqual([
      [11, 5, ["moved@1.0.0.3", "ranks@1.0.0.5"]],
      [21, 2, ["removed@1.0.0.3"]],
      [22, 1, ["prereqs@1.0.0.3"]],
      [31, 1, ["gates@1.0.0.3"]],
      [12, 5, ["spellValues@1.0.0.5"]],
      [32, 1, ["replaced@1.0.0.5"]],
    ]);
    expect(freshnessLines(f)).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "Talent 11: moved from row 1, column 1 to row 2, column 1 in build 1.0.0.3; its maximum rank went from 5 to 3 in build 1.0.0.5 (this plan spends 5 points in it).",
      "Talent 21: removed in build 1.0.0.3 (this plan spends 2 points in it).",
      "Talent 22: the talents it needs first changed in build 1.0.0.3.",
      "Talent 31: what unlocks it changed in build 1.0.0.3 (before: 10 points, where they count is unconfirmed; after: 10 points in its tree).",
      "Talent 12: its spell changed in build 1.0.0.5: 1 number and the tooltip text.",
      "Talent 32: it holds a different spell from build 1.0.0.5.",
      "Check these talents before you follow the plan.",
    ]);
    // Made on 1.0.0.3, only the later record counts.
    const later = planFreshness(tree, classTalentChanges(changedRecords(), 8), "1.0.0.3", plan);
    expect(later.touched.map((t) => t.nodeId)).toEqual([11, 12, 32]);
    expect(later.touched[0].changes.map((c) => c.kind)).toEqual(["ranks"]);
  });

  test("no record, a missing or unreadable link, a baseline, two records for one build or a class added or removed leaves the history incomplete, never unchanged", () => {
    const cases: [unknown[], HistoryGap[]][] = [
      [[], [{ kind: "missing", build: "1.0.0.5" }]],
      [[record("1.0.0.5", "1.0.0.3")], [{ kind: "missing", build: "1.0.0.3" }]],
      [[record("1.0.0.5", "1.0.0.3"), record("1.0.0.3", null)], [{ kind: "baseline", build: "1.0.0.3" }]],
      [[record("1.0.0.5", "1.0.0.3"), { ...record("1.0.0.3", "1.0.0.1"), talents: "junk" }], [{ kind: "unreadable", build: "1.0.0.3" }]],
      [[record("1.0.0.5", "1.0.0.9")], [{ kind: "unreadable", build: "1.0.0.5" }]],
      [[record("1.0.0.5", "1.0.0.1"), { ...record("1.0.0.5", "1.0.0.1"), id: "other-5", product: "other" }], [{ kind: "conflict", build: "1.0.0.5" }]],
      [[record("1.0.0.5", "1.0.0.1", { classesAdded: [{ classId: 8, className: "Mage", spoiler: false }] })], [{ kind: "class", build: "1.0.0.5" }]],
      [[record("1.0.0.5", "1.0.0.1"), "junk"], [{ kind: "unplaced", count: 1 }]],
    ];
    for (const [records, gaps] of cases) {
      const f = planFreshness(tree, classTalentChanges(records, 8), "1.0.0.1", plan);
      expect(f.gaps, JSON.stringify(gaps)).toEqual(gaps);
      expect(f.changed).toBeNull();
      expect(freshnessLines(f).join(" ")).not.toMatch(/changed none/);
    }
    // Another class's records say nothing about this one.
    expect(planFreshness(tree, classTalentChanges([record("1.0.0.5", "1.0.0.1")], 5), "1.0.0.1", plan)).toMatchObject({ gaps: [{ kind: "missing", build: "1.0.0.5" }], changed: null });

    // What the records do show still counts; the gap says the rest is unknown.
    const partial = planFreshness(tree, classTalentChanges([changedRecords()[0]], 8), "1.0.0.1", plan);
    expect(partial).toMatchObject({ changed: true, gaps: [{ kind: "missing", build: "1.0.0.3" }] });
    expect(partial.touched.map((t) => t.nodeId)).toEqual([11, 12, 32]);
    expect(freshnessLines(partial).slice(-2)).toEqual([
      "There is no change record for game build 1.0.0.3, so changes between 1.0.0.1 and 1.0.0.3 are unknown.",
      "Check each talent before you follow the plan.",
    ]);
    expect(freshnessLines(planFreshness(tree, classTalentChanges([], 8), "1.0.0.1", plan))).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "There is no change record for game build 1.0.0.5, so changes between 1.0.0.1 and 1.0.0.5 are unknown.",
      "Check each talent before you follow the plan.",
    ]);
  });

  test("a record that could not compare spell numbers leaves the history incomplete, and what the records do show is still listed", () => {
    const noSpells = { warnings: ["no committed spell values to compare with, so spell number changes are not listed"] };
    const quiet = planFreshness(tree, classTalentChanges([record("1.0.0.5", "1.0.0.1", {}, noSpells)], 8), "1.0.0.1", plan);
    expect(quiet).toMatchObject({ relation: "older", touched: [], changed: null, gaps: [{ kind: "limited", build: "1.0.0.5", comparison: "spellValues" }] });
    expect(freshnessLines(quiet)).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "The change record for game build 1.0.0.5 had no spell numbers to compare with, so changes to spell numbers in that build are unknown.",
      "Check each talent before you follow the plan.",
    ]);
    const shown = planFreshness(tree, classTalentChanges([record("1.0.0.5", "1.0.0.3", { ranks: [at(11, { before: 5, after: 3 })] }), record("1.0.0.3", "1.0.0.1", {}, noSpells)], 8), "1.0.0.1", plan);
    expect(shown).toMatchObject({ changed: true, gaps: [{ kind: "limited", build: "1.0.0.3", comparison: "spellValues" }] });
    expect(shown.touched.map((t) => t.nodeId)).toEqual([11]);
    expect(freshnessLines(shown).at(-1)).toBe("Check each talent before you follow the plan.");
    // A warning the site does not know is read as a comparison that may be missing.
    const odd = planFreshness(tree, classTalentChanges([record("1.0.0.5", "1.0.0.1", {}, { warnings: ["Mage: 3 nodes have no entries"] })], 8), "1.0.0.1", plan);
    expect(odd).toMatchObject({ changed: null, gaps: [{ kind: "limited", build: "1.0.0.5", comparison: "unknown" }] });
    expect(freshnessLines(odd)[1]).toBe("The change record for game build 1.0.0.5 warns that part of its comparison may be missing, so changes in that build may not all be listed.");
    // Only the records between the plan's build and the tree's count.
    expect(planFreshness(tree, classTalentChanges([record("1.0.0.5", "1.0.0.3"), record("1.0.0.3", "1.0.0.1", {}, noSpells)], 8), "1.0.0.3", plan)).toMatchObject({ changed: false, gaps: [] });
  });

  test("a talent a public build changed and a spoiler build renamed keeps its public name while spoilers are off", () => {
    const records = [
      record("1.0.0.5", "1.0.0.3", { ranks: [at(11, { name: "Hidden Name", before: 5, after: 3 })] }, { live: false, spoiler: true }),
      record("1.0.0.3", "1.0.0.1", { moved: [at(11, { from: pos(0, 0), to: pos(1, 0) })] }),
    ];
    const f = planFreshness(tree, classTalentChanges(records, 8), "1.0.0.1", { 11: { rank: 5 } });
    expect(freshnessLines(f)).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "Talent 11: moved from row 1, column 1 to row 2, column 1 in build 1.0.0.3.",
      "1 of this plan's talents changed in a build players cannot play yet (1.0.0.5). Spoilers are not shown here.",
      "Check each talent before you follow the plan.",
    ]);
    // The result names a talent only on each change, beside that change's spoiler flag.
    expect(f.touched[0]).not.toHaveProperty("name");
    expect(f.touched[0].changes.map((c) => [c.name, c.spoiler])).toEqual([["Talent 11", false], ["Hidden Name", true]]);
    expect(freshnessLines(f, { spoilers: true })[1]).toBe("Hidden Name: moved from row 1, column 1 to row 2, column 1 in build 1.0.0.3; its maximum rank went from 5 to 3 in build 1.0.0.5 (this plan spends 5 points in it).");
  });

  test("a plan made on a build with no record of its own, skipped or withdrawn, claims nothing from the record that spans it", () => {
    // A build that a record compares with needs no record of its own: 1.0.0.1 is 1.0.0.3's previous build.
    expect(planFreshness(tree, classTalentChanges(changedRecords(), 8), "1.0.0.1", plan).gaps).toEqual([]);
    const f = planFreshness(tree, classTalentChanges(changedRecords(), 8), "1.0.0.2", plan);
    // 1.0.0.3's record compares 1.0.0.1 with 1.0.0.3: its changes may predate the plan, so none is claimed.
    expect(f.touched.map((t) => [t.nodeId, t.changes.map((c) => c.build)])).toEqual([[11, ["1.0.0.5"]], [12, ["1.0.0.5"]], [32, ["1.0.0.5"]]]);
    expect(f.gaps).toEqual([{ kind: "unrecorded", build: "1.0.0.2", from: "1.0.0.1", to: "1.0.0.3" }]);
    expect(f.changed).toBe(true);

    const none = planFreshness(tree, classTalentChanges([record("1.0.0.5", "1.0.0.1", { removed: [at(12, { maxRanks: 5 })] })], 8), "1.0.0.3", plan);
    expect(none).toMatchObject({ relation: "older", touched: [], changed: null, gaps: [{ kind: "unrecorded", build: "1.0.0.3", from: "1.0.0.1", to: "1.0.0.5" }] });
    expect(freshnessLines(none)).toEqual([
      "Made on game build 1.0.0.3; this tree is build 1.0.0.5.",
      "Game build 1.0.0.3 has no change record of its own: the record for build 1.0.0.5 compares 1.0.0.1 with 1.0.0.5, so which of its changes came after this plan is unknown.",
      "Check each talent before you follow the plan.",
    ]);
  });

  test("a plan made on a newer build than the tree, or on a build that cannot be read, gets no verdict", () => {
    const changes = classTalentChanges(changedRecords(), 8);
    const newer = planFreshness(tree, changes, "1.0.0.7", plan);
    expect(newer).toMatchObject({ relation: "newer", touched: [], pointLevels: [], gaps: [], changed: null });
    expect(freshnessLines(newer)).toEqual([
      "Made on game build 1.0.0.7, which is newer than this tree (build 1.0.0.5).",
      "This site does not show that build's tree, so what differs is unknown. Check each talent before you follow the plan.",
    ]);
    for (const junk of ["", "1.0.x.1", "<b>1.0.0.1</b>"]) {
      const f = planFreshness(tree, changes, junk, plan);
      expect(f).toMatchObject({ relation: "unknown", touched: [], changed: null });
      expect(freshnessLines(f)).toEqual(["This plan's game build cannot be read.", "What changed since it was made is unknown. Check each talent before you follow the plan."]);
    }
    expect(freshnessLines(planFreshness({ ...tree, build: "beta" }, changes, "1.0.0.1", plan))).toEqual([
      "This tree's game build cannot be read.", "What changed since the plan was made is unknown. Check each talent before you follow the plan.",
    ]);
    expect(freshnessLines(planFreshness(tree, changes, "1.0.1", plan))).toEqual([
      "Game build 1.0.1 cannot be compared with this tree's build, 1.0.0.5.", "What changed since the plan was made is unknown. Check each talent before you follow the plan.",
    ]);
  });

  test("a changed point schedule says which level the plan's points need before and after", () => {
    const schedule = (before: number[], after: number[]) => classTalentChanges([record("1.0.0.5", "1.0.0.1", { pointLevels: [{ classId: 8, className: "Mage", before, after, spoiler: false }] })], 8);
    const moved = planFreshness(tree, schedule([10, 11, 12, 13, 14], [10, 12, 14, 16]), "1.0.0.1", { 11: { rank: 3 } });
    expect(moved).toMatchObject({ touched: [], gaps: [], changed: true });
    expect(moved.pointLevels).toEqual([{ build: "1.0.0.5", spoiler: false, before: [10, 11, 12, 13, 14], after: [10, 12, 14, 16], points: 3, levelBefore: 12, levelAfter: 14 }]);
    expect(freshnessLines(moved)).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "The levels talent points arrive at changed in build 1.0.0.5: this plan's 3 points needed level 12, and from that build they need level 14.",
      "Check each talent before you follow the plan.",
    ]);
    const short = planFreshness(tree, schedule([10, 11, 12, 13, 14], [10, 12, 14, 16]), "1.0.0.1", { 11: { rank: 5 } });
    expect(short.pointLevels[0]).toMatchObject({ points: 5, levelBefore: 14, levelAfter: null });
    expect(freshnessLines(short)[1]).toBe("The levels talent points arrive at changed in build 1.0.0.5: it gives 4 points, fewer than this plan's 5.");
    const same = planFreshness(tree, schedule([10, 11, 12], [10, 11, 12, 13]), "1.0.0.1", { 11: { rank: 1 } });
    expect(freshnessLines(same)[1]).toBe("The levels talent points arrive at changed in build 1.0.0.5; this plan's 1 point still needs level 10.");
    expect(freshnessLines(planFreshness(tree, schedule([10, 11], [11, 12]), "1.0.0.1", {}))[1]).toBe("The levels talent points arrive at changed in build 1.0.0.5.");
  });

  test("junk ranks are left out, and nothing it is given is changed", () => {
    const asked = deepFreeze({ 11: { rank: 5 }, 12: { rank: 0 }, 21: { rank: -2 }, 22: { rank: 1.5 }, 31: null, abc: { rank: 3 } }) as unknown as Ranks;
    const changes = deepFreeze(classTalentChanges(deepFreeze(changedRecords()), 8));
    const before = JSON.stringify(changes);
    const f = planFreshness(deepFreeze({ ...tree }), changes, "1.0.0.1", asked);
    expect(f.touched.map((t) => [t.nodeId, t.points])).toEqual([[11, 5]]);
    expect(JSON.stringify(changes)).toBe(before);
    expect(planFreshness(tree, changes, "1.0.0.1", null as never)).toMatchObject({ touched: [], changed: false });
  });
});

describe("freshnessLines", () => {
  test("spoiler changes are counted, not shown, unless the reader turned spoilers on", () => {
    // The record says the whole build is a spoiler, even where an item does not.
    const records = [record("1.0.0.5", "1.0.0.1", {
      ranks: [at(11, { before: 5, after: 3 })],
      pointLevels: [{ classId: 8, className: "Mage", before: [10, 11, 12], after: [10, 12, 14], spoiler: true }],
    }, { live: false, spoiler: true })];
    const f = planFreshness(tree, classTalentChanges(records, 8), "1.0.0.1", { 11: { rank: 3 } });
    expect(f.changed).toBe(true);
    expect(f.touched[0].changes[0].spoiler).toBe(true);
    const hidden = freshnessLines(f);
    expect(hidden).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "1 of this plan's talents and the levels talent points arrive at changed in a build players cannot play yet (1.0.0.5). Spoilers are not shown here.",
      "Check each talent before you follow the plan.",
    ]);
    expect(hidden.join(" ")).not.toMatch(/Talent 11|maximum rank|level 1[24]|in build/);
    expect(freshnessLines(f, { spoilers: true })).toEqual([
      "Made on game build 1.0.0.1; this tree is build 1.0.0.5.",
      "Talent 11: its maximum rank went from 5 to 3 in build 1.0.0.5.",
      "The levels talent points arrive at changed in build 1.0.0.5: this plan's 3 points needed level 12, and from that build they need level 14.",
      "Check these talents before you follow the plan.",
    ]);
  });

  test("never says fresh, stale, reviewed or up to date, and carries no dates: review and dates belong to the content", () => {
    const changes = classTalentChanges(changedRecords(), 8);
    const results: PlanFreshness[] = ["1.0.0.5", "1.0.0.1", "1.0.0.2", "1.0.0.3", "1.0.0.7", "junk", "1.0.1"].map((b) => planFreshness(tree, changes, b, plan));
    results.push(planFreshness(tree, classTalentChanges([], 8), "1.0.0.1", plan));
    for (const f of results) {
      expect(Object.keys(f).sort()).toEqual(["changed", "gaps", "madeOn", "others", "pointLevels", "relation", "touched", "treeBuild"]);
      expect(JSON.stringify(f)).not.toMatch(/detectedAt|extractedAt|review/i);
      for (const spoilers of [false, true]) {
        const text = freshnessLines(f, { spoilers }).join(" ");
        expect(text).not.toMatch(/\b(?:fresh|stale|reviewed|up to date|verified|recommend)/i);
        expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    }
  });
});

const src = join(__dirname, "../..");

test("every change record the build watch publishes is read, and reads", () => {
  const files = readdirSync(join(src, "data/game-data/changes")).filter((f) => f.endsWith(".json")).sort();
  const listed = PUBLISHED_CHANGES.map((e) => `${(e as { id: string }).id}.json`).sort();
  // A new build's pull request adds its record to the folder; list it in PUBLISHED_CHANGES in the same pull request.
  expect(listed, "web/src/lib/talents/freshness-records.ts PUBLISHED_CHANGES").toEqual(files);
  const read = classTalentChanges(PUBLISHED_CHANGES, 8);
  expect(read.unplaced).toBe(0);
  expect(read.steps.length).toBe(files.length);
  expect(read.steps.every((s) => s.readable)).toBe(true);
});

test("the published records chain the Mage tree from 1.60.1.70450 to 70630, whose change to a plan's talent is a spoiler", () => {
  // Elemental Precision (Frost, node 105778) went from 5 ranks to 3 in 70630, the first build of the retail product.
  const f = planFreshness({ ...fixture, build: "1.60.1.70630" }, classTalentChanges(PUBLISHED_CHANGES, 8), "1.60.1.70450", { 105778: { rank: 5 } });
  expect(f).toMatchObject({ relation: "older", gaps: [], changed: true });
  expect(f.touched[0].changes).toEqual([expect.objectContaining({ kind: "ranks", build: "1.60.1.70630", before: 5, after: 3, spoiler: true })]);
  expect(freshnessLines(f)[1]).toBe("1 of this plan's talents changed in a build players cannot play yet (1.60.1.70630). Spoilers are not shown here.");
});

test("the engine and the note only read: nothing in them can save a plan, restamp its code or run in the browser", () => {
  const writes = /\bencode(?:Build|Order)\b|\b(?:replace)?[pP]lanHash\b|localStorage|sessionStorage|\bfetch\(|player-workspace|saved-builds|SaveBuild|(?:replace|push)State|location\.(?:hash|href)\s*=(?!=)|location\.(?:assign|replace)\(/;
  for (const file of ["lib/talents/freshness.ts", "lib/talents/freshness-records.ts", "components/talents/FreshnessNote.tsx"]) {
    const text = readFileSync(join(src, file), "utf8");
    expect(text, file).not.toMatch(writes);
    expect(text, file).not.toMatch(/"use client"|\buse(?:Effect|State)\b/);
  }
  // The one part that runs in the browser reads the address and never writes it.
  expect(readFileSync(join(src, "components/talents/WhilePlanShown.tsx"), "utf8")).not.toMatch(writes);
});
