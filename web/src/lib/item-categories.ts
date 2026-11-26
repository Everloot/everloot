import file from "@/data/game-data/item-categories.json";
import { describe, type ItemCategory, type ItemClass, type ItemSubclass, type Taxonomy } from "@kb/item-taxonomy";

/** [classId, subclassId, inventoryType, quality or null, the item ids with them]. */
type Group = [number, number, number, number | null, number[]];
const data = file as unknown as { classes: ItemClass[]; subclasses: ItemSubclass[]; groups: Group[] };
const names: Taxonomy = { classes: data.classes, subclasses: data.subclasses, items: [] };

/**
 * `categoryOf(CLIENT_TAXONOMY, itemId)` from data/game-data/item-categories.json (scripts/item-categories.mjs), a
 * 0.2 MB cut of the client layer. A page that only names an item's type and slot imports this instead of
 * `@/lib/items`, which loads the whole 2.5 MB layer (about 25 MB of a Worker isolate's 128 MB).
 */
export function itemCategoryOf(itemId: number): ItemCategory | null {
  for (const [classId, subclassId, inventoryType, quality, ids] of data.groups) {
    if (ids.includes(itemId)) return describe(names, [itemId, classId, subclassId, inventoryType, quality]);
  }
  return null;
}
