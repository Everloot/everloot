import type { ArmoryCharacter, ArmoryGuild } from "./armory-store";

/** Invented characters and guilds in the shape the armory functions return; no real player's name. */
export function armoryCharacter(over: Partial<ArmoryCharacter> = {}): ArmoryCharacter {
  return {
    region: "eu", slug: "velkara-duskmantle", characterId: 9001, name: "Velkara", surname: "Duskmantle", level: 60,
    rulesetId: 2, ruleset: "Normal", raceId: 8, race: "Troll", classId: 3, class: "Hunter", faction: "Horde", gender: "FEMALE",
    guildSlug: "ember-wardens", guildName: "Ember Wardens", lastLogin: "2026-11-08T20:00:00.000Z",
    equippedItemLevel: 58, averageItemLevel: 58, itemLevel: 57.41, gearScore: 61.2, honorableKills: 1234, pvpRank: 7,
    equipment: [
      { slot: "HEAD", itemId: 16846, name: "Giantstalker's Helmet", level: 66, quality: "EPIC", inventoryType: "HEAD" },
      { slot: "MAIN_HAND", itemId: 17069, name: "Striker's Mark", level: 69, quality: "RARE", inventoryType: "RANGEDRIGHT" },
    ],
    fetchedAt: "2026-11-09T10:00:00.000Z", checkedAt: "2026-11-09T10:00:00.000Z",
    ...over,
  };
}

export function armoryGuild(over: Partial<ArmoryGuild> = {}): ArmoryGuild {
  return {
    region: "eu", slug: "ember-wardens", guildId: 77, name: "Ember Wardens", faction: "Horde", rulesetId: 2, ruleset: "Normal",
    memberCount: 3, createdAt: "2026-10-01T12:00:00.000Z", fetchedAt: "2026-11-09T09:00:00.000Z", checkedAt: "2026-11-09T09:00:00.000Z",
    ...over,
  };
}
