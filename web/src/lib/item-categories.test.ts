import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { categoryOf, slugify } from "@kb/item-taxonomy";
import { itemCategories, itemFacets as facetsCut } from "../../scripts/item-categories.mjs";
import { CLIENT_EDGES, CLIENT_LAYER, CLIENT_SKILLS, CLIENT_TAXONOMY } from "@kb/client-layer-file";
import { CLIENT_TAXONOMY as LIST_TAXONOMY, itemFacets } from "./items";
import { itemCategoryOf, itemTaxonomy } from "./item-categories";

const committed = (file: string) => readFileSync(join(__dirname, "..", "data", "game-data", file), "utf8").replace(/\r\n/g, "\n");

test("every item's category is the one the client layer gives, and an item it lacks has none", () => {
  for (const [id] of CLIENT_TAXONOMY.items) expect(itemCategoryOf(id), `item ${id}`).toEqual(categoryOf(CLIENT_TAXONOMY, id));
  for (const id of [0, 31, 999_999_999]) expect(itemCategoryOf(id)).toEqual(categoryOf(CLIENT_TAXONOMY, id));
  expect(itemCategoryOf(35)).toMatchObject({ class: { name: "Weapon" }, subclass: { name: "Staves" }, slot: { name: "Two-Hand" } });
});

test("the committed cut is the one the client layer makes now", () => {
  expect(committed("item-categories.json")).toBe(itemCategories(CLIENT_LAYER));
});

test("the taxonomy rebuilt from the cut is the client layer's, row for row and in order", () => {
  expect(itemTaxonomy()).toEqual(CLIENT_TAXONOMY);
  expect(LIST_TAXONOMY).toEqual(CLIENT_TAXONOMY);
  expect(LIST_TAXONOMY.items.length).toBeGreaterThan(30_000);
});

test("the item lists' game-file filters read the same sets the layer's relations give", () => {
  // How lib/items.ts computed them from the whole layer before item-facets.json.
  const skillOfSpell = new Map<number, number>();
  for (const e of CLIENT_EDGES) if (e.rel === "in_skill_line") skillOfSpell.set(e.fromId, e.toId);
  const crafted = new Set<number>(), reagent = new Set<number>(), set = new Set<number>();
  const bySkill = new Map<number, Set<number>>();
  for (const e of CLIENT_EDGES) {
    if (e.fromKind !== "item") continue;
    if (e.rel === "part_of_set") set.add(e.fromId);
    if (e.rel !== "created_by" && e.rel !== "reagent_for") continue;
    (e.rel === "created_by" ? crafted : reagent).add(e.fromId);
    const skill = skillOfSpell.get(e.toId);
    if (skill !== undefined) bySkill.set(skill, (bySkill.get(skill) ?? new Set()).add(e.fromId));
  }
  const professions = [...CLIENT_SKILLS].filter(([id]) => bySkill.has(id)).map(([id, name]) => ({ id, name, slug: slugify(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  expect(itemFacets()).toEqual({ crafted, reagent, set, bySkill, professions });
  expect(crafted.size).toBeGreaterThan(1000);
  expect(professions.length).toBeGreaterThan(5);
});

test("the committed facets cut is the one the client layer makes now", () => {
  expect(committed("item-facets.json")).toBe(facetsCut(CLIENT_LAYER));
});
