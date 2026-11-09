import { z } from "zod";
import { ARMORY_RECHECK_DAYS, namesFromSlug, SEARCH_RULE, type ArmoryMetricKey } from "./armory";
import { authQuery } from "./supabase/server";

/**
 * Where the armory rows live: Supabase in production (the functions of 20261109120000_armory.sql, called with the
 * service key through authQuery), and maps in memory in development, which follow the same rules and forget
 * everything on restart. The pages are the only readers: nothing here feeds an API answer, an export or the MCP tools.
 * Only two writes: a hide, and a character put in the crawler's queue. Every answer is checked against the shape the
 * contract gives; one that does not match is an error, as storage out of reach is, never a page of "undefined".
 */

export interface ArmoryItem { slot: string; itemId: number; name: string; level: number | null; quality: string | null; inventoryType: string | null }

export interface ArmoryCharacter {
  region: string; slug: string; characterId: number; name: string; surname: string; level: number;
  rulesetId: number; ruleset: string; raceId: number; race: string; classId: number; class: string;
  faction: string; gender: string | null; guildSlug: string | null; guildName: string | null;
  lastLogin: string | null; equippedItemLevel: number | null; averageItemLevel: number | null;
  itemLevel: number | null; gearScore: number | null; honorableKills: number | null; pvpRank: number | null;
  equipment: ArmoryItem[]; fetchedAt: string; checkedAt: string;
}

export interface ArmoryGuild {
  region: string; slug: string; guildId: number; name: string; faction: string; rulesetId: number; ruleset: string;
  memberCount: number; createdAt: string | null; fetchedAt: string; checkedAt: string;
}

export interface ArmoryMember {
  characterSlug: string; name: string; surname: string; level: number | null; classId: number | null; raceId: number | null;
  rank: number | null; itemLevel: number | null; gearScore: number | null; stored: boolean;
}

export interface ArmoryHit { region: string; slug: string; name: string; surname: string; level: number; class: string; race: string; ruleset: string; guildName: string | null }
export interface ArmoryGuildHit { region: string; slug: string; name: string; faction: string; ruleset: string; memberCount: number }

export interface ArmoryBoardRow {
  rank: number; region: string; slug: string; name: string; surname: string; level: number; class: string; race: string;
  faction: string; ruleset: string; rulesetId: number; guildName: string | null; value: number; fetchedAt: string;
}

/** A character's place on one board, within its own region and ruleset. */
export interface ArmoryRank { metric: ArmoryMetricKey; rank: number; of: number }
export interface ArmoryCount { region: string; rulesetId: number; ruleset: string; characters: number; guilds: number; newest: string | null }

export interface ArmoryStore {
  character(region: string, slug: string): Promise<ArmoryCharacter | null>;
  guild(region: string, slug: string): Promise<ArmoryGuild | null>;
  /** The guild's members, with item level and Gear Score for those stored; hidden characters left out. */
  roster(region: string, slug: string): Promise<ArmoryMember[]>;
  /** Characters whose name starts with `prefix` (2 letters or more), name then surname order. */
  search(prefix: string, limit: number): Promise<ArmoryHit[]>;
  searchGuilds(prefix: string, limit: number): Promise<ArmoryGuildHit[]>;
  /** One board, highest first; a null region or ruleset means all of them. */
  board(metric: ArmoryMetricKey, region: string | null, rulesetId: number | null, limit: number): Promise<ArmoryBoardRow[]>;
  rank(region: string, slug: string): Promise<ArmoryRank[]>;
  counts(): Promise<ArmoryCount[]>;
  /** Delete the character, its roster rows and its queue rows, and never write it again. */
  hide(region: string, slug: string): Promise<void>;
  /** Put a character or guild in the crawler's queue; false when it is queued already, read recently, or hidden. */
  enqueue(region: string, kind: "character" | "guild", slug: string, source: string): Promise<boolean>;
}

type Query = <T>(path: string, init?: RequestInit) => Promise<T>;

// PostgREST sends numeric and bigint as JSON numbers; a numeric string is accepted too, anything else is a mismatch.
const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
const numOrNull = num.nullable();
const textOrNull = z.string().nullable();

const ItemRow = z.object({
  slot: z.string(), item_id: num, name: textOrNull.optional(), level: numOrNull.optional(), quality: textOrNull.optional(), inventory_type: textOrNull.optional(),
}).transform((e): ArmoryItem => ({
  slot: e.slot, itemId: e.item_id, name: e.name ?? `Item ${e.item_id}`, level: e.level ?? null, quality: e.quality ?? null, inventoryType: e.inventory_type ?? null,
}));

const CharacterRow = z.object({
  region: z.string(), slug: z.string(), character_id: num, name: z.string(), surname: z.string(), level: num,
  ruleset_id: num, ruleset: z.string(), race_id: num, race: z.string(), class_id: num, class: z.string(),
  faction: z.string(), gender: textOrNull, guild_slug: textOrNull, guild_name: textOrNull, last_login: textOrNull,
  equipped_item_level: numOrNull, average_item_level: numOrNull, item_level: numOrNull, gear_score: numOrNull,
  honorable_kills: numOrNull, pvp_rank: numOrNull, equipment: z.array(ItemRow), fetched_at: z.string(), checked_at: z.string(),
}).transform((r): ArmoryCharacter => ({
  region: r.region, slug: r.slug, characterId: r.character_id, name: r.name, surname: r.surname, level: r.level,
  rulesetId: r.ruleset_id, ruleset: r.ruleset, raceId: r.race_id, race: r.race, classId: r.class_id, class: r.class,
  faction: r.faction, gender: r.gender, guildSlug: r.guild_slug, guildName: r.guild_name, lastLogin: r.last_login,
  equippedItemLevel: r.equipped_item_level, averageItemLevel: r.average_item_level, itemLevel: r.item_level, gearScore: r.gear_score,
  honorableKills: r.honorable_kills, pvpRank: r.pvp_rank, equipment: r.equipment, fetchedAt: r.fetched_at, checkedAt: r.checked_at,
}));

const GuildRow = z.object({
  region: z.string(), slug: z.string(), guild_id: num, name: z.string(), faction: z.string(), ruleset_id: num, ruleset: z.string(),
  member_count: num, created_at: textOrNull, fetched_at: z.string(), checked_at: z.string(),
}).transform((r): ArmoryGuild => ({
  region: r.region, slug: r.slug, guildId: r.guild_id, name: r.name, faction: r.faction, rulesetId: r.ruleset_id, ruleset: r.ruleset,
  memberCount: r.member_count, createdAt: r.created_at, fetchedAt: r.fetched_at, checkedAt: r.checked_at,
}));

// armory_members allows null names (and null level, class, race and rank); a member without names reads them off its
// slug rather than taking the whole roster down.
const MemberRow = z.object({
  character_slug: z.string(), name: textOrNull, surname: textOrNull, level: numOrNull, class_id: numOrNull, race_id: numOrNull,
  rank: numOrNull, item_level: numOrNull, gear_score: numOrNull, stored: z.boolean(),
}).transform((r): ArmoryMember => {
  const fallback = namesFromSlug(r.character_slug);
  return {
    characterSlug: r.character_slug, name: r.name ?? fallback.name, surname: r.surname ?? fallback.surname, level: r.level,
    classId: r.class_id, raceId: r.race_id, rank: r.rank, itemLevel: r.item_level, gearScore: r.gear_score, stored: r.stored,
  };
});

const HitRow = z.object({
  region: z.string(), slug: z.string(), name: z.string(), surname: z.string(), level: num, class: z.string(), race: z.string(),
  ruleset: z.string(), guild_name: textOrNull,
}).transform((r): ArmoryHit => ({
  region: r.region, slug: r.slug, name: r.name, surname: r.surname, level: r.level, class: r.class, race: r.race, ruleset: r.ruleset, guildName: r.guild_name,
}));

const GuildHitRow = z.object({
  region: z.string(), slug: z.string(), name: z.string(), faction: z.string(), ruleset: z.string(), member_count: num,
}).transform((r): ArmoryGuildHit => ({ region: r.region, slug: r.slug, name: r.name, faction: r.faction, ruleset: r.ruleset, memberCount: r.member_count }));

const BoardRow = z.object({
  rank: num, region: z.string(), slug: z.string(), name: z.string(), surname: z.string(), level: num, class: z.string(), race: z.string(),
  faction: z.string(), ruleset: z.string(), ruleset_id: num, guild_name: textOrNull, value: num, fetched_at: z.string(),
}).transform((r): ArmoryBoardRow => ({
  rank: r.rank, region: r.region, slug: r.slug, name: r.name, surname: r.surname, level: r.level, class: r.class, race: r.race,
  faction: r.faction, ruleset: r.ruleset, rulesetId: r.ruleset_id, guildName: r.guild_name, value: r.value, fetchedAt: r.fetched_at,
}));

const RankRow = z.object({ metric: z.enum(["item_level", "gear_score", "honorable_kills"]), rank: num, of: num });

const CountRow = z.object({
  region: z.string(), ruleset_id: num, ruleset: z.string(), characters: num, guilds: num, newest: textOrNull,
}).transform((r): ArmoryCount => ({ region: r.region, rulesetId: r.ruleset_id, ruleset: r.ruleset, characters: r.characters, guilds: r.guilds, newest: r.newest }));

/** The Supabase store: one RPC per call, through `query` (authQuery, or a fake in tests); every answer checked. */
export function createCloudArmoryStore(query: Query = authQuery): ArmoryStore {
  const rpc = async <S extends z.ZodTypeAny>(fn: string, args: Record<string, unknown>, shape: S): Promise<z.output<S>> =>
    shape.parse(await query<unknown>(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }));
  return {
    async character(region, slug) { return (await rpc("armory_character", { p_region: region, p_slug: slug }, z.array(CharacterRow)))[0] ?? null; },
    async guild(region, slug) { return (await rpc("armory_guild", { p_region: region, p_slug: slug }, z.array(GuildRow)))[0] ?? null; },
    async roster(region, slug) { return rpc("armory_roster", { p_region: region, p_slug: slug }, z.array(MemberRow)); },
    async search(prefix, limit) { return rpc("armory_search", { p_prefix: prefix, p_limit: limit }, z.array(HitRow)); },
    async searchGuilds(prefix, limit) { return rpc("armory_search_guilds", { p_prefix: prefix, p_limit: limit }, z.array(GuildHitRow)); },
    async board(metric, region, rulesetId, limit) {
      return rpc("armory_board", { p_metric: metric, p_region: region, p_ruleset_id: rulesetId, p_limit: limit }, z.array(BoardRow));
    },
    async rank(region, slug) { return rpc("armory_rank", { p_region: region, p_slug: slug }, z.array(RankRow)); },
    async counts() { return rpc("armory_counts", {}, z.array(CountRow)); },
    async hide(region, slug) { await query("rpc/armory_hide", { method: "POST", body: JSON.stringify({ p_region: region, p_slug: slug }) }); },
    async enqueue(region, kind, slug, source) {
      return rpc("armory_enqueue", { p_region: region, p_kind: kind, p_slug: slug, p_source: source }, z.boolean());
    },
  };
}

/** Why each unavailable store has nothing behind it, so the process can say so once. */
const unavailableReason = new WeakMap<ArmoryStore, string>();

/** A store with nothing behind it: every call fails, so each page shows storage as out of reach. */
export function createUnavailableArmoryStore(reason: string): ArmoryStore {
  const fail = async (): Promise<never> => { throw new Error(reason); };
  const store = { character: fail, guild: fail, roster: fail, search: fail, searchGuilds: fail, board: fail, rank: fail, counts: fail, hide: fail, enqueue: fail };
  unavailableReason.set(store, reason);
  return store;
}

/** A development store, with the writes the crawler would make so tests and a local server can fill it. */
export interface MemoryArmoryStore extends ArmoryStore {
  putCharacter(c: ArmoryCharacter): void;
  putGuild(g: ArmoryGuild, members: Omit<ArmoryMember, "itemLevel" | "gearScore" | "stored">[]): void;
  /** What armory_touch does on a 304: the stored rows count as read now, `fetched_at` and `checked_at` both. */
  touch(region: string, kind: "character" | "guild", slugs: string[]): number;
  queued(): { region: string; kind: string; slug: string; source: string }[];
}

/** The same rules as the SQL, for development without a database. */
export function createMemoryArmoryStore(now: () => Date = () => new Date()): MemoryArmoryStore {
  const characters = new Map<string, ArmoryCharacter>();
  const guilds = new Map<string, ArmoryGuild>();
  const members = new Map<string, Omit<ArmoryMember, "itemLevel" | "gearScore" | "stored">[]>();
  const hides = new Set<string>();
  const queue = new Map<string, { region: string; kind: string; slug: string; source: string }>();
  const key = (region: string, slug: string) => `${region}/${slug}`;
  const valueOf = (c: ArmoryCharacter, metric: ArmoryMetricKey) => (metric === "item_level" ? c.itemLevel : metric === "gear_score" ? c.gearScore : c.honorableKills);
  const login = (c: ArmoryCharacter) => (c.lastLogin ? Date.parse(c.lastLogin) : -Infinity);
  const ranked = (metric: ArmoryMetricKey, keep: (c: ArmoryCharacter) => boolean) =>
    [...characters.values()].filter((c) => valueOf(c, metric) !== null && keep(c))
      .sort((a, b) => valueOf(b, metric)! - valueOf(a, metric)! || login(b) - login(a));
  const prefixOf = (prefix: string) => {
    const p = prefix.trim().normalize("NFC").toLowerCase();
    return SEARCH_RULE.test(p) ? p : null;
  };
  return {
    putCharacter(c) { if (!hides.has(key(c.region, c.slug))) characters.set(key(c.region, c.slug), c); },
    putGuild(g, list) { guilds.set(key(g.region, g.slug), g); members.set(key(g.region, g.slug), list); },
    touch(region, kind, slugs) {
      const at = now().toISOString();
      const rows: Map<string, ArmoryCharacter | ArmoryGuild> = kind === "character" ? characters : guilds;
      let n = 0;
      for (const slug of slugs) {
        const row = rows.get(key(region, slug));
        if (row) { row.fetchedAt = at; row.checkedAt = at; n += 1; }
      }
      return n;
    },
    queued() { return [...queue.values()]; },
    async character(region, slug) { return characters.get(key(region, slug)) ?? null; },
    async guild(region, slug) { return guilds.get(key(region, slug)) ?? null; },
    async roster(region, slug) {
      return (members.get(key(region, slug)) ?? []).filter((m) => !hides.has(key(region, m.characterSlug))).map((m) => {
        const c = characters.get(key(region, m.characterSlug));
        return { ...m, itemLevel: c?.itemLevel ?? null, gearScore: c?.gearScore ?? null, stored: Boolean(c) };
      });
    },
    async search(prefix, limit) {
      const p = prefixOf(prefix);
      if (!p) return [];
      return [...characters.values()].filter((c) => c.name.toLowerCase().startsWith(p))
        .sort((a, b) => a.name.localeCompare(b.name) || a.surname.localeCompare(b.surname)).slice(0, limit)
        .map((c) => ({ region: c.region, slug: c.slug, name: c.name, surname: c.surname, level: c.level, class: c.class, race: c.race, ruleset: c.ruleset, guildName: c.guildName }));
    },
    async searchGuilds(prefix, limit) {
      const p = prefixOf(prefix);
      if (!p) return [];
      return [...guilds.values()].filter((g) => g.name.toLowerCase().startsWith(p)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit)
        .map((g) => ({ region: g.region, slug: g.slug, name: g.name, faction: g.faction, ruleset: g.ruleset, memberCount: g.memberCount }));
    },
    async board(metric, region, rulesetId, limit) {
      return ranked(metric, (c) => (region === null || c.region === region) && (rulesetId === null || c.rulesetId === rulesetId)).slice(0, limit).map((c, i) => ({
        rank: i + 1, region: c.region, slug: c.slug, name: c.name, surname: c.surname, level: c.level, class: c.class, race: c.race,
        faction: c.faction, ruleset: c.ruleset, rulesetId: c.rulesetId, guildName: c.guildName, value: valueOf(c, metric)!, fetchedAt: c.fetchedAt,
      }));
    },
    async rank(region, slug) {
      const me = characters.get(key(region, slug));
      if (!me) return [];
      return (["item_level", "gear_score", "honorable_kills"] as const).flatMap((metric) => {
        const list = ranked(metric, (c) => c.region === me.region && c.rulesetId === me.rulesetId);
        const at = list.indexOf(me);
        return at < 0 ? [] : [{ metric, rank: at + 1, of: list.length }];
      });
    },
    async counts() {
      const out = new Map<string, ArmoryCount>();
      const cell = (region: string, rulesetId: number, ruleset: string) => {
        const k = `${region}/${rulesetId}`;
        let c = out.get(k);
        if (!c) out.set(k, (c = { region, rulesetId, ruleset, characters: 0, guilds: 0, newest: null }));
        return c;
      };
      const newer = (a: string | null, b: string) => (a === null || Date.parse(b) > Date.parse(a) ? b : a);
      for (const c of characters.values()) { const x = cell(c.region, c.rulesetId, c.ruleset); x.characters += 1; x.newest = newer(x.newest, c.fetchedAt); }
      for (const g of guilds.values()) { const x = cell(g.region, g.rulesetId, g.ruleset); x.guilds += 1; x.newest = newer(x.newest, g.fetchedAt); }
      return [...out.values()].sort((a, b) => a.region.localeCompare(b.region) || a.rulesetId - b.rulesetId);
    },
    async hide(region, slug) {
      hides.add(key(region, slug));
      characters.delete(key(region, slug));
      for (const [k, list] of members) if (k.startsWith(`${region}/`)) members.set(k, list.filter((m) => m.characterSlug !== slug));
      for (const [k, q] of queue) if (q.region === region && q.slug === slug && q.kind === "character") queue.delete(k);
    },
    async enqueue(region, kind, slug, source) {
      const qk = `${region}/${kind}/${slug}`;
      if (queue.has(qk) || (kind === "character" && hides.has(key(region, slug)))) return false;
      // Fresh is checked_at, as the SQL has it: a 304 counts as a read.
      const stored = kind === "character" ? characters.get(key(region, slug)) : guilds.get(key(region, slug));
      if (stored && now().getTime() - Date.parse(stored.checkedAt) < ARMORY_RECHECK_DAYS * 86_400_000) return false;
      queue.set(qk, { region, kind, slug, source });
      return true;
    },
  };
}

/**
 * The store this deployment uses: Supabase when its variables are set, memory in development. In production without
 * them it is a store whose every call fails, so the pages say storage is out of reach; it never throws here.
 */
export function armoryStoreFrom(env: Record<string, string | undefined> = process.env, query?: Query): ArmoryStore {
  if (env.SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return createCloudArmoryStore(query);
  if (env.NODE_ENV === "production") return createUnavailableArmoryStore("Armory storage is not configured (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set)");
  return createMemoryArmoryStore();
}

/** How long a store with nothing behind it is kept before the next call builds one again. */
export const ARMORY_STORE_RETRY_MS = 60_000;

const held = globalThis as typeof globalThis & {
  __everlootArmory?: { store: ArmoryStore; retryAt: number | null };
  __everlootArmoryLogged?: boolean;
};

/**
 * One store per server process, so the development store keeps its rows between requests. Never throws. When there is
 * no store to build (no Supabase variables in production, or a builder that throws), the pages get one whose calls
 * fail, the process logs it once, and the next call after a minute builds again. The log line names the cause, never
 * a value.
 */
export function armoryStore(build: () => ArmoryStore = armoryStoreFrom, now: () => number = Date.now): ArmoryStore {
  const have = held.__everlootArmory;
  if (have && (have.retryAt === null || now() < have.retryAt)) return have.store;
  let store: ArmoryStore;
  let problem: string | undefined;
  try {
    store = build();
    problem = unavailableReason.get(store);
  } catch (err) {
    problem = `the store could not be built (${err instanceof Error ? err.name : "unknown error"})`;
    store = createUnavailableArmoryStore("Armory storage is unavailable");
  }
  if (problem && !held.__everlootArmoryLogged) {
    held.__everlootArmoryLogged = true;
    console.error(`armory: storage unavailable: ${problem}. Armory pages show it as unreachable; trying again every ${ARMORY_STORE_RETRY_MS / 1000} s.`);
  }
  held.__everlootArmory = { store, retryAt: problem ? now() + ARMORY_STORE_RETRY_MS : null };
  return store;
}
