/**
 * Item categories from the game files: class and subclass (ItemClass, ItemSubClass, with the client's
 * English names), slot (Item.InventoryType) and quality (ItemSparse.OverallQualityID). Numeric ids are
 * the key; slugs are made from the client's names and kept per build. Slot and quality are enums with
 * no table, so their English labels are ours, keyed on the game's numbers.
 */
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { CLIENT_LABEL } from "./edges.js";

/** `name` is the client's (singular, "Weapon"); `label` and `slug` are ours, plural as players browse them ("Weapons", "weapons"). */
export interface ItemClass { id: number; name: string; label: string; slug: string; items: number }

/**
 * Plural labels for the client's item classes, in the words item databases have long used, so the URLs read
 * /database/items/weapons/one-handed-swords. Keyed by ItemClass.ClassID; a class not listed keeps its client name.
 */
export const CLASS_LABELS: Record<number, string> = {
  0: "Consumables", 1: "Containers", 2: "Weapons", 3: "Jewelry", 4: "Armor", 5: "Reagents", 6: "Projectiles",
  7: "Trade Goods", 8: "Generic", 9: "Recipes", 10: "Money", 11: "Quivers", 12: "Quest", 13: "Keys", 14: "Permanent",
  15: "Miscellaneous", 16: "Glyphs", 17: "Battle Pets", 18: "WoW Tokens",
};
export interface ItemSubclass { classId: number; id: number; name: string | null; slug: string; items: number }
/** [itemId, classId, subclassId, inventoryType, quality or null]. */
export type ItemRow = [number, number, number, number, number | null];
export interface Taxonomy { classes: ItemClass[]; subclasses: ItemSubclass[]; items: ItemRow[] }

export interface Slot { inventoryType: number; name: string; slug: string }
/** Enum.InventoryType. 0 is "not equipped" and has no slot. Robes (20) and chest pieces (5) share a slot, as do the two ranged types. */
const SLOT_NAMES: Record<number, string> = {
  1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands",
  11: "Finger", 12: "Trinket", 13: "One-Hand", 14: "Shield", 15: "Ranged", 16: "Back", 17: "Two-Hand", 18: "Bag", 19: "Tabard",
  20: "Chest", 21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand", 24: "Ammo", 25: "Thrown", 26: "Ranged", 27: "Quiver", 28: "Relic",
};
export const slotOf = (inventoryType: number): Slot | null =>
  SLOT_NAMES[inventoryType] ? { inventoryType, name: SLOT_NAMES[inventoryType], slug: slugify(SLOT_NAMES[inventoryType]) } : null;

export interface Quality { id: number; name: string; slug: string }
/** Enum.ItemQuality. */
export const QUALITIES: Quality[] = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"]
  .map((name, id) => ({ id, name, slug: slugify(name) }));

export function slugify(name: string): string {
  return name.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

type Rows = Map<number, Record<string, unknown>>;
const list = (r: Rows | undefined) => [...(r?.values() ?? [])];
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function buildTaxonomy(get: (table: string) => Rows | undefined): Taxonomy {
  const quality = new Map(list(get("ItemSparse")).map((r) => [int(r.ID), int(r.OverallQualityID)]));
  const items: ItemRow[] = list(get("Item"))
    .filter((r) => int(r.ID) !== null && int(r.ClassID) !== null && int(r.SubclassID) !== null)
    .map((r): ItemRow => [int(r.ID)!, int(r.ClassID)!, int(r.SubclassID)!, int(r.InventoryType) ?? 0, quality.get(int(r.ID)!) ?? null])
    .sort((a, b) => a[0] - b[0]);
  const count = new Map<string, number>();
  for (const [, c, s] of items) {
    count.set(`${c}`, (count.get(`${c}`) ?? 0) + 1);
    count.set(`${c}:${s}`, (count.get(`${c}:${s}`) ?? 0) + 1);
  }
  const classes: ItemClass[] = list(get("ItemClass"))
    .filter((r) => int(r.ClassID) !== null && text(r.ClassName_lang))
    .map((r) => {
      const name = text(r.ClassName_lang)!;
      const label = CLASS_LABELS[int(r.ClassID)!] ?? name;
      return { id: int(r.ClassID)!, name, label, slug: slugify(label), items: count.get(`${int(r.ClassID)}`) ?? 0 };
    })
    .sort((a, b) => a.id - b.id);
  const named = new Map<string, string | null>();
  for (const r of list(get("ItemSubClass"))) {
    const c = int(r.ClassID), s = int(r.SubClassID);
    if (c === null || s === null || s < 0) continue;
    // "Axe" names both one- and two-handed axes; the verbose name tells them apart.
    named.set(`${c}:${s}`, text(r.VerboseName_lang) ?? text(r.DisplayName_lang));
  }
  for (const [, c, s] of items) if (!named.has(`${c}:${s}`)) named.set(`${c}:${s}`, null);
  const subclasses: ItemSubclass[] = [];
  const taken = new Set<string>();
  for (const key of [...named.keys()].sort((a, b) => { const [ac, as] = a.split(":").map(Number); const [bc, bs] = b.split(":").map(Number); return ac - bc || as - bs; })) {
    const [classId, id] = key.split(":").map(Number);
    const name = named.get(key)!;
    let slug = name ? slugify(name) : String(id);
    if (!slug || taken.has(`${classId}:${slug}`)) slug = `${slug || "subclass"}-${id}`;
    taken.add(`${classId}:${slug}`);
    subclasses.push({ classId, id, name, slug, items: count.get(key) ?? 0 });
  }
  return { classes, subclasses, items };
}

export function resolveClass(t: Taxonomy, slug: string): ItemClass | null {
  return t.classes.find((c) => c.slug === slug) ?? null;
}

/** A class by the slug of its client name ("weapon"), as the first item URLs used; pages redirect it to the plural one. */
export function resolveLegacyClass(t: Taxonomy, slug: string): ItemClass | null {
  return t.classes.find((c) => slugify(c.name) === slug && c.slug !== slug) ?? null;
}

/** A subclass by slug, or by its number. */
export function resolveSubclass(t: Taxonomy, classId: number, key: string): ItemSubclass | null {
  const mine = t.subclasses.filter((s) => s.classId === classId);
  return mine.find((s) => s.slug === key) ?? (/^\d+$/.test(key) ? mine.find((s) => s.id === Number(key)) ?? null : null);
}

export interface ItemCategory {
  itemId: number;
  class: { id: number; name: string; label: string; slug: string } | null;
  subclass: { id: number; name: string | null; slug: string } | null;
  slot: Slot | null;
  quality: Quality | null;
}

export function categoryOf(t: Taxonomy, itemId: number): ItemCategory | null {
  const row = t.items.find((r) => r[0] === itemId);
  return row ? describe(t, row) : null;
}

export function describe(t: Taxonomy, [itemId, classId, subclassId, inventoryType, quality]: ItemRow): ItemCategory {
  const c = t.classes.find((x) => x.id === classId);
  const s = t.subclasses.find((x) => x.classId === classId && x.id === subclassId);
  return {
    itemId,
    class: c ? { id: c.id, name: c.name, label: c.label, slug: c.slug } : null,
    subclass: s ? { id: s.id, name: s.name, slug: s.slug } : null,
    slot: slotOf(inventoryType),
    quality: quality === null ? null : QUALITIES[quality] ?? null,
  };
}

export interface ItemFilter { classId?: number; subclassId?: number; slot?: string; quality?: string }

export function filterItems(t: Taxonomy, f: ItemFilter): ItemRow[] {
  return t.items.filter(([, c, s, inv, q]) =>
    (f.classId === undefined || c === f.classId) && (f.subclassId === undefined || s === f.subclassId)
    && (f.slot === undefined || slotOf(inv)?.slug === f.slot)
    && (f.quality === undefined || (q !== null && QUALITIES[q]?.slug === f.quality)));
}

const plural = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
const words = (c: ItemCategory) => [c.subclass?.name ?? `subclass ${c.subclass?.id ?? "?"}`, c.slot?.name, c.quality?.name].filter(Boolean).join(" · ");

/** The MCP tool's structured answer: the same cases as the text, with the same limit. */
export function itemCategoriesStructured(
  args: { item?: number; class?: string; subclass?: string; slot?: string; quality?: string; limit?: number },
  t: Taxonomy, build: string,
): object {
  const base = { label: CLIENT_LABEL.toLowerCase(), build, credit: GAME_DATA_CREDIT };
  if (args.item !== undefined) return { ...base, item: categoryOf(t, args.item) };
  if (args.class === undefined) {
    return {
      ...base,
      classes: t.classes.filter((x) => x.items > 0).map((c) => ({
        id: c.id, name: c.name, slug: c.slug, items: c.items,
        subclasses: t.subclasses.filter((x) => x.classId === c.id && x.items > 0).map((s) => ({ id: s.id, name: s.name, slug: s.slug, items: s.items })),
      })),
    };
  }
  const cls = resolveClass(t, args.class) ?? resolveLegacyClass(t, args.class);
  if (!cls) return { ...base, error: `No item class ${args.class} in build ${build}.` };
  const sub = args.subclass === undefined ? null : resolveSubclass(t, cls.id, args.subclass);
  if (args.subclass !== undefined && !sub) return { ...base, error: `No subclass ${args.subclass} under ${cls.name} in build ${build}.` };
  const rows = filterItems(t, { classId: cls.id, subclassId: sub?.id, slot: args.slot, quality: args.quality });
  return { ...base, items: rows.slice(0, args.limit ?? 25).map((row) => describe(t, row)), total: rows.length };
}

/** Text answer for the MCP tool: the whole tree, one item's path, or a filtered list. */
export function handleItemCategories(
  args: { item?: number; class?: string; subclass?: string; slot?: string; quality?: string; limit?: number },
  t: Taxonomy, build: string,
): string {
  const stamp = `${CLIENT_LABEL.toLowerCase()}; build ${build}`;
  const end = (lines: string[]) => [...lines, GAME_DATA_CREDIT].join("\n");
  if (args.item !== undefined) {
    const c = categoryOf(t, args.item);
    if (!c) return end([`Item ${args.item} is not in build ${build}.`]);
    const path = [c.class?.label ?? `class ${c.class?.id}`, c.subclass?.name ?? `subclass ${c.subclass?.id}`].join(" > ");
    return end([`Item ${args.item}: ${[path, c.slot?.name, c.quality?.name].filter(Boolean).join(", ")} (${stamp})`]);
  }
  if (args.class === undefined) {
    // Slot and quality narrow one class's list; on their own they would filter the whole tree, so say they were not used.
    const unused = args.slot !== undefined || args.quality !== undefined;
    const lines = [...(unused ? ["Slot and quality filter within a class; add class to use them."] : []), `Item categories (${stamp})`];
    for (const c of t.classes.filter((x) => x.items > 0)) {
      lines.push(`${c.label} (${c.slug}): ${plural(c.items)}`);
      for (const s of t.subclasses.filter((x) => x.classId === c.id && x.items > 0)) lines.push(`  ${s.name ?? `subclass ${s.id}`} (${s.slug}): ${plural(s.items)}`);
    }
    return end(lines);
  }
  const cls = resolveClass(t, args.class) ?? resolveLegacyClass(t, args.class);
  if (!cls) return end([`No item class ${args.class} in build ${build}. Ask with no class for the list.`]);
  const sub = args.subclass === undefined ? null : resolveSubclass(t, cls.id, args.subclass);
  if (args.subclass !== undefined && !sub) return end([`No subclass ${args.subclass} under ${cls.name} in build ${build}.`]);
  const rows = filterItems(t, { classId: cls.id, subclassId: sub?.id, slot: args.slot, quality: args.quality });
  const limit = args.limit ?? 25;
  const title = [sub?.name ?? cls.label, args.slot, args.quality].filter(Boolean).join(", ");
  const lines = [`${sub ? `${cls.label} > ` : ""}${title}: ${plural(rows.length)} (${stamp})`];
  for (const row of rows.slice(0, limit)) lines.push(`item ${row[0]} · ${words(describe(t, row))}`);
  if (rows.length > limit) lines.push(`${rows.length - limit} more not shown`);
  return end(lines);
}
