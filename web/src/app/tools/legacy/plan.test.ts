import { expect, test } from "vitest";
import { LEGACY_PERKS } from "@/data/game-data/legacy-perks";
import { createPlanner, decodePlan, encodePlan, type Purchase } from "./plan";

const planner = createPlanner(LEGACY_PERKS);
const buildId = LEGACY_PERKS.build.buildId;
const node = (id: number) => LEGACY_PERKS.trees.flatMap((tree) => tree.nodes).find((perk) => perk.id === id)!;
const firstRank = (id: number): Purchase => [id, node(id).entries[0]!.id];

test("keeps choices within stored ranks and prerequisites and protects dependent purchases", () => {
  const working = firstRank(110290);
  const bartering = firstRank(110286);
  const dedicated = firstRank(110284);
  expect(planner.replay([dedicated]).purchases).toEqual([]);
  expect(planner.replay([bartering, dedicated]).purchases).toEqual([bartering, dedicated]);
  expect(planner.remove([bartering, dedicated], 110286)).toBeNull();
  expect(planner.remove([bartering, dedicated], 110284)).toEqual([bartering]);
  expect(planner.replay(Array.from({ length: 6 }, () => working)).purchases).toHaveLength(5);
  expect(planner.replay([firstRank(113506), firstRank(113508)]).purchases).toEqual([]);
});

test("keeps gates and the shared cap advisory and counts each gate's named group", () => {
  const chef = firstRank(110289);
  const purchases = Array.from({ length: 5 }, () => [chef, firstRank(110290), firstRank(110296), firstRank(110318)]).flat();
  expect(planner.replay(purchases).purchases).toEqual(purchases);
  expect(planner.totals(purchases)).toEqual([{ currencyId: 4225, spent: 20, cap: 16 }]);
  const firstTree = LEGACY_PERKS.trees[0]!;
  const gate = firstTree.gates.find((g) => g.amount === 5)!;
  expect(planner.gatePoints(gate, [firstRank(110296)])).toBe(0);
  expect(planner.gatePoints(gate, [firstRank(110290)])).toBe(1);
  expect(planner.gatePoints({ ...gate, countedGroupId: null, counted: [], confidence: "unknown" }, purchases)).toBeNull();
});

test("rejects invalid codecs, round trips purchase order, and names withdrawn entries during replay", () => {
  const rested = firstRank(110301);
  const talented = node(110298);
  const ranks: Purchase[] = talented.entries.map((entry) => [talented.id, entry.id]);
  const purchases = [rested, ...ranks];
  const code = encodePlan(buildId, purchases);
  expect(decodePlan(code)).toEqual({ buildId, purchases });
  expect(decodePlan(code.replace(/^1\./, "2."))).toBeNull();
  expect(decodePlan(`${code}\n`)).toBeNull();
  expect(decodePlan(`${code}.123-00`)).toBeNull();
  expect(decodePlan(`${code}.123-`)).toBeNull();
  expect(decodePlan(`1.1.${"1-1.".repeat(1100)}1-1`)).toBeNull();
  expect(planner.replay([rested, ranks[1]!, ranks[0]!]).purchases).toEqual([rested, ranks[0]!]);

  const chosen = talented.entries.at(-1)!;
  const later = createPlanner({
    ...LEGACY_PERKS,
    trees: LEGACY_PERKS.trees.map((tree) => ({ ...tree, nodes: tree.nodes.map((perk) => perk.id === talented.id
      ? { ...perk, entries: perk.entries.slice(0, -1), ranks: { ...perk.ranks, value: 4 } } : perk) })),
    withdrawn: [{ kind: "entry", nodeId: talented.id, treeId: 1188, id: chosen.id, name: "Talented", lastSeen: "old", withdrawnIn: "new" }],
  });
  const replayed = later.replay(purchases);
  expect(replayed.purchases).toEqual(purchases.slice(0, -1));
  expect(replayed.skipped).toEqual([expect.stringContaining("Talented")]);
  expect(replayed.skipped[0]).toContain("new");
});
