import { expect, test, vi } from "vitest";
import { emptyMarket, foldMarket } from "../src/market.js";
import { answerMarketValue, MARKET_UNSET } from "../src/mcp-server.js";

const now = new Date();
const scans = ["a-install", "b-install", "c-install"].map((installId, i) => ({
  kind: "auction_snapshot", installId, eventId: `e:${i}`, capturedAt: now.toISOString(), realm: "Forever",
  scanId: `s-${i}`, part: 1, parts: 1, items: [[2589, 2, 40, 100, 110]],
}));

test("market_value answers from the site's rollup with its data age", async () => {
  const loader = vi.fn(async () => ({ state: foldMarket(emptyMarket(), scans, now), dataAsOf: "2026-10-20T06:30:00.000Z" }));
  const text = await answerMarketValue({ realm: "Forever", itemId: 2589 }, loader);
  expect(text).toContain("Market value: 1s 10c");
  expect(text).toContain("3 reporters");
  expect(text.endsWith("Data as of 2026-10-20 06:30 UTC.")).toBe(true);
});

test("an unreadable rollup is unavailable, and no loader says it is not connected", async () => {
  expect(await answerMarketValue({ realm: "Forever", itemId: 2589 }, async () => null)).toMatch(/unavailable/i);
  expect(await answerMarketValue({ realm: "Forever", itemId: 2589 })).toBe(MARKET_UNSET);
  expect(MARKET_UNSET).toContain("not a measured zero");
});
