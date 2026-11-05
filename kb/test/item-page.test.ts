import { expect, test } from "vitest";
import { agreedItemNames, handleItemPage, itemNameReporters, itemPage, type DropRateRow, type ItemFacts, type NpcSighting } from "../src/item-page.js";

const rate = (extra: Partial<DropRateRow> = {}): DropRateRow => ({
  sourceNpcId: 456,
  itemId: 1234,
  kills: 12,
  drops: 4,
  rate: 4 / 12,
  reporters: 3,
  public: true,
  ...extra,
});

const npc = (installId: string, x: number, extra: Partial<NpcSighting> = {}): NpcSighting => ({
  installId,
  npcId: 456,
  name: "Forest Spider",
  mapId: 141,
  x,
  y: 61,
  ...extra,
});

const facts = (extra: Partial<ItemFacts> = {}): ItemFacts => ({
  rates: [rate()],
  names: ["a", "b", "c"].map((installId) => ({ installId, itemId: 1234, name: "Peacebloom" })),
  npcs: [npc("a", 42), npc("b", 43), npc("c", 44)],
  ...extra,
});

test("a public drop, an agreed name, and a median pin become the page", () => {
  const page = itemPage(1234, facts());
  expect(page.name).toBe("Peacebloom");
  expect(page.drops[0]).toMatchObject({ source: "NPC 456 Forest Spider", kills: 12, drops: 4, reporters: 3 });
  expect(page.pins).toEqual([{ npcId: 456, name: "Forest Spider", mapId: 141, x: 43, y: 61, reporters: 3 }]);
  expect(handleItemPage({ itemId: 1234 }, facts())).toContain("33.3%");
});

test("two installs, a second name, or a private rate stay off the page", () => {
  const page = itemPage(1234, facts({
    rates: [rate({ public: false })],
    names: [
      ...["a", "b", "c"].map((installId) => ({ installId, itemId: 1234, name: "Peacebloom" })),
      ...["d", "e", "f"].map((installId) => ({ installId, itemId: 1234, name: "Silverleaf" })),
    ],
    npcs: [npc("a", 42), npc("a", 10), npc("b", 80)],
  }));
  expect(page.name).toBeNull();
  expect(page.drops).toHaveLength(0);
  expect(page.pins).toHaveLength(0);
  expect(handleItemPage({ itemId: 1234 }, { rates: [], names: [], npcs: [] })).toContain("Drop rate unrecorded");
  expect(handleItemPage({ itemId: 0 })).toBe("Name an item id.");
});

test("an item with no agreed name counts the installs behind its leading name; an agreed or split name counts none", () => {
  const seen = (installId: string, itemId: number, name: string) => ({ installId, itemId, name });
  const count = (names: ItemFacts["names"]) => itemNameReporters(1234, facts({ names }));
  expect(count([])).toBe(0);
  expect(count([seen("a", 1234, "Peacebloom"), seen("a", 1234, "Peacebloom"), seen("b", 99, "Peacebloom")])).toBe(1);
  expect(count([seen("a", 1234, "Peacebloom"), seen("b", 1234, "peacebloom "), seen("c", 1234, "Silverleaf")])).toBe(2);
  expect(count(["a", "b", "c"].map((i) => seen(i, 1234, "Peacebloom")))).toBe(0);
  expect(count([...["a", "b", "c"].map((i) => seen(i, 1234, "Peacebloom")), ...["d", "e", "f"].map((i) => seen(i, 1234, "Silverleaf"))])).toBe(0);
});

test("zero drops in a public sample names the kills", () => {
  const text = handleItemPage({ itemId: 1234 }, facts({ rates: [rate({ drops: 0, kills: 9, rate: 0 })] }));
  expect(text).toContain("0 items in 9 observed loot windows");
  expect(text).not.toContain("Drop rate unrecorded");
  expect(text).not.toContain("0.0%");
});

test("agreedItemNames gives the names itemPage would, for every item at once", () => {
  const seen = (installId: string, itemId: number, name: string) => ({ installId, itemId, name });
  const facts: ItemFacts = {
    rates: [], npcs: [],
    names: [
      seen("a", 1, "Linen Cloth"), seen("b", 1, "linen cloth "), seen("c", 1, "Linen Cloth"),
      seen("a", 2, "Copper Ore"), seen("b", 2, "Copper Ore"),
      seen("a", 3, "Tin Ore"), seen("b", 3, "Tin Ore"), seen("c", 3, "Tin Ore"), seen("a", 3, "Iron Ore"), seen("b", 3, "Iron Ore"), seen("c", 3, "Iron Ore"),
    ],
  };
  const names = agreedItemNames(facts);
  expect([...names]).toEqual([[1, "Linen Cloth"]]);
  for (const id of [1, 2, 3]) expect(names.get(id) ?? null).toBe(itemPage(id, facts).name);
});
