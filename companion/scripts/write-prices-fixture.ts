/**
 * Regenerates addon/tests/fixtures/EverlootPrices.lua: npx tsx scripts/write-prices-fixture.ts
 * The companion test pins its output to this file; addon/tests/market_contract.py loads it in Lua 5.1.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { renderPricesAddon, type DropSources, type ItemSources, type RealmPrices } from "../src/prices";

const HOSTILE = 'x"] = 1 } os.execute("calc") --[[\n]]\\\0\r\t';

export const FIXTURE_REALMS: RealmPrices[] = [
  {
    realm: "Forever", house: "Alliance", dataAsOf: "2026-10-20T06:30:00.000Z",
    items: [[2589, 205, 200, 190, 40, "2026-10-20", 3], [765, null, 30, 33, 900, "2026-10-05", 4]],
  },
  // The Horde house of the same realm is its own market, at its own price.
  { realm: "Forever", house: "Horde", dataAsOf: "2026-10-20T06:30:00.000Z", items: [[2589, 900, 880, 850, 12, "2026-10-20", 3], [765, null, 30, 33, 900, "2026-10-05", 4]] },
  { realm: HOSTILE, house: "Alliance", dataAsOf: "2026-10-20T06:30:00.000Z", items: [[1, 1, 1, 1, 1, "2026-10-20", 3]] },
];

/** Linen (2589) from four NPCs, out of order so the writer sorts them; ore (2770) from an object; 12345 has a drop and no price. */
export const FIXTURE_DROPS: DropSources = {
  dataAsOf: "2026-10-20T06:00:00.000Z", fetchedAt: "2026-10-20T06:30:00.000Z",
  rows: [[2589, "n", 94, 12, 200, 3], [2770, "o", 1731, 300, 310, 6], [2589, "n", 116, 42, 340, 5], [12345, "n", 61, 1, 80, 3],
    [2589, "n", 6, 1, 90, 3], [2589, "n", 474, 5, 120, 4]],
  // Names the site knows; 474 and 61 have none. 94's name tries to break out of the string and the tooltip's colours.
  names: { n116: "Defias Bandit", o1731: "Copper Vein", n94: 'Bad "|cffff0000Name|r"\nn6=Forged', n6: "Kobold Vermin", n9999: "Not In Any Row" },
};

/** Linen (2589) sold by two public vendors (one named) and a reagent of 7 recipes, with a second row the writer drops; the herb (765) a reagent only. */
export const FIXTURE_SOURCES: ItemSources = {
  dataAsOf: "2026-10-20T06:00:00.000Z", fetchedAt: "2026-10-20T06:30:00.000Z",
  rows: [[765, [], 2], [2589, [5678, 1234], 7], [2589, [999], 1]],
  names: { n1234: "Fixture Supplier", n999: "Not In Any Row" },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(new URL("../../addon/tests/fixtures/EverlootPrices.lua", import.meta.url), renderPricesAddon(FIXTURE_REALMS, FIXTURE_DROPS, FIXTURE_SOURCES).lua);
}
