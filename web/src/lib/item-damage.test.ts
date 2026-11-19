import { expect, test, vi } from "vitest";
import { loadItemTips, parseSiteManifest } from "./game-assets";
import { itemIndex, memoryStore, siteManifest } from "./game-assets.fixture";

// A made-up check of the Cutlass: no weapon has been read off the game's tooltip yet. With it in the list, the range
// reaches the tooltip only if the shard's damage inputs survive the shard reader.
vi.mock("@kb/assets/weapon-damage", async (original) => ({
  ...(await original<typeof import("@kb/assets/weapon-damage")>()),
  CHECKED_WEAPONS: [{
    id: 851, n: "Cutlass", l: 15, q: 1, d: 2200, w: { t: "ItemDamageOneHand", dps: 6.957369327545166, dv: 0.6000000238418579, ds: 0 },
    game: { min: 10, max: 20 }, seen: "2026-11-04", build: "1.60.1.99999",
  }],
}));

const BASE = "https://assets.example.test/wow_classic_beta-70450-84bea423";
const FOLDER = "wow_classic_beta-70450-84bea423";

test("the damage inputs in an item shard reach the tooltip through the shard reader", async () => {
  const cutlass = {
    n: "Cutlass", q: 1, l: 15, r: 10, b: 2, s: 13, c: 2, sc: 7, d: 2200, st: [], sp: 0, u: 0, cr: [], rq: [], fx: [],
    w: { t: "ItemDamageOneHand", dps: 6.957369327545166, dv: 0.6000000238418579, ds: 0 },
  };
  const store = memoryStore({ [`${FOLDER}/items.json`]: { ...itemIndex, shards: { ...itemIndex.shards, "1": { file: "items/1.json" } } }, [`${FOLDER}/items/1.json`]: { "851": cutlass } });
  const tips = await loadItemTips(parseSiteManifest(siteManifest, BASE)!, [851], store);
  expect(tips.get(851)?.lines).toContain("10 - 20 Damage · Speed 2.20");
  expect(tips.get(851)?.why[0]).toMatch(/^10 - 20 Damage: worked out from the game files \(ItemDamageOneHand/);
});
