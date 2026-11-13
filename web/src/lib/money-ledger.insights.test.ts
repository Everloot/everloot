import { describe, expect, test } from "vitest";
import { SPENDING_COLOR, stack } from "../app/tools/gold-ledger/SpendingInsights";
import { LEDGER_SPENDING, RIVER_DAYS, change, isMoneyLedger, narrowLedger, periodStats, summarizeMoney } from "./money-ledger";

// 2026-11-12 noon UTC; the 7-day period is 11-06..11-12, the one before 10-30..11-05.
const NOW = Date.parse("2026-11-12T12:00:00Z");
const DAY = 86_400;
const at = (iso: string) => Date.parse(iso) / 1000;
const ROSTER = {
  a: { name: "Thrall", realm: "Moon Guard" },
  b: { name: "Jaina", realm: "Moon Guard" },
};
const ev = (key: string, iso: string, category: string, copper: number, extra: Record<string, unknown> = {}) => ({ key, at: at(iso), category, copper, ...extra });

function read(events: object[], sales: object[] = []) {
  return summarizeMoney([], NOW, { installId: "i", roster: ROSTER, ledger: { events, sales, daily: {} } });
}

describe("periodStats", () => {
  const ledger = read([
    ev("a", "2026-10-20T10:00:00Z", "quest", 100), // the data begins here
    ev("a", "2026-11-01T10:00:00Z", "repair", 1_000),
    ev("a", "2026-11-03T10:00:00Z", "auction_spend", 3_000),
    ev("a", "2026-11-04T10:00:00Z", "loot", 2_000),
    ev("a", "2026-11-07T10:00:00Z", "repair", 1_500),
    ev("a", "2026-11-08T10:00:00Z", "flight", 500),
    ev("b", "2026-11-12T09:00:00Z", "auction_spend", 1_000),
    ev("b", "2026-11-12T10:00:00Z", "auction", 6_000),
  ]);

  test("a period's totals, its categories by size and the same-length period before", () => {
    const week = periodStats(ledger, 7);
    expect([week.from, week.to, week.river.length]).toEqual(["2026-11-06", "2026-11-12", 7]);
    expect([week.in, week.out, week.net]).toEqual([6_000, 3_000, 3_000]);
    expect(week.previous).toEqual({ in: 2_000, out: 4_000 });
    expect(week.spending).toEqual([
      { category: "repair", copper: 1_500, previous: 1_000 },
      { category: "auction_spend", copper: 1_000, previous: 3_000 },
      { category: "flight", copper: 500, previous: 0 },
    ]);
    expect(week.income).toEqual([{ category: "auction", copper: 6_000, previous: 0 }]);
    expect(week.outPerDay).toBe(Math.round(3_000 / 7));
  });

  test("a period reaching back before the data began has nothing to compare with and averages over the days with data", () => {
    const month = periodStats(ledger, 30);
    expect(month.previous).toBeNull();
    expect(month.spending.every((c) => c.previous === null)).toBe(true);
    // 10-20 to 11-12 is 24 days.
    expect(month.outPerDay).toBe(Math.round(7_000 / 24));
    expect(periodStats(ledger, 90).previous).toBeNull();
    expect(periodStats(read([]), 30)).toMatchObject({ in: 0, out: 0, outPerDay: 0, previous: null, spending: [] });
  });

  test("the period before counts only when the data began by its first midnight", () => {
    // 7 days before 11-06..11-12 is 10-30..11-05.
    const late = read([ev("a", "2026-10-30T23:59:59Z", "quest", 1), ev("a", "2026-11-10T10:00:00Z", "repair", 5)]);
    expect(periodStats(late, 7).previous).toBeNull();
    const onTime = read([ev("a", "2026-10-30T00:00:00Z", "quest", 1), ev("a", "2026-11-10T10:00:00Z", "repair", 5)]);
    expect(periodStats(onTime, 7).previous).toEqual({ in: 1, out: 0 });
  });

  test("change is a whole percent, or null with nothing before", () => {
    expect(change(1_500, 1_000)).toBe(50);
    expect(change(1_000, 3_000)).toBe(-67);
    expect(change(500, 0)).toBeNull();
    expect(change(500, null)).toBeNull();
  });
});

describe("largest payments", () => {
  test("each period's largest single payments, largest first; transfers between the player's characters are not spending", () => {
    const ledger = read([
      ev("a", "2026-10-01T10:00:00Z", "respec", 90_000),
      ev("a", "2026-11-10T10:00:00Z", "mail_out", 50_000, { ownAlt: true }),
      ev("b", "2026-11-10T10:01:00Z", "mail_in", 50_000, { ownAlt: true }),
      ...Array.from({ length: 7 }, (_, i) => ev("a", `2026-11-0${i + 3}T10:00:00Z`, "repair", 100 * (i + 1))),
    ]);
    // Repairs on 11-03..11-09; the 7 days start 11-06.
    expect(ledger.largest[7].map((r) => r.copper)).toEqual([700, 600, 500, 400]);
    expect(ledger.largest[30].map((r) => r.copper)).toEqual([700, 600, 500, 400, 300]);
    expect(ledger.largest[90].map((r) => r.copper)).toEqual([90_000, 700, 600, 500, 400]);
    // One character alone counts its own transfer.
    expect(narrowLedger(ledger, "1:Thrall-Moon Guard").largest[7][0]).toMatchObject({ category: "mail_out", copper: 50_000 });
    expect(ledger.firstAt).toBe("2026-10-01T10:00:00Z");
  });
});

describe("auction sales", () => {
  const sale = (key: string, iso: string, itemName: string, count: number, total: number, cut: number) =>
    ({ key, at: at(iso), itemName, count, total, cut, status: "paid", unit: Math.floor(total / count) });

  test("paid sales by item with the house cut, sales waiting for their letter, per character too", () => {
    const ledger = read([], [
      sale("a", "2026-11-10T10:00:00Z", "Linen Cloth", 20, 1_900, 100),
      sale("a", "2026-11-11T10:00:00Z", "Linen Cloth", 20, 1_710, 90),
      sale("b", "2026-11-11T11:00:00Z", "Copper Ore", 5, 4_750, 250),
      sale("a", "2026-07-01T10:00:00Z", "Old Thing", 1, 9_999, 1), // older than the ledger's 90 days
      { key: "a", at: NOW / 1000 - 3600, itemName: "Silk Cloth", status: "pending" },
      { key: "a", at: NOW / 1000 - 3 * DAY, itemName: "Silk Cloth", status: "pending" }, // past 48 hours
      { key: "a", at: NOW / 1000 - 3 * DAY, itemName: "Wool Cloth", status: "unmatched" },
      { key: "zz", at: NOW / 1000 - 60, itemName: "Nobody's", count: 1, total: 5, status: "paid" },
    ]);
    expect(ledger.sales).toEqual({
      items: [
        { itemName: "Copper Ore", units: 5, total: 4_750, cut: 250, sales: 1 },
        { itemName: "Linen Cloth", units: 40, total: 3_610, cut: 190, sales: 2 },
      ],
      total: 8_360, cut: 440, sales: 3, units: 45, pending: 1, resale: [],
    });
    expect(narrowLedger(ledger, "1:Jaina-Moon Guard").sales).toMatchObject({ total: 4_750, sales: 1, pending: 0 });
  });

  test("resale sets each item's average paid against its average received after the cut, for units both bought and sold", () => {
    const ledger = read([
      ev("a", "2026-11-09T10:00:00Z", "auction_spend", 1_000, { itemName: "Linen Cloth", count: 20 }), // 50 each
      ev("a", "2026-11-09T11:00:00Z", "auction_spend", 1_200, { itemName: "Linen Cloth", count: 20 }), // 60 each
      ev("a", "2026-11-09T12:00:00Z", "auction_spend", 900, { itemName: "Copper Ore", count: 10 }), // 90 each
      ev("a", "2026-11-09T13:00:00Z", "auction_spend", 500), // no item: not resale
      ev("a", "2026-11-09T14:00:00Z", "auction_spend", 700, { itemName: "Silk Cloth" }), // no count: not resale
      ev("a", "2026-07-01T10:00:00Z", "auction_spend", 99, { itemName: "Copper Ore", count: 1 }), // before the window
    ], [
      sale("b", "2026-11-11T10:00:00Z", "Linen Cloth", 30, 2_400, 120), // 80 each after the cut, sold by another character
      sale("a", "2026-11-11T11:00:00Z", "Copper Ore", 5, 400, 20), // 80 each: a loss of 10
      sale("a", "2026-11-11T12:00:00Z", "Silk Cloth", 5, 400, 20),
    ]);
    expect(ledger.sales.resale).toEqual([
      // Average paid 2200 / 40 = 55; 30 sold and 40 bought, so 30 units count.
      { itemName: "Linen Cloth", bought: 40, paid: 2_200, sold: 30, received: 2_400, margin: 25, profit: 750 },
      { itemName: "Copper Ore", bought: 10, paid: 900, sold: 5, received: 400, margin: -10, profit: -50 },
    ]);
    // One character alone: Thrall bought the linen but did not sell it.
    expect(narrowLedger(ledger, "1:Thrall-Moon Guard").sales.resale.map((r) => r.itemName)).toEqual(["Copper Ore"]);
  });
});

test("a summary remembered before the insights (a 30-day river) is read from the file again", () => {
  const fresh = read([]);
  expect(fresh.river).toHaveLength(RIVER_DAYS);
  expect(isMoneyLedger(JSON.parse(JSON.stringify(fresh)))).toBe(true);
  expect(isMoneyLedger({ ...fresh, river: fresh.river.slice(-30) })).toBe(false);
  const { sales: _sales, ...noSales } = fresh;
  expect(isMoneyLedger(noSales)).toBe(false);
  // Edited values the page computes on are refused rather than crashing it.
  expect(isMoneyLedger({ ...fresh, firstAt: 37 })).toBe(false);
  expect(isMoneyLedger({ ...fresh, firstAt: "not a time" })).toBe(false);
  expect(isMoneyLedger({ ...fresh, sales: { ...fresh.sales, cut: "x" } })).toBe(false);
  expect(isMoneyLedger({ ...fresh, river: fresh.river.map((d, i) => (i ? d : { ...d, out: "1" })) })).toBe(false);
  const withOne = read([ev("a", "2026-11-10T10:00:00Z", "repair", 5)]);
  const key = Object.keys(withOne.byCharacter)[0]!;
  expect(isMoneyLedger(withOne)).toBe(true);
  expect(isMoneyLedger({ ...withOne, byCharacter: { [key]: { ...withOne.byCharacter[key], largest: {} } } })).toBe(false);
});

test("a stacked column never grows past its height: gaps go first, then the heights share what is left", () => {
  const nine = Object.keys(SPENDING_COLOR).map((category) => ({ category, copper: 1 }));
  const tiny = stack(nine, 2);
  expect(tiny.reduce((n, p) => n + p.px + p.gap, 0)).toBeCloseTo(2);
  expect(tiny.every((p) => p.gap === 0)).toBe(true);
  const tall = stack([{ category: "repair", copper: 3 }, { category: "flight", copper: 1 }], 100);
  expect(tall).toEqual([{ category: "repair", px: 73.5, gap: 2 }, { category: "flight", px: 24.5, gap: 0 }]);
  expect(stack([], 50)).toEqual([]);
});

test("every spending category the addon writes has its own chart colour", () => {
  expect(Object.keys(SPENDING_COLOR).sort()).toEqual([...LEDGER_SPENDING].sort());
  expect(new Set(Object.values(SPENDING_COLOR)).size).toBe(LEDGER_SPENDING.length);
});
