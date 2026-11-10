import { expect, test } from "vitest";
import { indexLedger, reportAt } from "../src/main/reports";

const now = Date.parse("2026-11-10T12:00:00Z");
const event = (date: string, category = "auction", copper = 100, key = "a", extra = {}) => ({ at: Date.parse(date) / 1000, category, copper, key, ...extra });
const local = (events: unknown[], sales: unknown[] = []) => ({ roster: { a: { name: "One", realm: "Realm" }, b: { name: "Two", realm: "Realm" } }, ledger: { events, sales } });
const files = (events: unknown[], sales: unknown[] = []) => [{ account: "A", index: indexLedger(local(events, sales)) }];

test.each([7, 14, 30, 90] as const)("%i days includes today and whole UTC days, excluding future rows", (period) => {
  const start = Date.parse("2026-11-10T00:00:00Z") - (period - 1) * 86400000;
  const f = files([event(new Date(start - 1000).toISOString()), event(new Date(start).toISOString()), event("2026-11-10T12:00:01Z")]);
  const r = reportAt(f, { period }, now);
  expect(r.days).toHaveLength(period);
  expect(r.total).toBe(100);
  expect(r.rows[0].previous).toBe(period === 90 ? 0 : 100);
  expect(r.rows[0].change).toBe(period === 90 ? null : 0);
});

test("accounts and character keys remain distinct; transfers net only for multiple selected characters", () => {
  const index = indexLedger(local([event("2026-11-10", "mail_out", 50, "a", { ownAlt: true }), event("2026-11-10", "loot", 100, "b")]));
  const f = [{ account: "A", index }, { account: "B", index }];
  expect(reportAt(f, {}, now).total).toBe(200);
  expect(reportAt(f, { account: "B" }, now).total).toBe(100);
  expect(reportAt(f, { account: "B", character: "a" }, now).total).toBe(-50);
});

test("paid sales use their totals and units, purchases and expenses use events; cumulative sums daily values", () => {
  const f = files([event("2026-11-09", "auction", 400), event("2026-11-10", "auction_spend", 100, "a", { itemName: "Ore", count: 2 }), event("2026-11-10", "repair", 50)], [
    { at: Date.parse("2026-11-09") / 1000, key: "a", status: "paid", itemName: "Ore", count: 4, total: 400 },
    { at: Date.parse("2026-11-10") / 1000, key: "a", status: "pending", itemName: "Ore" },
  ]);
  const sales = reportAt(f, { metric: "sales", item: "Ore" }, now);
  expect(sales.rows[0]).toMatchObject({ units: 4, total: 400, average: 100, change: null });
  expect(reportAt(f, { metric: "purchases" }, now).total).toBe(100);
  expect(reportAt(f, { metric: "expenses" }, now).categories).toEqual([{ category: "auction_spend", total: 100 }, { category: "repair", total: 50 }]);
  expect(reportAt(f, { cumulative: true }, now).days.slice(-2).map(d => d.total)).toEqual([400, 250]);
  expect(reportAt(f, { period: "all" }, now).days).toHaveLength(2);
  expect(reportAt(f, { period: "all" }, now).previousComplete).toBe(false);
});

test("previous period includes disappeared items and uses absolute previous total for negative profit", () => {
  const r = reportAt(files([event("2026-10-31", "vendor_spend", 100, "a", { itemName: "Ore", count: 2 }), event("2026-11-10", "vendor", 50, "a", { itemName: "Ore", count: 1 }), event("2026-10-31", "vendor", 30, "a", { itemName: "Old", count: 1 })]), { period: 7 }, now);
  expect(r.rows.find(x => x.item === "Ore")?.change).toBe(150);
  expect(r.rows.find(x => x.item === "Old")).toMatchObject({ total: 0, previous: 30, change: -100 });
});

test("missing ledger and malformed rows are safe", () => {
  expect(reportAt([{ account: "A", index: indexLedger({}) }], {}, now).hasLedger).toBe(false);
  expect(indexLedger(local([null, { at: Infinity }, event("2026-11-10", "loot", -1)])).buckets).toEqual([]);
});

test("previous period includes its UTC start and ends before the current period", () => {
  const f = files([event("2026-10-28T00:00:00Z", "vendor", 100, "a", { itemName: "Ore", count: 1 }), event("2026-11-03T23:59:59Z", "vendor", 100, "a", { itemName: "Ore", count: 1 }), event("2026-11-04T00:00:00Z", "vendor", 300, "a", { itemName: "Ore", count: 3 })]);
  const r = reportAt(f, { period: 7 }, now);
  expect(r.previousComplete).toBe(true);
  expect(r.rows[0]).toMatchObject({ previous: 200, total: 300, change: 50, units: 3, average: 100 });
});

test("both own-alt transfer legs disappear from multi-character spending and profit", () => {
  const f = files([event("2026-11-10", "mail_out", 50, "a", { ownAlt: true }), event("2026-11-10", "mail_in", 50, "b", { ownAlt: true })]);
  expect(reportAt(f, {}, now).rows).toEqual([]);
  expect(reportAt(f, { metric: "expenses" }, now).total).toBe(0);
  expect(reportAt(f, { account: "A", character: "b" }, now).total).toBe(50);
});

test("previous period completeness follows the selected scope's own records, not each file's first record", () => {
  const old = indexLedger(local([event("2026-10-28T00:00:00Z", "vendor", 100, "a"), event("2026-11-08T00:00:00Z", "vendor", 100, "a")]));
  const recent = indexLedger(local([event("2026-11-08T00:00:00Z", "vendor", 100, "a")]));
  const f = [{ account: "Old", index: old }, { account: "Recent", index: recent }];
  expect(reportAt(f, { period: 7 }, now).previousComplete).toBe(true);
  expect(reportAt(f, { period: 7, account: "Old" }, now).previousComplete).toBe(true);
  expect(reportAt(f, { period: 7, account: "Recent" }, now).previousComplete).toBe(false);
  expect(reportAt(f, { period: 7, account: "Recent", character: "b" }, now).previousComplete).toBe(false);
});
