import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TALENT_CLASSES as PROTOCOL_TALENT_CLASSES } from "@everloot/protocol";
import { describe, expect, test } from "vitest";
import { CURRENT_VERSION } from "../game-version";
import { CatalogError, normalizeCatalog } from "./adapter";
import { TALENT_CLASSES, isTalentClass, loadCatalog } from "./catalogs";
import { add, isLegal, pointsAtLevel, pointsSpent, remove } from "./rules";
import { decodeBuild, encodeBuild, resolveBuild } from "./share";
import type { Ranks } from "./types";

const dataDir = fileURLToPath(new URL("../../data/game-data/talents/", import.meta.url));
// The build the committed game-data layers come from; a build bump regenerates the data, not these tests.
const BUILD = CURRENT_VERSION.build;

test("the protocol's class list is the site's, in the same order, so the MCP talent tools and the pages agree", () => {
  expect([...PROTOCOL_TALENT_CLASSES]).toEqual(TALENT_CLASSES);
});

test("only the class list's own names are classes, never a name every object inherits", () => {
  for (const slug of TALENT_CLASSES) expect(isTalentClass(slug), slug).toBe(true);
  for (const slug of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf", "Mage", ""]) {
    expect(isTalentClass(slug), slug).toBe(false);
  }
});

describe.each(TALENT_CLASSES)("%s game data", (slug) => {
  test("is a sound tree from the current game-data build", async () => {
    const c = await loadCatalog(slug);
    expect(c.classSlug).toBe(slug);
    expect(c.build).toBe(BUILD);
    expect(c.label).toBe("found in game files, unconfirmed");
    expect(c.trees).toHaveLength(3);
    expect(c.rules.status).toBe("unconfirmed");
    const ids = c.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const seen = new Set<string>();
    for (const n of c.nodes) {
      const pos = `${n.treeId}:${n.row}:${n.col}`;
      expect(seen.has(pos), pos).toBe(false);
      seen.add(pos);
      expect(n.maxRanks).toBeGreaterThanOrEqual(1);
      expect([0, 5, 10, 15, 20, 25, 30]).toContain(n.unlock?.pointsInTree ?? 0);
      for (const p of [...n.prereqs, ...(n.anyOf ?? [])]) {
        const need = c.nodes.find((x) => x.id === p)!;
        expect(need.treeId).toBe(n.treeId);
      }
    }
  });

  test("has 51 points, one per level from 10 to 60", async () => {
    const c = await loadCatalog(slug);
    expect(c.rules.pointLevels).toHaveLength(51);
    expect(pointsAtLevel(c, 9)).toBe(0);
    expect(pointsAtLevel(c, 10)).toBe(1);
    expect(pointsAtLevel(c, 60)).toBe(51);
  });

  test("a full legal build reaches 51 points, and every point can be given back", async () => {
    const c = await loadCatalog(slug);
    let ranks: Ranks = {};
    for (let pass = 0; pass < 60 && pointsSpent(ranks) < 51; pass++) {
      for (const n of c.nodes) ranks = add(c, ranks, n.id, 51);
    }
    expect(pointsSpent(ranks)).toBe(51);
    expect(isLegal(c, ranks)).toBe(true);
    const order = [...c.nodes].reverse();
    let guard = 0;
    while (pointsSpent(ranks) > 0 && guard++ < 200) {
      for (const n of order) ranks = remove(c, ranks, n.id);
      expect(isLegal(c, ranks)).toBe(true);
    }
    expect(pointsSpent(ranks)).toBe(0);
  });

  test("a build survives the share code and the tree it came from", async () => {
    const c = await loadCatalog(slug);
    let ranks: Ranks = {};
    for (const n of c.nodes) ranks = add(c, ranks, n.id, 30);
    const decoded = decodeBuild(encodeBuild({ classSlug: c.classSlug, specId: c.specId, build: c.build, ranks }));
    if (!decoded.ok) throw new Error("decode failed");
    const resolved = resolveBuild(c, decoded.build);
    expect(resolved).toEqual({ ok: true, build: { ranks, unknown: [], clamped: [], rejected: [], buildDiffers: false } });
  });
});

test("a share code with real mage node ids round trips through the catalog", async () => {
  const mage = await loadCatalog("mage");
  // Arcane Power (spell 12042) and the node it needs, by their trait node ids (unchanged since build 70450).
  const power = mage.nodes.find((n) => n.entries[0].spellId === 12042)!;
  expect(power.id).toBe(105798);
  expect(power.unlock).toMatchObject({ pointsInTree: 30 });
  const ranks: Ranks = { [power.id]: { rank: 1 } };
  const code = encodeBuild({ classSlug: "mage", specId: mage.specId, build: mage.build, ranks });
  expect(code).toBe(`EL1-mage-1482-${BUILD}-${btoa("105798:1").replace(/=+$/, "")}`);
  const decoded = decodeBuild(code);
  expect(decoded).toMatchObject({ ok: true, build: { classSlug: "mage", specId: 1482, build: BUILD, ranks } });
  if (!decoded.ok) throw new Error("decode failed");
  // Alone, the node cannot be placed: its row gate (30 points above) is not met. The report says why.
  const resolved = resolveBuild(mage, decoded.build);
  expect(resolved).toMatchObject({ ok: true, build: { unknown: [], ranks: {}, rejected: [{ id: 105798, name: "Arcane Power", rank: 1 }] } });
});

describe("licence boundary", () => {
  test("the game data folder holds no spell text, effect numbers or icon ids", () => {
    const files = readdirSync(dataDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(9);
    for (const f of files) {
      const text = readFileSync(dataDir + f, "utf8");
      for (const banned of ['"description"', '"auraDescription"', '"effects"', '"iconFileId"', '"iconFile"', '"durationMs"']) {
        expect(text.includes(banned), `${f} has ${banned}`).toBe(false);
      }
    }
  });

  test("the folder says whose data it is", () => {
    const readme = readFileSync(dataDir + "../README.md", "utf8");
    expect(readme).toMatch(/Blizzard's data/);
    expect(readme).toMatch(/not under Everloot's licence/);
  });
});

describe("adapter", () => {
  const entry = (name: string | null, maxRanks = 1) => ({ definitionId: 1, spellId: 2, name, maxRanks });
  const node = (id: number, extra: object = {}) => ({
    id, row: 0, col: 0, kind: "single", maxRanks: 1, entries: [entry("A")], prereqs: [], unlock: {}, ...extra,
  });
  const base = (nodes: object[]) => ({
    schema: "everloot.talent-catalog/2", label: "found in game files, unconfirmed", build: { version: "1.2.3" },
    classId: 8, className: "Mage", specId: null, pointLevels: [12, 10, 11],
    trees: [{ id: 5, name: null, order: 0, nodes }],
  });

  test("reads the catalog: 1-based positions, any and all prerequisites, gates, tiered entries, point levels", () => {
    const c = normalizeCatalog(base([
      node(1, { row: 0, col: 1 }),
      node(2, { row: 1, col: 1, kind: "tiered", maxRanks: 3, entries: [entry("T1"), entry("T2", 2)], prereqs: [{ nodeId: 1, rule: "all" }, { nodeId: 3, rule: "any" }], unlock: { spentRequired: { amount: 5, scope: "unconfirmed" }, ranksInNodes: [{ nodeId: 1, ranks: 1 }] } }),
      node(3, { row: 1, col: 2, entries: [entry(null)] }),
    ]));
    expect(c).toMatchObject({ classId: 8, classSlug: "mage", specId: 0, build: "1.2.3", label: "found in game files, unconfirmed" });
    expect(c.rules).toMatchObject({ pointLevels: [10, 11, 12], firstPointLevel: 10, maxLevel: 12, dualSpecLevel: 40, status: "unconfirmed" });
    expect(c.trees).toEqual([{ id: 5, name: "Tree 1" }]);
    expect(c.nodes.map((n) => [n.id, n.row, n.col])).toEqual([[1, 1, 2], [2, 2, 2], [3, 2, 3]]);
    expect(c.nodes[1]).toMatchObject({ kind: "tiered", maxRanks: 3, prereqs: [1], anyOf: [3], unlock: { pointsInTree: 5, scope: "unconfirmed", ranksInNodes: [{ nodeId: 1, ranks: 1 }] } });
    expect(c.nodes[1].entries.map((e) => e.name)).toEqual(["T1", "T2"]);
    expect(c.nodes[2].entries[0].name).toBe("Talent 2");
  });

  test("a class-wide gate counts points across the trees; the scope is kept and the page can say so", () => {
    const gated = (scope: string) => base([node(1), node(2, { row: 1, unlock: { spentRequired: { amount: 10, scope } } })]);
    const c = normalizeCatalog(gated("class"));
    expect(c.nodes[1].unlock).toEqual({ pointsTotal: 10, scope: "class" });
    expect(c.rules.gateScope).toBe("class");
    expect(normalizeCatalog(gated("tree")).rules.gateScope).toBe("tree");
    expect(normalizeCatalog(gated("unconfirmed")).nodes[1].unlock).toEqual({ pointsInTree: 10, scope: "unconfirmed" });
    expect(normalizeCatalog(gated("unconfirmed")).rules.gateScope).toBe("unconfirmed");
  });

  test("refuses a broken catalog", () => {
    expect(() => normalizeCatalog(base([node(1), node(1, { col: 1 })]))).toThrow(/repeated node id 1/);
    expect(() => normalizeCatalog(base([node(1, { prereqs: [{ nodeId: 99, rule: "all" }] })]))).toThrow(/not in the catalog/);
    expect(() => normalizeCatalog(base([node(1, { kind: "choice" })]))).toThrow(/fewer than two/);
    expect(() => normalizeCatalog({ ...base([node(1)]), pointLevels: [] })).toThrow(CatalogError);
    expect(() => normalizeCatalog({ ...base([node(1)]), schema: "other/2" })).toThrow(CatalogError);
    expect(() => normalizeCatalog({ nope: true })).toThrow(CatalogError);
  });
});
