import { describe, expect, test } from "vitest";
import { auctionatorImportString, tsmImportString } from "./shopping-export";

const ore = { itemId: 2770, name: "Copper Ore", count: 6 };
const bar = { itemId: 2840, name: "Copper Bar", count: 12 };
const stone = { itemId: 2835, name: "Rough Stone", count: 20 };

describe("tsmImportString", () => {
  test("an empty list gives an empty string", () => {
    expect(tsmImportString([])).toEqual({ text: "", included: 0, omitted: [] });
  });
  test("one item is one item string", () => {
    expect(tsmImportString([ore]).text).toBe("i:2770");
  });
  test("many items are comma separated, in list order, once each, without counts", () => {
    expect(tsmImportString([ore, bar, stone, { ...ore, count: 3 }])).toEqual({ text: "i:2770,i:2840,i:2835", included: 3, omitted: [] });
  });
  test("items without a known id are left out and named", () => {
    expect(tsmImportString([ore, { itemId: null, name: "Mystery Herb", count: 2 }, { itemId: 0, name: "Zero", count: 1 }]))
      .toEqual({ text: "i:2770", included: 1, omitted: ["Mystery Herb", "Zero"] });
  });
  test("a long list keeps every id", () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ itemId: 1000 + i, name: `Item ${i}`, count: 1 }));
    const { text, included } = tsmImportString(items);
    expect(included).toBe(250);
    expect(text.split(",")).toHaveLength(250);
    expect(text.startsWith("i:1000,i:1001,")).toBe(true);
    expect(text.endsWith(",i:1249")).toBe(true);
  });
});

describe("auctionatorImportString", () => {
  test("an empty list gives an empty string", () => {
    expect(auctionatorImportString("Mining 1-75", [])).toEqual({ text: "", included: 0, omitted: [] });
  });
  test("one item is the list name and one exact search with its quantity", () => {
    expect(auctionatorImportString("Mining 1-75", [ore]).text).toBe('Mining 1-75^"Copper Ore";;;;;;;;;;;#;;6');
  });
  test("each search has 14 fields with the quantity last", () => {
    const search = auctionatorImportString("L", [ore]).text.split("^")[1];
    const fields = search.split(";");
    expect(fields).toHaveLength(14);
    expect(fields[0]).toBe('"Copper Ore"');
    expect(fields[11]).toBe("#");
    expect(fields[13]).toBe("6");
  });
  test("many items join with ^ and the same name adds its quantities", () => {
    expect(auctionatorImportString("Blacksmithing 1-300", [ore, bar, { ...ore, name: "copper ore", count: 4 }]).text)
      .toBe('Blacksmithing 1-300^"Copper Ore";;;;;;;;;;;#;;10^"Copper Bar";;;;;;;;;;;#;;12');
  });
  test("a missing or zero quantity leaves the field empty", () => {
    expect(auctionatorImportString("L", [{ itemId: 1, name: "Linen Cloth", count: 0 }]).text).toBe('L^"Linen Cloth";;;;;;;;;;;#;;');
  });
  test("names with apostrophes, colons and accents pass through; names with import separators are left out", () => {
    const result = auctionatorImportString("L", [
      { itemId: 1, name: "Kingsblood: Smith's Élixir", count: 1 },
      { itemId: 2, name: 'Odd "quoted" item', count: 1 },
      { itemId: 3, name: "Semi;colon", count: 1 },
      { itemId: 4, name: "Up^arrow", count: 1 },
      { itemId: 5, name: "Line\nbreak", count: 1 },
      { itemId: 6, name: "  ", count: 1 },
    ]);
    expect(result.text).toBe('L^"Kingsblood: Smith\'s Élixir";;;;;;;;;;;#;;1');
    expect(result.omitted).toEqual(['Odd "quoted" item', "Semi;colon", "Up^arrow", "Line\nbreak", "  "]);
  });
  test("the list name cannot break the line or the name", () => {
    expect(auctionatorImportString("A^B\nC", [ore]).text).toBe('A B C^"Copper Ore";;;;;;;;;;;#;;6');
    expect(auctionatorImportString("  ", [ore]).text).toBe('Everloot^"Copper Ore";;;;;;;;;;;#;;6');
  });
  test("the id is not needed: Auctionator searches by name", () => {
    expect(auctionatorImportString("L", [{ itemId: null, name: "Copper Ore", count: 2 }]).text).toBe('L^"Copper Ore";;;;;;;;;;;#;;2');
  });
  test("a long list keeps every search on one line", () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ itemId: i + 1, name: `Item ${i}`, count: i + 1 }));
    const { text, included } = auctionatorImportString("Long", items);
    expect(included).toBe(250);
    expect(text).not.toContain("\n");
    expect(text.split("^")).toHaveLength(251);
    expect(text.endsWith('^"Item 249";;;;;;;;;;;#;;250')).toBe(true);
  });
});
