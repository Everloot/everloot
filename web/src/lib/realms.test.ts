import { expect, test } from "vitest";
import { REALMS } from "../data/realms";
import { RULESETS } from "../data/wow-forever-launch";
import { DEFAULT_RULESET, RULESET_SLUGS, realmInfo, realmMap, realmMapKey, realmRuleset, rulesetParam } from "./realms";

// These tests read the realm map as committed, so they hold before and after it is filled. ./realms-empty.test.ts
// pins the map empty and checks that everything behaves as before the map existed.

test("the ruleset slugs follow the launch page's rulesets, one for one and in order", () => {
  expect(RULESET_SLUGS).toHaveLength(RULESETS.length);
  expect(RULESETS.map((r) => r.name)).toEqual(["Normal", "PvP", "Roleplaying", "RP-PvP", "Hardcore"]);
  expect(RULESET_SLUGS).toEqual(["normal", "pvp", "rp", "rp-pvp", "hardcore"]);
});

test("the realm map lists each realm once, however it is spelled", () => {
  const keys = REALMS.map((r) => realmMapKey(r.name));
  expect(new Set(keys).size).toBe(keys.length);
  for (const r of REALMS) expect(r.name.trim(), "a realm name with no outer spaces").toBe(r.name);
});

test("one key for a realm's spellings: the game's, a typed one, the URL's and the character links'", () => {
  for (const s of ["Mal'Ganis", "mal’ganis", "MALGANIS", " malganis "]) expect(realmMapKey(s)).toBe("malganis");
  for (const s of ["Argent Dawn", "argent-dawn", "argent  dawn"]) expect(realmMapKey(s)).toBe("argent dawn");
  const map = realmMap([{ name: "Mal'Ganis", ruleset: "pvp", region: "us" }]);
  expect(map.get(realmMapKey("mal'ganis"))).toEqual({ ruleset: "pvp", region: "us" });
});

test("a realm the map does not list is forever, never a guess", () => {
  for (const realm of ["No Such Realm Everloot", "", "  "]) {
    expect(realmRuleset(realm)).toBe(DEFAULT_RULESET);
    expect(realmInfo(realm)).toBeNull();
  }
});

test("only a ruleset's slug is a ruleset parameter", () => {
  expect(rulesetParam(undefined)).toBeNull();
  expect(rulesetParam("")).toBeNull();
  expect(rulesetParam("rp-pvp")).toBe("rp-pvp");
  for (const bad of ["all", "forever", "PvP", "pve", "rp_pvp"]) expect(rulesetParam(bad)).toBeUndefined();
});

