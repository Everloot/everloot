import { expect, test } from "vitest";
import { MAX_INVENTORY_ITEMS, parseInventory } from "./inventory";

test("the addon export and a manual list both accept line breaks and combine repeated item IDs", () => {
  const manual = "2589 7\r\n4306\t100\r\n\r\n2589 4";
  const parsed = { ok: true, items: [{ itemId: 2589, quantity: 11 }, { itemId: 4306, quantity: 100 }] };
  expect(parseInventory(manual)).toEqual(parsed);
  expect(parseInventory(`EVERLOOT-INVENTORY-1\r\n${manual}`)).toEqual(parsed);
  expect(parseInventory("2589 2147483647")).toEqual({ ok: true, items: [{ itemId: 2589, quantity: 2147483647 }] });
});

test("invalid and oversized lists are rejected before any price lookup", () => {
  for (const text of ["", "EVERLOOT-INVENTORY-1", "2589 -2", "2589 0", "2589 1.2", "2589 1 name", "9007199254740992 1", "2589 1\n2589 2147483647", "EVERLOOT-INVENTORY-2\n2589 1"]) {
    expect(parseInventory(text), text).toMatchObject({ ok: false, error: expect.any(String) });
  }
  const listed = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1} 1`).join("\n");
  expect(parseInventory(listed(MAX_INVENTORY_ITEMS))).toMatchObject({ ok: true });
  expect(parseInventory(listed(MAX_INVENTORY_ITEMS + 1))).toMatchObject({ ok: false, error: expect.stringContaining("400") });
});
