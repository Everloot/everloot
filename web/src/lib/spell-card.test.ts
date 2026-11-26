import { expect, test } from "vitest";
import type { ClientSpells } from "@kb/client-spells";
import { CLIENT_SPELLS } from "@/data/game-data/client-spells";
import { castText, costText, effectValue, rangeText, schoolNames, spellRanks, timeText, tooltipRows } from "./spell-card";

const table = (spells: ClientSpells["spells"]): ClientSpells => ({ ...CLIENT_SPELLS, spells });

test("times, costs and ranges read the way the game's tooltip prints them", () => {
  expect([timeText(1500), timeText(180000), timeText(3600000), timeText(7200000)]).toEqual(["1.5 sec", "3 min", "1 hour", "2 hours"]);
  expect(costText([0, 30, 0])).toBe("30 Mana");
  expect(costText([3, 40, 0])).toBe("40 Energy");
  expect(costText([0, 0, 6])).toBe("6% of base mana");
  // A power type the files do not name keeps its number rather than a guessed word.
  expect(costText([99, 5, 0])).toBe("5 power 99");
  expect([rangeText([0, 30]), rangeText([8, 30]), rangeText([0, 5, 1]), rangeText(undefined)]).toEqual(["30 yd range", "8-30 yd range", "Melee Range", null]);
  expect(schoolNames(4 | 16)).toEqual(["Fire", "Frost"]);
  expect(schoolNames(undefined)).toEqual([]);
});

test("a passive spell has no cast line; a channeled one says so; a pair keeps the side it has", () => {
  expect(castText({ passive: 1, castMs: 1500 })).toBeNull();
  expect(castText({ channeled: 1 })).toBe("Channeled");
  expect(tooltipRows({ passive: 1 })).toEqual([{ left: "Passive", right: null }]);
  expect(tooltipRows({ range: [0, 30], cooldownMs: 10000 })).toEqual([{ left: null, right: "30 yd range" }, { left: "Instant", right: "10 sec cooldown" }]);
});

test("effect values: dice, a variance spread and a flat value", () => {
  expect(effectValue([0, 13, 6, 0, 0, 0, 0])).toBe("14 to 19");
  expect(effectValue([0, 18, 0, 0, 0, 0, 0.4444])).toBe("14 to 22");
  expect(effectValue([0, 11, 0, 0, 0, 0, 0])).toBe("11");
  expect(effectValue([0, 4, 1, 0, 0, 0, 0])).toBe("5");
});

test("ranks follow the replaces links both ways, the lower id where one spell has two successors, and stop on a loop", () => {
  const t = table({ "1": {}, "2": { supersedes: 1 }, "3": { supersedes: 2 }, "9": { supersedes: 2 }, "5": {} });
  expect(spellRanks(3, t)).toEqual([1, 2, 3]);
  expect(spellRanks(1, t)).toEqual([1, 2, 3]);
  expect(spellRanks(5, t)).toEqual([]);
  const loop = table({ "1": { supersedes: 2 }, "2": { supersedes: 1 } });
  expect(spellRanks(1, loop).sort()).toEqual([1, 2]);
});
