import { createHmac } from "node:crypto";
import type { SyncRow } from "@everloot/protocol/private-sync";
export {
  SYNC_CHARACTERS_PER_REQUEST, SYNC_ROWS_PER_REQUEST, lockoutOwned, parseSyncRow, type SyncRow,
} from "@everloot/protocol/private-sync";
import { characterLinksOn } from "./character-links";

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

/**
 * What a link can still sync, in page order. Blizzard's character API supplies gear, stats, talents, PvP,
 * professions, reputations and earned achievements, so those categories are retired (the data policy's amendment of
 * 17 November 2026): `achievements` keeps only titles, which the API does not return. The protocol still lists the
 * retired categories, so an older Desktop App that sends them gets a success answer that drops them. `gold` is the
 * addon's lifetime gold statistics, which the API does not show either; it is never ranked.
 */
export const SYNC_CATEGORIES = ["raids", "achievements", "gold"] as const;
export type SyncCategory = (typeof SYNC_CATEGORIES)[number];
export const isSyncCategory = (v: unknown): v is SyncCategory => (SYNC_CATEGORIES as readonly unknown[]).includes(v);

/** The visibility switch that publishes each category. */
export const SHOW_SWITCH: Record<SyncCategory, string> = { raids: "show_raids", achievements: "show_collections", gold: "show_gold" };

/** A capture dated further ahead than this is dropped: stored, it would block every later capture. */
const FUTURE_MS = 86_400_000;

type Kind = SyncRow["kind"];
/** The category each kind still feeds; null for a retired kind, whose rows are dropped and counted as skipped. */
const CATEGORY_OF: Record<Kind, SyncCategory | null> = {
  gear_snapshot: null, talent_owned: null, stats_owned: null, pvp_owned: null, profession_owned: null, reputation_owned: null,
  achievement_owned: null, lockout_owned: "raids", title_owned: "achievements", wealth_owned: "gold",
};

/** One category's latest state, as stored: the server's own shape, with no install id, key or name in it. */
export interface Fact { category: SyncCategory; capturedAt: string; installId: string; data: Record<string, unknown> }

export interface CharacterFacts {
  /** The class the rows report, for the database to compare with the link's; null when no kept row came. */
  class: string | null;
  facts: Fact[];
  /** Rows not used: a retired or other kind, a bad shape, a capture from the future, or an older install's. */
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
 * capture among them is the fact's date. A row of a retired kind, a row from the future, and rows of another install
 * for the category are skipped. `null` when the group cannot be one character: owned rows of one install under two
 * character keys, or two classes.
 */
export function buildCharacterFacts(rows: readonly SyncRow[], now: Date): CharacterFacts | null {
  let skipped = 0;
  const latest = now.getTime() + FUTURE_MS;
  const usable: SyncRow[] = [];
  for (const r of rows) {
    if (CATEGORY_OF[r.kind] === null || time(r) > latest) { skipped++; continue; }
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
    case "achievements":
      // Titles only: earned achievements come from Blizzard's character API through the armory.
      return { titleIds: [...new Set(only(rows, "title_owned").flatMap((r) => r.titleIds))].sort((a, b) => a - b) };
    case "gold":
      // One row per capture holds every statistic the addon could read; the newest is the state.
      return { stats: { ...newest(only(rows, "wealth_owned")).stats } };
  }
}

/** The keyed hash kept in place of an install id: the same secret family as links, its own `source:` prefix. */
export function sourceRef(installId: string, secret: string): string {
  return createHmac("sha256", secret).update(`source:${installId}`).digest("hex");
}
