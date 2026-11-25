import { expect, test } from "vitest";
import { ahledgerCredit, craftingAsOf, craftingMargins, dealPrices, economyMarkets, priceHistory, upstreamCacheHeaders, AHLEDGER_PROFESSIONS } from "./ahledger";
import { CLIENT_PROFESSIONS } from "./professions";

test("credit accepts only AH Ledger's HTTPS host", () => {
  expect(ahledgerCredit({ attribution: { url: "https://ahledger.com/items/42" } }).url).toBe("https://ahledger.com/items/42");
  for (const url of ["https://ahledger.com.evil.test", "https://evil.test", "javascript:alert(1)", "http://ahledger.com", "https://user:pass@ahledger.com"]) {
    expect(ahledgerCredit({ attribution: { url } }).url).toBe("https://ahledger.com");
  }
});

test("private browser lifetimes never enter a shared cache; public edge lifetime uses s-maxage only", () => {
  expect(upstreamCacheHeaders("private, max-age=60")).toEqual({ "Cache-Control": "private, max-age=60" });
  expect(upstreamCacheHeaders("public, max-age=300, s-maxage=600")).toEqual({ "Cache-Control": "public, max-age=300", "CDN-Cache-Control": "max-age=600" });
  expect(upstreamCacheHeaders("public, max-age=300")).toEqual({ "Cache-Control": "public, max-age=300" });
  for (const header of [null, "private", "public, no-cache, max-age=30", "public, no-store, max-age=30"]) expect(upstreamCacheHeaders(header)).toEqual({ "Cache-Control": "no-store" });
});

test("history selects finite price fields and dated points; notices and malformed answers fail", () => {
  expect(priceHistory({ latest: { median7d: 12, median30d: 15, secret: 99 }, sales: { estimatedPerDay: 2, windowDays: 7 }, series: [{ t: "2026-11-15T00:00:00Z", min: 10, median: 12, p25: 11, p75: 13, quantity: 99 }, null, { t: "bad" }] })).toEqual({ median7d: 12, median30d: 15, salesPerDay: 2, windowDays: 7, series: [{ t: "2026-11-15T00:00:00Z", min: 10, median: 12, p25: 11, p75: 13 }] });
  for (const body of [null, {}, { notice: "key required" }]) expect(() => priceHistory(body)).toThrow();
  expect(priceHistory({ latest: { median7d: Infinity, median30d: "15" }, sales: {}, series: [] })).toEqual({ median7d: null, median30d: null, salesPerDay: null, windowDays: null, series: [] });
});

test("crafts use nested recipe ids, preserve unpriced costs and sort by daily profit, unknown last", () => {
  const row = (spellId: number, cost: number | null, profitPerDay: number | null) => ({ recipe: { spellId, name: `Test recipe ${spellId}` }, cost, netValue: 20, margin: cost === null ? null : 10, resultSalesPerDay: 3, profitPerDay, reagents: [] });
  const rows = craftingMargins({ recipes: [row(1, null, null), row(2, 10, -5), row(3, 10, 30), null] });
  expect(rows.map((r) => r.spellId)).toEqual([3, 2, 1]);
  expect(rows[2].cost).toBeNull();
  expect(rows[0]).not.toHaveProperty("reagents");
  expect(AHLEDGER_PROFESSIONS.every((name) => CLIENT_PROFESSIONS.some((p) => p.name === name))).toBe(true);
  expect(AHLEDGER_PROFESSIONS).not.toContain("Fishing");
});

test("crafts carry AH Ledger's required skill, and an answer's prices-as-of time only when it is a date", () => {
  const rows = craftingMargins({ recipes: [{ recipe: { spellId: 7, name: "Test recipe 7", skillRequired: 235 } }, { recipe: { spellId: 8, skillRequired: "235" } }] });
  expect(rows.map((r) => r.skill)).toEqual([235, null]);
  expect(craftingAsOf({ pricesAsOf: "2026-11-24T05:45:44.000Z", recipes: [] })).toBe("2026-11-24T05:45:44.000Z");
  for (const body of [null, {}, { pricesAsOf: "soon" }, { pricesAsOf: 1 }]) expect(craftingAsOf(body)).toBeNull();
});

test("deals keep their reference basis and sort savings; economy selects listed values only", () => {
  expect(dealPrices({ deals: [{ item: { id: 42, name: "Test item" }, saving: 50, minBuyout: 2, referenceMedian: 5, basis: "7d", quantity: 30 }, { item: { id: 43 }, saving: 100 }] }).map((r) => r.itemId)).toEqual([43, 42]);
  expect(economyMarkets({ markets: [{ market: "forever.pvp.horde.us", current: { value: 100, units: 50 }, weekAgo: { value: 70 } }, { market: "bad" }, null] })).toEqual([{ market: "forever.pvp.horde.us", current: 100, weekAgo: 70 }]);
  expect(craftingMargins({ recipes: [] })).toEqual([]);
  expect(dealPrices({ deals: [] })).toEqual([]);
  expect(economyMarkets({ markets: [] })).toEqual([]);
});
