import { expect, test } from "vitest";
import { readSaleLedger, saleCycles } from "./sale-cycles";

const day = 86400;
const now = Date.parse("2026-11-28T12:00:00Z") / 1000;
const reset = now - 3 * day;

test("reads the game file as data and ranks paid auctions in all three cycles", () => {
  const ledger = readSaleLedger(`EverlootDB = {
    ["ledger"] = {
      ["auctionReset"] = { ["start"] = ${reset}, ["next"] = ${reset + 7 * day} },
      ["sales"] = {
        { ["itemName"] = "Ore", ["at"] = ${now - 8 * day}, ["status"] = "paid", ["total"] = 50 },
        { ["itemName"] = "Cloth", ["at"] = ${now - 4 * day}, ["status"] = "unmatched" },
        { ["itemName"] = "Cloth", ["at"] = ${now - 2 * day}, ["status"] = "pending" },
        { ["itemName"] = "Cloth", ["at"] = ${now - day}, ["status"] = "paid", ["total"] = 50, ["noticeAt"] = ${now - day} },
        { ["itemName"] = "Cloth", ["at"] = ${now}, ["status"] = "paid", ["total"] = 50 },
        { ["itemName"] = "Future", ["at"] = ${now + 1}, ["status"] = "paid", ["total"] = 50 },
      },
    },
  }`);
  const report = saleCycles(ledger, now);
  const cloth = { itemName: "Cloth", sales: 2, total: 100 };
  expect(report.rank.day).toEqual([cloth]);
  expect(report.rank.week).toEqual([cloth]);
  expect(report.rank.month).toEqual([cloth, { itemName: "Ore", sales: 1, total: 50 }]);
  expect(report.peak).toEqual({ hour: 12, notices: 3, days: 3 });
  expect(saleCycles(ledger, now, "Cloth").peak).toEqual(report.peak);
  expect(saleCycles(ledger, now, "Ore").peak).toBeNull();
  expect(saleCycles(ledger, reset + 7 * day).start.week).toBeNull();
});

test("rejects executable text and accepts an older save with an empty ledger", () => {
  expect(() => readSaleLedger('EverlootDB = {} print("bad")')).toThrow();
  expect(saleCycles(readSaleLedger("EverlootDB = {}"), now).rank.month).toEqual([]);
});
