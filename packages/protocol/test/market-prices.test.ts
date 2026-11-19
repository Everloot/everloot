import { expect, test } from "vitest";
import { MARKET_PRICE_FIELDS, MARKET_PRICE_FIELDS_FULL, marketPricesResponse } from "../src/api.js";

const attribution = {
  licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/", credit: "Data from Everloot (https://everloot.app), CC BY-SA 4.0.",
  source: "https://everloot.app/tools/auctions", terms: "https://everloot.app/docs/api/terms",
};
const base = { ok: true, dataAsOf: "2026-10-20T06:30:00.000Z", rule: "A day is public when 3 reporters scanned it.", realm: "Forever", house: "Horde", attribution };
const seven = [2589, 205, 200, 190, 40, "2026-10-20", 3];
const thin = [765, null, 30, 33, 5, "2026-10-05", 4];

test("the default answer is seven positions a row, a thin item's market null", () => {
  expect(MARKET_PRICE_FIELDS).toHaveLength(7);
  const parsed = marketPricesResponse.parse({ ...base, fields: [...MARKET_PRICE_FIELDS], items: [seven, thin] });
  expect(parsed.items).toEqual([seven, thin]);
});

test("fields=full answers ten positions a row, the seven first and then updatedAt, ageDays and change1d", () => {
  expect(MARKET_PRICE_FIELDS_FULL).toEqual([...MARKET_PRICE_FIELDS, "updatedAt", "ageDays", "change1d"]);
  const items = [[...seven, "2026-10-20T10:00:00.000Z", 0, 0.1], [...thin, null, 15, null]];
  expect(marketPricesResponse.parse({ ...base, fields: [...MARKET_PRICE_FIELDS_FULL], items }).items).toEqual(items);
});

test("fields and rows are 7 or 10 wide, alike; anything else is refused", () => {
  const bad = [
    { fields: [...MARKET_PRICE_FIELDS], items: [[...seven, "2026-10-20T10:00:00.000Z", 0, 0.1]] },
    { fields: [...MARKET_PRICE_FIELDS_FULL], items: [seven] },
    { fields: [...MARKET_PRICE_FIELDS, "updatedAt"], items: [[...seven, null]] },
    { fields: [...MARKET_PRICE_FIELDS_FULL], items: [[...seven, "not a time", 0, 0.1]] },
    { fields: [...MARKET_PRICE_FIELDS_FULL], items: [[...seven, null, -1, null]] },
    { fields: [...MARKET_PRICE_FIELDS_FULL.slice(0, 7), "ageDays", "updatedAt", "change1d"], items: [[...seven, null, 0, null]] },
  ];
  for (const body of bad) expect(() => marketPricesResponse.parse({ ...base, ...body }), JSON.stringify(body)).toThrow();
});
