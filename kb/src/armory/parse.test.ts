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
  expect(parseCharacter(profile, equipment, pvp, "date", "ember-vale")).toEqual(
    {
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
      item_level: 57,
      gear_score: 57,
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
    },
  );
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
    member_count: 12,
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
    "HAND",
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
    "HAND",
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

it("decodes guild slugs without changing guild display names", () => {
  for (const slug of ["Zw\u00f6lf-Ritter", "Zw%C3%B6lf-Ritter"])
    expect(guildSlugFromHref(`https://example.test/guild/${slug}?x=1`)).toBe(
      "zw\u00f6lf-ritter",
    );
  const row = parseCharacter(
    {
      ...profile,
      guild: {
        ...profile.guild,
        name: "Zw\u00f6lf Ritter",
        key: { href: "https://example.test/guild/Zw%C3%B6lf-Ritter" },
      },
    },
    equipment,
    pvp,
    null,
    "ember-vale",
  );
  expect(row.guild_name).toBe("Zw\u00f6lf Ritter");
  expect(row.guild_slug).toBe("zw\u00f6lf-ritter");
});
it.each([undefined, null, "", " "])(
  "skips a profile with surname %s",
  (surname) => {
    expect(() =>
      parseCharacter(
        { ...profile, surname },
        equipment,
        pvp,
        null,
        "ember-vale",
      ),
    ).toThrow("no_surname");
  },
);
it("keeps the API slug, including Unicode and single words", () => {
  expect(
    parseCharacter(
      { ...profile, slug: "\u00c9mber7" },
      equipment,
      pvp,
      null,
      "wrong-guess",
    ).slug,
  ).toBe("\u00e9mber7");
});
it.each(["bad%20slug", "bad--slug", "bad-", "x".repeat(65)])(
  "skips invalid slug %s",
  (slug) => {
    expect(() =>
      parseCharacter({ ...profile, slug }, equipment, pvp, null, "ember-vale"),
    ).toThrow("invalid_slug");
  },
);
it("skips individual roster members without a surname or valid slug", () => {
  const members = [
    ...roster.members,
    ...[undefined, null, "", " "].map((surname) => ({
      ...roster.members[0],
      character: { ...roster.members[0].character, surname },
    })),
    {
      ...roster.members[0],
      character: { ...roster.members[0].character, slug: "bad--slug" },
    },
  ];
  const parsed = parseGuild(guild, { members }, null);
  expect(parsed.members).toHaveLength(2);
  expect(parsed.skipped).toEqual({ no_surname: 5, invalid_slug: 1 });
});
it("every captured inventory type produces a score in its real slot", () => {
  for (const e of equipment.equipped_items.filter(
    (e) => !["SHIRT", "TABARD", "AMMO"].includes(e.slot.type),
  ))
    expect(gearNumbers([e]).gear_score).not.toBeNull();
});

it.each([
  ["HEAD", "HEAD", 5],
  ["NECK", "NECK", 2],
  ["SHOULDER", "SHOULDER", 3],
  ["CHEST", "CHEST", 5],
  ["WAIST", "WAIST", 3],
  ["LEGS", "LEGS", 5],
  ["FEET", "FEET", 3],
  ["WRIST", "WRIST", 2],
  ["HAND", "HAND", 3],
  ["FINGER_1", "FINGER", 2],
  ["FINGER_2", "FINGER", 2],
  ["TRINKET_1", "TRINKET", 3],
  ["TRINKET_2", "TRINKET", 3],
  ["BACK", "CLOAK", 2],
  ["MAIN_HAND", "WEAPONMAINHAND", 2],
  ["OFF_HAND", "SHIELD", 2],
  ["RANGED", "RANGED", 1],
] as const)(
  "maps real slot %s with its hand-computed weight",
  (slot, type, expected) => {
    expect(gearNumbers([item(slot, type)])).toEqual({
      item_level: 3,
      gear_score: expected,
    });
  },
);
it.each([
  ["SHIRT", "BODY"],
  ["TABARD", "TABARD"],
])("ignores unranked slot %s", (slot, type) => {
  expect(gearNumbers([item(slot, type)])).toEqual({
    item_level: null,
    gear_score: null,
  });
});
