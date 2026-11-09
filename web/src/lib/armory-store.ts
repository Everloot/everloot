import { ARMORY_RECHECK_DAYS, type ArmoryMetricKey } from "./armory";
import { authQuery } from "./supabase/server";

/**
 * Where the armory rows live: Supabase in production (the functions of 20261109120000_armory.sql, called with the
 * service key through authQuery), and maps in memory in development, which follow the same rules and forget
 * everything on restart. The pages are the only readers: nothing here feeds an API answer, an export or the MCP tools.
 * Only two writes: a hide, and a character put in the crawler's queue.
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
  memberCount: number; createdAt: string | null; fetchedAt: string;
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
type Raw = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((r): r is Raw => typeof r === "object" && r !== null) : []);

/** Equipment as armory_upsert_characters stores it; an entry without a slot and an item id is left out. */
function toItems(v: unknown): ArmoryItem[] {
  return rows(v).flatMap((e) => {
    const slot = str(e.slot), itemId = num(e.item_id);
    if (!slot || itemId === null) return [];
    return [{ slot, itemId, name: str(e.name) ?? `Item ${itemId}`, level: num(e.level), quality: str(e.quality), inventoryType: str(e.inventory_type) }];
  });
}

export const toCharacter = (r: Raw): ArmoryCharacter => ({
  region: String(r.region), slug: String(r.slug), characterId: num(r.character_id) ?? 0, name: String(r.name), surname: String(r.surname),
  level: num(r.level) ?? 0, rulesetId: num(r.ruleset_id) ?? 0, ruleset: String(r.ruleset ?? ""), raceId: num(r.race_id) ?? 0, race: String(r.race ?? ""),
  classId: num(r.class_id) ?? 0, class: String(r.class ?? ""), faction: String(r.faction ?? ""), gender: str(r.gender),
  guildSlug: str(r.guild_slug), guildName: str(r.guild_name), lastLogin: str(r.last_login),
  equippedItemLevel: num(r.equipped_item_level), averageItemLevel: num(r.average_item_level), itemLevel: num(r.item_level), gearScore: num(r.gear_score),
  honorableKills: num(r.honorable_kills), pvpRank: num(r.pvp_rank), equipment: toItems(r.equipment),
  fetchedAt: String(r.fetched_at), checkedAt: String(r.checked_at),
});

const toGuild = (r: Raw): ArmoryGuild => ({
  region: String(r.region), slug: String(r.slug), guildId: num(r.guild_id) ?? 0, name: String(r.name), faction: String(r.faction ?? ""),
  rulesetId: num(r.ruleset_id) ?? 0, ruleset: String(r.ruleset ?? ""), memberCount: num(r.member_count) ?? 0,
  createdAt: str(r.created_at), fetchedAt: String(r.fetched_at),
});

const toMember = (r: Raw): ArmoryMember => ({
  characterSlug: String(r.character_slug), name: String(r.name), surname: String(r.surname ?? ""), level: num(r.level),
  classId: num(r.class_id), raceId: num(r.race_id), rank: num(r.rank), itemLevel: num(r.item_level), gearScore: num(r.gear_score), stored: r.stored === true,
});

const toHit = (r: Raw): ArmoryHit => ({
  region: String(r.region), slug: String(r.slug), name: String(r.name), surname: String(r.surname ?? ""), level: num(r.level) ?? 0,
  class: String(r.class ?? ""), race: String(r.race ?? ""), ruleset: String(r.ruleset ?? ""), guildName: str(r.guild_name),
});

const toGuildHit = (r: Raw): ArmoryGuildHit => ({
  region: String(r.region), slug: String(r.slug), name: String(r.name), faction: String(r.faction ?? ""), ruleset: String(r.ruleset ?? ""), memberCount: num(r.member_count) ?? 0,
});

const toBoardRow = (r: Raw): ArmoryBoardRow => ({
  rank: num(r.rank) ?? 0, region: String(r.region), slug: String(r.slug), name: String(r.name), surname: String(r.surname ?? ""), level: num(r.level) ?? 0,
  class: String(r.class ?? ""), race: String(r.race ?? ""), faction: String(r.faction ?? ""), ruleset: String(r.ruleset ?? ""), rulesetId: num(r.ruleset_id) ?? 0,
  guildName: str(r.guild_name), value: num(r.value) ?? 0, fetchedAt: String(r.fetched_at),
});

/** The Supabase store: one RPC per call, through `query` (authQuery, or a fake in tests). */
export function createCloudArmoryStore(query: Query = authQuery): ArmoryStore {
  const rpc = <T,>(fn: string, args: Record<string, unknown>) => query<T>(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  return {
    async character(region, slug) {
      const found = rows(await rpc("armory_character", { p_region: region, p_slug: slug }));
      return found[0] ? toCharacter(found[0]) : null;
    },
    async guild(region, slug) {
      const found = rows(await rpc("armory_guild", { p_region: region, p_slug: slug }));
      return found[0] ? toGuild(found[0]) : null;
    },
    async roster(region, slug) { return rows(await rpc("armory_roster", { p_region: region, p_slug: slug })).map(toMember); },
    async search(prefix, limit) { return rows(await rpc("armory_search", { p_prefix: prefix, p_limit: limit })).map(toHit); },
    async searchGuilds(prefix, limit) { return rows(await rpc("armory_search_guilds", { p_prefix: prefix, p_limit: limit })).map(toGuildHit); },
    async board(metric, region, rulesetId, limit) {
      return rows(await rpc("armory_board", { p_metric: metric, p_region: region, p_ruleset_id: rulesetId, p_limit: limit })).map(toBoardRow);
    },
    async rank(region, slug) {
      return rows(await rpc("armory_rank", { p_region: region, p_slug: slug })).flatMap((r) => {
        const rank = num(r.rank), of = num(r.of);
        return rank === null || of === null ? [] : [{ metric: String(r.metric) as ArmoryMetricKey, rank, of }];
      });
    },
    async counts() {
      return rows(await rpc("armory_counts", {})).map((r) => ({
        region: String(r.region), rulesetId: num(r.ruleset_id) ?? 0, ruleset: String(r.ruleset ?? ""),
        characters: num(r.characters) ?? 0, guilds: num(r.guilds) ?? 0, newest: str(r.newest),
      }));
    },
    async hide(region, slug) { await rpc("armory_hide", { p_region: region, p_slug: slug }); },
    async enqueue(region, kind, slug, source) {
      return (await rpc<unknown>("armory_enqueue", { p_region: region, p_kind: kind, p_slug: slug, p_source: source })) === true;
    },
  };
}

/** A development store, with the writes the crawler would make so tests and a local server can fill it. */
export interface MemoryArmoryStore extends ArmoryStore {
  putCharacter(c: ArmoryCharacter): void;
  putGuild(g: ArmoryGuild, members: Omit<ArmoryMember, "itemLevel" | "gearScore" | "stored">[]): void;
  queued(): { region: string; kind: string; slug: string; source: string }[];
}

const SEARCH_PREFIX = /^[a-z]{2,}$/;

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
  return {
    putCharacter(c) { if (!hides.has(key(c.region, c.slug))) characters.set(key(c.region, c.slug), c); },
    putGuild(g, list) { guilds.set(key(g.region, g.slug), g); members.set(key(g.region, g.slug), list); },
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
      const p = prefix.trim().toLowerCase();
      if (!SEARCH_PREFIX.test(p)) return [];
      return [...characters.values()].filter((c) => c.name.toLowerCase().startsWith(p))
        .sort((a, b) => a.name.localeCompare(b.name) || a.surname.localeCompare(b.surname)).slice(0, limit)
        .map((c) => ({ region: c.region, slug: c.slug, name: c.name, surname: c.surname, level: c.level, class: c.class, race: c.race, ruleset: c.ruleset, guildName: c.guildName }));
    },
    async searchGuilds(prefix, limit) {
      const p = prefix.trim().toLowerCase();
      if (!SEARCH_PREFIX.test(p)) return [];
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
      const stored = kind === "character" ? characters.get(key(region, slug)) : guilds.get(key(region, slug));
      const fresh = stored && now().getTime() - Date.parse(kind === "character" ? (stored as ArmoryCharacter).checkedAt : stored.fetchedAt) < ARMORY_RECHECK_DAYS * 86_400_000;
      if (fresh) return false;
      queue.set(qk, { region, kind, slug, source });
      return true;
    },
  };
}

/** The store this deployment uses: Supabase when its variables are set, memory in development, nothing in production without them. */
export function armoryStoreFrom(env: Record<string, string | undefined> = process.env, query?: Query): ArmoryStore {
  if (env.SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return createCloudArmoryStore(query);
  if (env.NODE_ENV === "production") throw new Error("Armory storage is not configured");
  return createMemoryArmoryStore();
}

const held = globalThis as typeof globalThis & { __everlootArmory?: ArmoryStore };
/** One store per server process, so the development store keeps its rows between requests. */
export function armoryStore(): ArmoryStore {
  return (held.__everlootArmory ??= armoryStoreFrom());
}
