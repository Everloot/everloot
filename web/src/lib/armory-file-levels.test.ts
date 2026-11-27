import { expect, test } from "vitest";
import { gearNumbers } from "@kb/armory/gear";
import { armoryCharacter } from "./armory.fixture";
import { withFileLevels } from "./armory-file-levels";

// A row the crawler stored after Blizzard stopped sending item levels (2026-11-24/25): every item without one, and so
// no ranked item level and no Gear Score.
const noLevels = () => armoryCharacter({
  itemLevel: null, gearScore: null, equippedItemLevel: null, averageItemLevel: null,
  equipment: [
    { slot: "HEAD", itemId: 16846, name: "Giantstalker's Helmet", level: null, quality: "EPIC", inventoryType: "HEAD" },
    { slot: "MAIN_HAND", itemId: 17069, name: "Striker's Mark", level: null, quality: "RARE", inventoryType: "RANGEDRIGHT" },
    { slot: "CHEST", itemId: 99999, name: "Not In The Files", level: null, quality: "RARE", inventoryType: "CHEST" },
  ],
});
const files = new Map([[16846, 66], [17069, 69]]);

test("an item with no stored level takes the game files' level, and the numbers are computed as the crawler would from them", () => {
  const view = withFileLevels(noLevels(), (id) => files.get(id) ?? null);
  expect(view.character.equipment.map((i) => i.level)).toEqual([66, 69, null]);
  expect([...view.fromFiles]).toEqual(["HEAD", "MAIN_HAND"]);
  // The crawler's own formula over the same levels; the item the files do not know counts as an empty slot there too.
  const expected = gearNumbers([
    { slot: { type: "HEAD" }, item: { id: 16846 }, name: "", level: { value: 66 }, quality: { type: "EPIC" }, inventory_type: { type: "HEAD" } },
    { slot: { type: "MAIN_HAND" }, item: { id: 17069 }, name: "", level: { value: 69 }, quality: { type: "RARE" }, inventory_type: { type: "RANGEDRIGHT" } },
  ]);
  expect(expected.item_level).toBe(7);
  expect(view.character.itemLevel).toBe(expected.item_level);
  expect(view.character.gearScore).toBe(expected.gear_score);
  expect(view.computed).toEqual({ itemLevel: true, gearScore: expected.gear_score !== null });
  // Blizzard's own numbers are never computed.
  expect(view.character.averageItemLevel).toBeNull();
  expect(view.character.equippedItemLevel).toBeNull();
});

test("a stored level and a stored number always win; nothing found leaves the character as stored", () => {
  const stored = armoryCharacter();
  const kept = withFileLevels(stored, () => 1);
  expect(kept.character).toBe(stored);
  expect(kept.fromFiles.size).toBe(0);
  expect(kept.computed).toEqual({ itemLevel: false, gearScore: false });

  // One item kept by the crawler, one without: the slot takes the files' level, the stored numbers stay.
  const partly = armoryCharacter({ equipment: [{ ...armoryCharacter().equipment[0]! }, { ...armoryCharacter().equipment[1]!, level: null }] });
  const view = withFileLevels(partly, (id) => files.get(id) ?? null);
  expect(view.character.equipment.map((i) => i.level)).toEqual([66, 69]);
  expect([...view.fromFiles]).toEqual(["MAIN_HAND"]);
  expect([view.character.itemLevel, view.character.gearScore]).toEqual([57.41, 61.2]);
  expect(view.computed).toEqual({ itemLevel: false, gearScore: false });

  // The files know none of the items (or give 0): nothing is filled and nothing computed.
  const none = withFileLevels(noLevels(), (id) => (id === 16846 ? 0 : null));
  expect(none.character.itemLevel).toBeNull();
  expect(none.fromFiles.size).toBe(0);
});
