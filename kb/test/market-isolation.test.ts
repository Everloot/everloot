import { expect, test } from "vitest";
import { emptyMarket, foldMarket, itemMarket, marketPrices } from "../src/market.js";

const now = new Date("2026-11-10T12:00:00Z");
const realm = "CAMWOW US1 Realm 4 PVP";
const scans = (name: string, house: string, price: number) => [0, 1, 2].map((n) => ({
  kind: "auction_snapshot", installId: `install-${house}-${n}`, capturedAt: now.toISOString(),
  realm: name, faction: house === "Neutral" ? "Alliance" : house, house,
  items: [[2589, 2, 40, price, price]],
}));

test("full realm names isolate region and every ruleset, even for the same install and item", () => {
  const names = ["PVE", "PVP", "RP", "RPPVP", "Hardcore"].map((s) => `CAMWOW US1 Realm 4 ${s}`);
  names.push("CAMWOW EU1 Realm 4 PVP");
  const state = foldMarket(emptyMarket(), names.flatMap((name, i) => scans(name, "Alliance", 100 + i)), now);
  names.forEach((name, i) => {
    expect(marketPrices(state, name.toLowerCase(), now, 2000, "Alliance").items[0]?.[1]).toBe(100 + i);
  });
  expect(itemMarket(state, "CAMWOW US1 Realm 4", 2589, now, "Alliance").value).toBeNull();
});

test("explicit house queries isolate both factions and neutral, including scanner faction at a neutral house", () => {
  const state = foldMarket(emptyMarket(), [
    ...scans(realm, "Alliance", 100), ...scans(realm, "Horde", 900), ...scans(realm, "Neutral", 500),
  ], now);
  for (const [house, price] of [["Alliance", 100], ["Horde", 900], ["Neutral", 500]] as const) {
    expect(itemMarket(state, realm, 2589, now, house).value?.market).toBe(price);
  }
});

test("reporters in different houses cannot jointly publish a house price", () => {
  const state = foldMarket(emptyMarket(), [scans(realm, "Alliance", 100)[0], ...scans(realm, "Horde", 900).slice(1)], now);
  expect(itemMarket(state, realm, 2589, now, "Alliance").value).toBeNull();
  expect(itemMarket(state, realm, 2589, now, "Horde").value).toBeNull();
});

test("a realm-only query never publishes agreement pooled across houses", () => {
  const state = foldMarket(emptyMarket(), [scans(realm, "Alliance", 100)[0], ...scans(realm, "Horde", 900).slice(1)], now);
  expect(itemMarket(state, realm, 2589, now).value).toBeNull();
});
