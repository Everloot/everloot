import { ITEM_FACTS } from "@everloot/protocol";
import { expect, test } from "vitest";
import type { ItemRecord } from "../../../kb/src/assets/items";
import type { CheckedWeapon } from "../../../kb/src/assets/weapon-damage";
import type { ReportedFact } from "../../../kb/src/item-facts";
import { shard0 } from "./game-assets.fixture";
import { factLine, itemTipText, withReported, WHY } from "./item-names";

const fact = (f: Partial<ReportedFact> & Pick<ReportedFact, "fact" | "value">): ReportedFact =>
  ({ reporters: 3, build: "1.60.1.70450", lastSeen: "2026-11-05T12:00:00.000Z", ...f });

test("each placeholder the files print is the line a reported number fills", () => {
  // Item 25 is a sword with Stamina and Strength; the same record as plate armour carries the armour line.
  const sword = itemTipText(shard0["25"]);
  for (const line of [factLine("damage_per_second", null), factLine("stamina", null), factLine("strength", null)]) expect(sword.lines).toContain(line);
  expect(itemTipText({ ...shard0["9"], c: 4, sc: 4, s: 1 }).lines).toContain(factLine("armor", null));
  expect([factLine("armor", 103), factLine("stamina", 5), factLine("spirit", -2), factLine("damage_per_second", 12), factLine("fire_resistance", 10)])
    .toEqual(["103 Armor", "+5 Stamina", "-2 Spirit", "(12.0 damage per second)", "+10 Fire Resistance"]);
  for (const f of ITEM_FACTS) expect(factLine(f, null)).toContain("[?]");
});

test("agreed numbers replace their placeholders, the reasons that no longer apply go, and each number says who and when", () => {
  const sword = itemTipText(shard0["25"]);
  const filled = withReported(sword, { shown: [fact({ fact: "damage_per_second", value: 12.4 }), fact({ fact: "stamina", value: 5 }), fact({ fact: "strength", value: 3, reporters: 7, lastSeen: null })], contested: [] });
  expect(filled.lines).toEqual(["Binds when equipped", "Unique", "One-Hand · Sword", "[?] - [?] Damage · Speed 1.90", "(12.4 damage per second)", "+5 Stamina", "+3 Strength", "Requires Level 5", "Item Level 2", '"Old."', "Sell Price: 7c"]);
  expect(filled.why).toEqual([
    WHY.damage,
    "12.4 damage per second: reported by 3 installs, last seen 2026-11-05, build 1.60.1.70450.",
    "+5 Stamina: reported by 3 installs, last seen 2026-11-05, build 1.60.1.70450.",
    "+3 Strength: reported by 7 installs, last seen [?], build 1.60.1.70450.",
  ]);
  // The damage range is still unknown, so the tooltip is still partial.
  expect(filled.partial).toBe(true);
  // Untouched when nothing is reported, and the record's own tooltip is not changed in place.
  expect(withReported(sword, { shown: [], contested: [] })).toBe(sword);
  expect(sword.lines).toContain("+[?] Stamina");
});

test("a line the files did not print goes where the game prints it; a contested line keeps its [?] and says why", () => {
  const shield = itemTipText({ ...shard0["9"], c: 4, sc: 6, s: 14, st: [7, 6], r: 20 });
  expect(shield.lines.slice(0, 4)).toEqual(["Off Hand · Shield", "[?] Armor", "+[?] Stamina", "+[?] Spirit"]);
  const got = withReported(shield, {
    shown: [fact({ fact: "armor", value: 300 }), fact({ fact: "block", value: 6 }), fact({ fact: "stamina", value: 4 }), fact({ fact: "shadow_resistance", value: 5 })],
    contested: ["spirit", "fire_resistance"],
  });
  expect(got.lines.slice(0, 7)).toEqual(["Off Hand · Shield", "300 Armor", "6 Block", "+4 Stamina", "+[?] Spirit", "+5 Shadow Resistance", "Requires Level 20"]);
  // Spirit is still a placeholder, so its reason stays; armour's goes. Fire resistance has no line to explain.
  expect(got.why.slice(0, 2)).toEqual([WHY.stats, "[?] Spirit: installs disagree on the number, so none is shown until 3 agree on one."]);
  expect(got.why).not.toContain(WHY.armor);
  expect(got.partial).toBe(true);
  const settled = withReported(shield, { shown: [fact({ fact: "armor", value: 300 }), fact({ fact: "stamina", value: 4 }), fact({ fact: "spirit", value: -1 })], contested: [] });
  expect(settled.lines).toContain("-1 Spirit");
  expect(settled.why.filter((w) => w.startsWith("[?]"))).toEqual([]);
  expect(settled.partial).toBe(false);
});

// The Cutlass (851) as build 1.60.1.70450's shard holds it. The checks are made up: no weapon has been read off the game yet.
const cutlass: ItemRecord = {
  n: "Cutlass", q: 1, l: 15, r: 10, b: 2, s: 13, c: 2, sc: 7, d: 2200, st: [], sp: 0, u: 0, cr: [], rq: [], fx: [],
  w: { t: "ItemDamageOneHand", dps: 6.957369327545166, dv: 0.6000000238418579, ds: 0 },
};
const check = (r: ItemRecord, id: number, game: { min: number; max: number }): CheckedWeapon =>
  ({ id, n: r.n, l: r.l, q: r.q, d: r.d, w: r.w!, game, seen: "2026-11-04", build: "1.60.1.99999" });

test("a weapon's damage stays [?] with its reason while no weapon has been checked in the game", () => {
  const tip = itemTipText(cutlass);
  expect(tip.lines).toContain("[?] - [?] Damage · Speed 2.20");
  expect(tip.why).toEqual([WHY.damage]);
});

test("once checks confirm a reading, the files' range prints with where it came from, apart from the reported per second", () => {
  const checked = [check(cutlass, 851, { min: 10, max: 20 })];
  const tip = itemTipText(cutlass, checked);
  expect(tip.lines.slice(0, 4)).toEqual(["Binds when equipped", "One-Hand · Sword", "10 - 20 Damage · Speed 2.20", "([?] damage per second)"]);
  const source = "10 - 20 Damage: worked out from the game files (ItemDamageOneHand, the weapon speed and its spread), the way 1 weapon from that table read off the game's own tooltip on 2026-11-04 agree, build 1.60.1.99999.";
  expect(tip.why).toEqual([source]);
  // The per-second number is the players'; it fills its own line and says so on its own line.
  const filled = withReported(tip, { shown: [fact({ fact: "damage_per_second", value: 6.8 })], contested: [] });
  expect(filled.lines.slice(2, 4)).toEqual(["10 - 20 Damage · Speed 2.20", "(6.8 damage per second)"]);
  expect(filled.why).toEqual([source, "6.8 damage per second: reported by 3 installs, last seen 2026-11-05, build 1.60.1.70450."]);
  // A wand prints its school; a table no checked weapon came from keeps [?].
  const wand: ItemRecord = { ...cutlass, n: "Flamestick", s: 26, sc: 19, d: 1800, w: { t: "ItemDamageWand", dps: 13.575119972229004, dv: 0.6000000238418579, ds: 2 } };
  expect(itemTipText(wand, checked).lines).toContain("[?] - [?] Damage · Speed 1.80");
  expect(itemTipText(wand, [...checked, check(wand, 5241, { min: 17, max: 32 })]).lines).toContain("17 - 32 Fire Damage · Speed 1.80");
  // A record without the table's inputs, or an unknown school, keeps [?] too.
  expect(itemTipText({ ...cutlass, w: undefined }, checked).why).toEqual([WHY.damage]);
  expect(itemTipText({ ...cutlass, w: { ...cutlass.w!, ds: 9 } }, checked).lines).toContain("[?] - [?] Damage · Speed 2.20");
});
