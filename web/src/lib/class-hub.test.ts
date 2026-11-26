import { expect, test } from "vitest";
import type { ClientClassGear } from "@kb/client-class-gear";
import type { ClientClassSpells } from "@kb/client-class-spells";
import type { ClientSpells } from "@kb/client-spells";
import type { Taxonomy } from "@kb/item-taxonomy";
import { classGear, classSpellLevels, guideRoles } from "./class-hub";
import type { Guide } from "./guides";

// Made-up tables in the files' shapes: the hub reads only what they hold (docs/DATA_POLICY.md).
const BUILD = { product: "wowf", buildId: 1, version: "1.0.0.1", buildConfig: "x", definitions: null, extractedAt: "2026-11-26T00:00:00.000Z" };
const GEAR = {
  schema: "everloot.client-class-gear/1", label: "Found in game files, unconfirmed", credit: "", build: BUILD,
  note: "proficiencies and class masks are the game files'; races are not told apart",
  classes: { mage: { id: 8, gear: [[2, 10, 0], [4, 1, 0], [2, 99, 0]] }, warrior: { id: 1, gear: [[4, 4, 40], [2, 1, 0], [4, 1, 0]] } },
  restricted: {},
} as unknown as ClientClassGear;
const TAXONOMY: Taxonomy = {
  classes: [{ id: 2, name: "Weapon", label: "Weapons", slug: "weapons", items: 1 }, { id: 4, name: "Armor", label: "Armor", slug: "armor", items: 1 }],
  subclasses: [
    { classId: 2, id: 1, name: "Two-Handed Axes", slug: "two-handed-axes", items: 1 },
    { classId: 2, id: 10, name: "Staves", slug: "staves", items: 1 },
    { classId: 4, id: 1, name: "Cloth", slug: "cloth", items: 1 },
    { classId: 4, id: 4, name: "Plate", slug: "plate", items: 1 },
  ],
  items: [],
};

test("a class's armor and weapon types are its proficiencies in the files, named by the item types, each linking its item list for the class", () => {
  const mage = classGear("mage", GEAR, TAXONOMY);
  expect(mage.armor).toEqual([{ name: "Cloth", level: 0, href: "/database/items/armor/cloth?class=mage" }]);
  // A type the taxonomy does not name keeps its number and no list link, never a made-up name.
  expect(mage.weapons).toEqual([
    { name: "Staves", level: 0, href: "/database/items/weapons/staves?class=mage" },
    { name: null, level: 0, href: null, subclass: 99 },
  ]);
  // In the taxonomy's order, with the level the files give a later proficiency.
  const warrior = classGear("warrior", GEAR, TAXONOMY);
  expect(warrior.armor.map((a) => [a.name, a.level])).toEqual([["Cloth", 0], ["Plate", 40]]);
  expect(classGear("druid", GEAR, TAXONOMY)).toEqual({ armor: [], weapons: [] });
});

test("a class's spells group by the level the files give, lowest first; the rest are counted, never placed", () => {
  const classSpells = { classes: { mage: { id: 8, spells: [1, 2, 3, 4, 5] } } } as unknown as ClientClassSpells;
  const spells = { spells: { 1: { level: 10 }, 2: { level: 1 }, 3: {}, 5: { level: 10 } } } as unknown as ClientSpells;
  expect(classSpellLevels("mage", classSpells, spells)).toEqual({ levels: [{ level: 1, spells: [2] }, { level: 10, spells: [1, 5] }], unleveled: 2 });
  expect(classSpellLevels("druid", classSpells, spells)).toEqual({ levels: [], unleveled: 0 });
});

test("the roles a hub names are its reviewed guides' own, once each, in the guide order of roles", () => {
  const guide = (roles: string[]) => ({ roles }) as unknown as Guide;
  expect(guideRoles([guide(["damage"]), guide(["tank", "damage"])])).toEqual(["tank", "damage"]);
  expect(guideRoles([])).toEqual([]);
});
