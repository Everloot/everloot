import { expect, test } from "vitest";
import type { ArmoryHit } from "./armory-store";
import { mergeLookup } from "./character-lookup";
import type { Player } from "./player-pages";

// Invented characters only.
const seen = (over: Partial<Player> = {}): Player => ({
  name: "Velkara", realm: "EU1 Realm 2 Normal", ruleset: "forever", race: "Troll", class: "HUNTER", level: 58, guild: "Ember Wardens", lastSeen: "2026-11-12", ...over,
});
const read = (over: Partial<ArmoryHit> = {}): ArmoryHit => ({
  region: "eu", slug: "velkara-duskmantle", name: "Velkara", surname: "Duskmantle", level: 60, class: "Hunter", race: "Troll", ruleset: "Normal", guildName: "Ember Wardens", ...over,
});

test("a sighting and an armory character with one name in one region are one row, linking the Blizzard profile with the day the addon saw it", () => {
  const rows = mergeLookup([seen()], [read()]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    name: "Velkara Duskmantle", href: "/armory/eu/velkara-duskmantle", sources: ["addon", "armory"], lastSeen: "2026-11-12", level: 60, classToken: "HUNTER",
  });
  expect(rows[0]!.hideHref).toBe("/armory/hide?region=eu&name=Velkara&surname=Duskmantle");
});

test("each lookup alone keeps its own row, its own page and its own hide form", () => {
  const [addon] = mergeLookup([seen()], []);
  expect(addon).toMatchObject({ name: "Velkara", sources: ["addon"], href: "/characters/forever/eu1-realm-2-normal/velkara" });
  expect(addon!.hideHref).toContain("/players/opt-out?");
  const [armory] = mergeLookup([], [read()]);
  expect(armory).toMatchObject({ sources: ["armory"], lastSeen: null, where: "EU Normal" });
});

test("anything less than certain stays two rows", () => {
  const two = (players: Player[], hits: ArmoryHit[]) => mergeLookup(players, hits).map((r) => r.sources.join("+"));
  // Another region.
  expect(two([seen({ realm: "CAMWOW US1 Realm 4 PvP" })], [read()])).toEqual(["addon", "armory"]);
  // Guilds that disagree.
  expect(two([seen({ guild: "Night Watch" })], [read()])).toEqual(["addon", "armory"]);
  // Two armory characters with that first name in the region: which one the addon saw is not known.
  expect(two([seen()], [read(), read({ slug: "velkara-stone", surname: "Stone" })])).toEqual(["addon", "armory", "armory"]);
  // Two sightings with that name in the region.
  expect(two([seen(), seen({ realm: "EU1 Realm 3 PvP" })], [read()])).toEqual(["addon", "addon", "armory"]);
  // A realm with no region in its name.
  expect(two([seen({ realm: "Quiet Hollow" })], [read()])).toEqual(["addon", "armory"]);
});

test("a guild one side has not seen does not keep a pair apart", () => {
  expect(mergeLookup([seen({ guild: null })], [read()])).toHaveLength(1);
  expect(mergeLookup([seen()], [read({ guildName: null })])).toHaveLength(1);
});
