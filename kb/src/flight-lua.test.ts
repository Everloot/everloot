import { expect, test } from "vitest";
import { flightLengths, flightLua } from "./flight-lua.js";

const rows = (list: Record<string, unknown>[]) => new Map(list.map((r) => [Number(r.ID), r]));
const nodes = rows([
  { ID: 2, Name_lang: "Coppercloud Quay, Glasswind", ContinentID: 0 },
  { ID: 4, Name_lang: " Amberwing Rest ", ContinentID: 0 },
  { ID: 6, Name_lang: "Generic, World target", ContinentID: 0 },
  { ID: 8, Name_lang: "Mistglass Landing", ContinentID: 1 },
  { ID: 9, Name_lang: "Far Isle", ContinentID: 530 },
]);
let point = 0;
const along = (pathId: number, locs: [number, number, number][], continents = locs.map(() => 0)) =>
  locs.map((loc, i) => ({ ID: ++point, PathID: pathId, NodeIndex: i, Loc: loc, ContinentID: continents[i] }));

test("each direction is measured through every point in three dimensions, in yards", () => {
  const paths = rows([
    { ID: 10, FromTaxiNode: 2, ToTaxiNode: 4 },
    { ID: 11, FromTaxiNode: 4, ToTaxiNode: 2 },
  ]);
  // Out of order on purpose: NodeIndex sets the order. 3-4-5 then a 12-yard climb.
  const points = rows([...along(10, [[0, 0, 0], [3, 4, 0], [3, 4, 12]]).reverse(), ...along(11, [[3, 4, 12], [0, 0, 12], [0, 0, 0]])]);
  const out = flightLengths(nodes, paths, points, new Set([0, 1]));
  expect(out.paths).toEqual([{ from: 2, to: 4, yards: 17 }, { from: 4, to: 2, yards: 17 }]);
  expect(out.nodes).toEqual([{ id: 2, name: "Coppercloud Quay, Glasswind" }, { id: 4, name: "Amberwing Rest" }]);
});

test("transports, other continents, cross-continent pairs and pointless paths are left out", () => {
  const paths = rows([
    { ID: 20, FromTaxiNode: 2, ToTaxiNode: 6 },
    { ID: 21, FromTaxiNode: 2, ToTaxiNode: 9 },
    { ID: 22, FromTaxiNode: 2, ToTaxiNode: 8 },
    { ID: 23, FromTaxiNode: 4, ToTaxiNode: 2 },
    { ID: 24, FromTaxiNode: 2, ToTaxiNode: 4 },
    { ID: 25, FromTaxiNode: 2, ToTaxiNode: 4 },
  ]);
  const points = rows([
    ...along(20, [[0, 0, 0], [5, 0, 0]]), ...along(21, [[0, 0, 0], [5, 0, 0]]), ...along(22, [[0, 0, 0], [5, 0, 0]]),
    ...along(23, [[0, 0, 0]]),
    // A hop across a continent change adds nothing; the first path of a direction wins.
    ...along(24, [[0, 0, 0], [10, 0, 0], [900, 0, 0], [905, 0, 0]], [0, 0, 1, 1]), ...along(25, [[0, 0, 0], [1, 0, 0]]),
  ]);
  const out = flightLengths(nodes, paths, points, new Set([0, 1]));
  expect(out.paths).toEqual([{ from: 2, to: 4, yards: 15 }]);
});

test("the Lua file names the build, keys each direction and escapes names", () => {
  const lua = flightLua("1.60.1.71037", { nodes: [{ id: 2, name: 'Quay "North"' }], paths: [{ from: 2, to: 4, yards: 5120 }] });
  expect(lua).toContain("build 1.60.1.71037");
  expect(lua).toContain('[2] = "Quay \\"North\\"",');
  expect(lua).toContain('["2-4"] = 5120,');
  expect(lua.startsWith("-- ")).toBe(true);
});
