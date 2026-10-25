import { expect, test } from "vitest";
import type { ItemPage } from "../../../kb/src/item-page";
import { itemIndexable } from "./indexable";

// With storage out of reach only the name decides, so the page itself is never read.
const page = {} as ItemPage;

test("an item the game files or the wiki name is indexed, unless the name marks it as a development leftover", () => {
  expect(itemIndexable(page, true, { name: "Linen Cap", source: "files", color: null, wikiPage: null })).toBe(true);
  expect(itemIndexable(page, true, { name: "Test of Faith", source: "wiki", color: null, wikiPage: null })).toBe(true);
  expect(itemIndexable(page, true, { name: "Deprecated Cloth Cap", source: "files", color: null, wikiPage: null })).toBe(false);
  expect(itemIndexable(page, true, { name: "[PH] Redridge Rye", source: "files", color: null, wikiPage: null })).toBe(false);
  expect(itemIndexable(page, true, null)).toBe(false);
});
