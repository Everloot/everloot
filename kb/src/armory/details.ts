import { z } from "zod";

// Forever's active talent-group shape: https://jsr.io/@pinta365/blizzard-api/doc/wow-forever
// Keep a small page-only projection, never the complete API response.
const text = z.string().min(1).max(120);
const amount = z.number().finite().nonnegative();
const date = z.string().datetime();
const gameId = z.number().int().positive().max(2_147_483_647);
// Forever answered about 48 achievements, 18-23 factions and 495-951 completed quests on 2026-11-17.
// The caps leave room to grow; full lists at the caps stay near 45 KB of the column's 64 KB.
export const MAX_ACHIEVEMENTS = 100, MAX_REPUTATIONS = 50, MAX_QUESTS = 3000;
// Forever answered 69 to 90 play-history counts per character on 2026-11-20.
export const MAX_PLAY_HISTORY = 300;
/** The play-history counts the armory ranks, by Blizzard statistic id. Generated columns read `ranked` (20261121100000). */
export const PLAY_HISTORY_RANKED = { quests: 98, creatures: 107, fish: 1518, flights: 349, dungeons: 932, deaths: 60 } as const;
export type PlayHistoryRankedKey = keyof typeof PLAY_HISTORY_RANKED;
const count = z.number().int().nonnegative().max(2_147_483_647);
const PlayHistory = z.object({
  asOf: date,
  groups: z.array(z.object({ name: text, rows: z.array(z.object({ id: gameId, name: text, value: count, note: text.optional() })) }))
    .refine((groups) => groups.reduce((n, g) => n + g.rows.length, 0) <= MAX_PLAY_HISTORY),
  ranked: z.object(Object.fromEntries(Object.keys(PLAY_HISTORY_RANKED).map((k) => [k, count.optional()])) as Record<PlayHistoryRankedKey, z.ZodOptional<typeof count>>),
});
export const ArmoryDetails = z.object({
  revision: z.literal(1),
  retry: z.literal(true).optional(),
  statistics: z.object({ asOf: date, rows: z.array(z.object({ label: text, value: amount, percent: z.boolean() })).max(40) }).optional(),
  talents: z.object({ asOf: date, trees: z.array(z.object({ name: text, points: amount, talents: z.array(z.object({ name: text, rank: amount })).max(100) })).max(10) }).optional(),
  professions: z.object({ asOf: date, rows: z.array(z.object({ name: text, rank: amount, max: amount.positive() })).max(10) }).optional(),
  avatar: z.object({ asOf: date, url: z.string().url().refine(safePortrait) }).optional(),
  // Completed achievements only; Forever's points are always 0, so they are not kept.
  achievements: z.object({ asOf: date, rows: z.array(z.object({ id: gameId, name: text, completedAt: date })).max(MAX_ACHIEVEMENTS) }).optional(),
  reputations: z.object({ asOf: date, rows: z.array(z.object({ id: gameId, name: text, standing: text, tier: amount.int().optional() })).max(MAX_REPUTATIONS) }).optional(),
  quests: z.object({ asOf: date, completed: z.array(gameId).max(MAX_QUESTS) }).optional(),
  // A bad stored copy drops only itself, never the other sections.
  playHistory: PlayHistory.optional().catch(undefined),
});
export type ProfileDetails = z.infer<typeof ArmoryDetails>;
type ObjectValue = Record<string, unknown>;
const obj = (v: unknown): ObjectValue => v !== null && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const name = (v: unknown) => text.safeParse(v).success ? v as string : null;
const number = (v: unknown) => amount.safeParse(v).success ? v as number : null;
const id = (v: unknown) => gameId.safeParse(v).success ? v as number : null;

export function safePortrait(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "render.worldofwarcraft.com" && !u.port && !u.username && !u.password &&
      /^\/forever-(us|eu)\/character\/[\w/-]+-avatar\.(jpg|png)$/.test(u.pathname) && !u.search && !u.hash;
  } catch { return false; }
}

export const DETAIL_KEYS = ["statistics", "specializations", "professions", "media", "achievements", "reputations", "quests", "achievement-statistics"] as const;
export type DetailKey = typeof DETAIL_KEYS[number];
/**
 * Follow a profile's advertised link, never a submitted URL or a link to another character.
 * For quests the profile advertises `/quests`; only its fixed `/completed` part is read. Play history has no link of
 * its own: it is the fixed `/statistics` part of the advertised `/achievements`.
 */
export function detailPath(profile: unknown, key: DetailKey, region: string, slug: string): string | null {
  const root = obj(profile);
  const field = key === "achievement-statistics" ? "achievements" : key;
  const href = obj(root[field] ?? root[key === "media" ? "character_media" : field]).href;
  if (typeof href !== "string") return null;
  try {
    const u = new URL(href);
    const base = `/profile/wow/character/${encodeURIComponent(slug)}/`;
    const suffix = key === "media" ? "character-media" : field;
    const part = key === "quests" ? "/completed" : key === "achievement-statistics" ? "/statistics" : "";
    return u.protocol === "https:" && u.host === `${region}.api.blizzard.com` && !u.username && !u.password &&
      decodeURIComponent(u.pathname) === decodeURIComponent(`${base}${suffix}`) ? `${u.pathname}${part}` : null;
  } catch { return null; }
}

const STATS: [string, string, boolean?][] = [
  ["health", "Health"], ["power", "Mana / resource"], ["strength", "Strength"], ["agility", "Agility"],
  ["intellect", "Intellect"], ["stamina", "Stamina"], ["spirit", "Spirit"], ["spell_power", "Spell power"],
  ["spell_healing", "Healing"], ["spell_crit", "Spell critical strike", true], ["spell_hit", "Spell hit", true],
  ["attack_power", "Attack power"], ["ranged_attack_power", "Ranged attack power"], ["melee_crit", "Melee critical strike", true],
  ["ranged_crit", "Ranged critical strike", true], ["armor", "Armor"], ["defense", "Defense"],
  ["dodge", "Dodge", true], ["parry", "Parry", true], ["block", "Block", true],
  ["fire_resistance", "Fire resistance"], ["frost_resistance", "Frost resistance"], ["shadow_resistance", "Shadow resistance"],
  ["nature_resistance", "Nature resistance"], ["arcane_resistance", "Arcane resistance"],
];

export function normalizeDetails(responses: Partial<Record<DetailKey, unknown>>, asOf: string): ProfileDetails {
  const out: ProfileDetails = { revision: 1 };
  const stats = obj(responses.statistics);
  const rows = STATS.flatMap(([key, label, percent]) => {
    const raw = stats[key], nested = obj(raw);
    const value = number(typeof raw === "number" ? raw : nested.effective ?? nested.value);
    return value === null ? [] : [{ label, value, percent: percent === true }];
  });
  if (rows.length) out.statistics = { asOf, rows };
  const group = list(obj(responses.specializations).specialization_groups).map(obj).find((g) => g.is_active === true);
  const trees = list(group?.specializations).flatMap((raw) => {
    const s = obj(raw), label = name(obj(s.specialization).name ?? s.specialization_name), points = number(s.spent_points);
    if (!label || points === null) return [];
    const talents = list(s.talents).flatMap((rawTalent) => {
      const t = obj(rawTalent), title = name(obj(t.talent).name), rank = number(t.talent_rank);
      return title && rank !== null ? [{ name: title, rank }] : [];
    }).slice(0, 100);
    return [{ name: label, points, talents }];
  }).slice(0, 10);
  if (trees.length) out.talents = { asOf, trees };
  const professions = obj(responses.professions);
  const skills = [...list(professions.primaries), ...list(professions.secondaries)].flatMap((raw) => {
    const p = obj(raw), label = name(obj(p.profession).name);
    // One profession may have several tiers; show the highest current tier.
    const tiers = list(p.tiers).map(obj).filter((t) => number(t.skill_points) !== null && number(t.max_skill_points) !== null && Number(t.max_skill_points) > 0)
      .sort((a, b) => Number(b.max_skill_points) - Number(a.max_skill_points));
    const t = tiers[0] ?? p, rank = number(t.skill_points), max = number(t.max_skill_points);
    return label && rank !== null && max !== null && max > 0 && rank <= max ? [{ name: label, rank, max }] : [];
  }).slice(0, 10);
  if (skills.length) out.professions = { asOf, rows: skills };
  const avatar = list(obj(responses.media).assets).map(obj).find((a) => a.key === "avatar" && typeof a.value === "string" && safePortrait(a.value));
  if (avatar) out.avatar = { asOf, url: avatar.value as string };
  // A well-formed answer with nothing completed is still a read, so these keep an empty list.
  if (Array.isArray(obj(responses.achievements).achievements)) {
    const seen = new Set<number>();
    const rows = list(obj(responses.achievements).achievements).flatMap((raw) => {
      const a = obj(raw), achievement = obj(a.achievement), key = id(a.id ?? achievement.id), title = name(achievement.name);
      const at = a.completed_timestamp, completedAt = typeof at === "number" && Number.isSafeInteger(at) && at > 0 ? new Date(at) : null;
      if (key === null || !title || !completedAt || Number.isNaN(completedAt.getTime()) || seen.has(key)) return [];
      seen.add(key);
      return [{ id: key, name: title, completedAt: completedAt.toISOString() }];
    }).slice(0, MAX_ACHIEVEMENTS);
    out.achievements = { asOf, rows };
  }
  if (Array.isArray(obj(responses.reputations).reputations)) {
    const seen = new Set<number>();
    const rows = list(obj(responses.reputations).reputations).flatMap((raw) => {
      const r = obj(raw), faction = obj(r.faction), standing = obj(r.standing), key = id(faction.id), title = name(faction.name), label = name(standing.name);
      if (key === null || !title || !label || seen.has(key)) return [];
      seen.add(key);
      const tier = number(standing.tier);
      return [{ id: key, name: title, standing: label, ...(tier !== null && Number.isInteger(tier) ? { tier } : {}) }];
    }).slice(0, MAX_REPUTATIONS);
    out.reputations = { asOf, rows };
  }
  if (Array.isArray(obj(responses.quests).quests)) {
    const completed = [...new Set(list(obj(responses.quests).quests).flatMap((raw) => {
      const key = id(obj(raw).id);
      return key === null ? [] : [key];
    }))].sort((a, b) => a - b).slice(0, MAX_QUESTS);
    out.quests = { asOf, completed };
  }
  const history = obj(responses["achievement-statistics"]);
  if (Array.isArray(history.categories)) {
    const groups: { name: string; rows: { id: number; name: string; value: number; note?: string }[] }[] = [];
    const ranked: Partial<Record<PlayHistoryRankedKey, number>> = {};
    const rankedKey = new Map(Object.entries(PLAY_HISTORY_RANKED).map(([k, v]) => [v as number, k as PlayHistoryRankedKey]));
    let room = MAX_PLAY_HISTORY;
    const add = (label: string, stats: unknown) => {
      const rows = list(stats).flatMap((raw) => {
        const s = obj(raw), key = id(s.id), title = name(s.name), value = count.safeParse(s.quantity).success ? s.quantity as number : null;
        if (key === null || !title || value === null || room <= 0) return [];
        room--;
        const k = rankedKey.get(key);
        if (k) ranked[k] = value;
        const note = name(s.description);
        return [{ id: key, name: title, value, ...(note ? { note } : {}) }];
      });
      if (rows.length) groups.push({ name: label, rows });
    };
    for (const raw of list(history.categories)) {
      const c = obj(raw), label = name(c.name);
      if (!label) continue;
      add(label, c.statistics);
      for (const rawSub of list(c.sub_categories)) {
        const sub = obj(rawSub), subLabel = name(sub.name);
        if (subLabel) add(`${label} · ${subLabel}`.slice(0, 120), sub.statistics);
      }
    }
    out.playHistory = { asOf, groups, ranked };
  }
  return out;
}
