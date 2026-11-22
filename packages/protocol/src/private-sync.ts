import { z } from "zod";
import { CHARACTER_KEY, INSTALL_ID, recordSchemas } from "./records.js";

/**
 * Transport validation for private character sync, shared by the sender and server.
 * Private-only kinds must never be added to recordSchemas: public intake rejects them.
 * Authorization, environment gates, visibility switches and storage belong to the server.
 */
/** What a link can sync, in page order. `stats`, `pvp` and `gold` are the player's own self-reported numbers. `achievements` is published under the Collections section's switch. */
export const SYNC_CATEGORIES = ["gear", "stats", "talents", "pvp", "professions", "reputations", "raids", "achievements", "gold"] as const;
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];
export const isSyncCategory = (v: unknown): v is SyncCategory => (SYNC_CATEGORIES as readonly unknown[]).includes(v);

/** Characters one request may carry, and rows across them. A full completion file is a few thousand rows. */
export const SYNC_CHARACTERS_PER_REQUEST = 10;
export const SYNC_ROWS_PER_REQUEST = 10_000;
const ownedBase = z.object({
  installId: INSTALL_ID,
  capturedAt: z.string().datetime({ offset: true }),
  characterKey: CHARACTER_KEY,
  class: z.string().min(2).max(20).regex(/^[A-Za-z]+$/),
  level: z.number().int().min(1).max(100),
});
export const professionOwned = ownedBase.extend({
  kind: z.literal("profession_owned"),
  profession: z.string().min(1).max(60),
  skillLine: z.number().int().positive().max(2_000_000_000).optional(),
  rank: z.number().int().min(0).max(1000),
  maxRank: z.number().int().min(1).max(1000),
}).refine((r) => r.rank <= r.maxRank, { message: "rank cannot exceed maxRank", path: ["rank"] });
export const lockoutOwned = ownedBase.extend({
  kind: z.literal("lockout_owned"),
  instance: z.string().min(1).max(120),
  instanceId: z.number().int().positive().max(2_000_000_000).optional(),
  difficultyId: z.number().int().nonnegative().max(1000).optional(),
  difficulty: z.string().min(1).max(60).optional(),
  bossesKilledCount: z.number().int().min(0).max(100),
  bossesTotal: z.number().int().min(1).max(100),
  resetAt: z.string().datetime({ offset: true }),
}).refine((r) => r.bossesKilledCount <= r.bossesTotal, { message: "bossesKilledCount cannot exceed bossesTotal", path: ["bossesKilledCount"] });
/**
 * The active talent build of one linked character, keyed like the other owned rows. The public talent_snapshot carries
 * no character key and is not read here, so an anonymous row can never become a character's fact. Same refinements as
 * the protocol's talentSnapshot; `choice` is a zero-based entry index, so 0 is valid.
 */
export const talentOwned = ownedBase.extend({
  kind: z.literal("talent_owned"),
  treeId: z.number().int().positive(),
  specId: z.number().int().positive().optional(),
  points: z.number().int().nonnegative().max(500),
  nodes: z.array(z.object({
    nodeId: z.number().int().positive(),
    ranks: z.number().int().min(1).max(50),
    choice: z.number().int().min(0).max(3).optional(),
  })).max(600),
}).superRefine((row, ctx) => {
  if (row.points !== row.nodes.reduce((sum, node) => sum + node.ranks, 0)) {
    ctx.addIssue({ code: "custom", message: "talent points must equal the sum of node ranks", path: ["points"] });
  }
  if (new Set(row.nodes.map((node) => node.nodeId)).size !== row.nodes.length) {
    ctx.addIssue({ code: "custom", message: "talent node ids must be unique", path: ["nodes"] });
  }
});

/**
 * The character window's numbers, as the addon records them: exactly these keys, grouped as the page groups them.
 * Percent keys are rounded to 2 decimals by the addon. An absent key was not readable; it is never a zero.
 */
export const STAT_KEYS = [
  "strength", "agility", "stamina", "intellect", "spirit",
  "meleeAttackPower", "meleeHit", "meleeCrit", "meleeHaste", "expertise",
  "rangedAttackPower", "rangedHit", "rangedCrit", "rangedHaste",
  "spellPower", "healing", "spellHit", "spellCrit", "spellHaste",
  "armor", "defense", "dodge", "parry", "block",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];
const isStatKey = (k: string): k is StatKey => (STAT_KEYS as readonly string[]).includes(k);
/**
 * One linked character's sheet. Unknown keys are dropped, not refused, so an older site tolerates a newer addon; a row
 * left with no known key is refused. Each value must be a finite number.
 */
export const statsOwned = ownedBase.extend({
  kind: z.literal("stats_owned"),
  stats: z.record(z.string(), z.unknown()).transform((raw, ctx) => {
    const out: Partial<Record<StatKey, number>> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isStatKey(key)) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        ctx.addIssue({ code: "custom", message: `${key} must be a finite number` });
        return z.NEVER;
      }
      out[key] = value;
    }
    if (Object.keys(out).length === 0) {
      ctx.addIssue({ code: "custom", message: "stats needs at least one known stat" });
      return z.NEVER;
    }
    return out;
  }),
});

const pvpInt = z.number().int().min(0).max(2_000_000_000);
/**
 * One linked character's PvP standing, as the addon records it: each number is optional (an unreadable one is absent,
 * never a zero), but a row holds the rank or the honorable kills, or it says nothing.
 */
export const pvpOwned = ownedBase.extend({
  kind: z.literal("pvp_owned"),
  rank: pvpInt.optional(),
  rankPoints: pvpInt.optional(),
  rankThreshold: pvpInt.optional(),
  rankMax: pvpInt.optional(),
  season: pvpInt.optional(),
  honorableKills: pvpInt.optional(),
}).refine((r) => r.rank !== undefined || r.honorableKills !== undefined, { message: "pvp needs a rank or honorable kills", path: ["rank"] });

/**
 * The Statistics window's Wealth and auction entries the addon reads with GetStatistic: `money` ids are copper,
 * `counts` are plain counts. Gold is private and never ranked.
 */
export const WEALTH_STATS = {
  money: [328, 333, 326, 921, 919, 334, 331, 332, 1146, 1147, 1148, 1150],
  counts: [329, 330, 1149],
} as const;
const WEALTH_IDS = new Set<string>([...WEALTH_STATS.money, ...WEALTH_STATS.counts].map(String));
const wealthAmount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/**
 * One linked character's lifetime gold statistics, keyed by statistic id. Unknown ids are dropped, not refused; a row
 * left with no known id is refused. An unreadable statistic is absent, never a zero.
 */
export const wealthOwned = ownedBase.extend({
  kind: z.literal("wealth_owned"),
  stats: z.record(z.string(), z.unknown()).transform((raw, ctx) => {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!WEALTH_IDS.has(key)) continue;
      if (!wealthAmount.safeParse(value).success) {
        ctx.addIssue({ code: "custom", message: `${key} must be a whole number of at least 0` });
        return z.NEVER;
      }
      out[key] = value as number;
    }
    if (Object.keys(out).length === 0) {
      ctx.addIssue({ code: "custom", message: "stats needs at least one known statistic" });
      return z.NEVER;
    }
    return out;
  }),
});

/** The kinds this endpoint reads, each with the category it feeds. Any other kind is skipped. */
const SCHEMAS = {
  gear_snapshot: recordSchemas.gear_snapshot,
  talent_owned: talentOwned,
  stats_owned: statsOwned,
  pvp_owned: pvpOwned,
  profession_owned: professionOwned,
  reputation_owned: recordSchemas.reputation_owned,
  lockout_owned: lockoutOwned,
  achievement_owned: recordSchemas.achievement_owned,
  title_owned: recordSchemas.title_owned,
  wealth_owned: wealthOwned,
} as const;
type Kind = keyof typeof SCHEMAS;
export type SyncRow = z.infer<(typeof SCHEMAS)[Kind]>;
/** One row of a request, checked against its kind's schema; null when it is not one this endpoint reads. */
export function parseSyncRow(value: unknown): SyncRow | null {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || !Object.hasOwn(SCHEMAS, kind)) return null;
  const parsed = SCHEMAS[kind as Kind].safeParse(value);
  return parsed.success ? parsed.data : null;
}

