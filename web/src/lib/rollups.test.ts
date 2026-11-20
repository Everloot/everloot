import { describe, expect, test } from "vitest";
import { rollupDrops, type LootRow } from "./rollups.js";

const win = (installId: string, sourceNpcId: number | undefined, items: Array<{ itemId: number; count: number }>): LootRow => ({
  installId,
  ...(sourceNpcId === undefined ? {} : { sourceNpcId }),
  items,
});

describe("drop rollups", () => {
  test("a fact goes public at 3 independent installs, with kills attached", () => {
    const { rates, rejected } = rollupDrops([
      win("a", 7, [{ itemId: 11, count: 1 }]),
      win("b", 7, [{ itemId: 11, count: 2 }]),
      win("c", 7, [{ itemId: 12, count: 1 }]),
      win("a", 7, [{ itemId: 12, count: 1 }]),
    ]);
    const fang = rates.find((r) => r.itemId === 11)!;
    // kills corroborated by a, b, c → public, even though only a + b saw this drop.
    expect(fang).toMatchObject({ kills: 4, drops: 2, rate: 0.5, reporters: 3, public: true });
    const other = rates.find((r) => r.itemId === 12)!;
    expect(other).toMatchObject({ kills: 4, drops: 2, reporters: 3, public: true });
    expect(rejected).toHaveLength(0);
  });

  test("sourceless windows and implausible rows are rejected, never averaged in", () => {
    const { rates, rejected } = rollupDrops([
      win("a", undefined, [{ itemId: 1, count: 1 }]),
      win("a", -5, [{ itemId: 1, count: 1 }]),
      win("a", 7, [{ itemId: 0, count: 1 }]),
      win("a", 7, [{ itemId: 1, count: 1 }]),
    ]);
    expect(rates).toHaveLength(1);
    // the bad-item window still counts its kill (source was valid); only the item line is rejected.
    expect(rates[0]).toMatchObject({ itemId: 1, kills: 2, drops: 1, rate: 0.5 });
    expect(rejected).toHaveLength(3);
  });

  test("kills that dropped no item are 0 drops in N kills once 3 installs agree", () => {
    const { rates, measuredZeros } = rollupDrops([
      win("a", 7, []),
      win("b", 7, []),
      win("c", 7, []),
      win("a", 7, []),
    ]);
    expect(rates).toHaveLength(0);
    expect(measuredZeros).toEqual([{ sourceNpcId: 7, kills: 4, reporters: 3, tier: "confirmed", public: true }]);
  });

  test("an empty window counts in the kills of an item that did drop", () => {
    const { rates, measuredZeros } = rollupDrops([
      win("a", 7, [{ itemId: 11, count: 1 }]),
      win("b", 7, []),
      win("c", 7, [{ itemId: 11, count: 1 }]),
    ]);
    expect(measuredZeros).toHaveLength(0);
    expect(rates[0]).toMatchObject({ itemId: 11, kills: 3, drops: 2, rate: 2 / 3, public: true });
  });

  test("duplicate item lines in one window count one drop", () => {
    const { rates } = rollupDrops([win("a", 7, [{ itemId: 1, count: 1 }, { itemId: 1, count: 3 }])]);
    expect(rates[0]).toMatchObject({ kills: 1, drops: 1, rate: 1 });
  });
});
