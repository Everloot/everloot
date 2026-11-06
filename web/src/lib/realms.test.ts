import { expect, test } from "vitest";
import { REALMS } from "../data/realms";
import { RULESETS } from "../data/wow-forever-launch";
import { REALM_RULESETS } from "../design/tokens";
import { DEFAULT_RULESET, RULESET_LABEL, RULESET_SLUGS, realmInfo, realmMap, realmMapKey, realmParts, realmRuleset, rulesetFromName, rulesetParam } from "./realms";

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

test("a realm whose name ends in its ruleset is on that ruleset; the map still wins, and a name without one stays forever", () => {
  expect(rulesetFromName("CAMWOW US1 Realm 4 PvP")).toBe("pvp");
  expect(rulesetFromName("CAMWOW AU1 Realm 2 PvP")).toBe("pvp");
  expect(rulesetFromName("Some Realm PvE")).toBe("normal");
  expect(rulesetFromName("Some Realm Normal")).toBe("normal");
  expect(rulesetFromName("Some Realm RP")).toBe("rp");
  expect(rulesetFromName("Some Realm RP-PvP")).toBe("rp-pvp");
  expect(rulesetFromName("Some Realm RP PvP ")).toBe("rp-pvp");
  // The realm list as players copied it (Blizzard forums, 2026-11-03): one word for RP-PvP, capitals for PvE.
  expect(rulesetFromName("CAMWOW US1 Realm 9 RPPVP")).toBe("rp-pvp");
  expect(rulesetFromName("CAMWOW AU1 Realm 4 RPPvP")).toBe("rp-pvp");
  expect(rulesetFromName("CAMWOW US1 Realm 1 PVE")).toBe("normal");
  expect(rulesetFromName("CAMWOW US1 Realm 10 RP")).toBe("rp");
  expect(rulesetFromName("Some Realm Hardcore")).toBe("hardcore");
  for (const realm of ["PvP", "Mal'Ganis", "Stormrage", "Pvpland", "Forever"]) expect(rulesetFromName(realm)).toBeNull();
  expect(realmRuleset("CAMWOW US1 Realm 4 PvP")).toBe("pvp");
});

test("a realm's name splits into the name and the ruleset it ends in, as the tooltip shows it", () => {
  expect(realmParts("CAMWOW US1 Realm 4 PvP")).toEqual({ base: "CAMWOW US1 Realm 4", ruleset: "pvp" });
  expect(realmParts("Some Realm RP-PvP")).toEqual({ base: "Some Realm", ruleset: "rp-pvp" });
  expect(realmParts("CAMWOW US2 Realm 10 RPPVP")).toEqual({ base: "CAMWOW US2 Realm 10", ruleset: "rp-pvp" });
  expect(realmParts("Mal'Ganis")).toEqual({ base: "Mal'Ganis", ruleset: null });
  expect(RULESET_LABEL.normal).toBe("PvE");
  // Every ruleset has its name colour.
  expect([...REALM_RULESETS]).toEqual([...RULESET_SLUGS]);
});

test("only a ruleset's slug is a ruleset parameter", () => {
  expect(rulesetParam(undefined)).toBeNull();
  expect(rulesetParam("")).toBeNull();
  expect(rulesetParam("rp-pvp")).toBe("rp-pvp");
  for (const bad of ["all", "forever", "PvP", "pve", "rp_pvp"]) expect(rulesetParam(bad)).toBeUndefined();
});

