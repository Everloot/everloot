import { createHmac } from "node:crypto";
import { z } from "zod";
import { CHARACTER_KEY, INSTALL_ID, recordSchemas } from "@everloot/protocol";
import { characterLinksOn, linkRealmKey } from "./character-links";

/**
 * Private sync (identity ADR section 4, accepted with D1 and D9 on 2026-11-06; showcase plan S5): a signed-in
 * player's Desktop App sends its own linked characters' rows with a sync:own key, and the site keeps the latest state
 * of each category for each live link. Off until EVERLOOT_PRIVATE_SYNC=1 (and EVERLOOT_CHARACTER_LINKS=1): with it
 * off every sync route answers 404 and nothing reads or writes the sync tables
 * (supabase/migrations/20261106120000_private_sync.sql).
 *
 * The rule follows the link, not the machine: a fact about a character is kept only when the sending account holds
 * that character's live link and has turned sync on for that category. The install a row came from is kept only as a
 * keyed hash, never raw, and never owns anything. This file holds the pure part: what a request may carry and how its
 * rows become one fact per category. Nothing here reads or writes storage.
 */

export function privateSyncOn(env: Record<string, string | undefined> = process.env): boolean {
  return characterLinksOn(env) && env.EVERLOOT_PRIVATE_SYNC === "1";
}

/** What a link can sync, in page order. `stats` and `pvp` are the player's own self-reported numbers. `achievements` is published under the Collections section's switch. */
export const SYNC_CATEGORIES = ["gear", "stats", "talents", "pvp", "professions", "reputations", "raids", "achievements"] as const;
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];
export const isSyncCategory = (v: unknown): v is SyncCategory => (SYNC_CATEGORIES as readonly unknown[]).includes(v);

/** The visibility switch that publishes each category. Gear and collections reuse the switches the links shipped with. */
export const SHOW_SWITCH: Record<SyncCategory, string> = {
  gear: "show_gear", stats: "show_stats", talents: "show_talents", pvp: "show_pvp", professions: "show_professions",
  reputations: "show_reputations", raids: "show_raids", achievements: "show_collections",
};

/** Characters one request may carry, and rows across them. A full completion file is a few thousand rows. */
export const SYNC_CHARACTERS_PER_REQUEST = 10;
export const SYNC_ROWS_PER_REQUEST = 10_000;
/** A capture dated further ahead than this is dropped: stored, it would block every later capture. */
const FUTURE_MS = 86_400_000;

/**
 * profession_owned, lockout_owned and talent_owned stay on the computer except for this endpoint (the addon's owned
 * and talents modules), so the protocol has no schema for them and the public intake refuses them. Their shapes are
 * defined here, for this endpoint only, from the addon's rows: adding them to `recordSchemas` would let the intake take them.
 */
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

/** The kinds this endpoint reads, each with the category it feeds. Any other kind is skipped. */
const SCHEMAS = {
  gear_snapshot: recordSchemas.gear_snapshot,
  talent_owned: talentOwned,
  profession_owned: professionOwned,
  reputation_owned: recordSchemas.reputation_owned,
  lockout_owned: lockoutOwned,
  achievement_owned: recordSchemas.achievement_owned,
  title_owned: recordSchemas.title_owned,
} as const;
type Kind = keyof typeof SCHEMAS;
export type SyncRow = z.infer<(typeof SCHEMAS)[Kind]>;
const CATEGORY_OF: Record<Kind, SyncCategory> = {
  gear_snapshot: "gear", talent_owned: "talents", profession_owned: "professions", reputation_owned: "reputations",
  lockout_owned: "raids", achievement_owned: "achievements", title_owned: "achievements",
};

/** One row of a request, checked against its kind's schema; null when it is not one this endpoint reads. */
export function parseSyncRow(value: unknown): SyncRow | null {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || !Object.hasOwn(SCHEMAS, kind)) return null;
  const parsed = SCHEMAS[kind as Kind].safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** One category's latest state, as stored: the server's own shape, with no install id, key or name in it. */
export interface Fact { category: SyncCategory; capturedAt: string; installId: string; data: Record<string, unknown> }

export interface CharacterFacts {
  /** The class the rows report, for the database to compare with the link's; null when only gear came. */
  class: string | null;
  facts: Fact[];
  /** Rows not used: another kind, a bad shape, another character, a capture from the future, or an older install's. */
  skipped: number;
}

const time = (row: { capturedAt: string }) => Date.parse(row.capturedAt);
const newest = <T extends { capturedAt: string }>(rows: readonly T[]): T => rows.reduce((a, b) => (time(b) > time(a) ? b : a));
/** The newest row per key. */
function latestBy<T extends { capturedAt: string }>(rows: readonly T[], key: (r: T) => string | number): T[] {
  const by = new Map<string | number, T>();
  for (const r of rows) {
    const k = key(r);
    const had = by.get(k);
    if (!had || time(r) > time(had)) by.set(k, r);
  }
  return [...by.values()];
}

/**
 * One character's rows, as a request groups them under `{ name, realm }`, turned into at most one fact per category.
 * Each category takes the rows of the install that sent its newest row, so two machines' states never mix; the newest
 * capture among them is the fact's date. A gear row naming another character, a row from the future, and rows of
 * another install for the category are skipped. `null` when the group cannot be one character: owned rows of one
 * install under two character keys, or two classes.
 */
export function buildCharacterFacts(name: string, realm: string, rows: readonly SyncRow[], now: Date): CharacterFacts | null {
  let skipped = 0;
  const latest = now.getTime() + FUTURE_MS;
  const usable: SyncRow[] = [];
  for (const r of rows) {
    if (time(r) > latest) { skipped++; continue; }
    if (r.kind === "gear_snapshot" && (r.character.toLowerCase() !== name.toLowerCase() || linkRealmKey(r.realm) !== linkRealmKey(realm))) {
      skipped++;
      continue;
    }
    usable.push(r);
  }
  const classes = new Set<string>();
  const keys = new Map<string, string>();
  for (const r of usable) {
    if ("class" in r) classes.add(r.class.toUpperCase());
    if ("characterKey" in r) {
      const had = keys.get(r.installId);
      if (had && had !== r.characterKey) return null;
      keys.set(r.installId, r.characterKey);
    }
  }
  if (classes.size > 1) return null;

  const facts: Fact[] = [];
  for (const category of SYNC_CATEGORIES) {
    const all = usable.filter((r) => CATEGORY_OF[r.kind] === category);
    if (all.length === 0) continue;
    const installId = newest(all).installId;
    const mine = all.filter((r) => r.installId === installId);
    skipped += all.length - mine.length;
    const data = categoryData(category, mine, now);
    if (!data) continue;
    facts.push({ category, installId, capturedAt: new Date(time(newest(mine))).toISOString(), data });
  }
  return { class: classes.size ? [...classes][0]! : null, facts, skipped };
}

type Of<K extends Kind> = Extract<SyncRow, { kind: K }>;
const only = <K extends Kind>(rows: readonly SyncRow[], kind: K) => rows.filter((r): r is Of<K> => r.kind === kind);

function categoryData(category: SyncCategory, rows: readonly SyncRow[], now: Date): Record<string, unknown> | null {
  switch (category) {
    case "gear": {
      const g = newest(only(rows, "gear_snapshot"));
      return { equipped: g.equipped.map((e) => ({ slot: e.slot, itemId: e.itemId, itemLevel: e.itemLevel })) };
    }
    case "stats":
    case "pvp":
      // No row kind feeds these yet (a later change adds them), so a request can never build one.
      return null;
    case "talents": {
      const t = newest(only(rows, "talent_owned"));
      return {
        class: t.class.toUpperCase(), treeId: t.treeId, specId: t.specId ?? null, points: t.points,
        nodes: [...t.nodes].sort((a, b) => a.nodeId - b.nodeId).map((n) => ({ nodeId: n.nodeId, ranks: n.ranks, ...(n.choice === undefined ? {} : { choice: n.choice }) })),
      };
    }
    case "professions":
      return {
        professions: latestBy(only(rows, "profession_owned"), (r) => r.profession.toLowerCase())
          .sort((a, b) => a.profession.localeCompare(b.profession))
          .map((r) => ({ name: r.profession, skillLine: r.skillLine ?? null, rank: r.rank, maxRank: r.maxRank })),
      };
    case "reputations":
      return {
        factions: latestBy(only(rows, "reputation_owned"), (r) => r.factionId)
          .sort((a, b) => a.factionId - b.factionId)
          .map((r) => ({ factionId: r.factionId, reaction: r.reaction, standing: r.standing, floor: r.floor, ceiling: r.ceiling })),
      };
    case "raids":
      // A lockout already reset is gone: an empty list is a real answer, "no lockout this week".
      return {
        lockouts: latestBy(only(rows, "lockout_owned"), (r) => `${r.instanceId ?? r.instance}:${r.difficultyId ?? r.difficulty ?? ""}`)
          .filter((r) => Date.parse(r.resetAt) > now.getTime())
          .sort((a, b) => a.instance.localeCompare(b.instance))
          .map((r) => ({
            instance: r.instance, instanceId: r.instanceId ?? null, difficulty: r.difficulty ?? null, difficultyId: r.difficultyId ?? null,
            killed: r.bossesKilledCount, total: r.bossesTotal, resetAt: new Date(Date.parse(r.resetAt)).toISOString(),
          })),
      };
    case "achievements": {
      // Earned by this character only: a link proves one character, not the account. An achievement complete on the
      // account but not by this character, or a row that does not say who earned it, would publish what other,
      // unlinked characters did, so it is left out.
      const earned = latestBy(only(rows, "achievement_owned"), (r) => r.achievementId)
        .filter((r) => r.completed && r.earnedByMe === true)
        .sort((a, b) => a.achievementId - b.achievementId)
        .map((r) => ({ id: r.achievementId, on: r.earnedOn ?? null }));
      const titles = [...new Set(only(rows, "title_owned").flatMap((r) => r.titleIds))].sort((a, b) => a - b);
      return { achievements: earned, titleIds: titles };
    }
  }
}

/** The keyed hash kept in place of an install id: the same secret family as links, its own `source:` prefix. */
export function sourceRef(installId: string, secret: string): string {
  return createHmac("sha256", secret).update(`source:${installId}`).digest("hex");
}
