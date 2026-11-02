import { expect, test } from "vitest";
import {
  buildTaxonomy, categoryOf, filterItems, handleItemCategories, itemCategoriesStructured, QUALITIES, resolveClass, resolveLegacyClass, resolveSubclass, slotOf, slugify, type Taxonomy,
} from "../src/item-taxonomy.js";

type Rows = Map<number, Record<string, unknown>>;
const rows = (list: Record<string, unknown>[]): Rows => new Map(list.map((r) => [r.ID as number, r]));

function tables(): (t: string) => Rows | undefined {
  const all: Record<string, Rows> = {
    ItemClass: rows([
      { ID: 3, ClassID: 2, ClassName_lang: "Weapon" },
      { ID: 5, ClassID: 4, ClassName_lang: "Armor" },
      { ID: 19, ClassID: 18, ClassName_lang: "WoW Token" },
    ]),
    ItemSubClass: rows([
      { ID: 10, ClassID: 2, SubClassID: 0, DisplayName_lang: "Axe", VerboseName_lang: "One-Handed Axes" },
      { ID: 11, ClassID: 2, SubClassID: 1, DisplayName_lang: "Axe", VerboseName_lang: "Two-Handed Axes" },
      { ID: 17, ClassID: 2, SubClassID: 7, DisplayName_lang: "Sword", VerboseName_lang: "One-Handed Swords" },
      { ID: 20, ClassID: 4, SubClassID: 1, DisplayName_lang: "Cloth", VerboseName_lang: "Cloth" },
      { ID: 21, ClassID: 4, SubClassID: 0, DisplayName_lang: "Miscellaneous", VerboseName_lang: "" },
      // Two rows whose names would give one slug: the second keeps its id in the slug.
      { ID: 30, ClassID: 4, SubClassID: 8, DisplayName_lang: "Idol" },
      { ID: 31, ClassID: 4, SubClassID: 9, DisplayName_lang: "Idol" },
    ]),
    Item: rows([
      { ID: 19019, ClassID: 2, SubclassID: 7, InventoryType: 13 },
      { ID: 16916, ClassID: 4, SubclassID: 1, InventoryType: 20 },
      { ID: 2589, ClassID: 4, SubclassID: 1, InventoryType: 0 },
      { ID: 122284, ClassID: 18, SubclassID: 0, InventoryType: 0 },
    ]),
    ItemSparse: rows([
      { ID: 19019, OverallQualityID: 5 },
      { ID: 16916, OverallQualityID: 4 },
    ]),
  };
  return (t) => all[t];
}

test("slugs come from the client's English names", () => {
  expect(slugify("One-Handed Swords")).toBe("one-handed-swords");
  expect(slugify("Food & Drink")).toBe("food-drink");
  expect(slugify("Jewelry(OBSOLETE)")).toBe("jewelry-obsolete");
  expect(slugify("WoW Token")).toBe("wow-token");
});

test("the taxonomy: classes and subclasses with slugs and counts, items with class, subclass, slot and quality", () => {
  const t = buildTaxonomy(tables());
  // The client's names stay; labels and slugs are plural, as item databases have long used them.
  expect(t.classes).toEqual([
    { id: 2, name: "Weapon", label: "Weapons", slug: "weapons", items: 1 },
    { id: 4, name: "Armor", label: "Armor", slug: "armor", items: 2 },
    { id: 18, name: "WoW Token", label: "WoW Tokens", slug: "wow-tokens", items: 1 },
  ]);
  expect(t.subclasses.filter((s) => s.classId === 2)).toEqual([
    { classId: 2, id: 0, name: "One-Handed Axes", slug: "one-handed-axes", items: 0 },
    { classId: 2, id: 1, name: "Two-Handed Axes", slug: "two-handed-axes", items: 0 },
    { classId: 2, id: 7, name: "One-Handed Swords", slug: "one-handed-swords", items: 1 },
  ]);
  expect(t.subclasses.find((s) => s.classId === 4 && s.id === 0)).toMatchObject({ name: "Miscellaneous", slug: "miscellaneous" });
  expect(t.subclasses.filter((s) => s.classId === 4 && s.name === "Idol").map((s) => s.slug)).toEqual(["idol", "idol-9"]);
  // A class/subclass pair the client has no subclass row for still gets a subclass, named by its number.
  expect(t.subclasses.find((s) => s.classId === 18)).toEqual({ classId: 18, id: 0, name: null, slug: "0", items: 1 });
  expect(t.items).toEqual([[2589, 4, 1, 0, null], [16916, 4, 1, 20, 4], [19019, 2, 7, 13, 5], [122284, 18, 0, 0, null]]);
});

test("an item's category path, slot and quality, in words", () => {
  const t = buildTaxonomy(tables());
  expect(categoryOf(t, 16916)).toEqual({
    itemId: 16916,
    class: { id: 4, name: "Armor", label: "Armor", slug: "armor" },
    subclass: { id: 1, name: "Cloth", slug: "cloth" },
    slot: { inventoryType: 20, name: "Chest", slug: "chest" },
    quality: { id: 4, name: "Epic", slug: "epic" },
  });
  expect(categoryOf(t, 2589)).toMatchObject({ slot: null, quality: null });
  expect(categoryOf(t, 1)).toBeNull();
  expect(slotOf(13)).toEqual({ inventoryType: 13, name: "One-Hand", slug: "one-hand" });
  expect(QUALITIES[0]).toEqual({ id: 0, name: "Poor", slug: "poor" });
});

test("slugs and numeric ids both resolve; filters narrow by slot and quality", () => {
  const t: Taxonomy = buildTaxonomy(tables());
  expect(resolveClass(t, "armor")?.id).toBe(4);
  expect(resolveClass(t, "nope")).toBeNull();
  // The first URLs used the client's singular name; those resolve to the class so pages can redirect.
  expect(resolveLegacyClass(t, "weapon")?.slug).toBe("weapons");
  expect(resolveLegacyClass(t, "armor")).toBeNull();
  expect(resolveSubclass(t, 4, "cloth")?.id).toBe(1);
  expect(resolveSubclass(t, 4, "1")?.slug).toBe("cloth");
  expect(filterItems(t, { classId: 4 }).map((r) => r[0])).toEqual([2589, 16916]);
  // Robes (20) and chest pieces (5) are both "chest".
  expect(filterItems(t, { classId: 4, slot: "chest" }).map((r) => r[0])).toEqual([16916]);
  expect(filterItems(t, { quality: "legendary" }).map((r) => r[0])).toEqual([19019]);
});

test("the categories answer: the tree, one item's path, or a filtered list, each with the label and build", () => {
  const t = buildTaxonomy(tables());
  const build = "1.60.1.70450";
  const tree = handleItemCategories({}, t, build);
  expect(tree).toContain("Armor (armor): 2 items");
  expect(tree).toContain("found in game files, unconfirmed; build 1.60.1.70450");
  expect(tree).toContain("Blizzard");
  expect(handleItemCategories({ item: 16916 }, t, build)).toContain("Item 16916: Armor > Cloth, Chest, Epic");
  expect(handleItemCategories({ item: 7 }, t, build)).toContain("Item 7 is not in build 1.60.1.70450");
  const list = handleItemCategories({ class: "armor", slot: "chest" }, t, build);
  expect(list).toContain("Armor, chest: 1 item");
  expect(list).toContain("item 16916 · Cloth · Chest · Epic");
  expect(handleItemCategories({ class: "dragons" }, t, build)).toContain("No item class dragons");
  expect(handleItemCategories({ class: "weapon" }, t, build)).toContain("Weapons: 1 item");
});

test("slot and quality without a class say they were not applied, instead of answering the whole tree as if they were", () => {
  const t = buildTaxonomy(tables());
  const build = "1.60.1.70450";
  const NOTE = "Slot and quality filter within a class; add class to use them.";
  for (const args of [{ slot: "chest" }, { quality: "epic" }, { slot: "chest", quality: "epic" }]) {
    const text = handleItemCategories(args, t, build);
    expect(text.startsWith(`${NOTE}\nItem categories`), JSON.stringify(args)).toBe(true);
  }
  expect(handleItemCategories({}, t, build)).not.toContain(NOTE);
  expect(handleItemCategories({ class: "armor", slot: "chest" }, t, build)).not.toContain(NOTE);
});

test("the structured answer takes the same class slugs as the text, the singular one included", () => {
  const t = buildTaxonomy(tables());
  const out = itemCategoriesStructured({ class: "weapon" }, t, "1.60.1.70450") as { error?: string; items?: { itemId: number }[]; total?: number };
  expect(out.error).toBeUndefined();
  expect(out.items!.map((i) => i.itemId)).toEqual([19019]);
  expect(out.total).toBe(1);
});

test("the quality slugs are the protocol's ITEM_QUALITY_SLUGS, in Enum.ItemQuality order", async () => {
  const { ITEM_QUALITY_SLUGS } = await import("@everloot/protocol");
  expect(QUALITIES.map((q) => q.slug)).toEqual([...ITEM_QUALITY_SLUGS]);
});
