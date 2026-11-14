import { createHmac } from "node:crypto";
import { STAT_KEYS, SYNC_CATEGORIES, type StatKey, type SyncCategory, type SyncRow } from "@everloot/protocol/private-sync";
export {
  SYNC_CATEGORIES, isSyncCategory, SYNC_CHARACTERS_PER_REQUEST, SYNC_ROWS_PER_REQUEST,
  professionOwned, lockoutOwned, talentOwned, statsOwned, pvpOwned, STAT_KEYS, parseSyncRow,
  type StatKey, type SyncCategory, type SyncRow,
} from "@everloot/protocol/private-sync";
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

/** The visibility switch that publishes each category. Gear and collections reuse the switches the links shipped with. */
export const SHOW_SWITCH: Record<SyncCategory, string> = {
  gear: "show_gear", stats: "show_stats", talents: "show_talents", pvp: "show_pvp", professions: "show_professions",
  reputations: "show_reputations", raids: "show_raids", achievements: "show_collections",
};

/** A capture dated further ahead than this is dropped: stored, it would block every later capture. */
const FUTURE_MS = 86_400_000;

export const ATTRIBUTE_KEYS: readonly StatKey[] = ["strength", "agility", "stamina", "intellect", "spirit"];
/** A stat of exactly 0 is not shown in game (except the five attributes), so it is not stored either. */
export const keepStat = (key: StatKey, value: number) => value !== 0 || ATTRIBUTE_KEYS.includes(key);
type Kind = SyncRow["kind"];
const CATEGORY_OF: Record<Kind, SyncCategory> = {
  gear_snapshot: "gear", talent_owned: "talents", stats_owned: "stats", pvp_owned: "pvp", profession_owned: "professions", reputation_owned: "reputations",
  lockout_owned: "raids", achievement_owned: "achievements", title_owned: "achievements",
};

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
    case "stats": {
      const s = newest(only(rows, "stats_owned"));
      // Keys in the page's order; a zero outside the attributes is not a shown stat.
      const stats = Object.fromEntries(STAT_KEYS.flatMap((k) => { const v = s.stats[k]; return v !== undefined && keepStat(k, v) ? [[k, v]] : []; }));
      return Object.keys(stats).length ? { stats } : null;
    }
    case "pvp": {
      const p = newest(only(rows, "pvp_owned"));
      return {
        rank: p.rank ?? null, rankPoints: p.rankPoints ?? null, rankThreshold: p.rankThreshold ?? null,
        rankMax: p.rankMax ?? null, season: p.season ?? null, honorableKills: p.honorableKills ?? null,
      };
    }
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
