import { expect, test } from "vitest";
import { itemSet, itemSetClasses, itemSetHref, ITEM_SETS } from "./item-sets";

test("every set the file lists has a page address by id", () => {
  expect(ITEM_SETS.length).toBeGreaterThan(500);
  expect(itemSetHref(1)).toBe("/database/item-sets/1");
  expect(itemSet(1)?.items).toContain(11729);
  expect(itemSet(999_999)).toBeUndefined();
});

test("a set is for the classes every piece's own class mask allows; none when a piece allows every class", () => {
  // Bit id - 1: 1 warrior, 2 paladin, 4 hunter.
  const restricted = { 10: 0b101, 11: 0b111, 12: 0b100 };
  expect(itemSetClasses([10, 11], restricted)).toEqual(["warrior", "hunter"]);
  expect(itemSetClasses([10, 12], restricted)).toEqual(["hunter"]);
  expect(itemSetClasses([10, 13], restricted)).toBeNull();
  expect(itemSetClasses([], restricted)).toBeNull();
});

test("the class sets in the files: the Gladiator and Tier 1 name no class; a PvP set names its class", () => {
  expect(itemSetClasses(itemSet(1)!.items)).toBeNull();
  // Vestments of Prophecy: the Tier 1 pieces carry no class mask in the files, so the page names no class.
  expect(itemSetClasses(itemSet(202)!.items)).toBeNull();
  // Champion's Raiment: every piece's mask is priest's.
  expect(itemSetClasses(itemSet(342)!.items)).toEqual(["priest"]);
});
