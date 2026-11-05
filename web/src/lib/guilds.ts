import { validGuildName, type IntakeRecord } from "@everloot/protocol";
import { guildBoard, guildFactsFromRecords, type GuildBoard, type GuildFacts } from "../../../kb/src/guild-board";
import {
  agreedKills, guildDirectory, guildKey, guildKillsFromRecords, guildLadder, guildProgression, guildRanks, guildSlug, instanceDefs, LADDER_PAGE,
  mergeKills, officerKills, searchGuilds,
  type AgreedKill, type GuildFaction, type GuildKillRow, type GuildPage, type GuildProgress, type GuildReader, type GuildSummary, type InstanceDef, type LadderFilter, type LadderRow,
} from "../../../kb/src/guilds";
import { instanceFactsFromRecords } from "../../../kb/src/instances";
import { loadGuildAlts, memberKey, type GuildAlt } from "./guild-alts";
import { playerPagesOn, playerPath, rulesetOf, type Player } from "./player-pages";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { FAMILIES } from "../data/families";
import { REALMS } from "../data/realms";
import { guildHideKey, missingFunction, playerHideKey, playerStore, REALM_GUILD_LIMIT, realmSlugOf, type GuildHit, type GuildRealm } from "./player-store";
import { realmInfo } from "./realms";
import { uploadStore } from "./upload-store";

/**
 * The guild ladder's page data (docs/design/specs/2026-10-24-guild-board-design.md). Everything here is off until
 * EVERLOOT_GUILDS=1: with it unset the pages answer 404 and read nothing. The rollup itself is kb/src/guilds.ts;
 * this file reads the upload corpus and the players table and composes what a page shows.
 *
 * Three sources: guild_kill rows from members (agreed by 2 installs), the officer board (kb/src/guild-board.ts) and
 * the seen roster from the players table. A guild hidden through the hide form leaves all three.
 */

import { guildsOn } from "./guild-switch";
export { guildIndexingOn, guildsOn } from "./guild-switch";

/** The cache tag the guild search results carry; recording a hide clears it. */
export const GUILD_SEARCH_TAG = "guilds";
export const GUILDS_PATH = "/guilds";
export const HIDE_GUILD_PATH = "/guilds/hide";

export function guildPath(realm: string, guild: string): string {
  return `${GUILDS_PATH}/${encodeURIComponent(guildSlug(realm))}/${encodeURIComponent(guildSlug(guild))}`;
}

/** A realm's guild list, at the slug of the realm's key, so every spelling of the realm links to the one page. */
export function realmPath(realm: string): string {
  return `${GUILDS_PATH}/${encodeURIComponent(realmSlugOf(realm))}`;
}

export function hideGuildPath(realm: string, guild: string): string {
  return `${HIDE_GUILD_PATH}?realm=${encodeURIComponent(realm)}&guild=${encodeURIComponent(guild)}`;
}

/** The letters of a search the form may run: the start of a guild name, 2 to 24 characters; null when it is not one. */
export function guildSearchPrefix(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const prefix = q.trim();
  return validGuildName(prefix) ? prefix : null;
}

export type GuildKillRecord = Extract<IntakeRecord, { kind: "guild_kill" }>;

export function isGuildKillRow(row: IntakeRecord): row is GuildKillRecord {
  return row.kind === "guild_kill";
}

/**
 * Why intake drops a guild kill row, or null to keep it. With the switch off nothing is collected; a hidden guild's
 * kills are dropped (decision 9c); `hidden` null means the hide list could not be read, so the row is not kept unchecked.
 */
export function guildKillProblem(row: GuildKillRecord, on: boolean, hidden: ReadonlySet<string> | null): string | null {
  if (!on) return "Guild kills are not collected yet.";
  if (hidden === null) return "Guild kills could not be checked against the hidden guilds. Send them again later.";
  if (hidden.has(guildHideKey(row.realm, row.guildName))) return "This guild asked to be hidden; its kills are not kept.";
  return null;
}

/** The hidden guilds as intake reads them once per upload: null when the store could not answer. */
export async function hiddenGuildsForIntake(): Promise<Set<string> | null> {
  try {
    return await playerStore().hiddenGuilds();
  } catch {
    return null;
  }
}

export const factionLabel = (f: GuildFaction | null): "Alliance" | "Horde" | null => (f === "alliance" ? "Alliance" : f === "horde" ? "Horde" : null);

/** What one corpus read rolls up to, kept until the corpus changes. */
interface Rollup {
  key: string;
  rows: GuildKillRow[];
  instances: InstanceDef[];
  facts: GuildFacts;
  /** The officer boards, by guild key, for every guild an officer upload names. Names unchecked: never shown as they are. */
  boards: Map<string, GuildBoard>;
  /** Every character the officers' facts name, as `playerHideKey` keys. */
  names: Set<string>;
  officers: AgreedKill[];
}

export interface GuildData {
  unreachable: boolean;
  dataAsOf: string | null;
  instances: InstanceDef[];
  /** Member and officer kills as one list, hidden guilds left out. */
  kills: AgreedKill[];
  progress: GuildProgress[];
  /** The officer boards, hidden guilds left out and every hidden character left out of their roster, loot and attendance. */
  boards: Map<string, GuildBoard>;
  /** The hidden guilds, as `guildHideKey` keys, so a caller can tell a hidden guild from an unknown one. */
  hidden: ReadonlySet<string>;
  /** True when the hidden characters could not be read: the boards then name no one. */
  namesWithheld: boolean;
}

const UNREAD: GuildData = { unreachable: true, dataAsOf: null, instances: [], kills: [], progress: [], boards: new Map(), hidden: new Set(), namesWithheld: true };

/** A board worth keeping: something in it was agreed by two officer uploads. */
const published = (b: GuildBoard) => b.memberCount !== null || b.roster.length > 0 || b.progression.length > 0 || b.loot.length > 0 || b.present.length > 0;

function rollup(key: string, records: readonly unknown[], asOf: Date): Rollup {
  const facts = guildFactsFromRecords(records as unknown[]);
  const instances = instanceDefs(instanceFactsFromRecords(records as unknown[]), asOf);
  const named = new Map<string, { guildName: string; realm: string }>();
  for (const r of [...facts.counts, ...facts.members, ...facts.bosses, ...facts.loot, ...facts.attendance]) {
    if (r.guildName.trim() && r.realm.trim()) named.set(guildKey(r.realm, r.guildName), { guildName: r.guildName, realm: r.realm });
  }
  const boards = new Map<string, GuildBoard>();
  for (const [k, g] of named) {
    const board = guildBoard(g.guildName, g.realm, facts);
    if (published(board)) boards.set(k, board);
  }
  const names = new Set([
    ...facts.members.map((m) => playerHideKey(m.realm, m.name)), ...facts.loot.map((l) => playerHideKey(l.realm, l.recipient)),
    ...facts.attendance.map((a) => playerHideKey(a.realm, a.name)), ...facts.gear.map((g) => playerHideKey(g.realm, g.character)),
  ]);
  return { key, rows: guildKillsFromRecords(records), instances, facts, boards, names, officers: officerKills([...boards.values()], instances) };
}

/**
 * The officers' facts without the characters who asked to be hidden: their roster line, the loot they received,
 * their attendance and their item level. `hidden` null means the hide list could not be read, so no name is kept.
 */
export function withoutHiddenPlayers(facts: GuildFacts, hidden: ReadonlySet<string> | null): GuildFacts {
  const shown = (realm: string, name: string) => hidden !== null && !hidden.has(playerHideKey(realm, name));
  return {
    ...facts,
    members: facts.members.filter((m) => shown(m.realm, m.name)),
    loot: facts.loot.filter((l) => shown(l.realm, l.recipient)),
    attendance: facts.attendance.filter((a) => shown(a.realm, a.name)),
    gear: facts.gear.filter((g) => shown(g.realm, g.character)),
  };
}

let memo: Rollup | null = null;
let shownMemo: { key: string; boards: Map<string, GuildBoard> } | null = null;

/**
 * The boards a page may show, rebuilt from the facts without hidden characters. Kept while the corpus and the hidden
 * characters it names stay the same, so an opt-out takes effect on the next read even when the corpus has not changed.
 */
function shownBoards(r: Rollup, hiddenPlayers: ReadonlySet<string> | null): Map<string, GuildBoard> {
  const named = hiddenPlayers === null ? "unread" : [...hiddenPlayers].filter((k) => r.names.has(k)).sort().join("\u0001");
  const key = `${r.key}|${named}`;
  if (shownMemo?.key === key) return shownMemo.boards;
  const facts = withoutHiddenPlayers(r.facts, hiddenPlayers);
  const boards = new Map([...r.boards].map(([k, b]) => [k, guildBoard(b.guildName, b.realm, facts)] as const));
  shownMemo = { key, boards };
  return boards;
}

const hiddenKey = (g: { realm: string; guildName: string }) => guildHideKey(g.realm, g.guildName);

/** The hidden characters, read once per request: null when the store could not answer. */
async function hiddenPlayersOrNull(): Promise<Set<string> | null> {
  try {
    return await playerStore().hiddenPlayers();
  } catch {
    return null;
  }
}

/**
 * The ladder's data from the stored uploads: the instances with agreed bosses, every agreed kill and each guild's
 * progression. The rollup is kept per corpus read, as lib/rankings.ts does; the hidden set is read each time, so a
 * hide takes effect at once. A hide list that cannot be read makes the whole answer unreachable: guilds are withheld,
 * never shown unfiltered (pages show the unavailable state, the tools answer unavailable, the export skips its files).
 */
export async function loadGuildData(): Promise<GuildData> {
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) return UNREAD;
  const dataAsOf = corpus.dataAsOf ?? null;
  const asOf = dataAsOf ? new Date(dataAsOf) : new Date();
  const key = `${corpus.uploads}|${dataAsOf ?? ""}|${corpus.records.length}`;
  if (memo === null || memo.key !== key) memo = rollup(key, corpus.records, asOf);
  const [hidden, hiddenPlayers] = await Promise.all([hiddenGuildsForIntake(), hiddenPlayersOrNull()]);
  if (hidden === null) return UNREAD;
  const members = agreedKills(memo.rows, asOf, memo.instances).filter((k) => !hidden.has(hiddenKey(k)));
  const officers = memo.officers.filter((k) => !hidden.has(hiddenKey(k)));
  const kills = mergeKills(members, officers);
  // A character hidden after the corpus was rolled up is left out here, on every read; without the list, no name is shown.
  const boards = new Map([...shownBoards(memo, hiddenPlayers)].filter(([, b]) => !hidden.has(hiddenKey(b))));
  return {
    unreachable: false, dataAsOf, instances: memo.instances, kills, progress: guildProgression(kills, memo.instances), boards, hidden,
    namesWithheld: hiddenPlayers === null,
  };
}

const boardSources = (boards: ReadonlyMap<string, GuildBoard>) =>
  [...boards.values()].map((b) => ({ guildName: b.guildName, realm: b.realm, faction: null, memberCount: b.memberCount, roster: b.roster.length }));

type Seen = Map<string, { guildName: string; realm: string; members: number; lastSeen: string | null; faction: GuildFaction | null }>;
const seenFromHits = (hits: readonly GuildHit[]): Seen =>
  new Map(hits.map((h) => [guildKey(h.realm, h.guild), { guildName: h.guild, realm: h.realm, members: h.members, lastSeen: h.lastSeen, faction: null }]));

/**
 * Guilds whose name starts with `prefix`: the directory built from kills and officer boards, merged with the
 * players table's search (which knows guilds only members were seen in). Hidden guilds are already out of both.
 */
export async function loadGuildSearch(prefix: string): Promise<{ results: GuildSummary[]; unreachable: boolean; dataAsOf: string | null }> {
  const data = await loadGuildData();
  // Without a readable hide list nothing is listed, not even the players table's guilds.
  if (data.unreachable) return { results: [], unreachable: true, dataAsOf: null };
  let hits: GuildHit[] = [];
  if (playerPagesOn()) {
    try { hits = await playerStore().searchGuilds(prefix); } catch { hits = []; }
  }
  const directory = guildDirectory({ kills: data.kills, seen: seenFromHits(hits), boards: boardSources(data.boards) });
  return { results: searchGuilds(directory, prefix), unreachable: false, dataAsOf: data.dataAsOf };
}

/**
 * A players-table read that may come before its migration: null when the store cannot answer. PostgREST saying the
 * function is not there yet is expected until the owner applies it, so only other failures are logged.
 */
async function storeRead<T>(what: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    if (!missingFunction(err)) console.error(`${what} failed`, err);
    return null;
  }
}

/**
 * Address segments under /guilds that are never a realm: the guild families (served first by the same route) and the
 * hide form. A realm with one of these slugs gets no realm page and is left off the realm list.
 */
export const RESERVED_GUILD_SLUGS: ReadonlySet<string> = new Set([...FAMILIES.map((f) => f.slug), HIDE_GUILD_PATH.split("/").at(-1)!]);

/** A realm address the store is asked about: the slug realmSlugOf writes, nothing longer than a realm can make. */
const REALM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const realmSlugAllowed = (slug: string) => slug.length <= 40 && REALM_SLUG.test(slug) && !RESERVED_GUILD_SLUGS.has(slug);

/**
 * The minimum for a realm on the /guilds realm list while the realm map (data/realms.ts) is empty: 3 guilds and 10
 * characters seen in guilds. Any realm name the addon reports is stored, so without a minimum a few made-up names
 * would fill the list; once the map lists the game's realms, only those are listed, whatever their counts.
 */
export const REALM_LIST_MIN = { guilds: 3, characters: 10 } as const;

/** The realm list read for /guilds, kept five minutes; recording a guild hide clears it with the search tag. */
const cachedGuildRealms = unstable_cache(() => playerStore().guildRealms(), ["guild-realms"], { revalidate: 300, tags: [GUILD_SEARCH_TAG] });

/**
 * The realms for the list on /guilds, by name: realms the map lists once it is filled, else realms past
 * REALM_LIST_MIN, never one whose address is reserved. Null without the player pages or while the store cannot answer
 * (a failed read is not kept: unstable_cache keeps only answers).
 */
export async function loadGuildRealms(): Promise<GuildRealm[] | null> {
  if (!playerPagesOn()) return null;
  const realms = await storeRead("guild realms", cachedGuildRealms);
  if (realms === null) return null;
  const mapped = REALMS.length > 0;
  return realms
    .filter((r) => !RESERVED_GUILD_SLUGS.has(realmSlugOf(r.realm)))
    .filter((r) => (mapped ? realmInfo(r.realm) !== null : r.guilds >= REALM_LIST_MIN.guilds && r.characters >= REALM_LIST_MIN.characters))
    .sort((a, b) => a.realm.localeCompare(b.realm));
}

/** Guilds per realm page. */
export const REALM_PAGE = 50;

export interface RealmPageData {
  realm: string;
  /** Every guild seen on the realm, most members seen first, then name. */
  guilds: GuildSummary[];
  /** True when the players table returned its most rows, so some guilds with the fewest members seen are not listed. */
  capped: boolean;
  dataAsOf: string | null;
}

/**
 * A realm's guild list, by the realm slug in its address: every guild a kill, an officer board or a character seen in
 * it puts on that realm, hidden guilds left out. Null when nothing is known on the realm (the page is then a 404),
 * "unreachable" when the corpus, the hide list or the players table could not be read, including before the
 * realm_guilds migration is applied. An address that is not a realm slug, or is reserved, is null without a read. One
 * call per request: the page and its metadata share it.
 */
export const loadRealmPage = cache(async (slug: string): Promise<RealmPageData | null | "unreachable"> => {
  const wanted = slug.toLowerCase();
  if (!realmSlugAllowed(wanted)) return null;
  const data = await loadGuildData();
  if (data.unreachable) return "unreachable";
  const onRealm = <T extends { realm: string }>(rows: Iterable<T>) => [...rows].filter((r) => realmSlugOf(r.realm) === wanted);
  let hits: GuildHit[] = [];
  if (playerPagesOn()) {
    // One indexed read by slug: an address naming no realm finds no rows and reads nothing else.
    const found = await storeRead("realm guilds", () => playerStore().realmGuilds(wanted));
    if (found === null) return "unreachable";
    hits = found;
  }
  const boards = new Map(onRealm(data.boards.values()).map((b) => [guildKey(b.realm, b.guildName), b] as const));
  const guilds = guildDirectory({ kills: onRealm(data.kills), seen: seenFromHits(hits), boards: boardSources(boards) })
    .sort((a, b) => (b.membersSeen ?? 0) - (a.membersSeen ?? 0) || a.guildName.localeCompare(b.guildName));
  if (guilds.length === 0) return null;
  return { realm: hits[0]?.realm ?? guilds[0]!.realm, guilds, capped: hits.length >= REALM_GUILD_LIMIT, dataAsOf: data.dataAsOf };
});

/** The day raids open on Forever (UTC). Before it, while no raid has an agreed kill, the hub says when raid ranking starts. */
export const RAIDS_OPEN_DAY = "2026-12-09";
export const raidsOpen = (now: Date = new Date()): boolean => now.toISOString().slice(0, 10) >= RAIDS_OPEN_DAY;

export interface LadderQuery { instance?: number; ruleset?: string; realm?: string; faction?: GuildFaction; page?: number }

/** One ladder row with the guild's ruleset and its rank in the world, its ruleset and its faction within that ruleset. */
export interface RankedRow extends LadderRow {
  ruleset: string;
  ranks: { world: number; ruleset: number; faction: number | null };
}

/**
 * The first guilds in the view to kill a boss: a kill counts only at a time two members' installs report it within
 * FIRST_KILL_WINDOW_MS of each other, and guilds with the same earliest time share the first. Empty before anyone has.
 */
export interface BossFirst { encounterId: number; name: string; killedAt: string | null; guilds: { key: string; guildName: string; realm: string }[] }

export interface LadderView {
  /** The instances with an agreed kill, newest tier first. */
  instances: InstanceDef[];
  instance: InstanceDef | null;
  query: LadderQuery;
  /** Rulesets with a kill in the instance, for the filter. */
  rulesets: string[];
  /** Realms with a kill in the instance, for the filter. */
  realms: string[];
  rows: RankedRow[];
  /** Each boss of the instance and the first guild in the filtered view to kill it. */
  firsts: BossFirst[];
  total: number;
  page: number;
  pages: number;
}

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The URL's ladder filters: an instance id, a ruleset, a realm and a faction, anything else ignored. */
export function parseLadderQuery(search: Search): LadderQuery {
  const q: LadderQuery = {};
  const instance = Number(one(search.instance));
  if (Number.isInteger(instance) && instance > 0) q.instance = instance;
  const ruleset = one(search.ruleset)?.trim().toLowerCase();
  if (ruleset && /^[a-z][a-z-]{1,19}$/.test(ruleset)) q.ruleset = ruleset;
  const realm = one(search.realm)?.trim();
  if (realm && realm.length >= 2 && realm.length <= 40) q.realm = realm;
  const faction = one(search.faction)?.toLowerCase();
  if (faction === "alliance" || faction === "horde") q.faction = faction;
  const page = Number(one(search.page));
  if (Number.isInteger(page) && page > 1) q.page = page;
  return q;
}

export function ladderHref(q: LadderQuery): string {
  const params = new URLSearchParams();
  if (q.instance) params.set("instance", String(q.instance));
  if (q.ruleset) params.set("ruleset", q.ruleset);
  if (q.realm) params.set("realm", q.realm);
  if (q.faction) params.set("faction", q.faction);
  if (q.page && q.page > 1) params.set("page", String(q.page));
  const s = params.toString();
  return s ? `${GUILDS_PATH}?${s}` : GUILDS_PATH;
}

/** How many characters were seen in each of these guilds, from the players table; null without the pages. */
async function membersSeen(guilds: readonly { realm: string; guildName: string }[]): Promise<Map<string, number>> {
  if (!playerPagesOn()) return new Map();
  const counts = await Promise.all(guilds.map(async (g) => {
    try { return [guildKey(g.realm, g.guildName), (await playerStore().guildMembers(g.realm, g.guildName)).length] as const; } catch { return null; }
  }));
  return new Map(counts.filter((c): c is readonly [string, number] => c !== null));
}

/**
 * A guild's rank in the world, in its ruleset, and among its faction in that ruleset, for one instance. Each
 * ladder is built once per ruleset and faction asked for.
 */
function standings(progress: readonly GuildProgress[], instanceMapId: number): (row: LadderRow) => RankedRow {
  const ladders = new Map<string, Map<string, number>>();
  const rankIn = (id: string, key: string, list: () => LadderRow[]): number => {
    let ranks = ladders.get(id);
    if (!ranks) { ranks = new Map(list().map((r) => [r.key, r.rank])); ladders.set(id, ranks); }
    return ranks.get(key) ?? 0;
  };
  return (row) => {
    const ruleset = rulesetOf(row.realm);
    const own = () => progress.filter((p) => rulesetOf(p.realm) === ruleset);
    return {
      ...row,
      ruleset,
      ranks: {
        world: rankIn("world", row.key, () => guildLadder(progress, instanceMapId)),
        ruleset: rankIn(`r:${ruleset}`, row.key, () => guildLadder(own(), instanceMapId)),
        faction: row.faction ? rankIn(`f:${ruleset}:${row.faction}`, row.key, () => guildLadder(own(), instanceMapId, { faction: row.faction! })) : null,
      },
    };
  };
}

/**
 * Each boss of the instance with the first guilds among `rows` to kill it, in name order whatever order `rows` come
 * in. Only a kill two installs back at one time counts (BossProgress.occurredAt), so reports of different kills a week
 * apart never add up to an early first. The ladder itself still counts a kill once two installs report the boss at all.
 * Officers' kills carry no time and never count as first.
 */
export function bossFirsts(instance: InstanceDef, rows: readonly GuildProgress[]): BossFirst[] {
  return instance.bosses.map((boss) => {
    let killedAt: string | null = null;
    let guilds: BossFirst["guilds"] = [];
    for (const r of rows) {
      const at = r.list.find((x) => x.encounterId === boss.encounterId)?.occurredAt;
      if (!at) continue;
      const guild = { key: r.key, guildName: r.guildName, realm: r.realm };
      if (killedAt === null || at < killedAt) { killedAt = at; guilds = [guild]; }
      else if (at === killedAt) guilds.push(guild);
    }
    guilds.sort((a, b) => a.guildName.localeCompare(b.guildName) || a.realm.localeCompare(b.realm) || a.key.localeCompare(b.key));
    return { encounterId: boss.encounterId, name: boss.name, killedAt, guilds };
  });
}

/**
 * One page of the ladder for one instance (the newest with a kill unless the URL picks one), filtered by ruleset,
 * realm and faction. Members seen are counted for the rows on the page only.
 */
export async function loadLadder(data: GuildData, query: LadderQuery): Promise<LadderView> {
  const ranked = new Set(data.progress.filter((p) => p.killed > 0).map((p) => p.instanceMapId));
  const instances = data.instances.filter((i) => ranked.has(i.instanceMapId)).sort((a, b) => b.tier - a.tier);
  const instance = instances.find((i) => i.instanceMapId === query.instance) ?? instances[0] ?? null;
  if (!instance) return { instances, instance: null, query, rulesets: [], realms: [], rows: [], firsts: [], total: 0, page: 1, pages: 0 };
  const inInstance = data.progress.filter((p) => p.instanceMapId === instance.instanceMapId && p.killed > 0);
  const scoped = query.ruleset ? data.progress.filter((p) => rulesetOf(p.realm) === query.ruleset) : data.progress;
  const filter: LadderFilter = { ...(query.realm ? { realm: query.realm } : {}), ...(query.faction ? { faction: query.faction } : {}) };
  const all = guildLadder(scoped, instance.instanceMapId, filter);
  const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  const rulesets = sorted(inInstance.map((p) => rulesetOf(p.realm)));
  const realms = sorted(inInstance.filter((p) => !query.ruleset || rulesetOf(p.realm) === query.ruleset).map((p) => p.realm));
  const pages = Math.max(1, Math.ceil(all.length / LADDER_PAGE));
  const page = Math.min(query.page ?? 1, pages);
  const slice = all.slice((page - 1) * LADDER_PAGE, page * LADDER_PAGE);
  const seen = await membersSeen(slice);
  const rank = standings(data.progress, instance.instanceMapId);
  const rows = slice.map((r) => rank({ ...r, membersSeen: seen.get(r.key) ?? null }));
  return { instances, instance, query, rulesets, realms, rows, firsts: bossFirsts(instance, all), total: all.length, page, pages: all.length ? pages : 0 };
}

/** One member as the guild page lists it: the officers' roster and the addon's sightings, joined by name. */
export interface GuildMember {
  name: string;
  realm: string;
  /** A store token ("SHAMAN") from a sighting, or the class name the officers' roster gives ("Mage"). */
  class: string;
  level: number;
  /** The guild rank, only from a roster the officers published. */
  rank: string | null;
  /** The day the addon last saw the character in this guild; null when only the officers list it. */
  lastSeen: string | null;
  /** The character's player page, when the addon saw it there. */
  path: string | null;
  /** Other characters on the member's account, only as `character_link` proves them and the switches allow. */
  alts: GuildAlt[];
}

/**
 * The member list: the officers' roster in its own order, each name joined to its sighting when there is one, then
 * the characters only seen, newest first. `seen` comes from the players table, which already leaves out hidden
 * characters and hidden guilds.
 */
export function guildMemberList(
  realm: string, seen: readonly Player[], roster: readonly { name: string; rank: string; level: number; className: string }[],
): Omit<GuildMember, "alts">[] {
  const name = (n: string) => n.trim().toLowerCase();
  const sighted = new Map(seen.map((p) => [name(p.name), p]));
  const fromSighting = (p: Player) => ({ name: p.name, realm: p.realm, class: p.class, level: p.level, lastSeen: p.lastSeen, path: playerPath(p) });
  const out: Omit<GuildMember, "alts">[] = roster.map((m) => {
    const p = sighted.get(name(m.name));
    if (p) sighted.delete(name(m.name));
    return p
      ? { ...fromSighting(p), level: Math.max(p.level, m.level), rank: m.rank }
      : { name: m.name, realm, class: m.className, level: m.level, rank: m.rank, lastSeen: null, path: null };
  });
  return [...out, ...[...sighted.values()].map((p) => ({ ...fromSighting(p), rank: null }))];
}

export interface GuildPageData {
  page: GuildPage;
  /** The officer board, when officers published one. */
  board: GuildBoard | null;
  members: GuildMember[];
  /** True when the hidden characters could not be read, so the officers' roster, loot and attendance are left out. */
  namesWithheld: boolean;
  dataAsOf: string | null;
}

/** The guild a realm and guild slug name, among the guilds the corpus knows. */
function fromCorpus(data: GuildData, realm: string, guild: string): { guildName: string; realm: string } | null {
  const match = (g: { guildName: string; realm: string }) => guildSlug(g.realm) === realm && guildSlug(g.guildName) === guild;
  return data.kills.find(match) ?? [...data.boards.values()].find(match) ?? null;
}

/** The guild a slug names among the guilds members were seen in: the store searches by prefix, so the slug's words are tried as one. */
async function fromStore(realm: string, guild: string): Promise<GuildHit | null> {
  if (!playerPagesOn()) return null;
  const match = (h: GuildHit) => guildSlug(h.realm) === realm && guildSlug(h.guild) === guild;
  for (const prefix of [guild.replace(/-/g, " "), guild.split("-")[0] ?? ""]) {
    if (prefix.length < 2) continue;
    let hits: GuildHit[];
    try { hits = await playerStore().searchGuilds(prefix); } catch { return null; }
    const hit = hits.find(match);
    if (hit) return hit;
  }
  return null;
}

/**
 * Everything a guild page shows, by the realm and guild slugs in its address: null when no source knows the guild
 * (or it is hidden), "unreachable" when the corpus could not be read.
 */
export async function loadGuildPage(realmSlug: string, guildSlug_: string, loaded?: GuildData): Promise<GuildPageData | null | "unreachable"> {
  const realm = realmSlug.toLowerCase();
  const guild = guildSlug_.toLowerCase();
  const data = loaded ?? (await loadGuildData());
  if (data.unreachable) return "unreachable";
  const known = fromCorpus(data, realm, guild);
  const hit = known ? null : await fromStore(realm, guild);
  const identity = known ?? (hit ? { guildName: hit.guild, realm: hit.realm } : null);
  if (!identity) return null;
  const key = guildKey(identity.realm, identity.guildName);
  let seenRoster: Player[] = [];
  if (playerPagesOn()) {
    try { seenRoster = await playerStore().guildMembers(identity.realm, identity.guildName); } catch { seenRoster = []; }
  }
  const board = data.boards.get(key) ?? null;
  const seen: Seen = seenRoster.length
    ? new Map([[key, { guildName: identity.guildName, realm: identity.realm, members: seenRoster.length, lastSeen: seenRoster.map((m) => m.lastSeen).sort().at(-1) ?? null, faction: null }]])
    : new Map();
  const summary = guildDirectory({ kills: data.kills, seen, boards: board ? boardSources(new Map([[key, board]])) : [] }).find((g) => g.key === key)
    ?? { key, guildName: identity.guildName.trim(), realm: identity.realm.trim(), faction: null, membersSeen: null, membersPublished: null, kills: 0, latestKillAt: null, lastSeen: null, sources: [] };
  const activity = data.kills.filter((k) => k.key === key && k.killedAt).sort((a, b) => b.killedAt.localeCompare(a.killedAt));
  const listed = guildMemberList(identity.realm.trim(), seenRoster, board?.roster ?? []);
  const alts = await loadGuildAlts(listed);
  return {
    page: { summary, progression: data.progress.filter((p) => p.key === key), activity, seenRoster, ranks: guildRanks(key, data.progress) },
    board,
    members: listed.map((m) => ({ ...m, alts: alts.get(memberKey(m.realm, m.name)) ?? [] })),
    namesWithheld: data.namesWithheld,
    dataAsOf: data.dataAsOf,
  };
}

/**
 * The guild tools' reader (kb/src/guilds.ts GuildReader): the same data the pages show, hidden guilds left out. The
 * MCP mounts and GET /api/tools/{tool} lend it only while EVERLOOT_GUILDS=1, so with the switch off the two ladder
 * tools are not listed and guild_board answers from the officer board alone.
 */
export const guildReader: GuildReader = {
  async ladder() {
    const data = await loadGuildData();
    return data.unreachable ? null : { instances: data.instances, progress: data.progress, dataAsOf: data.dataAsOf };
  },
  async search(prefix, limit) {
    const found = await loadGuildSearch(prefix);
    return found.unreachable ? null : { guilds: found.results.slice(0, limit), dataAsOf: found.dataAsOf };
  },
  async page(guildName, realm) {
    const data = await loadGuildData();
    if (data.unreachable) return null;
    if (data.hidden.has(guildHideKey(realm, guildName))) return { page: null, hidden: true, dataAsOf: data.dataAsOf };
    const loaded = await loadGuildPage(guildSlug(realm), guildSlug(guildName), data);
    if (loaded === "unreachable") return null;
    return { page: loaded?.page ?? null, hidden: false, dataAsOf: loaded?.dataAsOf ?? data.dataAsOf };
  },
};

/**
 * The open data export's guild rows (guildKillsResponse.kills and guildsResponse.guilds): the agreed kills oldest
 * first, and the directory from kills and officer boards. The export does not read the player pages, so members seen
 * is null there, which the schema says is not zero.
 */
export function guildExportRows(data: GuildData): { kills: Record<string, unknown>[]; guilds: Record<string, unknown>[] } {
  const kills = [...data.kills].sort((a, b) => (a.killedAt || "~").localeCompare(b.killedAt || "~") || a.key.localeCompare(b.key) || a.encounterId - b.encounterId)
    .map((k) => ({
      guildName: k.guildName, realm: k.realm, faction: k.faction, encounterId: k.encounterId, name: k.name, instanceMapId: k.instanceMapId,
      difficulty: k.difficulty, killedAt: k.killedAt, installs: k.installs, source: k.source,
    }));
  const guilds = guildDirectory({ kills: data.kills, seen: new Map(), boards: boardSources(data.boards) }).map((g) => ({
    guildName: g.guildName, realm: g.realm, faction: g.faction, membersSeen: null, membersPublished: g.membersPublished,
    kills: g.kills, latestKillAt: g.latestKillAt, lastSeen: null, sources: g.sources,
  }));
  return { kills, guilds };
}

/**
 * Whether the officers' board of a guild may be shown on /tools/guild-board: with the guild pages on, a hidden guild's
 * board is withheld too, and an unreadable hide list withholds every board. With the switch off there is no hide form
 * and no hide list to read, so the board answers as it always has.
 */
export async function officerBoardState(guildName: string, realm: string): Promise<"shown" | "hidden" | "unreachable"> {
  if (!guildsOn()) return "shown";
  const hidden = await hiddenGuildsForIntake();
  if (hidden === null) return "unreachable";
  return hidden.has(guildHideKey(realm, guildName)) ? "hidden" : "shown";
}
