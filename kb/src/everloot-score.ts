/**
 * The Everloot Score, version 1: two numbers per character and per account, from rows Everloot captures, never an
 * estimate. It follows section 3 of docs/design/2026-11-02-profiles-score-rankings-plan.md and the owner's decisions
 * of 2026-11-02; the weights there are the owner's to settle (decision D2), so they live in one table below. Pure:
 * callers hand in the facts. Nothing shows the score yet; public display waits on the public-character policy
 * (docs/design/2026-11-01-public-character-policy-draft.md). In plain words: docs/design/2026-11-02-everloot-score.md.
 *
 * - Progress = Raid + Dungeon: each distinct boss and difficulty the character killed this season, counted only when
 *   another uploader's pull summary lists the character in the group (`confirmed`). A raid boss is worth 10 times its
 *   raid's tier, a dungeon boss 1; a dungeon's final boss 3 once the curated final-boss list exists.
 * - Completion = Achievements + Reputations + Titles + Quests, from the character's own completion rows, on the
 *   lists 3 installs agree on. Self-reported: it is never merged into the Progress ranking.
 * - Speed and PvP: defined, not scored. Each will be its own component, so adding one changes no other.
 *
 * Only the character's own rows earn points: rows its own install sent under its own key. Another uploader's pull
 * summary can confirm one of them, never add one. Missing data is unknown, never zero.
 */
import type { CompletionFacts } from "./completion.js";

export const SCORE_VERSION = 1;

/** Section 3.2's weights: a proposal until the owner settles decision D2. Any change is a new SCORE_VERSION. */
export const WEIGHTS = {
  /** A raid boss is worth this many points per tier of its raid. */
  raidPerTier: 10,
  dungeonBoss: 1,
  /** Only for a boss on the curated final-boss list; with no list, every dungeon boss is `dungeonBoss`. */
  dungeonFinalBoss: 3,
  /** Achievement points are divided by this, rounded down over the character's total. */
  achievementPointsPer: 10,
  exalted: 10,
  title: 5,
  /** One point per this many completed quests, rounded down. */
  questsPerPoint: 25,
} as const;

/**
 * Section 3.3, rule 2: a kill is confirmed when this many pull summaries list the character, each from an install and
 * an address that are not the character's own and not another witness's, within this many minutes of the kill.
 */
export const CONFIRMATION = { witnesses: 1, windowMinutes: 10 } as const;
/** A kill counts only when the character is at most this many levels under the instance's lowest level (rule 4). */
export const LEVEL_SLACK = 5;
/** Rule 6, intake: an own kill row is accepted up to this many days before it arrived. Eligibility is the season. */
export const KILL_DAYS_BACK = 60;
/** How far a row's own clock may run ahead of the server's receipt of it. A row dated later than that counts for nothing. */
export const CLOCK_SKEW_MINUTES = 10;

export const COMPONENTS = ["progress", "completion", "speed", "pvp"] as const;
export type ComponentKey = (typeof COMPONENTS)[number];

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
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
  /** The difficulty ids the game files give the instance. A kill on any other difficulty scores nothing. */
  difficulties: readonly number[];
  /** The instance's lowest level in the game files. Absent when they give none: then no kill there scores. */
  minLevel?: number;
}

/**
 * One kill of the character's own, the `kill_owned` row the plan proposes (section 9, P2). It is not in the protocol
 * yet. `receivedAt` is the server's time when the row arrived; `addressHash` is the keyed hash of the address the
 * upload carrying it came from.
 */
export interface OwnKill {
  installId: string;
  addressHash: string;
  characterKey: string;
  encounterId: number;
  instanceMapId: number;
  difficulty: number;
  success: boolean;
  capturedAt: string;
  receivedAt: string;
}

/**
 * Another uploader's `pull_summary` (PR #697) for one pull, the only thing that confirms a kill. `members` is the
 * group it lists, each member resolved by the caller to `characterId(installId, characterKey)` through the link rows;
 * a member no link resolves is left out. `success` is true when the pull ended in a kill.
 */
export interface PullWitness {
  installId: string;
  addressHash: string;
  encounterId: number;
  difficulty: number;
  success: boolean;
  capturedAt: string;
  receivedAt: string;
  members: readonly string[];
}

/** An anonymous `encounter` row from another install. It shows a kill happened, not who was in it: it confirms nothing. */
export interface EncounterReport { installId: string; encounterId: number; difficulty: number | null; success: boolean; capturedAt: string }

/** A guild kill 2 installs agree on, as the guild rollup gives it (`AgreedKill` in guilds.ts). It confirms nothing. */
export interface GuildKill { guildName: string; realm: string; encounterId: number; difficulty: number | null; killedAt: string }

export interface ProgressFacts {
  instances: readonly ScoreInstance[];
  /** The curated raid tier list the owner signs off, by instance map id: 1 is the first raid tier. */
  raidTiers: ReadonlyMap<number, number>;
  /** The curated final-boss list, by encounter id. Null until it exists: every dungeon boss is then worth 1. */
  finalBosses: ReadonlySet<number> | null;
  /** When this season started: kills before it count for nothing. Progress resets when a new raid tier opens. */
  seasonStart: string;
  kills: readonly OwnKill[];
  pullSummaries: readonly PullWitness[];
  /** Anonymous `encounter` rows and guild kills: they only label an unconfirmed kill "reported, not confirmed". */
  reports: { encounters: readonly EncounterReport[]; guildKills: readonly GuildKill[] };
  /** Characters (`characterId`) whose own kill rows are synced: one with no kill has measured zero. */
  recorders: ReadonlySet<string>;
  /** The guild each character's own sync names, by `characterId`. */
  guilds: ReadonlyMap<string, { guildName: string; realm: string }>;
}

export const COMPLETION_PARTS = ["achievements", "reputations", "titles", "quests"] as const;
export type CompletionPart = (typeof COMPLETION_PARTS)[number];

export interface ScoreContext {
  /** The server's time: nothing dated after it counts. */
  asOf: Date;
  /** Launch: nothing dated before it counts. */
  launch: string;
  /** Null while own kills are not recorded for anyone: Progress is then not scored. */
  progress: ProgressFacts | null;
  /** The agreed achievement, reputation and title lists and every character's own completion rows. */
  completion: CompletionFacts;
  /**
   * Which kinds of completion rows each character's own uploads carried, by `characterId`. A kind the character never
   * uploaded is unknown, not an empty list: an upload of achievements alone does not say it has no title.
   */
  completionCoverage: ReadonlyMap<string, ReadonlySet<CompletionPart>>;
  /** The agreed quest list; null while there is none, which leaves Quests out for everyone. */
  agreedQuests: ReadonlySet<number> | null;
  /** Install ids marked contested (two accounts present the same one): none of their rows count. */
  contested: ReadonlySet<string>;
}

// --- Outputs ---

export type PartKey = "raid" | "dungeon" | CompletionPart;
/** `count` is what was counted: bosses, achievement points, factions, titles or quests. */
export interface PartScore { key: PartKey; count: number; points: number }

/** Why one of the character's own kills scored nothing. */
export type KillDrop =
  | "wipe" | "not on the boss list" | "difficulty not valid" | "raid not on the tier list" | "before the season"
  | "date out of range" | "instance level unknown" | "level unknown" | "under the level band" | "repeat"
  /** Another install's anonymous row or the guild's kill shows the kill happened, but no pull summary lists the character. */
  | "reported, not confirmed"
  | "not confirmed";

export type ComponentScore =
  | { key: ComponentKey; status: "scored"; points: number; parts: PartScore[] }
  /** Others have this data and this character does not: no points. */
  | { key: ComponentKey; status: "unknown"; missing: string }
  /** Nobody's data of this kind is scored yet; it is left out alike for everyone. */
  | { key: ComponentKey; status: "not-scored"; reason: string };

export interface CharacterScore {
  version: number;
  asOf: string;
  installId: string;
  characterKey: string;
  /** The number the Progress board ranks. */
  progress: ComponentScore;
  /** Self-reported; ranked only on its own labelled board, never with Progress. */
  completion: ComponentScore;
  speed: ComponentScore;
  pvp: ComponentScore;
  /** Progress plus Completion for the profile only: no board ranks it. Null when either is unknown. */
  total: number | null;
  /** The bosses that scored, as `encounterId:difficulty`, and why the others did not. */
  kills: { counted: string[]; dropped: Partial<Record<KillDrop, number>> };
}

// --- One character ---

/** One key for a character across inputs: its install and completion key, trimmed and in lower case. */
export const characterId = (installId: string, characterKey: string) => `${installId.trim()}:${characterKey.trim().toLowerCase()}`;

const bossKey = (encounterId: number, difficulty: number) => `${encounterId}:${difficulty}`;
const utcDay = (iso: string) => new Date(Date.parse(iso)).toISOString().slice(0, 10);
const validLevel = (level: number | undefined | null) => (typeof level === "number" && Number.isInteger(level) && level > 0 ? level : null);

/** A row's time, or null when it is not a date, arrived after the server's clock, or is dated past its arrival plus the skew. */
function rowTime(capturedAt: string, receivedAt: string, now: number): number | null {
  const at = Date.parse(capturedAt);
  const received = Date.parse(receivedAt);
  if (!Number.isFinite(at) || !Number.isFinite(received) || received > now || at > received + CLOCK_SKEW_MINUTES * MINUTE_MS) return null;
  return at;
}

/**
 * How many witnesses are independent: the largest set of (install, address) pairs in which no install and no address
 * repeats, leaving out the character's own install and address. One install behind many addresses, or many installs
 * behind one address, is one witness.
 */
export function independentWitnesses(pairs: readonly { installId: string; addressHash: string }[], subject: { installId: string; addressHash: string }): number {
  const ownInstall = subject.installId.trim();
  const ownAddress = subject.addressHash.trim();
  const byInstall = new Map<string, Set<string>>();
  for (const p of pairs) {
    const install = p.installId.trim();
    const address = p.addressHash.trim();
    if (!install || !address || install === ownInstall || address === ownAddress) continue;
    byInstall.set(install, (byInstall.get(install) ?? new Set()).add(address));
  }
  // A maximum matching of installs to addresses (augmenting paths): the pairs that share nothing.
  const holder = new Map<string, string>();
  const assign = (install: string, tried: Set<string>): boolean => {
    for (const address of byInstall.get(install)!) {
      if (tried.has(address)) continue;
      tried.add(address);
      const other = holder.get(address);
      if (other === undefined || assign(other, tried)) { holder.set(address, install); return true; }
    }
    return false;
  };
  let matched = 0;
  for (const install of [...byInstall.keys()].sort()) if (assign(install, new Set())) matched++;
  return matched;
}

/** Rule 2: enough independent pull summaries list the character in a kill of this boss and difficulty within the window. */
function confirmed(kill: OwnKill, at: number, id: string, facts: ProgressFacts, ctx: ScoreContext): boolean {
  const window = CONFIRMATION.windowMinutes * MINUTE_MS;
  const now = ctx.asOf.getTime();
  const witnesses = facts.pullSummaries.filter((w) => {
    if (ctx.contested.has(w.installId.trim()) || !w.success || w.encounterId !== kill.encounterId || w.difficulty !== kill.difficulty) return false;
    if (!w.members.some((m) => m.trim() === id)) return false;
    const seen = rowTime(w.capturedAt, w.receivedAt, now);
    return seen !== null && Math.abs(seen - at) <= window;
  });
  return independentWitnesses(witnesses, kill) >= CONFIRMATION.witnesses;
}

/** An unconfirmed kill another install's anonymous row, or the character's own guild that day, says happened. */
function reported(kill: OwnKill, at: number, guild: { guildName: string; realm: string } | undefined, facts: ProgressFacts, ctx: ScoreContext): boolean {
  const window = CONFIRMATION.windowMinutes * MINUTE_MS;
  const skewed = ctx.asOf.getTime() + CLOCK_SKEW_MINUTES * MINUTE_MS;
  const near = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) && t <= skewed && Math.abs(t - at) <= window; };
  const sameKill = (r: { encounterId: number; difficulty: number | null }) => r.encounterId === kill.encounterId && r.difficulty === kill.difficulty;
  if (facts.reports.encounters.some((r) => {
    const install = r.installId.trim();
    return r.success && sameKill(r) && install !== kill.installId.trim() && !ctx.contested.has(install) && near(r.capturedAt);
  })) return true;
  if (!guild) return false;
  const day = new Date(at).toISOString().slice(0, 10);
  return facts.reports.guildKills.some((g) => sameKill(g) && g.guildName === guild.guildName && g.realm === guild.realm
    && Number.isFinite(Date.parse(g.killedAt)) && Date.parse(g.killedAt) <= skewed && utcDay(g.killedAt) === day);
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
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.encounterId - b.encounterId || a.difficulty - b.difficulty);
  for (const k of own) {
    const at = rowTime(k.capturedAt, k.receivedAt, now);
    const instance = instanceOf.get(k.encounterId);
    if (!k.success) { drop("wipe"); continue; }
    if (!instance || instance.instanceMapId !== k.instanceMapId || instance.kind === null) { drop("not on the boss list"); continue; }
    if (!instance.difficulties.includes(k.difficulty)) { drop("difficulty not valid"); continue; }
    if (at === null || at < Date.parse(k.receivedAt) - KILL_DAYS_BACK * DAY_MS) { drop("date out of range"); continue; }
    if (at < seasonStart) { drop("before the season"); continue; }
    const tier = instance.kind === "raid" ? facts.raidTiers.get(instance.instanceMapId) : undefined;
    if (instance.kind === "raid" && !(tier && tier > 0)) { drop("raid not on the tier list"); continue; }
    if (validLevel(instance.minLevel) === null) { drop("instance level unknown"); continue; }
    if (level === null) { drop("level unknown"); continue; }
    if (level < instance.minLevel! - LEVEL_SLACK) { drop("under the level band"); continue; }
    const key = bossKey(k.encounterId, k.difficulty);
    if (counted.has(key)) { drop("repeat"); continue; }
    if (!confirmed(k, at, id, facts, ctx)) { drop(reported(k, at, facts.guilds.get(id), facts, ctx) ? "reported, not confirmed" : "not confirmed"); continue; }
    const points = instance.kind === "raid" ? WEIGHTS.raidPerTier * tier! : facts.finalBosses?.has(k.encounterId) ? WEIGHTS.dungeonFinalBoss : WEIGHTS.dungeonBoss;
    counted.set(key, { raid: instance.kind === "raid", points });
  }
  kills.counted = [...counted.keys()].sort();
  // A kill the level check could not judge may be worth points: Progress is unknown, not the sum of the others.
  if (kills.dropped["level unknown"]) return { score: { key: "progress", status: "unknown", missing: "character level" }, kills };
  const sum = (raid: boolean) => [...counted.values()].filter((c) => c.raid === raid);
  const parts: PartScore[] = [true, false].map((raid) => {
    const list = sum(raid);
    return { key: raid ? "raid" : "dungeon", count: list.length, points: list.reduce((s, c) => s + c.points, 0) };
  });
  return { score: { key: "progress", status: "scored", points: parts.reduce((s, p) => s + p.points, 0), parts }, kills };
}

const PART_ROWS: Record<CompletionPart, string> = { achievements: "achievement", reputations: "reputation", titles: "title", quests: "quest" };

function completionOf(ref: ScoreCharacterRef, ctx: ScoreContext): { score: ComponentScore; level: number | null } {
  const facts = ctx.completion;
  // A part is scored for everyone once its list has an entry; Quests also needs the agreed quest list to exist.
  const listed: Record<CompletionPart, boolean> = {
    achievements: facts.achievements.size > 0, reputations: facts.factions.size > 0, titles: facts.titles.size > 0, quests: (ctx.agreedQuests?.size ?? 0) > 0,
  };
  const id = characterId(ref.installId, ref.characterKey);
  // The character's own rows, from its own install under its own key. Nothing else stands in for them.
  const owned = ctx.contested.has(ref.installId.trim()) ? undefined : facts.owned.find((c) => characterId(c.installId, c.characterKey) === id);
  const level = validLevel(owned?.level);
  if (!COMPLETION_PARTS.some((p) => listed[p])) return { score: { key: "completion", status: "not-scored", reason: "No list has three installs agreeing on it yet." }, level };
  if (!owned) return { score: { key: "completion", status: "unknown", missing: "own completion rows" }, level };
  const covered = ctx.completionCoverage.get(id);
  const missing = COMPLETION_PARTS.filter((p) => listed[p] && !covered?.has(p));
  if (missing.length > 0) return { score: { key: "completion", status: "unknown", missing: `own ${missing.map((p) => PART_ROWS[p]).join(", ")} rows` }, level };

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
  const progress = progressOf(ref, validLevel(ref.level) ?? completion.level, ctx);
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

export type ExcludedReason = "frozen" | "hidden" | "source not owned" | "other ruleset" | "nothing scored" | "listed twice" | "other version";

/** The account's number for one component: its best character's, and which character that is. */
export interface AccountBest { points: number; installId: string; characterKey: string }

export interface AccountScore {
  version: number;
  ruleset: string;
  /** The best Progress among the counted characters: what a Progress board ranks. Null when none has one. */
  progress: AccountBest | null;
  /** The best Completion, chosen on its own, so it may be another character's. Self-reported. */
  completion: AccountBest | null;
  counted: number;
  /** Every distinct boss any counted character killed: shown on a profile, never ranked. */
  record: number;
  excluded: { installId: string; characterKey: string; reason: ExcludedReason }[];
}

/**
 * An account's score in one ruleset (decision D4: best character only, no alt bonus). Progress and Completion are
 * each the best among its counted characters, chosen separately: a high Completion never picks the Progress
 * character. A character counts when its link is not frozen, it is not hidden, its install is a source the account
 * owns and it was scored with this version; for each number, only characters with that number scored take part.
 */
export function scoreAccount(characters: readonly AccountCharacter[], ruleset: string): AccountScore {
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
    else if (c.score.progress.status !== "scored" && c.score.completion.status !== "scored") out(c.score, "nothing scored");
    else counted.push(c.score);
  }
  // Highest first; equal points keep the id order above, so the same account always gets the same best.
  const bestOf = (key: "progress" | "completion"): AccountBest | null => {
    let best: AccountBest | null = null;
    for (const s of counted) {
      const c = s[key];
      if (c.status === "scored" && (best === null || c.points > best.points)) best = { points: c.points, installId: s.installId, characterKey: s.characterKey };
    }
    return best;
  };
  const record = new Set(counted.filter((s) => s.progress.status === "scored").flatMap((s) => s.kills.counted)).size;
  return { version: SCORE_VERSION, ruleset, progress: bestOf("progress"), completion: bestOf("completion"), counted: counted.length, record, excluded };
}
