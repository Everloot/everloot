/**
 * The Everloot Score, version 1: one number per character and one per account, from rows Everloot captures, never
 * an estimate. It follows section 3 of docs/design/2026-11-02-profiles-score-rankings-plan.md; the weights there are
 * the owner's to settle (decision D2), so they live in one table below. Pure: callers hand in the facts. Nothing
 * shows the score yet; public display waits on the public-character policy
 * (docs/design/2026-11-01-public-character-policy-draft.md). In plain words: docs/design/2026-11-02-everloot-score.md.
 *
 * - Progress = Raid + Dungeon: each distinct boss and difficulty the character killed this season, counted only when
 *   other installs corroborate the kill. A raid boss is worth 10 times its raid's tier, a dungeon boss 1, a dungeon's
 *   final boss 3.
 * - Completion = Achievements + Reputations + Titles + Quests, from the character's own completion rows, on the
 *   lists 3 installs agree on.
 * - Speed and PvP: defined, not scored. Each will be its own component, so adding one changes no other.
 *
 * Only the character's own rows count: rows its own install sent under its own key. Missing data is unknown, never
 * zero, and a character with an unknown component has no total.
 */
import type { CompletionFacts } from "./completion.js";

export const SCORE_VERSION = 1;

/** Section 3.2's weights: a proposal until the owner settles decision D2. Any change is a new SCORE_VERSION. */
export const WEIGHTS = {
  /** A raid boss is worth this many points per tier of its raid. */
  raidPerTier: 10,
  dungeonBoss: 1,
  dungeonFinalBoss: 3,
  /** Achievement points are divided by this, rounded down over the character's total. */
  achievementPointsPer: 10,
  exalted: 10,
  title: 5,
  /** One point per this many completed quests, rounded down. */
  questsPerPoint: 25,
} as const;

/** Section 3.3, rule 2: a kill counts when this many other installs, from this many other addresses, saw it. */
export const CORROBORATION = { installs: 2, addresses: 2, windowMinutes: 10 } as const;
/** A kill counts only when the character is at most this many levels under the instance's lowest level (rule 4). */
export const LEVEL_SLACK = 5;
/** Rule 6: a kill dated more than this many days before its upload, or a day after it, does not count. */
export const DAYS_BACK = 30;

export const COMPONENTS = ["progress", "completion", "speed", "pvp"] as const;
export type ComponentKey = (typeof COMPONENTS)[number];

const DAY_MS = 86_400_000;
/** The client's reaction index for Exalted, the top of the eight standings. */
const EXALTED = 8;

// --- Inputs ---

/**
 * A character to score: its install and the completion module's 8-hex key for it. `level` is the level its link row
 * last sent; without it the level of its own completion rows is used.
 */
export interface ScoreCharacterRef { installId: string; characterKey: string; level?: number }

/** One instance whose bosses score: the 3-install agreed boss list, with what the game files add. */
export interface ScoreInstance {
  instanceMapId: number;
  kind: "raid" | "dungeon" | null;
  /** The agreed bosses. A boss off this list never scores. */
  bosses: readonly number[];
  /** The last encounter the game files list for a dungeon: its final boss. Absent when the files list none. */
  finalBoss?: number;
  /** The instance's lowest level in the game files, for the level check; absent when they give none. */
  minLevel?: number;
}

/**
 * One kill of the character's own, the `kill_owned` row the plan proposes (section 9, P2). It is not in the protocol
 * yet. `receivedAt` is the server's time when the row arrived.
 */
export interface OwnKill {
  installId: string;
  characterKey: string;
  encounterId: number;
  instanceMapId: number;
  difficulty?: number;
  success: boolean;
  capturedAt: string;
  receivedAt: string;
}

/** An anonymous `encounter` row, with the keyed hash of the address its upload came from. */
export interface WitnessKill { installId: string; reporter: string; encounterId: number; difficulty?: number; success: boolean; capturedAt: string }

/** A guild kill 2 installs agree on, as the guild rollup gives it (`AgreedKill` in guilds.ts). */
export interface GuildKill { guildName: string; realm: string; encounterId: number; killedAt: string }

export interface ProgressFacts {
  instances: readonly ScoreInstance[];
  /** The curated raid tier list the owner signs off, by instance map id: 1 is the first raid tier. */
  raidTiers: ReadonlyMap<number, number>;
  /** When this season started: kills before it count for nothing. Progress resets when a new raid tier opens. */
  seasonStart: string;
  kills: readonly OwnKill[];
  witnesses: readonly WitnessKill[];
  guildKills: readonly GuildKill[];
  /** Characters (`characterId`) whose own kill rows are synced: one with no kill has measured zero. */
  recorders: ReadonlySet<string>;
  /** The guild each character's own sync names, by `characterId`. */
  guilds: ReadonlyMap<string, { guildName: string; realm: string }>;
}

export interface ScoreContext {
  /** The server's time: nothing dated after it counts. */
  asOf: Date;
  /** Launch: nothing dated before it counts. */
  launch: string;
  /** Null while own kills are not recorded for anyone: Progress is then not scored. */
  progress: ProgressFacts | null;
  /** The agreed achievement, reputation and title lists and every character's own completion rows. */
  completion: CompletionFacts;
  /** The agreed quest list; null while there is none, which leaves Quests out for everyone. */
  agreedQuests: ReadonlySet<number> | null;
  /** Install ids marked contested (two accounts present the same one): none of their rows count. */
  contested: ReadonlySet<string>;
}

// --- Outputs ---

export type PartKey = "raid" | "dungeon" | "achievements" | "reputations" | "titles" | "quests";
/** `count` is what was counted: bosses, achievement points, factions, titles or quests. */
export interface PartScore { key: PartKey; count: number; points: number }

/** Why one of the character's own kills scored nothing. */
export type KillDrop =
  | "wipe" | "not on the boss list" | "raid not on the tier list" | "before the season" | "date out of range"
  | "level unknown" | "under the level band" | "not corroborated" | "repeat";

export type ComponentScore =
  | { key: ComponentKey; status: "scored"; points: number; parts: PartScore[] }
  /** Others have this data and this character does not: no points, and no total. */
  | { key: ComponentKey; status: "unknown"; missing: string }
  /** Nobody's data of this kind is scored yet; it is left out of every total alike. */
  | { key: ComponentKey; status: "not-scored"; reason: string };

export interface CharacterScore {
  version: number;
  asOf: string;
  installId: string;
  characterKey: string;
  progress: ComponentScore;
  completion: ComponentScore;
  speed: ComponentScore;
  pvp: ComponentScore;
  /** Progress plus Completion, or null when either is unknown for this character. */
  total: number | null;
  /** The bosses that scored, as `encounterId:difficulty`, and why the others did not. */
  kills: { counted: string[]; dropped: Partial<Record<KillDrop, number>> };
}

// --- One character ---

/** One key for a character across inputs: its install and completion key, trimmed and in lower case. */
export const characterId = (installId: string, characterKey: string) => `${installId.trim()}:${characterKey.trim().toLowerCase()}`;

const bossKey = (encounterId: number, difficulty: number | undefined) => `${encounterId}:${difficulty ?? "-"}`;
const utcDay = (iso: string) => new Date(Date.parse(iso)).toISOString().slice(0, 10);

/** Rule 2: two other installs from two other addresses saw the same kill within ten minutes, or the guild owns it that day. */
function corroborated(kill: OwnKill, facts: ProgressFacts, contested: ReadonlySet<string>, guild: { guildName: string; realm: string } | undefined): boolean {
  const at = Date.parse(kill.capturedAt);
  const window = CORROBORATION.windowMinutes * 60_000;
  const installs = new Set<string>();
  const addresses = new Set<string>();
  for (const w of facts.witnesses) {
    const install = w.installId.trim();
    if (install === kill.installId.trim() || contested.has(install) || !w.success || w.encounterId !== kill.encounterId || w.difficulty !== kill.difficulty) continue;
    if (!(Math.abs(Date.parse(w.capturedAt) - at) <= window)) continue;
    installs.add(install);
    addresses.add(w.reporter);
  }
  if (installs.size >= CORROBORATION.installs && addresses.size >= CORROBORATION.addresses) return true;
  if (!guild) return false;
  const day = utcDay(kill.capturedAt);
  return facts.guildKills.some((g) => g.encounterId === kill.encounterId && g.guildName === guild.guildName && g.realm === guild.realm && utcDay(g.killedAt) === day);
}

function progressOf(ref: ScoreCharacterRef, level: number | null, ctx: ScoreContext): { score: ComponentScore; kills: CharacterScore["kills"] } {
  const kills: CharacterScore["kills"] = { counted: [], dropped: {} };
  const facts = ctx.progress;
  if (!facts) return { score: { key: "progress", status: "not-scored", reason: "The addon does not record a character's own kills yet." }, kills };
  const id = characterId(ref.installId, ref.characterKey);
  if (!facts.recorders.has(id) || ctx.contested.has(ref.installId.trim())) return { score: { key: "progress", status: "unknown", missing: "own boss kills" }, kills };

  const instanceOf = new Map<number, ScoreInstance>();
  for (const i of [...facts.instances].sort((a, b) => a.instanceMapId - b.instanceMapId)) for (const b of i.bosses) if (!instanceOf.has(b)) instanceOf.set(b, i);
  const seasonStart = Math.max(Date.parse(facts.seasonStart), Date.parse(ctx.launch));
  const now = ctx.asOf.getTime();
  const drop = (why: KillDrop) => { kills.dropped[why] = (kills.dropped[why] ?? 0) + 1; };
  const counted = new Map<string, { raid: boolean; points: number }>();

  const own = facts.kills
    .filter((k) => characterId(k.installId, k.characterKey) === id)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.encounterId - b.encounterId);
  for (const k of own) {
    const at = Date.parse(k.capturedAt);
    const received = Date.parse(k.receivedAt);
    const instance = instanceOf.get(k.encounterId);
    if (!k.success) { drop("wipe"); continue; }
    if (!instance || instance.instanceMapId !== k.instanceMapId || instance.kind === null) { drop("not on the boss list"); continue; }
    if (!Number.isFinite(at) || !Number.isFinite(received) || at > now || at > received + DAY_MS || at < received - DAYS_BACK * DAY_MS) { drop("date out of range"); continue; }
    if (at < seasonStart) { drop("before the season"); continue; }
    const tier = instance.kind === "raid" ? facts.raidTiers.get(instance.instanceMapId) : undefined;
    if (instance.kind === "raid" && !(tier && tier > 0)) { drop("raid not on the tier list"); continue; }
    if (instance.minLevel !== undefined && level === null) { drop("level unknown"); continue; }
    if (instance.minLevel !== undefined && level! < instance.minLevel - LEVEL_SLACK) { drop("under the level band"); continue; }
    const key = bossKey(k.encounterId, k.difficulty);
    if (counted.has(key)) { drop("repeat"); continue; }
    if (!corroborated(k, facts, ctx.contested, facts.guilds.get(id))) { drop("not corroborated"); continue; }
    const points = instance.kind === "raid" ? WEIGHTS.raidPerTier * tier! : instance.finalBoss === k.encounterId ? WEIGHTS.dungeonFinalBoss : WEIGHTS.dungeonBoss;
    counted.set(key, { raid: instance.kind === "raid", points });
  }
  kills.counted = [...counted.keys()].sort();
  const sum = (raid: boolean) => [...counted.values()].filter((c) => c.raid === raid);
  const parts: PartScore[] = [true, false].map((raid) => {
    const list = sum(raid);
    return { key: raid ? "raid" : "dungeon", count: list.length, points: list.reduce((s, c) => s + c.points, 0) };
  });
  return { score: { key: "progress", status: "scored", points: parts.reduce((s, p) => s + p.points, 0), parts }, kills };
}

function completionOf(ref: ScoreCharacterRef, ctx: ScoreContext): { score: ComponentScore; level: number | null } {
  const facts = ctx.completion;
  const anyList = facts.achievements.size + facts.factions.size + facts.titles.size + (ctx.agreedQuests?.size ?? 0) > 0;
  const id = characterId(ref.installId, ref.characterKey);
  // The character's own rows, from its own install under its own key. Nothing else stands in for them.
  const owned = ctx.contested.has(ref.installId.trim()) ? undefined : facts.owned.find((c) => characterId(c.installId, c.characterKey) === id);
  const level = owned?.level ?? null;
  if (!anyList) return { score: { key: "completion", status: "not-scored", reason: "No list has three installs agreeing on it yet." }, level };
  if (!owned) return { score: { key: "completion", status: "unknown", missing: "own completion rows" }, level };

  const launchDay = utcDay(ctx.launch);
  let achievementPoints = 0;
  for (const a of facts.achievements.values()) {
    const mine = owned.achievements.get(a.achievementId);
    // Earned on another character of the account counts for that one; earned before launch counts for nothing.
    if (!mine || !mine.completed || mine.earnedByMe === false || (mine.earnedOn && mine.earnedOn < launchDay)) continue;
    achievementPoints += a.points;
  }
  // Major and renown-style factions are left out: only the eight standings reach Exalted.
  const exalted = [...facts.factions.values()].filter((f) => !f.major && owned.factions.get(f.factionId)?.reaction === EXALTED).length;
  const titles = [...facts.titles.keys()].filter((t) => owned.titles.has(t)).length;
  const parts: PartScore[] = [
    { key: "achievements", count: achievementPoints, points: Math.floor(achievementPoints / WEIGHTS.achievementPointsPer) },
    { key: "reputations", count: exalted, points: exalted * WEIGHTS.exalted },
    { key: "titles", count: titles, points: titles * WEIGHTS.title },
  ];
  if (ctx.agreedQuests) {
    const quests = [...owned.quests].filter((q) => ctx.agreedQuests!.has(q)).length;
    parts.push({ key: "quests", count: quests, points: Math.floor(quests / WEIGHTS.questsPerPoint) });
  }
  return { score: { key: "completion", status: "scored", points: parts.reduce((s, p) => s + p.points, 0), parts }, level };
}

/** One character's score, from its own rows only. */
export function scoreCharacter(ref: ScoreCharacterRef, ctx: ScoreContext): CharacterScore {
  const completion = completionOf(ref, ctx);
  const progress = progressOf(ref, ref.level ?? completion.level, ctx);
  const speed: ComponentScore = { key: "speed", status: "not-scored", reason: "Timed runs are not scored in version 1." };
  const pvp: ComponentScore = { key: "pvp", status: "not-scored", reason: "Everloot records no PvP results." };
  const all = [progress.score, completion.score, speed, pvp].filter((c) => c.status !== "not-scored");
  const total = all.length > 0 && all.every((c) => c.status === "scored") ? all.reduce((s, c) => s + (c.status === "scored" ? c.points : 0), 0) : null;
  return {
    version: SCORE_VERSION, asOf: ctx.asOf.toISOString(),
    installId: ref.installId.trim(), characterKey: ref.characterKey.trim().toLowerCase(),
    progress: progress.score, completion: completion.score, speed, pvp, total, kills: progress.kills,
  };
}

// --- One account ---

/** A character the account linked, with what the score needs to know about the link. */
export interface AccountCharacter {
  score: CharacterScore;
  /** A frozen link (two accounts claim the character) counts for nobody. */
  link: "linked" | "frozen";
  /** Hidden through the hide form. */
  hidden: boolean;
  /** True only when the character's install is a source the same account owns. */
  sourceOwned: boolean;
  ruleset: string;
}

export type ExcludedReason = "frozen" | "hidden" | "source not owned" | "other ruleset" | "unknown total" | "listed twice" | "other version";

/** Decision D4. The plan recommends the best character only; a bonus is a share of the others' totals, capped. */
export interface AltBonus { share: number; cap: number }
export const NO_ALT_BONUS: AltBonus = { share: 0, cap: 0 };

export interface AccountScore {
  version: number;
  ruleset: string;
  /** The best character's total plus any alt bonus; null when no character counts. */
  total: number | null;
  best: { installId: string; characterKey: string; total: number } | null;
  altBonus: number;
  counted: number;
  /** Every distinct boss any counted character killed: shown on a profile, never ranked. */
  record: number;
  excluded: { installId: string; characterKey: string; reason: ExcludedReason }[];
}

/**
 * An account's score in one ruleset: the best total among its linked characters there. A character counts when its
 * link is not frozen, it is not hidden, its install is a source the account owns and its total is known.
 */
export function scoreAccount(characters: readonly AccountCharacter[], ruleset: string, bonus: AltBonus = NO_ALT_BONUS): AccountScore {
  const excluded: AccountScore["excluded"] = [];
  const seen = new Set<string>();
  const counted: CharacterScore[] = [];
  const out = (s: CharacterScore, reason: ExcludedReason) => excluded.push({ installId: s.installId, characterKey: s.characterKey, reason });
  const ordered = [...characters].sort((a, b) => characterId(a.score.installId, a.score.characterKey).localeCompare(characterId(b.score.installId, b.score.characterKey)));
  for (const c of ordered) {
    const id = characterId(c.score.installId, c.score.characterKey);
    if (seen.has(id)) { out(c.score, "listed twice"); continue; }
    seen.add(id);
    if (c.link !== "linked") out(c.score, "frozen");
    else if (c.hidden) out(c.score, "hidden");
    else if (!c.sourceOwned) out(c.score, "source not owned");
    else if (c.ruleset !== ruleset) out(c.score, "other ruleset");
    else if (c.score.version !== SCORE_VERSION) out(c.score, "other version");
    else if (c.score.total === null) out(c.score, "unknown total");
    else counted.push(c.score);
  }
  // Highest total first; equal totals keep the id order above, so the same account always gets the same best.
  const ranked = [...counted].sort((a, b) => b.total! - a.total!);
  const best = ranked[0];
  const record = new Set(counted.flatMap((s) => s.kills.counted)).size;
  if (!best) return { version: SCORE_VERSION, ruleset, total: null, best: null, altBonus: 0, counted: 0, record, excluded };
  const others = ranked.slice(1).reduce((s, c) => s + c.total!, 0);
  const altBonus = Math.floor(Math.min(bonus.cap, bonus.share * others));
  return {
    version: SCORE_VERSION, ruleset, total: best.total! + altBonus,
    best: { installId: best.installId, characterKey: best.characterKey, total: best.total! },
    altBonus, counted: counted.length, record, excluded,
  };
}
