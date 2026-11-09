import { z } from "zod";
import { gearNumbers } from "./gear.js";

const label = z
  .object({ id: z.number().int(), name: z.string() })
  .passthrough();
const faction = z.object({ name: z.enum(["Alliance", "Horde"]) }).passthrough();
const key = z.object({ href: z.string().url() }).passthrough();
const profileSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    surname: z.string(),
    level: z.number().int().min(1).max(60),
    ruleset: label,
    race: label,
    character_class: label,
    faction,
    gender: z.object({ type: z.string() }).passthrough().nullish(),
    guild: z
      .object({ id: z.number().int(), name: z.string(), key })
      .passthrough()
      .nullish(),
    last_login_timestamp: z.number().nullish(),
    equipped_item_level: z.number().nullish(),
    average_item_level: z.number().nullish(),
  })
  .passthrough();
const equipmentSchema = z
  .object({
    equipped_items: z.array(
      z
        .object({
          slot: z.object({ type: z.string() }).passthrough(),
          item: z.object({ id: z.number().int() }).passthrough(),
          name: z.string(),
          level: z.object({ value: z.number().nonnegative() }).passthrough(),
          quality: z.object({ type: z.string() }).passthrough(),
          inventory_type: z.object({ type: z.string() }).passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const pvpSchema = z
  .object({
    honorable_kills: z.number().int().nonnegative(),
    pvp_rank: z.number().int(),
  })
  .passthrough();
const guildSchema = z
  .object({
    id: z.number().int(),
    slug: z.string(),
    name: z.string(),
    faction,
    ruleset: label,
    member_count: z.number().int(),
    created_timestamp: z.number().nullish(),
  })
  .passthrough();
const rosterSchema = z
  .object({
    members: z.array(
      z
        .object({
          rank: z.number().int(),
          character: z
            .object({
              slug: z.string(),
              name: z.string(),
              surname: z.string(),
              level: z.number().int(),
              playable_class: z.object({ id: z.number().int() }).passthrough(),
              playable_race: z.object({ id: z.number().int() }).passthrough(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export function characterSlug(name: string, surname: string): string {
  return `${name}-${surname}`.toLowerCase();
}
export function guildSlugFromHref(href: string): string {
  return new URL(href).pathname.split("/").filter(Boolean).at(-1)!;
}
export function parseCharacter(
  profile: unknown,
  equipment: unknown,
  pvp: unknown,
  lastModified: string | null,
) {
  const p = profileSchema.parse(profile),
    e = equipmentSchema.parse(equipment),
    v = pvpSchema.parse(pvp);
  return {
    slug: characterSlug(p.name, p.surname),
    character_id: p.id,
    name: p.name,
    surname: p.surname,
    level: p.level,
    ruleset_id: p.ruleset.id,
    ruleset: p.ruleset.name,
    race_id: p.race.id,
    race: p.race.name,
    class_id: p.character_class.id,
    class: p.character_class.name,
    faction: p.faction.name,
    gender: p.gender?.type ?? null,
    guild_slug: p.guild ? guildSlugFromHref(p.guild.key.href) : null,
    guild_name: p.guild?.name ?? null,
    guild_id: p.guild?.id ?? null,
    last_login:
      p.last_login_timestamp == null
        ? null
        : new Date(p.last_login_timestamp).toISOString(),
    equipped_item_level: p.equipped_item_level ?? null,
    average_item_level: p.average_item_level ?? null,
    ...gearNumbers(e.equipped_items),
    honorable_kills: v.honorable_kills,
    pvp_rank: v.pvp_rank,
    equipment: e.equipped_items.map((i) => ({
      slot: i.slot.type,
      item_id: i.item.id,
      name: i.name,
      level: i.level.value,
      quality: i.quality.type,
      inventory_type: i.inventory_type.type,
    })),
    last_modified: lastModified,
  };
}
export function parseGuild(
  guild: unknown,
  roster: unknown,
  lastModified: string | null,
) {
  const g = guildSchema.parse(guild),
    r = rosterSchema.parse(roster);
  return {
    guild: {
      slug: g.slug,
      guild_id: g.id,
      name: g.name,
      faction: g.faction.name,
      ruleset_id: g.ruleset.id,
      ruleset: g.ruleset.name,
      member_count: g.member_count,
      created_at:
        g.created_timestamp == null
          ? null
          : new Date(g.created_timestamp).toISOString(),
      last_modified: lastModified,
    },
    members: r.members.map(({ character: c, rank }) => ({
      character_slug: c.slug,
      name: c.name,
      surname: c.surname,
      level: c.level,
      class_id: c.playable_class.id,
      race_id: c.playable_race.id,
      rank,
    })),
  };
}
export type CharacterRow = ReturnType<typeof parseCharacter>;
export type GuildRow = ReturnType<typeof parseGuild>["guild"];
export type MemberRow = ReturnType<typeof parseGuild>["members"][number];
