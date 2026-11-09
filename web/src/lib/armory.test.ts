import { expect, test } from "vitest";
import {
  armoryBoardHref, armoryBoardQuery, armoryCharacterPath, armoryGuildPath, armoryHidePath, armoryOn, characterSlugOf, classTokenOfId, classTokenOfName,
  metricValue, namesFromSlug, raceOfId, readLine, slotLabel, slugFromSegment, validArmorySlug,
} from "./armory";

test("the switch is on only for EVERLOOT_ARMORY=1", () => {
  expect(armoryOn({ EVERLOOT_ARMORY: "1" })).toBe(true);
  for (const v of [undefined, "", "0", "true"]) expect(armoryOn({ EVERLOOT_ARMORY: v })).toBe(false);
});

test("a character slug is name-surname in lower case, letters of any script", () => {
  expect(characterSlugOf(" Velkara ", "Duskmantle")).toBe("velkara-duskmantle");
  expect(characterSlugOf("Vélkara", "Dúskmantle")).toBe("vélkara-dúskmantle");
  // A decomposed é (e + combining accent) is composed first, as the API spells it.
  expect(characterSlugOf("Ve\u0301lkara", "Dusk")).toBe("vélkara-dusk");
  expect(characterSlugOf("Ølvir", "Stål")).toBe("ølvir-stål");
  expect(characterSlugOf("E\u0301lodie", "Bru\u0301n")).toBe("élodie-brún");
  for (const [n, s] of [["V", "Duskmantle"], ["Velkara", ""], ["Vel1", "Dusk"], ["Vel kara", "Dusk"], ["Velkara", "Dusk-mantle"], ["Velkara", "Dusk'mantle"]]) {
    expect(characterSlugOf(n!, s!)).toBeNull();
  }
  // The browser lets a combining mark through; one with no composed letter (q + acute) is refused here, never stored.
  expect(characterSlugOf("Saq\u0301ra", "Dusk")).toBeNull();
  expect(characterSlugOf("\u0301\u0301", "Dusk")).toBeNull();
});

test("a member stored without names reads them off its slug", () => {
  expect(namesFromSlug("velkara-duskmantle")).toEqual({ name: "Velkara", surname: "Duskmantle" });
  expect(namesFromSlug("ølvir-stål")).toEqual({ name: "Ølvir", surname: "Stål" });
  expect(namesFromSlug("wardens")).toEqual({ name: "Wardens", surname: "" });
  expect(namesFromSlug("a-b-c")).toEqual({ name: "A", surname: "B C" });
});

test("a slug is one or more lower-case words of letters and digits joined by hyphens, 64 characters at most", () => {
  for (const s of ["velkara-duskmantle", "wardens", "vélkara-dúskmantle", "guild-of-7", "ølvir", "é".repeat(64)]) expect(validArmorySlug(s)).toBe(true);
  for (const s of ["Velkara-Dusk", "Vélkara", "a--b", "-a-b", "a-b-", "a-b/../c", "a b", "a_b", "", "é".repeat(65), "x".repeat(40) + "-" + "y".repeat(30)]) {
    expect(validArmorySlug(s)).toBe(false);
  }
  expect(slugFromSegment("v%C3%A9lkara-duskmantle")).toBe("vélkara-duskmantle");
  expect(slugFromSegment("vélkara-duskmantle")).toBe("vélkara-duskmantle");
  expect(slugFromSegment("%E0%A4%A")).toBeNull();
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
  expect(armoryCharacterPath("eu", "vélkara-duskmantle")).toBe("/armory/eu/v%C3%A9lkara-duskmantle");
  expect(armoryGuildPath("us", "wardens")).toBe("/armory/us/guilds/wardens");
});
