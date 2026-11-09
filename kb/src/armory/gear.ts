import { gearNumbers as score, type RankedSlot } from "../gear-score.js";

export interface EquipmentItem {
  slot: { type: string };
  item: { id: number };
  name: string;
  level: { value: number };
  quality: { type: string };
  inventory_type: { type: string };
}
const slots: Record<string, RankedSlot | null> = {
  SHIRT: null,
  TABARD: null,
  AMMO: null,
  HEAD: "HeadSlot",
  NECK: "NeckSlot",
  SHOULDER: "ShoulderSlot",
  CHEST: "ChestSlot",
  WAIST: "WaistSlot",
  LEGS: "LegsSlot",
  FEET: "FeetSlot",
  WRIST: "WristSlot",
  HAND: "HandsSlot",
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
// The API's slot is authoritative, even for e.g. RELIC in RANGED.
// These representative inventory types let the shared scorer apply its slot budgets.
const slotInventory: Record<RankedSlot, number> = {
  HeadSlot: 1,
  NeckSlot: 2,
  ShoulderSlot: 3,
  ChestSlot: 5,
  WaistSlot: 6,
  LegsSlot: 7,
  FeetSlot: 8,
  WristSlot: 9,
  HandsSlot: 10,
  Finger0Slot: 11,
  Finger1Slot: 11,
  Trinket0Slot: 12,
  Trinket1Slot: 12,
  BackSlot: 16,
  MainHandSlot: 21,
  SecondaryHandSlot: 22,
  RangedSlot: 28,
};
export function gearNumbers(equipped: EquipmentItem[]): {
  item_level: number | null;
  gear_score: number | null;
} {
  const result = score(
    equipped.map((e, index) => ({
      slot: slots[e.slot.type] ?? e.slot.type,
      itemId: index,
      itemLevel: e.level.value,
    })),
    (index) => {
      const e = equipped[index],
        slot = slots[e.slot.type];
      return slot
        ? {
            level: e.level.value,
            inventoryType:
              e.slot.type === "MAIN_HAND" &&
              e.inventory_type.type === "TWOHWEAPON"
                ? 17
                : slotInventory[slot],
          }
        : undefined;
    },
  );
  const levels = new Map(
    equipped
      .filter((e) => slots[e.slot.type])
      .map((e) => [slots[e.slot.type]!, e.level.value]),
  );
  if (
    equipped.some(
      (e) =>
        e.slot.type === "MAIN_HAND" && e.inventory_type.type === "TWOHWEAPON",
    )
  )
    levels.set("SecondaryHandSlot", levels.get("MainHandSlot")!);
  return {
    item_level: levels.size
      ? Math.floor([...levels.values()].reduce((a, b) => a + b, 0) / 17)
      : null,
    gear_score: result.ok ? result.gearScore : null,
  };
}
