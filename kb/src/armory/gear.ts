import { gearNumbers as score, type RankedSlot } from "../gear-score.js";

export interface EquipmentItem {
  slot: { type: string };
  item: { id: number };
  name: string;
  level: { value: number };
  quality: { type: string };
  inventory_type: { type: string };
}
const slots: Record<string, RankedSlot> = {
  HEAD: "HeadSlot",
  NECK: "NeckSlot",
  SHOULDER: "ShoulderSlot",
  CHEST: "ChestSlot",
  WAIST: "WaistSlot",
  LEGS: "LegsSlot",
  FEET: "FeetSlot",
  WRIST: "WristSlot",
  HANDS: "HandsSlot",
  FINGER_1: "Finger0Slot",
  FINGER_2: "Finger1Slot",
  TRINKET_1: "Trinket0Slot",
  TRINKET_2: "Trinket1Slot",
  BACK: "BackSlot",
  MAIN_HAND: "MainHandSlot",
  OFF_HAND: "SecondaryHandSlot",
  RANGED: "RangedSlot",
};
const inventory: Record<string, number> = {
  HEAD: 1,
  NECK: 2,
  SHOULDER: 3,
  BODY: 4,
  CHEST: 5,
  WAIST: 6,
  LEGS: 7,
  FEET: 8,
  WRIST: 9,
  HANDS: 10,
  FINGER: 11,
  TRINKET: 12,
  WEAPON: 13,
  SHIELD: 14,
  RANGED: 15,
  CLOAK: 16,
  TWOHWEAPON: 17,
  TABARD: 19,
  ROBE: 20,
  WEAPONMAINHAND: 21,
  WEAPONOFFHAND: 22,
  HOLDABLE: 23,
  THROWN: 25,
  RANGEDRIGHT: 26,
  RELIC: 28,
};
export function gearNumbers(equipped: EquipmentItem[]): {
  item_level: number | null;
  gear_score: number | null;
} {
  const facts = new Map(
    equipped.map((e) => [
      e.item.id,
      {
        level: e.level.value,
        inventoryType: inventory[e.inventory_type.type] ?? -1,
      },
    ]),
  );
  const result = score(
    equipped.map((e) => ({
      slot: slots[e.slot.type] ?? e.slot.type,
      itemId: e.item.id,
      itemLevel: e.level.value,
    })),
    (id) => facts.get(id),
  );
  const levels = new Map(
    equipped
      .filter((e) => slots[e.slot.type])
      .map((e) => [e.slot.type, e.level.value]),
  );
  if (
    equipped.some(
      (e) =>
        e.slot.type === "MAIN_HAND" && e.inventory_type.type === "TWOHWEAPON",
    )
  )
    levels.set("OFF_HAND", levels.get("MAIN_HAND")!);
  return {
    item_level: levels.size
      ? Math.floor([...levels.values()].reduce((a, b) => a + b, 0) / 17)
      : null,
    gear_score: result.ok ? result.gearScore : null,
  };
}
