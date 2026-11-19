import { expect, test } from "vitest";
import type { ClientTerrain } from "@kb/client-terrain";
import { CLIENT_TERRAIN } from "@/data/game-data/client-terrain";
import { gearFor, instanceTerrain, speedGear, speedLabel, terrainGear, terrainSlug, terrainTypes, triggerLabel, zoneTerrain } from "./terrain";
import { publicZones } from "./zones";

// A small terrain file: Desert covers zone 11 whole, a town in zone 12, held-back zone 99 and instance 50; group 901
// is a zone list with no terrain word.
const data: ClientTerrain = {
  ...CLIENT_TERRAIN,
  areaGroups: {
    900: { name: "Desert", zones: [11, 99], parts: { 12: ["Oasis Town"], 99: ["Hidden Town"] }, instances: [50] },
    901: { name: null, zones: [12, 99], parts: {}, instances: [60] },
  },
  items: [
    [1, 1000, "equip", 900, "mount", 7],
    [2, 2000, "use", null, "run", 40],
    [3, 3000, "equip", 901, "run", 2],
    [4, 4000, "equip", 900, null, null],
    [5, 5000, "equip", null, "swim", 33],
  ],
  sets: [[70, 7000, 2, 901, "mount", 5, [8, 9]]],
};
const released = new Set([11, 12]);

test("terrain types: named groups only, by name, with held-back zones and their parts left out", () => {
  const [desert, ...rest] = terrainTypes(data, released);
  expect(rest).toEqual([]);
  expect(desert).toEqual({ groupId: 900, name: "Desert", slug: "desert", zones: [11], parts: new Map([[12, ["Oasis Town"]]]), instances: [50] });
  expect(terrainSlug("Cavernous or Underground")).toBe("cavernous-or-underground");
});

test("a zone's terrain says whether the type covers it whole or only some parts of it", () => {
  const types = terrainTypes(data, released);
  expect(zoneTerrain(11, types).map((t) => [t.type.name, t.parts])).toEqual([["Desert", null]]);
  expect(zoneTerrain(12, types).map((t) => [t.type.name, t.parts])).toEqual([["Desert", ["Oasis Town"]]]);
  expect(zoneTerrain(13, types)).toEqual([]);
  expect(instanceTerrain(50, types).map((t) => t.name)).toEqual(["Desert"]);
});

test("gear for a place: effects bound to a terrain or zone list that covers it; anywhere-gear is not tied to a place", () => {
  const gear = terrainGear(data, released);
  expect(gearFor({ zone: 11 }, gear).map((g) => g.itemId)).toEqual([1, 4]);
  expect(gearFor({ zone: 12 }, gear).map((g) => g.itemId)).toEqual([1, 3, 4, 8]);
  expect(gearFor({ zone: 99 }, gear)).toEqual([]);
  expect(gearFor({ instance: 60 }, gear).map((g) => g.itemId)).toEqual([3, 8]);
  expect(gear.find((g) => g.itemId === 3)?.places).toEqual({ zones: [12], instances: [60] });
});

test("speed gear: run, then mount, then swim, fastest first, with a plain label", () => {
  const gear = terrainGear(data, released);
  expect(speedGear(gear).map((g) => g.itemId)).toEqual([2, 3, 1, 8, 5]);
  const set = gear.find((g) => g.set)!;
  expect(set).toMatchObject({ itemId: 8, trigger: "set", set: { setId: 70, threshold: 2, pieces: [8, 9] }, places: { zones: [12], instances: [60] } });
  expect(triggerLabel(set)).toBe("Set bonus (2 pieces)");
  expect(triggerLabel({ trigger: "hit", set: null })).toBe("Chance on hit");
  expect(speedLabel({ kind: "mount", percent: 7 })).toBe("+7% mount speed");
  expect(speedLabel(null)).toBeNull();
});

test("the committed file names the terrain types on released zones, Desert among them", () => {
  const types = terrainTypes();
  const zones = new Set(publicZones().map((z) => z.mapId));
  expect(types.map((t) => t.name)).toContain("Desert");
  for (const t of types) for (const z of [...t.zones, ...t.parts.keys()]) expect(zones.has(z), `${t.name} ${z}`).toBe(true);
  expect(speedGear().length).toBeGreaterThan(0);
});
