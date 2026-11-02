/**
 * Which items a class can use, by the game files (kb/src/client-class-gear.ts): the weapon and armor types its
 * proficiencies name, at the level it gets each, and the item's own class mask. Found in game files, unconfirmed.
 * Where the files say nothing about an item, it is kept and counted, never hidden.
 */
import type { ItemRow } from "../../../kb/src/item-taxonomy";
import type { ClientClassGear } from "../../../kb/src/client-class-gear";
import type { ClassSlug } from "@/lib/class-context";

/**
 * "yes": the files let the class use it. "no": a proficiency the class lacks (or gets at a higher level), or the item's
 * class mask leaves the class out. "unknown": kept, since the files do not say: a weapon or armor type no proficiency
 * names (rings, relics, fishing poles) or an item without an ItemSparse row, whose class mask is unread.
 */
export type ClassUse = "yes" | "no" | "unknown";

/** An item row → whether a class can use it; `level` counts only the proficiencies it has by then. */
export function classUse(data: ClientClassGear, classSlug: ClassSlug, level?: number): (row: ItemRow) => ClassUse {
  const cls = data.classes[classSlug];
  // The (item class, subclass) pairs some proficiency names: only these does a proficiency decide.
  const gated = new Set(Object.values(data.classes).flatMap((c) => c.gear.map(([ic, sub]) => `${ic}:${sub}`)));
  const mine = new Map((cls?.gear ?? []).map(([ic, sub, at]) => [`${ic}:${sub}`, at]));
  return (row) => {
    // A class the files do not list: nothing to narrow by.
    if (!cls) return "unknown";
    const mask = data.restricted[row[0]];
    if (mask !== undefined && !((mask >>> (cls.id - 1)) & 1)) return "no";
    const key = `${row[1]}:${row[2]}`;
    if (gated.has(key)) {
      const at = mine.get(key);
      return at !== undefined && (level === undefined || at <= level) ? "yes" : "no";
    }
    // No ItemSparse row (the taxonomy's quality is null then): its class mask is not known.
    return row[4] === null || row[1] === 2 || row[1] === 4 ? "unknown" : "yes";
  };
}
