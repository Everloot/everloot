import { expect, test } from "vitest";
import {
  armoryBoardHref, armoryBoardQuery, armoryHidePath, armoryOn, characterSlugOf, classTokenOfId, classTokenOfName,
  metricValue, raceOfId, readLine, slotLabel, validArmorySlug,
} from "./armory";

test("the switch is on only for EVERLOOT_ARMORY=1", () => {
  expect(armoryOn({ EVERLOOT_ARMORY: "1" })).toBe(true);
  for (const v of [undefined, "", "0", "true"]) expect(armoryOn({ EVERLOOT_ARMORY: v })).toBe(false);
});

test("a character slug is name-surname in lower case, letters only", () => {
  expect(characterSlugOf(" Velkara ", "Duskmantle")).toBe("velkara-duskmantle");
  for (const [n, s] of [["V", "Duskmantle"], ["Velkara", ""], ["Vel1", "Dusk"], ["Vel kara", "Dusk"], ["Velkara", "Dusk-mantle"], ["Vélkara", "Dusk"]]) {
    expect(characterSlugOf(n!, s!)).toBeNull();
  }
  expect(validArmorySlug("velkara-duskmantle")).toBe(true);
  for (const s of ["velkara", "Velkara-Dusk", "a--b", "-a-b", "a-b/../c", "x".repeat(40) + "-" + "y".repeat(30)]) expect(validArmorySlug(s)).toBe(false);
});

test("board filters accept the four rulesets and two regions, and refuse anything else", () => {
  expect(armoryBoardQuery({})).toEqual({ region: null, ruleset: null });
  expect(armoryBoardQuery({ region: "eu", ruleset: "15" })).toEqual({ region: "eu", ruleset: 15 });
  for (const bad of [{ region: "kr" }, { ruleset: "4" }, { ruleset: "pvp" }]) expect(armoryBoardQuery(bad)).toBeNull();
  expect(armoryBoardHref("item-level", { region: null, ruleset: null })).toBe("/armory/rankings/item-level");
  expect(armoryBoardHref("honorable-kills", { region: "us", ruleset: 1 })).toBe("/armory/rankings/honorable-kills?ruleset=1&region=us");
});

test("an unknown class or race id reads Unknown, never a guess", () => {
  expect(classTokenOfId(3)).toBe("HUNTER");
  expect(classTokenOfId(6)).toBeNull();
  expect(classTokenOfId(null)).toBeNull();
  expect(raceOfId(8)).toBe("Troll");
  expect(raceOfId(10)).toBe("Unknown");
  expect(classTokenOfName("Hunter")).toBe("HUNTER");
  expect(slotLabel("MAIN_HAND")).toBe("Main hand");
  expect(slotLabel("WEIRD")).toBe("Unknown");
});

test("the read line and the figures", () => {
  expect(readLine("2026-11-09T10:00:00Z")).toBe("Read 2026-11-09 10:00 UTC");
  expect(readLine(null)).toBe("Read time unrecorded");
  expect(metricValue("item-level", 57.413)).toBe("57.41");
  expect(metricValue("honorable-kills", 12345)).toBe("12,345");
  expect(armoryHidePath({ region: "eu", name: "Velkara", surname: "Duskmantle" })).toBe("/armory/hide?region=eu&name=Velkara&surname=Duskmantle");
});
