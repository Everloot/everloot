import { describe, expect, it } from "vitest";
import { GEAR_SCORE_DIVISOR, gearNumbers, SLOT_BUDGET, type ItemFileFacts } from "../src/gear-score";

// Inventory types (Enum.InventoryType): 1 head, 2 neck, 3 shoulder, 5 chest, 6 waist, 7 legs, 8 feet, 9 wrist,
// 10 hands, 11 finger, 12 trinket, 13 one-hand, 14 shield, 15 bow, 16 back, 17 two-hand, 4 shirt, 19 tabard.
const KIT: [string, number][] = [
  ["HeadSlot", 1], ["NeckSlot", 2], ["ShoulderSlot", 3], ["BackSlot", 16], ["ChestSlot", 5], ["WristSlot", 9],
  ["HandsSlot", 10], ["WaistSlot", 6], ["LegsSlot", 7], ["FeetSlot", 8], ["Finger0Slot", 11], ["Finger1Slot", 11],
  ["Trinket0Slot", 12], ["Trinket1Slot", 12], ["MainHandSlot", 13], ["SecondaryHandSlot", 14], ["RangedSlot", 15],
];

/** One item per slot, ids 1000 + slot index, every item at `level` in the files. */
function kit(level: number, over: Partial<Record<string, { inv?: number; level?: number }>> = {}) {
  const files = new Map<number, ItemFileFacts>();
  const equipped = KIT.map(([slot, inv], i) => {
    const id = 1000 + i;
    files.set(id, { inventoryType: over[slot]?.inv ?? inv, level: over[slot]?.level ?? level });
    return { slot, itemId: id, itemLevel: over[slot]?.level ?? level };
  });
  return { equipped, facts: (id: number) => files.get(id) };
}

describe("gear score v1", () => {
  it("weights are the game file's level 60 epic budgets and sum to the divisor", () => {
    expect(Object.values(SLOT_BUDGET).reduce((a, b) => a + b, 0)).toBe(GEAR_SCORE_DIVISOR);
    expect(GEAR_SCORE_DIVISOR).toBe(512);
  });

  it("a full kit at one item level scores that item level on both numbers", () => {
    const { equipped, facts } = kit(60);
    expect(gearNumbers(equipped, facts)).toEqual({ ok: true, itemLevel: 60, gearScore: 60, items: 17 });
  });

  it("an empty slot counts as 0 on both numbers, so one good item cannot carry a character", () => {
    const { equipped, facts } = kit(60);
    const r = gearNumbers(equipped.filter((e) => e.slot === "HeadSlot"), facts);
    expect(r).toEqual({ ok: true, itemLevel: Math.floor(60 / 17), gearScore: Math.floor((44 * 60) / 512), items: 1 });
  });

  it("weighs slots by their budget: a better head moves the score more than a better ring", () => {
    const head = kit(50, { HeadSlot: { level: 70 } });
    const ring = kit(50, { Finger0Slot: { level: 70 } });
    const h = gearNumbers(head.equipped, head.facts), r = gearNumbers(ring.equipped, ring.facts);
    if (!h.ok || !r.ok) throw new Error("refused");
    expect(h.itemLevel).toBe(r.itemLevel);
    expect(h.gearScore).toBeGreaterThan(r.gearScore);
  });

  it("a two-hander fills both hands, so it scores as a main hand and an off hand of its level", () => {
    const { equipped, facts } = kit(60, { MainHandSlot: { inv: 17 } });
    const r = gearNumbers(equipped.filter((e) => e.slot !== "SecondaryHandSlot"), facts);
    expect(r).toEqual({ ok: true, itemLevel: 60, gearScore: 60, items: 16 });
  });

  it("shirt and tabard are never counted", () => {
    const { equipped, facts } = kit(60);
    const files = (id: number) => (id === 1 ? { inventoryType: 4, level: 1 } : id === 2 ? { inventoryType: 19, level: 1 } : facts(id));
    const r = gearNumbers([...equipped, { slot: "ShirtSlot", itemId: 1, itemLevel: 1 }, { slot: "TabardSlot", itemId: 2, itemLevel: 1 }], files);
    expect(r).toEqual({ ok: true, itemLevel: 60, gearScore: 60, items: 17 });
  });

  it("refuses an item the files do not know", () => {
    const { equipped, facts } = kit(60);
    expect(gearNumbers(equipped, (id) => (id === 1000 ? undefined : facts(id)))).toEqual({ ok: false, reason: "unknown_item" });
  });

  it("refuses an item in a slot its inventory type cannot go in", () => {
    const { equipped, facts } = kit(60, { HeadSlot: { inv: 7 } });
    expect(gearNumbers(equipped, facts)).toEqual({ ok: false, reason: "wrong_slot" });
  });

  it("refuses an upload whose item level differs from the files", () => {
    const { equipped, facts } = kit(60);
    expect(gearNumbers(equipped.map((e) => (e.slot === "HeadSlot" ? { ...e, itemLevel: 99 } : e)), facts)).toEqual({ ok: false, reason: "level_mismatch" });
  });

  it("refuses two items in one slot, and a two-hander beside an off hand", () => {
    const { equipped, facts } = kit(60);
    expect(gearNumbers([...equipped, equipped[0]!], facts)).toEqual({ ok: false, reason: "duplicate_slot" });
    const two = kit(60, { MainHandSlot: { inv: 17 } });
    expect(gearNumbers(two.equipped, two.facts)).toEqual({ ok: false, reason: "wrong_slot" });
  });

  it("an upload with nothing counted ranks nowhere", () => {
    expect(gearNumbers([], () => undefined)).toEqual({ ok: false, reason: "no_items" });
  });
});
