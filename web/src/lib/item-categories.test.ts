import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { categoryOf } from "@kb/item-taxonomy";
import { itemCategories } from "../../scripts/item-categories.mjs";
import { CLIENT_LAYER, CLIENT_TAXONOMY } from "./items";
import { itemCategoryOf } from "./item-categories";

test("every item's category is the one the client layer gives, and an item it lacks has none", () => {
  for (const [id] of CLIENT_TAXONOMY.items) expect(itemCategoryOf(id), `item ${id}`).toEqual(categoryOf(CLIENT_TAXONOMY, id));
  for (const id of [0, 31, 999_999_999]) expect(itemCategoryOf(id)).toEqual(categoryOf(CLIENT_TAXONOMY, id));
  expect(itemCategoryOf(35)).toMatchObject({ class: { name: "Weapon" }, subclass: { name: "Staves" }, slot: { name: "Two-Hand" } });
});

test("the committed cut is the one the client layer makes now", () => {
  const committed = readFileSync(join(__dirname, "..", "data", "game-data", "item-categories.json"), "utf8").replace(/\r\n/g, "\n");
  expect(committed).toBe(itemCategories(CLIENT_LAYER));
});
