/**
 * Guilds as a ladder (docs/design/specs/2026-10-24-guild-board-design.md). Pure functions over rows, so the MCP
 * server, the pages and the export agree.
 *
 * Three sources feed one guild record, keyed by realm and name:
 * 1. `guild_kill` rows from members: a kill is the guild's once GUILD_KILL_AGREEMENT distinct installs report the
 *    same guild and encounter; the kill time is the earliest of the agreeing reports.
 * 2. Seen members, from the players table (one row per character with the guild it was last seen in).
 * 3. The officer board (guild-board.ts): roster, lockout progression, attendance and loot under a verified grant.
 *
 * Progression is the union of 1 and 3, each kill marked with its source. The ladder orders by bosses killed in
 * one instance, then by the earliest time the latest kill was agreed, so the guild that got there first ranks
 * first; equal rows share a rank. There is no combined score.
 */

import { confirmedEntrances, instanceBosses, type InstanceFacts } from "./instances.js";

export const GUILD_KILL_AGREEMENT = 2;
/** Rows a ladder page shows. */
export const LADDER_PAGE = 20;

export type GuildFaction = "alliance" | "horde";
export type KillSource = "members" | "officers";

/** A stored guild_kill row, as the addon writes it and intake validates it. */
export interface GuildKillRow {
  installId: string;
  guildName: string;
  realm: string;
  faction: GuildFaction;
  encounterId: number;
  name: string;
  instanceMapId: number;
  /** The difficulty id `GetInstanceInfo` reported, when it did. */
  difficulty: number | null;
  size?: number;
  capturedAt: string;
}

/** One character the addon saw in a guild (the players table's row, visible ones only). */
export interface SeenMember {
  name: string;
  realm: string;
  race: string;
  class: string;
  level: number;
  lastSeen: string;
}

/** An instance the ladder can rank, with its bosses in encounter order. From the knowledge release. */
export interface InstanceDef {
  instanceMapId: number;
  name: string;
  /** Dungeon or raid, when known. */
  instanceType: "dungeon" | "raid" | null;
  /** The instance's order among raids: higher is newer. The newest raid is the ladder's default. */
  tier: number;
  bosses: { encounterId: number; name: string }[];
}

/** A kill the guild owns: reported by enough installs. */
export interface AgreedKill {
  key: string;
  guildName: string;
  realm: string;
  faction: GuildFaction | null;
  encounterId: number;
  name: string;
  instanceMapId: number;
  /** The difficulty id most reports gave; null when none did, and for an officers' kill. */
  difficulty: number | null;
  /** The earliest report among the agreeing installs, ISO. */
  killedAt: string;
  installs: number;
  source: KillSource;
}

export interface BossProgress {
  encounterId: number;
  name: string;
  killed: boolean;
  killedAt: string | null;
  source: KillSource | null;
}

/** One guild's standing in one instance. */
export interface GuildProgress {
  key: string;
  guildName: string;
  realm: string;
  faction: GuildFaction | null;
  instanceMapId: number;
  instanceName: string;
  tier: number;
  killed: number;
  bosses: number;
  /** When the latest kill was agreed, ISO; null with no kill. */
  latestKillAt: string | null;
  list: BossProgress[];
}

export interface LadderRow extends GuildProgress {
  rank: number;
  membersSeen: number | null;
}

export interface LadderFilter {
  realm?: string;
  faction?: GuildFaction;
}

/** One guild as the directory and the search list it: every source that knows it, named. */
export interface GuildSummary {
  key: string;
  guildName: string;
  realm: string;
  faction: GuildFaction | null;
  membersSeen: number | null;
  /** The officer roster's size when published. */
  membersPublished: number | null;
  kills: number;
  /** The newest agreed kill, ISO; null with none. */
  latestKillAt: string | null;
  /** The newest day a member was seen, YYYY-MM-DD; null without player rows. */
  lastSeen: string | null;
  sources: ("kills" | "seen" | "officers")[];
}

/** One guild as the players table groups it: how many visible characters were last seen in it, and when. */
export interface SeenGuild {
  guildName: string;
  realm: string;
  members: number;
  /** The newest day a member was seen, YYYY-MM-DD; null when no row carries one. */
  lastSeen: string | null;
  faction: GuildFaction | null;
}

/** One officer board as the directory and the ladder read it: the agreed count, roster size and lockout progression. */
export interface OfficerBoard {
  guildName: string;
  realm: string;
  faction: GuildFaction | null;
  memberCount: number | null;
  roster: number;
  progression: { instance: string; bosses: string[] }[];
}

/** What a guild page and the guild_board tool show: the summary, progression per instance, kills in time order and the rosters. */
export interface GuildPage {
  summary: GuildSummary;
  progression: GuildProgress[];
  activity: AgreedKill[];
  seenRoster: SeenMember[];
  /** Realm and overall rank for the newest instance with a kill; null without one. */
  ranks: { instanceMapId: number; instanceName: string; realm: number; overall: number } | null;
}

const clean = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

/** The key of one guild: realm then name, both cleaned, joined with a NUL as the players table keys characters. */
export function guildKey(realm: string, guildName: string): string {
  return `${clean(realm)}\u0000${clean(guildName)}`;
}

/** The URL slug of a realm or guild name: lower case, spaces as hyphens, apostrophes dropped. */
export function guildSlug(value: string): string {
  return clean(value).replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseTime(value: string): number | null {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * The kills enough installs agree on: one per guild and encounter, timed at the earliest report, with the
 * difficulty most reports name. A hidden guild (by key) is left out. Rows dated after `now` are ignored.
 */
export function agreedKills(rows: readonly GuildKillRow[], now: Date, hidden: ReadonlySet<string> = new Set()): AgreedKill[] {
  const groups = new Map<string, { rows: GuildKillRow[]; installs: Set<string> }>();
  for (const r of rows) {
    const installId = r.installId.trim();
    const at = parseTime(r.capturedAt);
    if (!installId || !r.guildName.trim() || !r.realm.trim() || at === null || at > now.getTime()) continue;
    const key = guildKey(r.realm, r.guildName);
    if (hidden.has(key)) continue;
    const id = `${key}\u0000${r.instanceMapId}\u0000${r.encounterId}`;
    const group = groups.get(id) ?? { rows: [], installs: new Set<string>() };
    group.rows.push(r);
    group.installs.add(installId);
    groups.set(id, group);
  }
  const out: AgreedKill[] = [];
  for (const { rows: list, installs } of groups.values()) {
    if (installs.size < GUILD_KILL_AGREEMENT) continue;
    const first = [...list].sort((a, b) => parseTime(a.capturedAt)! - parseTime(b.capturedAt)!)[0]!;
    const difficulty = mode(list.map((r) => r.difficulty).filter((d): d is number => d !== null)) ?? null;
    const faction = mode(list.map((r) => r.faction)) ?? null;
    out.push({
      key: guildKey(first.realm, first.guildName), guildName: first.guildName.trim(), realm: first.realm.trim(), faction,
      encounterId: first.encounterId, name: mode(list.map((r) => r.name.trim()).filter(Boolean)) ?? first.name.trim(),
      instanceMapId: first.instanceMapId, difficulty, killedAt: new Date(parseTime(first.capturedAt)!).toISOString(),
      installs: installs.size, source: "members",
    });
  }
  return out.sort((a, b) => a.killedAt.localeCompare(b.killedAt) || a.key.localeCompare(b.key) || a.encounterId - b.encounterId);
}

/** The most frequent value; ties go to the one seen first. */
function mode<T>(values: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  let best: T | undefined;
  let bestCount = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestCount) { best = v; bestCount = n; }
  }
  return best;
}

/**
 * Kills the officers published through the board (raid_lockout rows under a grant, agreed by two officer uploads),
 * as AgreedKill rows with source "officers". The board names bosses by name only, so each is matched to the
 * instance's boss list by name (case-insensitive); an unmatched name is dropped. The lockout carries no kill time.
 */
export function officerKills(
  boards: readonly Pick<OfficerBoard, "guildName" | "realm" | "progression">[],
  instances: readonly InstanceDef[],
): AgreedKill[] {
  const out: AgreedKill[] = [];
  for (const board of boards) {
    for (const row of board.progression) {
      const instanceName = clean(row.instance.split(" · ")[0] ?? row.instance);
      const def = instances.find((i) => clean(i.name) === instanceName);
      if (!def) continue;
      for (const bossName of row.bosses) {
        const boss = def.bosses.find((b) => clean(b.name) === clean(bossName));
        if (!boss) continue;
        out.push({
          key: guildKey(board.realm, board.guildName), guildName: board.guildName.trim(), realm: board.realm.trim(), faction: null,
          encounterId: boss.encounterId, name: boss.name, instanceMapId: def.instanceMapId, difficulty: null,
          killedAt: "", installs: 0, source: "officers",
        });
      }
    }
  }
  return out;
}

/** Member and officer kills as one list: a boss both report is one line, the members' line (it has a time). */
export function mergeKills(members: readonly AgreedKill[], officers: readonly AgreedKill[]): AgreedKill[] {
  const seen = new Set(members.map((k) => `${k.key}\u0000${k.instanceMapId}\u0000${k.encounterId}`));
  return [...members, ...officers.filter((k) => !seen.has(`${k.key}\u0000${k.instanceMapId}\u0000${k.encounterId}`))];
}

/**
 * Every guild's standing in every instance it has a kill in. A kill whose encounter is not on the instance's boss
 * list counts for nothing (an unknown boss is not progression); an instance not in `instances` is skipped.
 */
export function guildProgression(kills: readonly AgreedKill[], instances: readonly InstanceDef[]): GuildProgress[] {
  const byInstance = new Map(instances.map((i) => [i.instanceMapId, i]));
  const groups = new Map<string, AgreedKill[]>();
  for (const k of kills) {
    const def = byInstance.get(k.instanceMapId);
    if (!def || !def.bosses.some((b) => b.encounterId === k.encounterId)) continue;
    const id = `${k.key}\u0000${k.instanceMapId}`;
    groups.set(id, [...(groups.get(id) ?? []), k]);
  }
  const out: GuildProgress[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    const def = byInstance.get(first.instanceMapId)!;
    const byBoss = new Map(list.map((k) => [k.encounterId, k]));
    const bosses: BossProgress[] = def.bosses.map((b) => {
      const k = byBoss.get(b.encounterId);
      return { encounterId: b.encounterId, name: b.name, killed: Boolean(k), killedAt: k?.killedAt || null, source: k?.source ?? null };
    });
    const timed = list.map((k) => k.killedAt).filter(Boolean).sort();
    const faction = list.find((k) => k.faction)?.faction ?? null;
    out.push({
      key: first.key, guildName: first.guildName, realm: first.realm, faction, instanceMapId: def.instanceMapId, instanceName: def.name, tier: def.tier,
      killed: bosses.filter((b) => b.killed).length, bosses: bosses.length, latestKillAt: timed.at(-1) ?? null, list: bosses,
    });
  }
  return out.sort((a, b) => b.tier - a.tier || a.instanceMapId - b.instanceMapId || a.key.localeCompare(b.key));
}

/**
 * The ladder for one instance: bosses killed, high to low; then the earliest latest-kill time (a guild with no
 * timed kill, officers only, comes after timed ones at the same count); then the name. Equal count and time share
 * a rank. `membersSeen` comes from the directory when given.
 */
export function guildLadder(
  progress: readonly GuildProgress[], instanceMapId: number, filter: LadderFilter = {}, members: ReadonlyMap<string, number> = new Map(),
): LadderRow[] {
  const rows = progress
    .filter((p) => p.instanceMapId === instanceMapId && p.killed > 0)
    .filter((p) => !filter.realm || clean(p.realm) === clean(filter.realm))
    .filter((p) => !filter.faction || p.faction === filter.faction)
    .sort((a, b) => b.killed - a.killed || timeOrder(a.latestKillAt, b.latestKillAt) || a.guildName.localeCompare(b.guildName) || a.realm.localeCompare(b.realm));
  const out: LadderRow[] = [];
  rows.forEach((p, i) => {
    const prev = out[i - 1];
    const tie = prev && prev.killed === p.killed && prev.latestKillAt === p.latestKillAt;
    out.push({ ...p, rank: tie ? prev.rank : i + 1, membersSeen: members.get(p.key) ?? null });
  });
  return out;
}

const timeOrder = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b));

/**
 * One record per guild from the three sources, with the sources that know it named. `seen` is grouped by
 * guild key; `boards` are the officer boards with an agreed roster or count.
 */
export function guildDirectory(sources: {
  kills: readonly AgreedKill[];
  seen: ReadonlyMap<string, SeenGuild>;
  boards: readonly OfficerBoard[];
}): GuildSummary[] {
  const out = new Map<string, GuildSummary>();
  const get = (key: string, guildName: string, realm: string): GuildSummary => {
    const have = out.get(key);
    if (have) return have;
    const made: GuildSummary = { key, guildName: guildName.trim(), realm: realm.trim(), faction: null, membersSeen: null, membersPublished: null, kills: 0, latestKillAt: null, lastSeen: null, sources: [] };
    out.set(key, made);
    return made;
  };
  for (const k of sources.kills) {
    const g = get(k.key, k.guildName, k.realm);
    g.kills += 1;
    if (k.killedAt && (!g.latestKillAt || k.killedAt > g.latestKillAt)) g.latestKillAt = k.killedAt;
    if (!g.faction && k.faction) g.faction = k.faction;
    if (!g.sources.includes("kills")) g.sources.push("kills");
  }
  for (const [key, s] of sources.seen) {
    const g = get(key, s.guildName, s.realm);
    g.membersSeen = s.members;
    g.lastSeen = s.lastSeen;
    if (!g.faction && s.faction) g.faction = s.faction;
    if (!g.sources.includes("seen")) g.sources.push("seen");
  }
  for (const b of sources.boards) {
    if (b.memberCount === null && b.roster === 0) continue;
    const g = get(guildKey(b.realm, b.guildName), b.guildName, b.realm);
    g.membersPublished = b.memberCount ?? b.roster;
    if (!g.faction && b.faction) g.faction = b.faction;
    if (!g.sources.includes("officers")) g.sources.push("officers");
  }
  // Newest kill first, guilds without a timed kill after every guild with one, then by members seen and name.
  return [...out.values()].sort((a, b) => newestFirst(a.latestKillAt, b.latestKillAt) || (b.membersSeen ?? 0) - (a.membersSeen ?? 0) || a.guildName.localeCompare(b.guildName));
}

const newestFirst = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : b.localeCompare(a));

/** The guilds whose name starts with `prefix` (2 letters or more), at most `limit`, in the directory's order. */
export function searchGuilds(directory: readonly GuildSummary[], prefix: string, limit = 25): GuildSummary[] {
  const p = clean(prefix);
  if (p.length < 2) return [];
  return directory.filter((g) => clean(g.guildName).startsWith(p)).slice(0, limit);
}

/** A guild's realm and overall rank in the newest instance it has a kill in; null without one. */
export function guildRanks(key: string, progress: readonly GuildProgress[]): GuildPage["ranks"] {
  const own = progress.filter((p) => p.key === key && p.killed > 0).sort((a, b) => b.tier - a.tier || b.instanceMapId - a.instanceMapId)[0];
  if (!own) return null;
  const overall = guildLadder(progress, own.instanceMapId).find((r) => r.key === key)?.rank;
  const realm = guildLadder(progress, own.instanceMapId, { realm: own.realm }).find((r) => r.key === key)?.rank;
  return overall && realm ? { instanceMapId: own.instanceMapId, instanceName: own.instanceName, realm, overall } : null;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** The guild_board tool's text for the ladder side of a guild: progression, activity and the seen roster. */
export function formatGuildPage(page: GuildPage): string {
  const { summary } = page;
  const lines = [`${summary.guildName} on ${summary.realm}${summary.faction ? ` (${summary.faction === "alliance" ? "Alliance" : "Horde"})` : ""}`];
  if (page.ranks) lines.push(`Rank ${page.ranks.overall} overall and ${page.ranks.realm} on ${summary.realm} in ${page.ranks.instanceName}.`);
  if (page.progression.length === 0) lines.push("No agreed kills yet. A kill counts once two members' uploads report it, or when the officers publish it.");
  for (const p of page.progression) {
    lines.push(`${p.instanceName}: ${p.killed}/${p.bosses}`);
    for (const b of p.list) lines.push(`  ${b.killed ? "killed" : "open"}  ${b.name}${b.killedAt ? ` (${day(b.killedAt)})` : ""}${b.source ? ` [${b.source}]` : ""}`);
  }
  if (page.seenRoster.length) {
    lines.push(`Seen in this guild: ${page.seenRoster.length} characters. Sightings by players running the addon, not the game's roster.`);
    for (const m of page.seenRoster.slice(0, 50)) lines.push(`  ${m.name}, ${m.level} ${m.class}, last seen ${m.lastSeen}`);
    if (page.seenRoster.length > 50) lines.push(`  and ${page.seenRoster.length - 50} more`);
  } else if (summary.membersSeen === null) {
    lines.push("Characters seen in this guild are not connected to this server, so none listed is not an empty guild.");
  } else {
    lines.push("No characters seen in this guild yet.");
  }
  return lines.join("\n");
}

/** The ladder as text, for the guild_rankings tool. */
export function formatLadder(rows: readonly LadderRow[], instance: InstanceDef | null, filter: LadderFilter = {}): string {
  if (!instance) return "No instance has an agreed kill yet.";
  const scope = [filter.realm ? `on ${filter.realm}` : "", filter.faction ? (filter.faction === "alliance" ? "Alliance" : "Horde") : ""].filter(Boolean).join(", ");
  const lines = [`${instance.name}${scope ? ` (${scope})` : ""}: ${rows.length} ${rows.length === 1 ? "guild" : "guilds"} with a kill.`];
  for (const r of rows) lines.push(`${r.rank}. ${r.guildName} (${r.realm}) ${r.killed}/${r.bosses}${r.latestKillAt ? `, latest ${day(r.latestKillAt)}` : ""}`);
  return lines.join("\n");
}

/** guild_kill rows from stored records: the shape intake validated, anything else dropped. */
export function guildKillsFromRecords(records: readonly unknown[]): GuildKillRow[] {
  const out: GuildKillRow[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.kind !== "guild_kill") continue;
    const ok = typeof r.installId === "string" && typeof r.guildName === "string" && typeof r.realm === "string"
      && (r.faction === "alliance" || r.faction === "horde") && Number.isInteger(r.encounterId) && typeof r.name === "string"
      && Number.isInteger(r.instanceMapId) && typeof r.capturedAt === "string";
    if (!ok) continue;
    out.push({
      installId: r.installId as string, guildName: r.guildName as string, realm: r.realm as string, faction: r.faction as GuildFaction,
      encounterId: r.encounterId as number, name: r.name as string, instanceMapId: r.instanceMapId as number,
      difficulty: Number.isInteger(r.difficulty) ? (r.difficulty as number) : null,
      ...(Number.isInteger(r.size) ? { size: r.size as number } : {}), capturedAt: r.capturedAt as string,
    });
  }
  return out;
}

/**
 * The instances the ladder can rank, from the world facts the corpus already agrees on: an instance's name and
 * type from its entrances (3 installs), its bosses from the encounters reported there (3 installs), in encounter
 * order. Tier is the instance's place among the raids by map id, higher being newer; dungeons come after every
 * raid. An instance with no agreed boss is left out: there is nothing to progress through.
 */
export function instanceDefs(facts: InstanceFacts, asOf: Date = new Date()): InstanceDef[] {
  const names = new Map<number, { name: string | null; instanceType: "dungeon" | "raid" | null }>();
  for (const e of confirmedEntrances(facts.entrances, asOf)) {
    if (!names.has(e.instanceMapId)) names.set(e.instanceMapId, { name: e.name, instanceType: e.instanceType === "raid" ? "raid" : e.instanceType === "party" ? "dungeon" : null });
  }
  const bosses = instanceBosses(facts.encounters, asOf);
  const defs: InstanceDef[] = [];
  for (const [instanceMapId, list] of bosses) {
    const named = list.filter((b) => b.name);
    if (named.length === 0) continue;
    const info = names.get(instanceMapId);
    defs.push({
      instanceMapId, name: info?.name ?? `Instance ${instanceMapId}`, instanceType: info?.instanceType ?? null, tier: 0,
      bosses: named.map((b) => ({ encounterId: b.encounterId, name: b.name! })),
    });
  }
  const raids = defs.filter((d) => d.instanceType === "raid").sort((a, b) => a.instanceMapId - b.instanceMapId);
  const rest = defs.filter((d) => d.instanceType !== "raid").sort((a, b) => a.instanceMapId - b.instanceMapId);
  raids.forEach((d, i) => { d.tier = rest.length + i + 1; });
  rest.forEach((d, i) => { d.tier = i + 1; });
  return [...raids, ...rest].sort((a, b) => b.tier - a.tier);
}

/**
 * What a host lends the guild tools: the site's ladder data, its guild search and one guild's page, with hidden
 * guilds already left out. A host without one (a standalone server, or the site with EVERLOOT_GUILDS off) does
 * not register guild_search and guild_rankings, and guild_board answers from the officer board only. Null from
 * any of them means the data could not be read, which is not an empty answer.
 */
export interface GuildReader {
  ladder(): Promise<{ instances: InstanceDef[]; progress: GuildProgress[]; dataAsOf: string | null } | null>;
  search(prefix: string, limit: number): Promise<{ guilds: GuildSummary[]; dataAsOf: string | null } | null>;
  /** `page` is null when no source knows the guild, or it is hidden. */
  page(guildName: string, realm: string): Promise<{ page: GuildPage | null; dataAsOf: string | null } | null>;
}

/** A guild as guild_search's output schema lists it. */
export const summaryOut = (g: GuildSummary) => ({
  guildName: g.guildName, realm: g.realm, faction: g.faction, membersSeen: g.membersSeen, kills: g.kills, latestKillAt: g.latestKillAt,
});

/** A ladder row as guild_rankings' output schema lists it. */
export const ladderOut = (r: LadderRow) => ({
  rank: r.rank, guildName: r.guildName, realm: r.realm, faction: r.faction, killed: r.killed, bosses: r.bosses, latestKillAt: r.latestKillAt, membersSeen: r.membersSeen,
});

/** The ladder side of guild_board's output: progression, activity, the seen roster and the ranks. */
export function guildPageOut(page: GuildPage) {
  return {
    ladderProgression: page.progression.map((p) => ({
      instanceMapId: p.instanceMapId, name: p.instanceName, killed: p.killed, bosses: p.bosses,
      list: p.list.map((b) => ({ encounterId: b.encounterId, name: b.name, killed: b.killed, killedAt: b.killedAt, source: b.source })),
    })),
    activity: page.activity.filter((k) => k.killedAt).map((k) => ({ encounterId: k.encounterId, name: k.name, instanceMapId: k.instanceMapId, killedAt: k.killedAt, source: k.source })),
    seenRoster: page.summary.membersSeen === null && page.seenRoster.length === 0 ? null : {
      count: page.seenRoster.length,
      members: page.seenRoster.map((m) => ({ name: m.name, level: m.level, class: m.class, lastSeen: m.lastSeen })),
    },
    ranks: page.ranks,
  };
}

/** guild_search's text. */
export function formatGuildSearch(guilds: readonly GuildSummary[], query: string): string {
  if (guilds.length === 0) return `No guild starts with "${query.trim()}". A guild is listed once two members report a kill, its officers publish a board, or a character is seen in it.`;
  return guilds.map((g) => {
    const parts = [
      g.kills ? `${g.kills} agreed ${g.kills === 1 ? "kill" : "kills"}${g.latestKillAt ? `, latest ${day(g.latestKillAt)}` : ""}` : "no agreed kill",
      g.membersSeen === null ? "members seen unrecorded" : `${g.membersSeen} seen`,
    ];
    const faction = g.faction ? ` (${g.faction === "alliance" ? "Alliance" : "Horde"})` : "";
    return `${g.guildName}, ${g.realm}${faction}: ${parts.join("; ")}`;
  }).join("\n");
}
