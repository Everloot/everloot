import { describe, expect, test } from "vitest";
import type { ItemRow } from "../../../kb/src/item-taxonomy";
import type { ClientClassGear } from "../../../kb/src/client-class-gear";
import { CLIENT_CLASS_GEAR } from "@/data/game-data/client-class-gear";
import { CLIENT_TAXONOMY } from "@/lib/items";
import { classUse } from "./class-gear";

// [id, item class, subclass, inventory type, quality (null: no ItemSparse row)]
const row = (id: number, itemClass: number, sub: number, quality: number | null = 2): ItemRow => [id, itemClass, sub, 0, quality];

const data = {
  classes: {
    warrior: { id: 1, gear: [[2, 7, 0], [2, 8, 0], [4, 1, 0], [4, 4, 40], [4, 6, 0]] },
    mage: { id: 8, gear: [[2, 7, 0], [2, 19, 0], [4, 1, 0]] },
  },
  restricted: { "500": 1, "501": 128 },
} as unknown as ClientClassGear;

describe("classUse", () => {
  const mage = classUse(data, "mage");
  const warrior = classUse(data, "warrior");

  test("a cloth-only class leaves plate and shields out and keeps cloth", () => {
    expect(mage(row(1, 4, 4))).toBe("no");
    expect(mage(row(2, 4, 6))).toBe("no");
    expect(mage(row(3, 4, 1))).toBe("yes");
  });

  test("weapon subclasses follow the class's proficiencies: one-handed swords and wands, not two-handed swords", () => {
    expect(mage(row(4, 2, 7))).toBe("yes");
    expect(mage(row(5, 2, 19))).toBe("yes");
    expect(mage(row(6, 2, 8))).toBe("no");
    expect(warrior(row(6, 2, 8))).toBe("yes");
    expect(warrior(row(5, 2, 19))).toBe("no");
  });

  test("a level counts only the proficiencies the class has by then", () => {
    expect(classUse(data, "warrior", 39)(row(1, 4, 4))).toBe("no");
    expect(classUse(data, "warrior", 40)(row(1, 4, 4))).toBe("yes");
    // Without a level, everything the class gets is in.
    expect(warrior(row(1, 4, 4))).toBe("yes");
  });

  test("the item's own class mask comes first", () => {
    expect(mage(row(500, 4, 1))).toBe("no");
    expect(warrior(row(500, 4, 1))).toBe("yes");
    expect(warrior(row(501, 0, 0))).toBe("no");
    expect(mage(row(501, 0, 0))).toBe("yes");
  });

  test("what the files do not decide is kept: a type no proficiency names, an item with no class data, a class not listed", () => {
    // Armor subclass 0 (rings, necks): no proficiency names it.
    expect(mage(row(7, 4, 0))).toBe("unknown");
    // A potion without an ItemSparse row: its class mask is unread.
    expect(mage(row(8, 0, 1, null))).toBe("unknown");
    expect(mage(row(9, 0, 1))).toBe("yes");
    expect(classUse(data, "druid")(row(1, 4, 4))).toBe("unknown");
  });
});

describe("the committed game data (build 70707)", () => {
  const items = CLIENT_TAXONOMY.items;
  const kept = (fn: (r: ItemRow) => string) => items.filter((r) => fn(r) !== "no");
  const sub = (rows: ItemRow[], itemClass: number, s: number) => rows.filter((r) => r[1] === itemClass && r[2] === s).length;

  test("a Mage keeps cloth and wands and loses plate, mail and shields", () => {
    const mage = kept(classUse(CLIENT_CLASS_GEAR, "mage"));
    expect(sub(mage, 4, 1)).toBeGreaterThan(0);
    expect(sub(mage, 2, 19)).toBeGreaterThan(0);
    for (const s of [3, 4, 6]) expect(sub(mage, 4, s), `armor subclass ${s}`).toBe(0);
    expect(mage.length).toBeLessThan(items.length);
  });

  test("a Warrior gets plate at level 40, not before", () => {
    expect(sub(kept(classUse(CLIENT_CLASS_GEAR, "warrior", 39)), 4, 4)).toBe(0);
    expect(sub(kept(classUse(CLIENT_CLASS_GEAR, "warrior", 40)), 4, 4)).toBeGreaterThan(0);
  });

  test("every class the site plans is in the file", () => {
    expect(Object.keys(CLIENT_CLASS_GEAR.classes).sort()).toEqual(["druid", "hunter", "mage", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"]);
  });
});
