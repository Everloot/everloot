import { describe, expect, test } from "vitest";
import { parseEverlootLua } from "./sv-parse";
import { HISTORY_POINTS, RIVER_DAYS, categoryLabel, directionOf, isMoneyLedger, summarizeMoney, thin } from "./money-ledger";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const gold = (character: string, capturedAt: string, currentCopper: number, peakCopper = currentCopper) =>
  ({ kind: "gold_snapshot", installId: "i", capturedAt, character, realm: "Moon Guard", currentCopper, peakCopper });
const money = (character: string, capturedAt: string, category: string, copper: number) =>
  ({ kind: "money_event", installId: "i", capturedAt, character, realm: "Moon Guard", category, copper });

const RECORDS = [
  gold("Thrall", "2026-10-20T10:00:00Z", 50_000, 80_000),
  gold("Thrall", "2026-10-23T10:00:00Z", 125_000, 125_000),
  gold("Thrall", "2026-10-22T10:00:00Z", 90_000, 90_000), // out of order: the newest still wins
  gold("Jaina", "2026-10-24T08:00:00Z", 2_000_000, 2_500_000),
  money("Thrall", "2026-10-24T09:00:00Z", "loot", 1_500),
  money("Thrall", "2026-10-24T09:30:00Z", "vendor", 300),
  money("Thrall", "2026-10-20T09:30:00Z", "quest", 10_000),
  money("Jaina", "2026-10-22T09:30:00Z", "auction_spend", 40_000),
  money("Jaina", "2026-10-10T09:30:00Z", "auction", 5_000), // in the river, not the week
  money("Jaina", "2026-08-01T09:30:00Z", "flight", 200), // only in the totals
  money("Jaina", "2026-10-25T09:30:00Z", "loot", 999), // after now: never counted in a day
  { kind: "npc_sighting", installId: "i", capturedAt: "2026-10-24T09:00:00Z", npcId: 1 },
];

describe("summarizeMoney", () => {
  const ledger = summarizeMoney(RECORDS, NOW);

  test("the roster has each character's newest gold and highest peak, richest first", () => {
    expect(ledger.roster).toEqual([
      { character: "Jaina", realm: "Moon Guard", copper: 2_000_000, peakCopper: 2_500_000, at: "2026-10-24T08:00:00Z" },
      { character: "Thrall", realm: "Moon Guard", copper: 125_000, peakCopper: 125_000, at: "2026-10-23T10:00:00Z" },
    ]);
  });

  test("the river is the last 30 UTC days, today last, money in and out per category", () => {
    expect(ledger.river).toHaveLength(RIVER_DAYS);
    expect(ledger.river[0]!.date).toBe("2026-09-25");
    expect(ledger.river.at(-1)).toEqual({ date: "2026-10-24", in: 1_800, out: 0, byCategory: { loot: 1_500, vendor: 300 } });
    expect(ledger.river.find((d) => d.date === "2026-10-22")).toMatchObject({ in: 0, out: 40_000 });
    expect(ledger.river.find((d) => d.date === "2026-10-10")).toMatchObject({ in: 5_000, out: 0 });
    expect(ledger.river.reduce((s, d) => s + d.in, 0)).toBe(16_800);
  });

  test("the week is the last 7 days", () => {
    expect(ledger.week).toEqual({ in: 11_800, out: 40_000, net: -28_200 });
  });

  test("category totals hold every event the file carries, with no category added", () => {
    expect(ledger.categories.map((c) => [c.category, c.direction, c.copper, c.events])).toEqual([
      ["auction_spend", "out", 40_000, 1],
      ["quest", "in", 10_000, 1],
      ["auction", "in", 5_000, 1],
      ["loot", "in", 2_499, 2],
      ["vendor", "in", 300, 1],
      ["flight", "out", 200, 1],
    ]);
  });

  test("receipts are the money events, newest first", () => {
    expect(ledger.eventCount).toBe(7);
    expect(ledger.receipts[0]).toEqual({ at: "2026-10-25T09:30:00Z", character: "Jaina", realm: "Moon Guard", category: "loot", direction: "in", copper: 999 });
    expect(ledger.receipts.map((r) => r.at)).toEqual([...ledger.receipts.map((r) => r.at)].sort().reverse());
  });

  test("gold history per character, oldest first", () => {
    expect(ledger.history.map((s) => [s.character, s.points.map((p) => p.copper)])).toEqual([
      ["Jaina", [2_000_000]],
      ["Thrall", [50_000, 90_000, 125_000]],
    ]);
  });

  test("a file with no money records is an empty ledger, not zeros made up", () => {
    const empty = summarizeMoney([], NOW);
    expect(empty.roster).toEqual([]);
    expect(empty.categories).toEqual([]);
    expect(empty.receipts).toEqual([]);
    expect(empty.week).toEqual({ in: 0, out: 0, net: 0 });
  });

  test("a character with money events but no snapshot shows with unrecorded gold", () => {
    expect(summarizeMoney([money("Anduin", "2026-10-24T09:00:00Z", "loot", 5)], NOW).roster).toEqual([
      { character: "Anduin", realm: "Moon Guard", copper: null, peakCopper: null, at: null },
    ]);
  });

  test("the summary survives a round trip through JSON (what Remember stores)", () => {
    const back = JSON.parse(JSON.stringify(ledger));
    expect(isMoneyLedger(back)).toBe(true);
    expect(back).toEqual(ledger);
    expect(isMoneyLedger({ roster: [] })).toBe(false);
    expect(isMoneyLedger(null)).toBe(false);
  });
});

test("reads the records the browser parser gives for an Everloot.lua", () => {
  const lua = `EverlootDB = {
    ["version"] = "0.2.6",
    ["installId"] = "abc",
    ["records"] = {
      ["gold_snapshot"] = {
        { ["capturedAt"] = "2026-10-24T08:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["currentCopper"] = 12345, ["peakCopper"] = 20000 },
      },
      ["money_event"] = {
        { ["capturedAt"] = "2026-10-24T09:00:00Z", ["character"] = "Thrall", ["realm"] = "Moon Guard", ["category"] = "quest", ["copper"] = 700 },
      },
    },
  }`;
  const ledger = summarizeMoney(parseEverlootLua(lua).records, NOW);
  expect(ledger.roster[0]).toMatchObject({ character: "Thrall", copper: 12_345, peakCopper: 20_000 });
  expect(ledger.week).toEqual({ in: 700, out: 0, net: 700 });
});

test("in and out follow the server ledger: vendor sales are money in", () => {
  expect(["flight", "postage", "barber", "respec", "auction_spend"].map(directionOf)).toEqual(Array(5).fill("out"));
  expect(["loot", "quest", "vendor", "auction"].map(directionOf)).toEqual(["in", "in", "in", "in"]);
  expect(categoryLabel("auction_spend")).toBe("auction spend");
});

test("thin keeps the first and last point", () => {
  const points = Array.from({ length: 200 }, (_, i) => i);
  const kept = thin(points);
  expect(kept).toHaveLength(HISTORY_POINTS);
  expect(kept[0]).toBe(0);
  expect(kept.at(-1)).toBe(199);
});
