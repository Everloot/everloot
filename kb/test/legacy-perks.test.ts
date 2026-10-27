import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { ClientDigests, tableHash } from "../src/build-watch/client-digests.js";
import { writeClientSnapshot } from "../src/client-snapshot.js";
import { buildLegacyPerkCatalog, serializeLegacyPerkCatalog, writeLegacyPerkCatalog } from "../src/legacy-perks/build-catalog.js";
import { LEGACY_PERKS_SCHEMA, LEGACY_TRAIT_SYSTEM_ID, LegacyPerkCatalog } from "../src/legacy-perks/catalog.js";
import type { Row, Rows, TableReader } from "../src/talents/build-catalog.js";
import type { BuildStamp } from "../src/talents/catalog.js";

const stamp = (buildId: number): BuildStamp => ({
  product: "wowf", buildId, version: `1.60.1.${buildId}`, buildConfig: "c".repeat(32), definitions: "abc1234", extractedAt: "2026-10-27T00:00:00.000Z",
});

/** A condition row with every requirement column at 0, as the client stores an unused one. */
const cond = (id: number, tree: number, extra: Row): Row => ({
  ID: id, CondType: 0, TraitTreeID: tree, GrantedRanks: 0, QuestID: 0, AchievementID: 0, SpecSetID: 0, TraitNodeGroupID: 0,
  TraitNodeID: 0, TraitNodeEntryID: 0, TraitCurrencyID: 5000, SpentAmountRequired: 0, Flags: 0, RequiredLevel: 0, TraitCondAccountElementID: 0, ...extra,
});

/**
 * Two made-up Legacy trees in trait system 45 and one class tree beside them. Tree 700 has a single node, a tiered
 * node behind a 5-point gate, a node behind a 10-point gate and a fourth with other flags; tree 701 has a choice node
 * and a node whose gate names no counting group. Tree 702 has no nodes. Ids and numbers are invented, not a real build's.
 */
function rows(): Record<string, Row[]> {
  return {
    TraitTree: [
      { ID: 900, TraitSystemID: 10 },
      { ID: 700, TraitSystemID: LEGACY_TRAIT_SYSTEM_ID },
      { ID: 701, TraitSystemID: LEGACY_TRAIT_SYSTEM_ID },
      { ID: 702, TraitSystemID: LEGACY_TRAIT_SYSTEM_ID },
    ],
    TraitNode: [
      { ID: 1, TraitTreeID: 700, PosX: 2400, PosY: 1000, Type: 0, Flags: 8 },
      { ID: 2, TraitTreeID: 700, PosX: 3300, PosY: 1000, Type: 1, Flags: 8 },
      { ID: 3, TraitTreeID: 700, PosX: 4200, PosY: 1000, Type: 0, Flags: 8 },
      { ID: 4, TraitTreeID: 700, PosX: 5100, PosY: 1000, Type: 0, Flags: 10 },
      { ID: 5, TraitTreeID: 701, PosX: 2400, PosY: 1900, Type: 2, Flags: 10 },
      { ID: 6, TraitTreeID: 701, PosX: 3300, PosY: 1900, Type: 0, Flags: 8 },
      { ID: 9, TraitTreeID: 900, PosX: 1000, PosY: 1000, Type: 0, Flags: 0 },
    ],
    TraitNodeXTraitNodeEntry: [
      { ID: 1, TraitNodeID: 1, TraitNodeEntryID: 11, Index: 100 },
      { ID: 2, TraitNodeID: 2, TraitNodeEntryID: 23, Index: 300 },
      { ID: 3, TraitNodeID: 2, TraitNodeEntryID: 21, Index: 100 },
      { ID: 4, TraitNodeID: 2, TraitNodeEntryID: 22, Index: 200 },
      { ID: 5, TraitNodeID: 3, TraitNodeEntryID: 31, Index: 100 },
      { ID: 6, TraitNodeID: 4, TraitNodeEntryID: 41, Index: 100 },
      { ID: 7, TraitNodeID: 5, TraitNodeEntryID: 51, Index: 100 },
      { ID: 8, TraitNodeID: 5, TraitNodeEntryID: 52, Index: 200 },
      { ID: 9, TraitNodeID: 6, TraitNodeEntryID: 61, Index: 100 },
      { ID: 10, TraitNodeID: 9, TraitNodeEntryID: 91, Index: 100 },
    ],
    TraitNodeEntry: [
      { ID: 11, TraitDefinitionID: 111, MaxRanks: 5 },
      { ID: 21, TraitDefinitionID: 121, MaxRanks: 1 }, { ID: 22, TraitDefinitionID: 122, MaxRanks: 1 }, { ID: 23, TraitDefinitionID: 123, MaxRanks: 1 },
      { ID: 31, TraitDefinitionID: 131, MaxRanks: 2 },
      { ID: 41, TraitDefinitionID: 141, MaxRanks: 1 },
      { ID: 51, TraitDefinitionID: 151, MaxRanks: 1 }, { ID: 52, TraitDefinitionID: 152, MaxRanks: 3 },
      { ID: 61, TraitDefinitionID: 161, MaxRanks: 1 },
      { ID: 91, TraitDefinitionID: 191, MaxRanks: 1 },
    ],
    TraitDefinition: [
      { ID: 111, SpellID: 2001, VisibleSpellID: 0 },
      { ID: 121, SpellID: 2002, VisibleSpellID: 0 }, { ID: 122, SpellID: 2002, VisibleSpellID: 0 }, { ID: 123, SpellID: 2002, VisibleSpellID: 0 },
      { ID: 131, SpellID: 2003, VisibleSpellID: 2007 }, // the client shows another spell's name
      { ID: 141, SpellID: 2009, VisibleSpellID: 0 },
      { ID: 151, SpellID: 2009, VisibleSpellID: 0 },
      { ID: 152, SpellID: 2005, VisibleSpellID: 0, OverrideName_lang: "Override Name" },
      { ID: 161, SpellID: 2006, VisibleSpellID: 0 }, // no SpellName row: its name sits in an encrypted block
      { ID: 191, SpellID: 2010, VisibleSpellID: 0 },
    ],
    SpellName: [
      { ID: 2001, Name_lang: "Alpha Perk" }, { ID: 2002, Name_lang: "Tiered Perk" }, { ID: 2003, Name_lang: "Hidden Spell" },
      { ID: 2005, Name_lang: "Choice Perk" }, { ID: 2007, Name_lang: "Shown Name" }, { ID: 2009, Name_lang: "Unknown" },
      { ID: 2010, Name_lang: "Class Talent" },
    ],
    TraitEdge: [
      { ID: 1, LeftTraitNodeID: 1, RightTraitNodeID: 2, Type: 2 },
      { ID: 2, LeftTraitNodeID: 2, RightTraitNodeID: 3, Type: 3 },
      { ID: 3, LeftTraitNodeID: 3, RightTraitNodeID: 4, Type: 0 }, // drawn, no prerequisite
      { ID: 4, LeftTraitNodeID: 1, RightTraitNodeID: 3, Type: 5 }, // deprecated in WoWDBDefs
      { ID: 5, LeftTraitNodeID: 1, RightTraitNodeID: 9, Type: 2 }, // into the class tree
    ],
    // 800 holds tree 700's first three nodes and is the group its conditions name; 801 and 802 are the gated groups.
    TraitNodeGroupXTraitNode: [
      { ID: 1, TraitNodeGroupID: 800, TraitNodeID: 1 }, { ID: 2, TraitNodeGroupID: 800, TraitNodeID: 2 }, { ID: 3, TraitNodeGroupID: 800, TraitNodeID: 3 },
      { ID: 4, TraitNodeGroupID: 801, TraitNodeID: 2 },
      { ID: 5, TraitNodeGroupID: 802, TraitNodeID: 3 },
      { ID: 6, TraitNodeGroupID: 810, TraitNodeID: 6 },
      { ID: 7, TraitNodeGroupID: 990, TraitNodeID: 9 },
    ],
    TraitCond: [
      cond(71, 700, { TraitNodeGroupID: 800, SpentAmountRequired: 5 }),
      cond(72, 700, { TraitNodeGroupID: 800, SpentAmountRequired: 10 }),
      cond(73, 701, { SpentAmountRequired: 3 }),
      cond(75, 900, { TraitNodeGroupID: 990, TraitCurrencyID: 3000, SpentAmountRequired: 5 }),
    ],
    TraitNodeGroupXTraitCond: [
      { ID: 1, TraitCondID: 71, TraitNodeGroupID: 801 }, { ID: 2, TraitCondID: 72, TraitNodeGroupID: 802 },
      { ID: 3, TraitCondID: 73, TraitNodeGroupID: 810 }, { ID: 4, TraitCondID: 75, TraitNodeGroupID: 990 },
    ],
    TraitNodeXTraitCond: [{ ID: 1, TraitCondID: 75, TraitNodeID: 9 }],
    TraitNodeEntryXTraitCond: [],
    TraitTreeXTraitCurrency: [
      { ID: 1, Index: 0, TraitTreeID: 700, TraitCurrencyID: 5000 }, { ID: 2, Index: 0, TraitTreeID: 701, TraitCurrencyID: 5000 },
      { ID: 3, Index: 0, TraitTreeID: 900, TraitCurrencyID: 3000 },
    ],
    TraitTreeXTraitCost: [{ ID: 1, TraitTreeID: 700, TraitCostID: 600 }, { ID: 2, TraitTreeID: 701, TraitCostID: 601 }, { ID: 3, TraitTreeID: 900, TraitCostID: 650 }],
    TraitCost: [
      { ID: 600, Amount: 1, TraitCurrencyID: 5000 }, { ID: 601, Amount: 2, TraitCurrencyID: 5000 }, { ID: 650, Amount: 1, TraitCurrencyID: 3000 },
    ],
    TraitNodeXTraitCost: [],
    TraitNodeGroupXTraitCost: [],
    TraitNodeEntryXTraitCost: [],
    TraitCurrency: [{ ID: 3000, SourcedMax: 51 }, { ID: 5000, SourcedMax: 16 }],
  };
}

const toRows = (list: Row[]): Rows => new Map(list.map((r) => [Number(r.ID), r]));
const reader = (tables: Record<string, Row[] | undefined>): TableReader => (name) => (tables[name] ? toRows(tables[name]!) : undefined);
/** The fixture with some rows taken out, or a table changed. */
const edit = (change: (t: Record<string, Row[] | undefined>) => void): Record<string, Row[] | undefined> => {
  const t: Record<string, Row[] | undefined> = rows();
  change(t);
  return t;
};
const drop = (t: Record<string, Row[] | undefined>, table: string, keep: (r: Row) => boolean) => { t[table] = t[table]!.filter(keep); };

const run = (tables: Record<string, Row[] | undefined> = rows(), build = stamp(70634), previous?: LegacyPerkCatalog) =>
  buildLegacyPerkCatalog({ get: reader(tables), build, previous });
const tree = (c: LegacyPerkCatalog, id: number) => c.trees.find((t) => t.id === id)!;
const node = (c: LegacyPerkCatalog, id: number) => c.trees.flatMap((t) => t.nodes).find((n) => n.id === id)!;

describe("the Legacy trees", () => {
  test("are the trees of trait system 45 that hold nodes, in id order; an empty one is listed, a class tree never appears", () => {
    const c = run();
    expect(c.traitSystemId).toBe(45);
    expect(c.trees.map((t) => [t.id, t.nodes.map((n) => n.id)])).toEqual([[700, [1, 2, 3, 4]], [701, [5, 6]]]);
    expect(c.emptyTreeIds).toEqual([702]);
    expect(JSON.stringify(c)).not.toContain("Class Talent");
  });

  test("a node keeps its stable id, stored position and flags, and its entries in buy order", () => {
    const c = run();
    expect(node(c, 1)).toEqual({
      id: 1, x: 2400, y: 1000, kind: "single", flags: 8,
      ranks: { value: 5, confidence: "stored", from: "TraitNodeEntry.MaxRanks" },
      entries: [{ id: 11, definitionId: 111, spellId: 2001, name: "Alpha Perk", maxRanks: 5 }],
      prereqs: [],
    });
    expect(node(c, 2).entries.map((e) => e.id)).toEqual([21, 22, 23]);
  });

  test("ranks follow the node type: a tiered node sums its entries, a choice node takes the largest", () => {
    const c = run();
    expect([node(c, 2).kind, node(c, 2).ranks.value]).toEqual(["tiered", 3]);
    expect([node(c, 5).kind, node(c, 5).ranks.value]).toEqual(["choice", 3]);
  });

  test("a name is the definition's override, else the shown spell's, else null when the files hold none", () => {
    const c = run();
    expect(node(c, 3).entries[0]).toMatchObject({ spellId: 2003, name: "Shown Name" });
    expect(node(c, 5).entries[1]).toMatchObject({ spellId: 2005, name: "Override Name" });
    expect(node(c, 6).entries[0]).toMatchObject({ spellId: 2006, name: null });
  });

  test("a node type WoWDBDefs does not name has no kind and unknown ranks, never a guessed one", () => {
    const c = run(edit((t) => { t.TraitNode!.find((r) => r.ID === 6)!.Type = 7; }));
    expect(node(c, 6)).toMatchObject({ kind: null, ranks: { value: null, confidence: "unknown" } });
    expect(c.warnings.join("\n")).toMatch(/node 6 .*type 7/);
  });
});

describe("prerequisites", () => {
  test("a sufficient edge is an 'any' prerequisite and a required edge an 'all' one, both stored readings", () => {
    const c = run();
    expect(node(c, 2).prereqs).toEqual([{ nodeId: 1, rule: "any", confidence: "stored" }]);
    expect(node(c, 3).prereqs).toEqual([{ nodeId: 2, rule: "all", confidence: "stored" }]);
  });

  test("a visual edge is no prerequisite; a deprecated edge type and an edge out of the Legacy trees are left out with a warning", () => {
    const c = run();
    expect(node(c, 4).prereqs).toEqual([]);
    expect(c.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/1 edge left out: .*type 5/),
      expect.stringMatching(/1 edge left out: .*outside the Legacy trees/),
    ]));
  });
});

describe("cost and cap", () => {
  test("a tree's cost is its TraitCost amount and currency, an inferred reading", () => {
    const c = run();
    expect(tree(c, 700).cost).toEqual({ value: 1, confidence: "inferred", from: "TraitTreeXTraitCost, TraitCost.Amount", traitCostId: 600, currencyId: 5000 });
    expect(tree(c, 701).cost.value).toBe(2);
  });

  test("a cost override on a node, group or entry makes the tree's cost unknown instead of applying the tree cost", () => {
    for (const [table, row] of [
      ["TraitNodeXTraitCost", { ID: 1, TraitNodeID: 6, TraitCostID: 600 }],
      ["TraitNodeGroupXTraitCost", { ID: 1, TraitNodeGroupID: 810, TraitCostID: 600 }],
      ["TraitNodeEntryXTraitCost", { ID: 1, TraitNodeEntryID: 52, TraitCostID: 600 }],
    ] as const) {
      const c = run(edit((t) => { t[table] = [row]; }));
      expect(tree(c, 701).cost, table).toMatchObject({ value: null, confidence: "unknown", traitCostId: 601 });
      expect(tree(c, 700).cost.value, table).toBe(1);
      expect(c.warnings.join("\n"), table).toMatch(new RegExp(`${table} .*tree 701`));
    }
  });

  test("a tree with no cost row, or two, has an unknown cost", () => {
    const none = run(edit((t) => drop(t, "TraitTreeXTraitCost", (r) => r.TraitTreeID !== 701)));
    expect(tree(none, 701).cost).toMatchObject({ value: null, confidence: "unknown", traitCostId: null });
    const two = run(edit((t) => { t.TraitTreeXTraitCost!.push({ ID: 4, TraitTreeID: 701, TraitCostID: 600 }); }));
    expect(tree(two, 701).cost).toMatchObject({ value: null, confidence: "unknown" });
  });

  test("the cap is the currency's SourcedMax, an inferred reading; a SourcedMax of 0 or no currency row gives no cap at all", () => {
    expect(run().currencies).toEqual([{ id: 5000, cap: { value: 16, confidence: "inferred", from: "TraitCurrency.SourcedMax" } }]);
    const zero = run(edit((t) => { t.TraitCurrency!.find((r) => r.ID === 5000)!.SourcedMax = 0; }));
    expect(zero.currencies[0].cap).toMatchObject({ value: null, confidence: "unknown" });
    const missing = run(edit((t) => drop(t, "TraitCurrency", (r) => r.ID !== 5000)));
    expect(missing.currencies[0].cap).toMatchObject({ value: null, confidence: "unknown" });
  });

  test("a tree that lists two currencies gets neither, rather than the first one picked", () => {
    const c = run(edit((t) => { t.TraitTreeXTraitCurrency!.push({ ID: 4, Index: 1, TraitTreeID: 701, TraitCurrencyID: 5001 }); }));
    expect(tree(c, 701).currencyId).toBeNull();
    expect(tree(c, 700).currencyId).toBe(5000);
    expect(c.warnings.join("\n")).toMatch(/tree 701 lists 2 currencies \(5000, 5001\)/);
  });

  test("cost, cap and where a gate counts are never stored readings, so nothing here can be enforced as confirmed", () => {
    const c = run();
    const readings = [...c.currencies.map((x) => x.cap), ...c.trees.map((t) => t.cost), ...c.trees.flatMap((t) => t.gates)];
    expect(readings.length).toBeGreaterThan(0);
    for (const r of readings) expect(r.confidence).not.toBe("stored");
  });
});

describe("spend gates", () => {
  test("keep their stored amount, currency and guarded nodes; where the points count is inferred from the group the condition names", () => {
    expect(tree(run(), 700).gates).toEqual([
      { condId: 71, amount: 5, currencyId: 5000, guardedGroupId: 801, guards: [2], countedGroupId: 800, counted: [1, 2, 3], confidence: "inferred", from: "TraitCond.TraitNodeGroupID" },
      { condId: 72, amount: 10, currencyId: 5000, guardedGroupId: 802, guards: [3], countedGroupId: 800, counted: [1, 2, 3], confidence: "inferred", from: "TraitCond.TraitNodeGroupID" },
    ]);
  });

  test("a gate whose condition names no group counts somewhere unknown, with no group filled in", () => {
    expect(tree(run(), 701).gates).toEqual([
      { condId: 73, amount: 3, currencyId: 5000, guardedGroupId: 810, guards: [6], countedGroupId: null, counted: [], confidence: "unknown", from: "TraitCond.TraitNodeGroupID is 0" },
    ]);
  });

  test("a condition on a Legacy group or node that is not a plain spend gate is reported, not dropped or read as one", () => {
    const c = run(edit((t) => {
      t.TraitCond!.push(cond(74, 701, { SpentAmountRequired: 2, RequiredLevel: 20 }), cond(76, 700, { CondType: 1 }));
      t.TraitNodeGroupXTraitCond!.push({ ID: 5, TraitCondID: 74, TraitNodeGroupID: 810 });
      t.TraitNodeXTraitCond!.push({ ID: 2, TraitCondID: 76, TraitNodeID: 1 });
    }));
    expect(tree(c, 701).gates.map((g) => g.condId)).toEqual([73]);
    expect(c.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/condition 74 .*not modelled/), expect.stringMatching(/condition 76 .*not modelled/)]));
  });
});

describe("what the files leave open", () => {
  test("nodes whose flags differ and nodes that share one spell are reported, and nothing is decided from either", () => {
    const c = run();
    expect(c.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/TraitNode\.Flags .*8 on 4 nodes, 10 on 2 \(4, 5\)/),
      expect.stringMatching(/nodes 4, 5 carry the same spell \(2009\)/),
    ]));
    expect([node(c, 4).flags, node(c, 4).entries[0].name]).toEqual([10, "Unknown"]);
  });

  test("the schema refuses a value on an unknown reading and an unknown value on a known one, so no default can slip in", () => {
    const c = run();
    const mutate = (change: (x: LegacyPerkCatalog) => void) => { const x = structuredClone(c); change(x); return LegacyPerkCatalog.safeParse(x).success; };
    expect(mutate(() => {})).toBe(true);
    expect(mutate((x) => { x.currencies[0].cap.confidence = "unknown"; })).toBe(false);
    expect(mutate((x) => { x.trees[0].cost.value = null; })).toBe(false);
    expect(mutate((x) => { x.trees[0].nodes[0].ranks.confidence = "unknown"; })).toBe(false);
    expect(mutate((x) => { x.trees[1].gates[0].confidence = "inferred"; })).toBe(false);
  });
});

describe("provenance", () => {
  test("the catalog carries its label, credit, build and every table it read with the client-digests row count and hash", () => {
    const tables = rows();
    const c = run(tables);
    expect(c).toMatchObject({ schema: LEGACY_PERKS_SCHEMA, label: "found in game files, unconfirmed", credit: GAME_DATA_CREDIT, build: stamp(70634) });
    expect(c.tables.map((t) => t.table)).toEqual(Object.keys(tables).sort());
    expect(c.tables.find((t) => t.table === "TraitNode")).toEqual({ table: "TraitNode", rows: 7, hash: tableHash(toRows(tables.TraitNode)) });
  });

  test("a missing table refuses the build rather than turning into missing perks", () => {
    for (const table of ["TraitNode", "TraitCond", "TraitCurrency", "TraitNodeEntryXTraitCost"]) {
      expect(() => run(edit((t) => { t[table] = undefined; })), table).toThrow(new RegExp(`${table} is not in this snapshot`));
    }
    expect(() => run(edit((t) => { t.TraitNode = []; }))).toThrow(/TraitNode has no rows/);
  });

  test("a build with no Legacy trees refuses rather than withdrawing every perk", () => {
    const empty = edit((t) => drop(t, "TraitNode", (r) => r.TraitTreeID === 900));
    expect(() => run(empty, stamp(70700), run())).toThrow(/no Legacy trees/);
  });
});

describe("withdrawal", () => {
  /** Build 70700 has lost node 3, the third entry of node 2 and the whole of tree 701. */
  const later = () => edit((t) => {
    drop(t, "TraitNode", (r) => r.ID !== 3 && r.TraitTreeID !== 701);
    drop(t, "TraitNodeXTraitNodeEntry", (r) => r.TraitNodeEntryID !== 23);
    drop(t, "TraitTree", (r) => r.ID !== 701);
  });

  test("a tree, node or entry the previous catalog listed and this build lacks stays listed as withdrawn, with its last name and builds", () => {
    const c = run(later(), stamp(70700), run());
    expect(c.trees.map((t) => [t.id, t.nodes.map((n) => n.id)])).toEqual([[700, [1, 2, 4]]]);
    const seen = { lastSeen: "1.60.1.70634", withdrawnIn: "1.60.1.70700" };
    expect(c.withdrawn).toEqual([
      { kind: "tree", id: 701, treeId: 701, name: null, ...seen },
      { kind: "node", id: 3, treeId: 700, name: "Shown Name", ...seen },
      { kind: "node", id: 5, treeId: 701, name: "Unknown", ...seen },
      { kind: "node", id: 6, treeId: 701, name: null, ...seen },
      { kind: "entry", id: 23, treeId: 700, nodeId: 2, name: "Tiered Perk", ...seen },
      { kind: "entry", id: 31, treeId: 700, nodeId: 3, name: "Shown Name", ...seen },
      { kind: "entry", id: 51, treeId: 701, nodeId: 5, name: "Unknown", ...seen },
      { kind: "entry", id: 52, treeId: 701, nodeId: 5, name: "Override Name", ...seen },
      { kind: "entry", id: 61, treeId: 701, nodeId: 6, name: null, ...seen },
    ]);
  });

  test("a withdrawn id stays withdrawn through later builds, and one that comes back leaves the list", () => {
    const withdrawn = run(later(), stamp(70700), run());
    const back = edit((t) => {
      drop(t, "TraitNode", (r) => r.TraitTreeID !== 701);
      drop(t, "TraitNodeXTraitNodeEntry", (r) => r.TraitNodeEntryID !== 23);
      drop(t, "TraitTree", (r) => r.ID !== 701);
    });
    const c = run(back, stamp(70800), withdrawn);
    expect(c.withdrawn.map((w) => `${w.kind} ${w.id}`)).toEqual(["tree 701", "node 5", "node 6", "entry 23", "entry 51", "entry 52", "entry 61"]);
    expect(c.withdrawn.every((w) => w.withdrawnIn === "1.60.1.70700")).toBe(true);
    expect(node(c, 3).id).toBe(3);
  });

  test("the same build twice withdraws nothing, and a previous catalog from a newer build is refused", () => {
    expect(run(rows(), stamp(70634), run()).withdrawn).toEqual([]);
    expect(() => run(rows(), stamp(70600), run())).toThrow(/newer/);
  });
});

describe("determinism", () => {
  test("the same rows give the same bytes, whatever order the tables list them in", () => {
    const shuffled = Object.fromEntries(Object.entries(rows()).map(([k, v]) => [k, [...v].reverse()]));
    expect(serializeLegacyPerkCatalog(run(shuffled))).toBe(serializeLegacyPerkCatalog(run()));
    const text = serializeLegacyPerkCatalog(run());
    expect(serializeLegacyPerkCatalog(LegacyPerkCatalog.parse(JSON.parse(text)))).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
  });

  test("the writer reads a snapshot file and writes the builder's bytes, the same on a second run over its own output", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-perks-"));
    try {
      const snapshot = join(dir, "wowf-70634-cccccccc.sqlite");
      const meta = { ...stamp(70634), library: "test", definitions: "abc1234" };
      const tables = rows();
      writeClientSnapshot(snapshot, meta, Object.entries(tables).map(([table, list]) => ({ table, fileDataID: 1, cKey: null, encryptedBlocks: 0, rows: toRows(list) })));
      const out = join(dir, "legacy-perks.json");
      writeLegacyPerkCatalog(snapshot, out);
      const first = readFileSync(out, "utf8");
      expect(first).toBe(serializeLegacyPerkCatalog(run(tables)));
      writeLegacyPerkCatalog(snapshot, out);
      expect(readFileSync(out, "utf8")).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the committed catalog", () => {
  const dataDir = join(import.meta.dirname, "..", "..", "web", "src", "data", "game-data");
  /** Git may check the file out with CRLF line ends; the generator writes LF. */
  const text = () => readFileSync(join(dataDir, "legacy-perks.json"), "utf8").split("\r\n").join("\n");
  const read = () => LegacyPerkCatalog.parse(JSON.parse(text()));

  test("is exactly what the generator writes for it, so it was not edited by hand", () => {
    const committed = read();
    expect(serializeLegacyPerkCatalog(committed)).toBe(text());
    expect(committed).toMatchObject({ schema: LEGACY_PERKS_SCHEMA, label: "found in game files, unconfirmed", credit: GAME_DATA_CREDIT, traitSystemId: 45 });
  });

  test("names only nodes of its own tree in prerequisites and gates", () => {
    for (const t of read().trees) {
      const ids = new Set(t.nodes.map((n) => n.id));
      for (const n of t.nodes) for (const p of n.prereqs) expect(ids.has(p.nodeId), `${t.id}: ${n.id} <- ${p.nodeId}`).toBe(true);
      for (const g of t.gates) for (const id of [...g.guards, ...g.counted]) expect(ids.has(id), `${t.id}: gate ${g.condId}`).toBe(true);
    }
  });

  test("holds no tooltip text, descriptions or icons, which stay out of git", () => {
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
    };
    walk(read());
    for (const k of keys) expect(k, k).not.toMatch(/description|icon|tooltip|requirement|_lang$/i);
  });

  test("read the same rows the committed client digests record, when both come from one build", () => {
    const committed = read();
    const digests = ClientDigests.parse(JSON.parse(readFileSync(join(dataDir, "client-digests.json"), "utf8")));
    expect(committed.build.buildId).toBeLessThanOrEqual(digests.build.buildId);
    if (digests.build.buildConfig !== committed.build.buildConfig) return;
    for (const t of committed.tables) expect(digests.tables[t.table], t.table).toEqual({ rows: t.rows, hash: t.hash });
  });
});
