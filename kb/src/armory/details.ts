import { z } from "zod";

// Forever's active talent-group shape: https://jsr.io/@pinta365/blizzard-api/doc/wow-forever
// Keep a small page-only projection, never the complete API response.
const text = z.string().min(1).max(120);
const amount = z.number().finite().nonnegative();
const date = z.string().datetime();
export const ArmoryDetails = z.object({
  revision: z.literal(1),
  retry: z.literal(true).optional(),
  statistics: z.object({ asOf: date, rows: z.array(z.object({ label: text, value: amount, percent: z.boolean() })).max(40) }).optional(),
  talents: z.object({ asOf: date, trees: z.array(z.object({ name: text, points: amount, talents: z.array(z.object({ name: text, rank: amount })).max(100) })).max(10) }).optional(),
  professions: z.object({ asOf: date, rows: z.array(z.object({ name: text, rank: amount, max: amount.positive() })).max(10) }).optional(),
  avatar: z.object({ asOf: date, url: z.string().url().refine(safePortrait) }).optional(),
});
export type ProfileDetails = z.infer<typeof ArmoryDetails>;
type ObjectValue = Record<string, unknown>;
const obj = (v: unknown): ObjectValue => v !== null && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const name = (v: unknown) => text.safeParse(v).success ? v as string : null;
const number = (v: unknown) => amount.safeParse(v).success ? v as number : null;

export function safePortrait(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "render.worldofwarcraft.com" && !u.port && !u.username && !u.password &&
      /^\/forever-(us|eu)\/character\/[\w/-]+-avatar\.(jpg|png)$/.test(u.pathname) && !u.search && !u.hash;
  } catch { return false; }
}

export const DETAIL_KEYS = ["statistics", "specializations", "professions", "media"] as const;
export type DetailKey = typeof DETAIL_KEYS[number];
/** Follow a profile's advertised link, never a submitted URL or a link to another character. */
export function detailPath(profile: unknown, key: DetailKey, region: string, slug: string): string | null {
  const root = obj(profile);
  const href = obj(root[key] ?? root[key === "media" ? "character_media" : key]).href;
  if (typeof href !== "string") return null;
  try {
    const u = new URL(href);
    const base = `/profile/wow/character/${encodeURIComponent(slug)}/`;
    const suffix = key === "media" ? "character-media" : key;
    return u.protocol === "https:" && u.host === `${region}.api.blizzard.com` && !u.username && !u.password &&
      decodeURIComponent(u.pathname) === decodeURIComponent(`${base}${suffix}`) ? u.pathname : null;
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
  return out;
}
