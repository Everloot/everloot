import { validGuildName, type IntakeRecord } from "@everloot/protocol";
import { guildBoard, guildFactsFromRecords, type GuildBoard, type GuildFacts } from "../../../kb/src/guild-board";
import {
  agreedKills, guildDirectory, guildKey, guildKillsFromRecords, guildLadder, guildProgression, guildRanks, guildSlug, instanceDefs, LADDER_PAGE,
  mergeKills, officerKills, searchGuilds,
  type AgreedKill, type GuildFaction, type GuildKillRow, type GuildPage, type GuildProgress, type GuildReader, type GuildSummary, type InstanceDef, type LadderFilter, type LadderRow,
} from "../../../kb/src/guilds";
import { instanceFactsFromRecords } from "../../../kb/src/instances";
import { playerPagesOn, type Player } from "./player-pages";
import { guildHideKey, playerStore, type GuildHit } from "./player-store";
import { uploadStore } from "./upload-store";

/**
 * The guild ladder's page data (docs/design/specs/2026-10-24-guild-board-design.md). Everything here is off until
 * EVERLOOT_GUILDS=1: with it unset the pages answer 404 and read nothing. The rollup itself is kb/src/guilds.ts;
 * this file reads the upload corpus and the players table and composes what a page shows.
 *
 * Three sources: guild_kill rows from members (agreed by 2 installs), the officer board (kb/src/guild-board.ts) and
 * the seen roster from the players table. A guild hidden through the hide form leaves all three.
 */

export { guildIndexingOn, guildsOn } from "./guild-switch";

/** The cache tag the guild search results carry; recording a hide clears it. */
export const GUILD_SEARCH_TAG = "guilds";
export const GUILDS_PATH = "/guilds";
export const HIDE_GUILD_PATH = "/guilds/hide";

export function guildPath(realm: string, guild: string): string {
  return `${GUILDS_PATH}/${encodeURIComponent(guildSlug(realm))}/${encodeURIComponent(guildSlug(guild))}`;
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
  /** The officer boards, by guild key, for every guild an officer upload names. */
  boards: Map<string, GuildBoard>;
  officers: AgreedKill[];
}

export interface GuildData {
  unreachable: boolean;
  dataAsOf: string | null;
  instances: InstanceDef[];
  /** Member and officer kills as one list, hidden guilds left out. */
  kills: AgreedKill[];
  progress: GuildProgress[];
  boards: Map<string, GuildBoard>;
}

const UNREAD: GuildData = { unreachable: true, dataAsOf: null, instances: [], kills: [], progress: [], boards: new Map() };

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
  return { key, rows: guildKillsFromRecords(records), instances, facts, boards, officers: officerKills([...boards.values()], instances) };
}

let memo: Rollup | null = null;

async function hiddenGuilds(): Promise<Set<string>> {
  try {
    return await playerStore().hiddenGuilds();
  } catch {
    return new Set();
  }
}

const hiddenKey = (g: { realm: string; guildName: string }) => guildHideKey(g.realm, g.guildName);

/**
 * The ladder's data from the stored uploads: the instances with agreed bosses, every agreed kill and each guild's
 * progression. The rollup is kept per corpus read, as lib/rankings.ts does; the hidden set is read each time, so a
 * hide takes effect at once.
 */
export async function loadGuildData(): Promise<GuildData> {
  const corpus = await uploadStore.loadCorpus();
  if (corpus.unreachable) return UNREAD;
  const dataAsOf = corpus.dataAsOf ?? null;
  const asOf = dataAsOf ? new Date(dataAsOf) : new Date();
  const key = `${corpus.uploads}|${dataAsOf ?? ""}|${corpus.records.length}`;
  if (memo === null || memo.key !== key) memo = rollup(key, corpus.records, asOf);
  const hidden = await hiddenGuilds();
  const members = agreedKills(memo.rows, asOf).filter((k) => !hidden.has(hiddenKey(k)));
  const officers = memo.officers.filter((k) => !hidden.has(hiddenKey(k)));
  const kills = mergeKills(members, officers);
  const boards = new Map([...memo.boards].filter(([, b]) => !hidden.has(hiddenKey(b))));
  return { unreachable: false, dataAsOf, instances: memo.instances, kills, progress: guildProgression(kills, memo.instances), boards };
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
  let hits: GuildHit[] = [];
  if (playerPagesOn()) {
    try { hits = await playerStore().searchGuilds(prefix); } catch { hits = []; }
  }
  const directory = guildDirectory({ kills: data.kills, seen: seenFromHits(hits), boards: boardSources(data.boards) });
  return { results: searchGuilds(directory, prefix), unreachable: data.unreachable && hits.length === 0, dataAsOf: data.dataAsOf };
}

export interface LadderQuery { instance?: number; realm?: string; faction?: GuildFaction; page?: number }

export interface LadderView {
  /** The instances with an agreed kill, newest tier first. */
  instances: InstanceDef[];
  instance: InstanceDef | null;
  query: LadderQuery;
  /** Realms with a kill in the instance, for the filter. */
  realms: string[];
  rows: LadderRow[];
  total: number;
  page: number;
  pages: number;
}

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The URL's ladder filters: an instance id, a realm and a faction, anything else ignored. */
export function parseLadderQuery(search: Search): LadderQuery {
  const q: LadderQuery = {};
  const instance = Number(one(search.instance));
  if (Number.isInteger(instance) && instance > 0) q.instance = instance;
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
 * One page of the ladder for one instance (the newest with a kill unless the URL picks one), filtered by realm
 * and faction. Members seen are counted for the rows on the page only.
 */
export async function loadLadder(data: GuildData, query: LadderQuery): Promise<LadderView> {
  const ranked = new Set(data.progress.filter((p) => p.killed > 0).map((p) => p.instanceMapId));
  const instances = data.instances.filter((i) => ranked.has(i.instanceMapId)).sort((a, b) => b.tier - a.tier);
  const instance = instances.find((i) => i.instanceMapId === query.instance) ?? instances[0] ?? null;
  if (!instance) return { instances, instance: null, query, realms: [], rows: [], total: 0, page: 1, pages: 0 };
  const filter: LadderFilter = { ...(query.realm ? { realm: query.realm } : {}), ...(query.faction ? { faction: query.faction } : {}) };
  const all = guildLadder(data.progress, instance.instanceMapId, filter);
  const realms = [...new Set(data.progress.filter((p) => p.instanceMapId === instance.instanceMapId && p.killed > 0).map((p) => p.realm))].sort((a, b) => a.localeCompare(b));
  const pages = Math.max(1, Math.ceil(all.length / LADDER_PAGE));
  const page = Math.min(query.page ?? 1, pages);
  const slice = all.slice((page - 1) * LADDER_PAGE, page * LADDER_PAGE);
  const seen = await membersSeen(slice);
  const rows = slice.map((r) => ({ ...r, membersSeen: seen.get(r.key) ?? null }));
  return { instances, instance, query, realms, rows, total: all.length, page, pages: all.length ? pages : 0 };
}

export interface GuildPageData {
  page: GuildPage;
  /** The officer board, when officers published one. */
  board: GuildBoard | null;
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
export async function loadGuildPage(realmSlug: string, guildSlug_: string): Promise<GuildPageData | null | "unreachable"> {
  const realm = realmSlug.toLowerCase();
  const guild = guildSlug_.toLowerCase();
  const data = await loadGuildData();
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
  return {
    page: { summary, progression: data.progress.filter((p) => p.key === key), activity, seenRoster, ranks: guildRanks(key, data.progress) },
    board,
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
    const loaded = await loadGuildPage(guildSlug(realm), guildSlug(guildName));
    if (loaded === "unreachable") return null;
    return { page: loaded?.page ?? null, dataAsOf: loaded?.dataAsOf ?? null };
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
