/**
 * The two numbers the gear rankings rank (rankings design 2026-10-20 section 6.2, approved 2026-10-21): item level and
 * Everloot Gear Score v1. Pure. Both are averages over the same 17 slots (shirt and tabard are left out), an empty
 * slot counting 0, so wearing one good item and nothing else ranks low. A two-hander fills both hands. Every item
 * level counted is the game files' level for that item: an upload whose level for an item differs from the files is
 * refused whole, as is an item the files do not know or one in a slot it cannot go in. Nothing here is estimated.
 *
 * Gear Score v1 weighs each slot by the game's own stat budget for it (`RandPropPoints`, read from the Forever client
 * files, build GEAR_WEIGHTS_BUILD, found in game files, unconfirmed): row 60, the Epic column, one number per slot
 * group. Which slot belongs to which group is the long-documented classic mapping, not something the files state.
 * Changing a weight is a new version; a shown score always carries GEAR_SCORE_VERSION.
 */

export const GEAR_SCORE_VERSION = "gear_score_v1";
/** The client build the budgets were read from. */
export const GEAR_WEIGHTS_BUILD = "1.60.1.70790";

/** RandPropPoints row 60, Epic: the stat budget of each slot group at item level 60. */
export const GROUP_BUDGET = {
  /** Head, chest, legs (and two-handers, which fill both hands here). */
  major: 44,
  /** Shoulders, hands, waist, feet, trinkets. */
  minor: 33,
  /** Neck, back, wrists, rings, off hand. */
  small: 25,
  /** Main-hand weapon. */
  weapon: 18,
  /** Ranged, thrown, wand or relic. */
  ranged: 14,
} as const;

/** The 17 slots counted, by the addon's slot names, with the budget each one weighs. */
export const SLOT_BUDGET = {
  HeadSlot: GROUP_BUDGET.major, ChestSlot: GROUP_BUDGET.major, LegsSlot: GROUP_BUDGET.major,
  ShoulderSlot: GROUP_BUDGET.minor, HandsSlot: GROUP_BUDGET.minor, WaistSlot: GROUP_BUDGET.minor, FeetSlot: GROUP_BUDGET.minor,
  Trinket0Slot: GROUP_BUDGET.minor, Trinket1Slot: GROUP_BUDGET.minor,
  NeckSlot: GROUP_BUDGET.small, BackSlot: GROUP_BUDGET.small, WristSlot: GROUP_BUDGET.small,
  Finger0Slot: GROUP_BUDGET.small, Finger1Slot: GROUP_BUDGET.small, SecondaryHandSlot: GROUP_BUDGET.small,
  MainHandSlot: GROUP_BUDGET.weapon,
  RangedSlot: GROUP_BUDGET.ranged,
} as const;
export type RankedSlot = keyof typeof SLOT_BUDGET;
const RANKED_SLOTS = Object.keys(SLOT_BUDGET) as RankedSlot[];

/** The sum of the 17 budgets: a full kit at item level N scores N. */
export const GEAR_SCORE_DIVISOR = RANKED_SLOTS.reduce((sum, s) => sum + SLOT_BUDGET[s], 0);

const TWO_HAND = 17;
/** The inventory types (Enum.InventoryType) each slot takes. */
const FITS: Record<RankedSlot, readonly number[]> = {
  HeadSlot: [1], NeckSlot: [2], ShoulderSlot: [3], BackSlot: [16], ChestSlot: [5, 20], WristSlot: [9], HandsSlot: [10],
  WaistSlot: [6], LegsSlot: [7], FeetSlot: [8], Finger0Slot: [11], Finger1Slot: [11], Trinket0Slot: [12], Trinket1Slot: [12],
  MainHandSlot: [13, TWO_HAND, 21], SecondaryHandSlot: [13, 14, 22, 23], RangedSlot: [15, 25, 26, 28],
};

/** One equipped item as the synced gear holds it. */
export interface EquippedItem { slot: string; itemId: number; itemLevel: number }
/** What the game files say about an item. */
export interface ItemFileFacts { inventoryType: number; level: number }

export type GearRefusal = "unknown_item" | "wrong_slot" | "level_mismatch" | "duplicate_slot" | "no_items";
export type GearNumbers =
  | { ok: true; itemLevel: number; gearScore: number; items: number }
  | { ok: false; reason: GearRefusal };

/** Both numbers for one character's equipped items, rounded down, or why the gear is not counted. */
export function gearNumbers(equipped: readonly EquippedItem[], files: (itemId: number) => ItemFileFacts | undefined): GearNumbers {
  const level = new Map<RankedSlot, number>();
  let twoHand = false;
  for (const e of equipped) {
    if (!(e.slot in SLOT_BUDGET)) continue; // shirt, tabard, ammo: not counted
    const slot = e.slot as RankedSlot;
    if (level.has(slot)) return { ok: false, reason: "duplicate_slot" };
    const f = files(e.itemId);
    if (!f) return { ok: false, reason: "unknown_item" };
    if (!FITS[slot].includes(f.inventoryType)) return { ok: false, reason: "wrong_slot" };
    if (f.level !== e.itemLevel) return { ok: false, reason: "level_mismatch" };
    if (slot === "MainHandSlot" && f.inventoryType === TWO_HAND) twoHand = true;
    level.set(slot, f.level);
  }
  if (level.size === 0) return { ok: false, reason: "no_items" };
  const items = level.size;
  if (twoHand) {
    if (level.has("SecondaryHandSlot")) return { ok: false, reason: "wrong_slot" };
    level.set("SecondaryHandSlot", level.get("MainHandSlot")!);
  }
  const of = (s: RankedSlot) => level.get(s) ?? 0;
  const itemLevel = Math.floor(RANKED_SLOTS.reduce((sum, s) => sum + of(s), 0) / RANKED_SLOTS.length);
  const gearScore = Math.floor(RANKED_SLOTS.reduce((sum, s) => sum + SLOT_BUDGET[s] * of(s), 0) / GEAR_SCORE_DIVISOR);
  return { ok: true, itemLevel, gearScore, items };
}
