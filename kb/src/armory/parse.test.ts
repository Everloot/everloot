import { it, expect } from "vitest";
import profile from "./fixtures/character.json";
import equipment from "./fixtures/equipment.json";
import pvp from "./fixtures/pvp.json";
import guild from "./fixtures/guild.json";
import roster from "./fixtures/roster.json";
import {
  characterSlug,
  guildSlugFromHref,
  parseCharacter,
  parseGuild,
} from "./parse.js";
import { gearNumbers } from "./gear.js";
it("slug helpers", () => {
  expect(characterSlug("Ember", "Vale")).toBe("ember-vale");
  expect(guildSlugFromHref(profile.guild.key.href)).toBe("copper-owls");
});
it("parses the character row", () => {
  expect(parseCharacter(profile, equipment, pvp, "date")).toEqual({
    slug: "ember-vale",
    character_id: 900001,
    name: "Ember",
    surname: "Vale",
    level: 60,
    ruleset_id: 1,
    ruleset: "PvP",
    race_id: 8,
    race: "Troll",
    class_id: 3,
    class: "Hunter",
    faction: "Horde",
    gender: "MALE",
    guild_slug: "copper-owls",
    guild_name: "Copper Owls",
    guild_id: 900010,
    last_login: new Date(profile.last_login_timestamp).toISOString(),
    equipped_item_level: 57,
    average_item_level: 59,
    ...gearNumbers(equipment.equipped_items),
    honorable_kills: 15,
    pvp_rank: 0,
    equipment: equipment.equipped_items.map((e) => ({
      slot: e.slot.type,
      item_id: e.item.id,
      name: e.name,
      level: e.level.value,
      quality: e.quality.type,
      inventory_type: e.inventory_type.type,
    })),
    last_modified: "date",
  });
});
it("parses guild and members", () => {
  const r = parseGuild(guild, roster, null);
  expect(r.guild).toEqual({
    slug: "copper-owls",
    guild_id: 900010,
    name: "Copper Owls",
    faction: "Horde",
    ruleset_id: 1,
    ruleset: "PvP",
    member_count: 84,
    created_at: new Date(guild.created_timestamp).toISOString(),
    last_modified: null,
  });
  expect(r.members[0]).toEqual({
    character_slug: "ember-vale",
    name: "Ember",
    surname: "Vale",
    level: roster.members[0].character.level,
    class_id: roster.members[0].character.playable_class.id,
    race_id: roster.members[0].character.playable_race.id,
    rank: roster.members[0].rank,
  });
});
it("rejects bad payloads", () => {
  expect(() => parseCharacter({}, {}, {}, null)).toThrow();
});
const item = (slot: string, type: string, level = 60, id = 1) => ({
  slot: { type: slot },
  inventory_type: { type },
  level: { value: level },
  item: { id },
  name: "Invented item",
  quality: { type: "RARE" },
});
it("uses the 17 slot weights", () => {
  const slots = [
    "HEAD",
    "NECK",
    "SHOULDER",
    "CHEST",
    "WAIST",
    "LEGS",
    "FEET",
    "WRIST",
    "HANDS",
    "FINGER_1",
    "FINGER_2",
    "TRINKET_1",
    "TRINKET_2",
    "BACK",
    "MAIN_HAND",
    "OFF_HAND",
    "RANGED",
  ];
  const types = [
    "HEAD",
    "NECK",
    "SHOULDER",
    "CHEST",
    "WAIST",
    "LEGS",
    "FEET",
    "WRIST",
    "HANDS",
    "FINGER",
    "FINGER",
    "TRINKET",
    "TRINKET",
    "CLOAK",
    "WEAPONMAINHAND",
    "SHIELD",
    "RANGED",
  ];
  // Full kit 17*60/17 and 512*60/512; lone head floor(60/17), floor(44*60/512).
  expect(
    gearNumbers(slots.map((s, i) => item(s, types[i], 60, i + 1))),
  ).toEqual({ item_level: 60, gear_score: 60 });
  expect(gearNumbers([item("HEAD", "HEAD")])).toEqual({
    item_level: 3,
    gear_score: 5,
  });
});
it("two hands, ignored shirt, empty set", () => {
  expect(
    gearNumbers([
      item("MAIN_HAND", "TWOHWEAPON"),
      item("SHIRT", "BODY", 90, 2),
    ]),
  ).toEqual({ item_level: 7, gear_score: 5 });
  expect(gearNumbers([])).toEqual({ item_level: null, gear_score: null });
});
