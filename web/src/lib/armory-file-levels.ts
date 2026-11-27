import { slots as RANKED_SLOT } from "@kb/armory/gear";
import { SLOT_BUDGET, type RankedSlot } from "@kb/gear-score";
import type { ArmoryCharacter, ArmoryItem } from "./armory-store";

/**
 * Since 2026-11-24/25, Blizzard's Forever equipment answer has no item level for a character who has logged in since
 * the change, so thousands of stored rows have no level on any item, and so no ranked item level and no Gear Score
 * (the crawler keeps a stored level since PR #1641, but cannot read the game files). An armory page can: for each
 * equipped item with no level it shows the game files' level for that item id (ItemSparse), and only where the stored
 * number is null it computes the ranked item level and Gear Score with the crawler's slot weights (kb/src/gear-score.ts)
 * over the slots whose level is known. An empty slot is known and counts 0, as in the crawler; a worn item with no
 * level anywhere is unknown and left out, not counted 0, so a kit the files mostly lack does not read as item level 3.
 * Below MIN_KNOWN_SLOTS known slots no number is shown at all. A level the row holds always wins. Display only: nothing
 * is stored, and Blizzard's own equipped and average item levels are never computed.
 */
export interface FileLevelView {
  /** The character with the files' levels filled in and the computed numbers. */
  character: ArmoryCharacter;
  /** The slots whose shown level is the game files'. */
  fromFiles: ReadonlySet<string>;
  /**
   * Which shown numbers were computed here, not read from storage; `slots`, how many of the 17 ranked slots have a known
   * level (or are empty); `withheld`, a stored-null number is not computed because too few slots are known.
   */
  computed: { itemLevel: boolean; gearScore: boolean; slots: number; withheld: boolean };
}

/** The ranked slots, out of 17, that must have a known level before a number is computed. */
export const MIN_KNOWN_SLOTS = 12;
const RANKED = Object.keys(SLOT_BUDGET) as RankedSlot[];

export function withFileLevels(c: ArmoryCharacter, fileLevel: (itemId: number) => number | null | undefined): FileLevelView {
  const fromFiles = new Set<string>();
  const equipment = c.equipment.map((item) => {
    if (item.level != null) return item;
    const level = fileLevel(item.itemId);
    if (level == null || !(level > 0)) return item;
    fromFiles.add(item.slot);
    return { ...item, level };
  });
  const filled = fromFiles.size ? { ...c, equipment } : c;
  const none = { itemLevel: false, gearScore: false, slots: RANKED.length, withheld: false };
  if ((c.itemLevel !== null && c.gearScore !== null) || equipment.length === 0) return { character: filled, fromFiles, computed: none };
  const { level, unknown } = rankedLevels(equipment);
  const slots = RANKED.length - unknown.size;
  if (slots < MIN_KNOWN_SLOTS) return { character: filled, fromFiles, computed: { ...none, slots, withheld: true } };
  // Computed only where the files filled a level, as before: a stored null beside stored levels stays not read.
  if (fromFiles.size === 0 || level.size === 0) return { character: filled, fromFiles, computed: { ...none, slots } };
  const known = RANKED.filter((s) => !unknown.has(s));
  const of = (s: RankedSlot) => level.get(s) ?? 0;
  const itemLevel = c.itemLevel === null, gearScore = c.gearScore === null;
  return {
    character: {
      ...filled,
      itemLevel: itemLevel ? Math.floor(known.reduce((sum, s) => sum + of(s), 0) / known.length) : c.itemLevel,
      gearScore: gearScore ? Math.floor(known.reduce((sum, s) => sum + SLOT_BUDGET[s] * of(s), 0) / known.reduce((sum, s) => sum + SLOT_BUDGET[s], 0)) : c.gearScore,
    },
    fromFiles,
    computed: { itemLevel, gearScore, slots, withheld: false },
  };
}

/** The ranked slots' levels, and the ranked slots worn with no level; a two-hander fills the off hand, as in the crawler. */
function rankedLevels(equipment: readonly ArmoryItem[]) {
  const level = new Map<RankedSlot, number>(), unknown = new Set<RankedSlot>();
  for (const item of equipment) {
    const slot = RANKED_SLOT[item.slot];
    if (!slot) continue;
    const twoHand = item.slot === "MAIN_HAND" && item.inventoryType === "TWOHWEAPON";
    if (item.level == null) {
      unknown.add(slot);
      if (twoHand) unknown.add("SecondaryHandSlot");
    } else {
      level.set(slot, item.level);
      if (twoHand && !equipment.some((i) => i.slot === "OFF_HAND")) level.set("SecondaryHandSlot", item.level);
    }
  }
  return { level, unknown };
}
