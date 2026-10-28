import { expect, test } from "vitest";
import { itemFactsFromRecords, lootWindowsFromRecords, rollupDrops } from "../src/drop-rollup.js";
import { handleItemPage } from "../src/item-page.js";

test("loot and item_seen records become the same item page the site renders", () => {
  const loot = (installId: string) => ({
    kind: "loot",
    sourceEvidence: "loot-api",
    installId,
    sourceNpcId: 456,
    items: [{ itemId: 1234, count: 1 }],
  });
  const seen = (installId: string) => ({ kind: "item_seen", installId, itemId: 1234, name: "Peacebloom" });
  const facts = itemFactsFromRecords([loot("a"), loot("b"), loot("c"), seen("a"), seen("b"), seen("c"), { kind: "loot" }]);
  expect(facts.rates[0]).toMatchObject({ itemId: 1234, kills: 3, drops: 3, reporters: 3, public: true });
  const text = handleItemPage({ itemId: 1234 }, facts);
  expect(text).toContain("Peacebloom");
  expect(text).toContain("100.0%");
  expect(text).toContain("NPC 456");
});

test("kills that dropped no item are a measured zero once 3 installs agree", () => {
  const empty = (installId: string) => ({ installId, sourceNpcId: 7, items: [] as { itemId: number; count: number }[] });
  const { rates, measuredZeros } = rollupDrops([empty("a"), empty("b"), empty("c"), empty("a")]);
  expect(rates).toHaveLength(0);
  expect(measuredZeros).toEqual([{ sourceNpcId: 7, kills: 4, reporters: 3, public: true }]);
});

test("an empty window still counts in the kills of an item that did drop", () => {
  const { rates, measuredZeros } = rollupDrops([
    { installId: "a", sourceNpcId: 7, items: [{ itemId: 11, count: 1 }] },
    { installId: "b", sourceNpcId: 7, items: [] },
    { installId: "c", sourceNpcId: 7, items: [{ itemId: 11, count: 1 }] },
  ]);
  expect(measuredZeros).toHaveLength(0);
  expect(rates[0]).toMatchObject({ itemId: 11, kills: 3, drops: 2, reporters: 3, public: true });
});

test("two installs do not publish a zero, and an object with no item is the same zero", () => {
  const quiet = rollupDrops([
    { installId: "a", sourceNpcId: 7, items: [] },
    { installId: "b", sourceNpcId: 7, items: [] },
  ]);
  expect(quiet.measuredZeros[0]).toMatchObject({ kills: 2, reporters: 2, public: false });
  const chest = rollupDrops([
    { installId: "a", sourceObjectId: 900, items: [] },
    { installId: "b", sourceObjectId: 900, items: [] },
    { installId: "c", sourceObjectId: 900, items: [] },
  ]);
  expect(chest.measuredZeros[0]).toMatchObject({ sourceObjectId: 900, kills: 3, public: true });
});

test("loot from an object (a chest, a node) is a kill too", () => {
  const open = (installId: string) => ({ kind: "loot", sourceEvidence: "loot-api", installId, sourceObjectId: 900, items: [{ itemId: 77, count: 2 }] });
  const facts = itemFactsFromRecords([open("a"), open("b"), open("c")]);
  expect(facts.rates).toHaveLength(1);
  expect(facts.rates[0]).toMatchObject({ sourceObjectId: 900, itemId: 77, kills: 3, drops: 3, reporters: 3, public: true });
});

test("typed windows: pick-pocket, skinning, disenchant and container windows stay out of the kill table", () => {
  const win = (installId: string, extra: Record<string, unknown>) => ({ kind: "loot", sourceEvidence: "loot-api", installId, items: [{ itemId: 77, count: 1 }], ...extra });
  const records = [
    win("a", { sourceNpcId: 5 }),
    win("b", { sourceNpcId: 5, lootType: "kill" }),
    win("c", { sourceNpcId: 5, lootType: "pickpocket", copper: 40 }),
    win("c", { sourceNpcId: 5, lootType: "skinning" }),
    win("c", { sourceItemId: 2455, lootType: "disenchant" }),
    win("c", { sourceItemId: 6, lootType: "container" }),
    win("c", { sourceObjectId: 900, lootType: "gather" }),
  ];
  expect(lootWindowsFromRecords(records)).toHaveLength(3);
  const facts = itemFactsFromRecords(records);
  expect(facts.rates.find((r) => r.sourceNpcId === 5)).toMatchObject({ kills: 2, drops: 2 });
});