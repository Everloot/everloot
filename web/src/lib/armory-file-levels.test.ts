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
  // The crawler's own formula over the same levels, where every slot is known (an empty slot counts 0)...
  const expected = gearNumbers([
    { slot: { type: "HEAD" }, item: { id: 16846 }, name: "", level: { value: 66 }, quality: { type: "EPIC" }, inventory_type: { type: "HEAD" } },
    { slot: { type: "MAIN_HAND" }, item: { id: 17069 }, name: "", level: { value: 69 }, quality: { type: "RARE" }, inventory_type: { type: "RANGEDRIGHT" } },
  ]);
  expect(expected.item_level).toBe(7);
  expect(withFileLevels({ ...noLevels(), equipment: noLevels().equipment.slice(0, 2) }, (id) => files.get(id) ?? null).character)
    .toMatchObject({ itemLevel: expected.item_level, gearScore: expected.gear_score });
  // ...but the chest the files do not know is left out, not counted 0: (66 + 69) / 16 known slots.
  expect(view.character.itemLevel).toBe(8);
  expect(view.computed).toEqual({ itemLevel: true, gearScore: true, slots: 16, withheld: false });
  // Blizzard's own numbers are never computed.
  expect(view.character.averageItemLevel).toBeNull();
  expect(view.character.equippedItemLevel).toBeNull();
});

test("a stored level and a stored number always win; nothing found leaves the character as stored", () => {
  const stored = armoryCharacter();
  const kept = withFileLevels(stored, () => 1);
  expect(kept.character).toBe(stored);
  expect(kept.fromFiles.size).toBe(0);
  expect(kept.computed).toMatchObject({ itemLevel: false, gearScore: false, withheld: false });

  // One item kept by the crawler, one without: the slot takes the files' level, the stored numbers stay.
  const partly = armoryCharacter({ equipment: [{ ...armoryCharacter().equipment[0]! }, { ...armoryCharacter().equipment[1]!, level: null }] });
  const view = withFileLevels(partly, (id) => files.get(id) ?? null);
  expect(view.character.equipment.map((i) => i.level)).toEqual([66, 69]);
  expect([...view.fromFiles]).toEqual(["MAIN_HAND"]);
  expect([view.character.itemLevel, view.character.gearScore]).toEqual([57.41, 61.2]);
  expect(view.computed).toMatchObject({ itemLevel: false, gearScore: false, withheld: false });

  // The files know none of the items (or give 0): nothing is filled and nothing computed.
  const none = withFileLevels(noLevels(), (id) => (id === 16846 ? 0 : null));
  expect(none.character.itemLevel).toBeNull();
  expect(none.fromFiles.size).toBe(0);
});

// A level 60 in a full set the game files mostly do not know (QA r6, a Dungeon Set 1 hunter): every ranked slot worn,
// only 3 with a level. Counting the other 14 as 0 gave a ranked item level of 3.
const SLOTS = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST", "HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2", "MAIN_HAND", "OFF_HAND", "RANGED"];
const fullKit = () => armoryCharacter({
  itemLevel: null, gearScore: null, equippedItemLevel: null, averageItemLevel: null,
  equipment: SLOTS.map((slot, i) => ({ slot, itemId: 1000 + i, name: slot, level: null, quality: "RARE", inventoryType: slot })),
});

test("numbers are withheld while fewer than 12 of the 17 slots have a known level, never counting unknown slots as 0", () => {
  const three = withFileLevels(fullKit(), (id) => (id < 1003 ? 60 : null));
  expect(three.fromFiles.size).toBe(3);
  expect([three.character.itemLevel, three.character.gearScore]).toEqual([null, null]);
  expect(three.computed).toEqual({ itemLevel: false, gearScore: false, slots: 3, withheld: true });
  // Nothing known at all, and nothing from the files: still withheld, and said so.
  expect(withFileLevels(fullKit(), () => null).computed).toEqual({ itemLevel: false, gearScore: false, slots: 0, withheld: true });
});

test("with 12 or more known slots the numbers average the known slots only", () => {
  // 15 slots at level 60 from the files, 2 unknown: 60, not 60 * 15 / 17 = 52.
  const view = withFileLevels(fullKit(), (id) => (id < 1015 ? 60 : null));
  expect([view.character.itemLevel, view.character.gearScore]).toEqual([60, 60]);
  expect(view.computed).toEqual({ itemLevel: true, gearScore: true, slots: 15, withheld: false });
});
