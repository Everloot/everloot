import { gearNumbers } from "@kb/armory/gear";
import type { ArmoryCharacter, ArmoryItem } from "./armory-store";

/**
 * Since 2026-11-24/25, Blizzard's Forever equipment answer has no item level for a character who has logged in since
 * the change, so thousands of stored rows have no level on any item, and so no ranked item level and no Gear Score
 * (the crawler keeps a stored level since PR #1641, but cannot read the game files). An armory page can: for each
 * equipped item with no level it shows the game files' level for that item id (ItemSparse), and only where the stored
 * number is null it computes the ranked item level and Gear Score from the filled levels with the crawler's own formula
 * (kb/src/armory/gear.ts). A level the row holds always wins; an item the files give no level stays without one and
 * counts as an empty slot, as in the crawler. Display only: nothing is stored, and Blizzard's own equipped and average
 * item levels are never computed.
 */
export interface FileLevelView {
  /** The character with the files' levels filled in and the computed numbers. */
  character: ArmoryCharacter;
  /** The slots whose shown level is the game files'. */
  fromFiles: ReadonlySet<string>;
  /** Which shown numbers were computed here, not read from storage. */
  computed: { itemLevel: boolean; gearScore: boolean };
}

export function withFileLevels(c: ArmoryCharacter, fileLevel: (itemId: number) => number | null | undefined): FileLevelView {
  const fromFiles = new Set<string>();
  const equipment = c.equipment.map((item) => {
    if (item.level != null) return item;
    const level = fileLevel(item.itemId);
    if (level == null || !(level > 0)) return item;
    fromFiles.add(item.slot);
    return { ...item, level };
  });
  if (fromFiles.size === 0) return { character: c, fromFiles, computed: { itemLevel: false, gearScore: false } };
  const numbers = gearNumbers(equipment.map(asEquipmentItem));
  const itemLevel = c.itemLevel === null && numbers.item_level !== null;
  const gearScore = c.gearScore === null && numbers.gear_score !== null;
  return {
    character: { ...c, equipment, itemLevel: itemLevel ? numbers.item_level : c.itemLevel, gearScore: gearScore ? numbers.gear_score : c.gearScore },
    fromFiles,
    computed: { itemLevel, gearScore },
  };
}

/** A stored item in the shape of Blizzard's answer, which the crawler's formula reads. */
const asEquipmentItem = (i: ArmoryItem) => ({
  slot: { type: i.slot }, item: { id: i.itemId }, name: i.name, level: i.level == null ? null : { value: i.level },
  quality: { type: i.quality ?? "" }, inventory_type: { type: i.inventoryType ?? "" },
});
