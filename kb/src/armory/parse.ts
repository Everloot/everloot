import { z } from "zod";
import { gearNumbers } from "./gear.js";
import { GuildCrest } from "./crest.js";

const label = z
  .object({ id: z.number().int(), name: z.string() })
  .passthrough();
const faction = z.object({ name: z.enum(["Alliance", "Horde"]) }).passthrough();
const key = z.object({ href: z.string().url() }).passthrough();
const profileSchema = z
  .object({
    slug: z.string().optional(),
    id: z.number().int(),
    name: z.string(),
    surname: z.string().nullish(),
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
          // Blizzard leaves the level out for some cosmetic items (a common head item, seen 2026-11-17).
          level: z.object({ value: z.number().nonnegative() }).passthrough().nullish(),
          quality: z.object({ type: z.string() }).passthrough(),
          inventory_type: z.object({ type: z.string() }).passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
// The tooltip lines Blizzard sends with each equipped item, read one field at a time: a field missing or in another
// shape is left out (`.catch`), never failing the character the way the six fields above do.
const named = z.object({ name: z.string() }).passthrough();
const shown = z.object({ display_string: z.string() }).passthrough();
const tipSchema = z.object({
  binding: named.optional().catch(undefined),
  item_subclass: named.optional().catch(undefined),
  is_subclass_hidden: z.boolean().optional().catch(undefined),
  inventory_type: named.optional().catch(undefined),
  armor: z.object({ value: z.number().int().nonnegative() }).passthrough().optional().catch(undefined),
  weapon: z.object({ damage: shown, attack_speed: shown, dps: shown }).passthrough().optional().catch(undefined),
  stats: z.array(z.object({ display: shown, is_equip_bonus: z.boolean().nullish(), is_negated: z.boolean().nullish() }).passthrough()).optional().catch(undefined),
  spells: z.array(z.object({ description: z.string().nullish() }).passthrough()).optional().catch(undefined),
  set: z.object({
    item_set: named,
    items: z.array(z.object({ item: named, is_equipped: z.boolean().nullish() }).passthrough()),
    effects: z.array(z.object({ display_string: z.string(), required_count: z.number().int(), is_active: z.boolean().nullish() }).passthrough()).nullish(),
  }).passthrough().optional().catch(undefined),
}).passthrough();

/** What an armory gear card shows beyond the six stored fields, in Blizzard's own words; absent keys were not sent. */
export interface ItemTipLines {
  binding?: string; slot?: string; kind?: string; armor?: number; damage?: string; speed?: string; dps?: string;
  stats?: string[]; bonus_stats?: string[]; effects?: string[];
  set?: { name: string; pieces: { name: string; equipped: boolean }[]; bonuses: { text: string; count: number; active: boolean }[] };
}

function itemTipLines(raw: unknown): ItemTipLines | undefined {
  const t = tipSchema.safeParse(raw);
  if (!t.success) return undefined;
  const d = t.data;
  const stats = (d.stats ?? []).filter((s) => !s.is_negated);
  const effects = (d.spells ?? []).map((s) => s.description).filter((s): s is string => Boolean(s));
  const tip: ItemTipLines = {
    ...(d.binding ? { binding: d.binding.name } : {}),
    ...(d.inventory_type ? { slot: d.inventory_type.name } : {}),
    // The game prints no kind for a ring, a neck or a cloak's "Cloth"; Blizzard marks those hidden.
    ...(d.item_subclass && !d.is_subclass_hidden ? { kind: d.item_subclass.name } : {}),
    ...(d.armor ? { armor: d.armor.value } : {}),
    ...(d.weapon ? { damage: d.weapon.damage.display_string, speed: d.weapon.attack_speed.display_string, dps: d.weapon.dps.display_string } : {}),
    ...(stats.some((s) => !s.is_equip_bonus) ? { stats: stats.filter((s) => !s.is_equip_bonus).map((s) => s.display.display_string) } : {}),
    ...(stats.some((s) => s.is_equip_bonus) ? { bonus_stats: stats.filter((s) => s.is_equip_bonus).map((s) => s.display.display_string) } : {}),
    ...(effects.length ? { effects } : {}),
    ...(d.set ? { set: {
      name: d.set.item_set.name,
      pieces: d.set.items.map((i) => ({ name: i.item.name, equipped: i.is_equipped === true })),
      bonuses: (d.set.effects ?? []).map((e) => ({ text: e.display_string, count: e.required_count, active: e.is_active === true })),
    } } : {}),
  };
  // The slot alone is no tooltip: the six stored fields say as much.
  return Object.keys(tip).some((k) => k !== "slot") ? tip : undefined;
}

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
    crest: GuildCrest.nullish().catch(null),
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
              surname: z.string().nullish(),
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
  return decodeURIComponent(
    new URL(href).pathname.split("/").filter(Boolean).at(-1)!,
  ).toLowerCase();
}
export class SkippedRow extends Error {
  constructor(readonly reason: "no_surname" | "invalid_slug") {
    super(reason);
  }
}
export function validSlug(slug: string): boolean {
  return slug.length <= 64 && /^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u.test(slug);
}
export function parseCharacter(
  profile: unknown,
  equipment: unknown,
  pvp: unknown,
  lastModified: string | null,
  apiSlug?: string,
) {
  const p = profileSchema.parse(profile);
  if (!p.surname?.trim()) throw new SkippedRow("no_surname");
  // Forever profiles may omit slug; preserve the API roster/queue identity then.
  const slug = (p.slug ?? apiSlug ?? "").toLowerCase();
  if (!validSlug(slug)) throw new SkippedRow("invalid_slug");
  const e = equipmentSchema.parse(equipment),
    v = pvpSchema.parse(pvp);
  return {
    slug,
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
    equipment: e.equipped_items.map((i) => {
      const tip = itemTipLines(i);
      return {
        slot: i.slot.type,
        item_id: i.item.id,
        name: i.name,
        level: i.level?.value ?? null,
        quality: i.quality.type,
        inventory_type: i.inventory_type.type,
        ...(tip ? { tip } : {}),
      };
    }),
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
  const skipped = { no_surname: 0, invalid_slug: 0 };
  const members = r.members.flatMap(({ character: c, rank }) => {
    if (!c.surname?.trim()) {
      skipped.no_surname++;
      return [];
    }
    const slug = c.slug.toLowerCase();
    if (!validSlug(slug)) {
      skipped.invalid_slug++;
      return [];
    }
    return [
      {
        character_slug: slug,
        name: c.name,
        surname: c.surname,
        level: c.level,
        class_id: c.playable_class.id,
        race_id: c.playable_race.id,
        rank,
      },
    ];
  });
  if (!validSlug(g.slug.toLowerCase())) throw new SkippedRow("invalid_slug");
  return {
    skipped,
    guild: {
      slug: g.slug.toLowerCase(),
      guild_id: g.id,
      name: g.name,
      faction: g.faction.name,
      ruleset_id: g.ruleset.id,
      ruleset: g.ruleset.name,
      member_count: g.member_count,
      ...(g.crest ? { crest: g.crest } : {}),
      created_at:
        g.created_timestamp == null
          ? null
          : new Date(g.created_timestamp).toISOString(),
      last_modified: lastModified,
    },
    members,
  };
}
export type CharacterRow = ReturnType<typeof parseCharacter>;
export type GuildRow = ReturnType<typeof parseGuild>["guild"];
export type MemberRow = ReturnType<typeof parseGuild>["members"][number];
