import { guildKey } from "../../../kb/src/guilds";
import { linkRealmKey } from "./character-links";
import { DEFAULT_RULESET, realmSlug, type Player, type PlayerUpsert } from "./player-pages";

/**
 * Where the player rows live: Supabase in production (the functions in 20261021130000_players.sql and
 * 20261025120000_guilds.sql), and a map in memory in development, which behaves the same way and forgets
 * everything on restart. Every call is one request, and a write is one batched call per upload, never one per row.
 */

/** One guild the search found: where it is, how many characters were seen in it and the newest day. */
export interface GuildHit { realm: string; guild: string; members: number; lastSeen: string }

export interface PlayerStore {
  /** Write a batch; a suppressed character is skipped and an older report never replaces a newer row. */
  upsert(rows: PlayerUpsert[]): Promise<void>;
  get(ruleset: string, realm: string, name: string): Promise<Player | null>;
  /** Names starting with `prefix` (2 or more letters), at most 25, in name order. */
  search(prefix: string): Promise<Player[]>;
  /** Hide a character: record the opt-out and delete its row. */
  suppress(realm: string, name: string): Promise<void>;
  prune(): Promise<void>;
  /** The characters seen in a guild on a realm, newest last seen first, at most 500. Empty for a hidden guild. */
  guildMembers(realm: string, guild: string): Promise<Player[]>;
  /** Guilds whose name starts with `prefix` (2 or more letters), one per realm and guild, at most 25, in name order. */
  searchGuilds(prefix: string): Promise<GuildHit[]>;
  /** Hide a guild: both guild reads leave it out from then on. The characters keep their own rows. */
  suppressGuild(realm: string, guild: string): Promise<void>;
  /** Every hidden guild, as `guildHideKey` keys, so the ladder can leave them out too. */
  hiddenGuilds(): Promise<Set<string>>;
}

const SEARCH_LIMIT = 25;
const ROSTER_LIMIT = 500;
export const PLAYER_KEPT_DAYS = 90;

/**
 * The key a guild hide is recorded under: the realm as the players table keys it (so a spelling cannot dodge
 * the hide), then the guild name, cleaned the way the ladder keys guilds.
 */
export const guildHideKey = (realm: string, guild: string): string => guildKey(linkRealmKey(realm), guild);

interface Stored { name: string; realm: string; ruleset?: string; race: string; class: string; level: number; guild: string | null; last_seen: string }
interface StoredGuild { realm: string; guild: string; members: number; last_seen: string }

const toPlayer = (row: Stored, ruleset: string): Player => ({
  name: row.name, realm: row.realm, ruleset: row.ruleset ?? ruleset, race: row.race, class: row.class, level: row.level, guild: row.guild, lastSeen: row.last_seen,
});
const toGuild = (row: StoredGuild): GuildHit => ({ realm: row.realm, guild: row.guild, members: Number(row.members), lastSeen: row.last_seen });

export function createCloudPlayerStore(url: string, key: string, doFetch: typeof fetch = fetch): PlayerStore {
  async function rpc<T>(fn: string, body: unknown): Promise<T> {
    const response = await doFetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Player storage unavailable (${response.status})`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  return {
    async upsert(rows) {
      if (rows.length) await rpc("upsert_players", { p_ruleset: DEFAULT_RULESET, p_rows: rows });
    },
    async get(ruleset, realm, name) {
      const rows = await rpc<Stored[]>("get_player", { p_ruleset: ruleset, p_realm_slug: realm, p_name: name });
      return Array.isArray(rows) && rows[0] ? toPlayer(rows[0], ruleset) : null;
    },
    async search(prefix) {
      const rows = await rpc<Stored[]>("search_players", { p_prefix: prefix, p_limit: SEARCH_LIMIT });
      return Array.isArray(rows) ? rows.map((row) => toPlayer(row, DEFAULT_RULESET)) : [];
    },
    async suppress(realm, name) { await rpc("suppress_player", { p_realm: realm, p_name: name }); },
    async prune() { await rpc("prune_players", {}); },
    async guildMembers(realm, guild) {
      const rows = await rpc<Stored[]>("guild_members", { p_ruleset: DEFAULT_RULESET, p_realm_key: linkRealmKey(realm), p_guild_key: guild });
      return Array.isArray(rows) ? rows.map((row) => toPlayer(row, DEFAULT_RULESET)) : [];
    },
    async searchGuilds(prefix) {
      const rows = await rpc<StoredGuild[]>("search_guilds", { p_prefix: prefix, p_limit: SEARCH_LIMIT });
      return Array.isArray(rows) ? rows.map(toGuild) : [];
    },
    async suppressGuild(realm, guild) { await rpc("suppress_guild", { p_realm: realm, p_guild: guild }); },
    async hiddenGuilds() {
      const rows = await rpc<{ realm_key: string; guild_key: string }[]>("hidden_guilds", {});
      return new Set(Array.isArray(rows) ? rows.map((row) => guildHideKey(row.realm_key, row.guild_key)) : []);
    },
  };
}

/** The same rules as the SQL, for development without a database. */
export function createMemoryPlayerStore(now: () => Date = () => new Date()): PlayerStore {
  const rows = new Map<string, Player>();
  const hidden = new Set<string>();
  const hiddenGuilds = new Set<string>();
  const key = (realm: string, name: string) => `${realm.trim().toLowerCase()}\u0000${name.toLowerCase()}`;
  const visible = (p: Player) => !hidden.has(key(p.realm, p.name));
  return {
    async upsert(batch) {
      for (const r of batch) {
        const k = key(r.realm, r.name);
        const old = rows.get(k);
        if (hidden.has(k) || (old && old.lastSeen > r.seen)) continue;
        rows.set(k, { name: r.name, realm: r.realm, ruleset: DEFAULT_RULESET, race: r.race, class: r.class, level: r.level, guild: r.guild ?? old?.guild ?? null, lastSeen: r.seen });
      }
    },
    async get(ruleset, realm, name) {
      return [...rows.values()].find((p) => p.ruleset === ruleset && realmSlug(p.realm) === realm.toLowerCase() && p.name.toLowerCase() === name.toLowerCase() && visible(p)) ?? null;
    },
    async search(prefix) {
      const p = prefix.toLowerCase();
      return [...rows.values()].filter((r) => r.name.toLowerCase().startsWith(p) && visible(r))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.realm.localeCompare(b.realm)).slice(0, SEARCH_LIMIT);
    },
    async suppress(realm, name) { hidden.add(key(realm, name)); rows.delete(key(realm, name)); },
    async prune() {
      const cutoff = new Date(now().getTime() - PLAYER_KEPT_DAYS * 86_400_000).toISOString().slice(0, 10);
      for (const [k, p] of rows) if (p.lastSeen < cutoff) rows.delete(k);
    },
    async guildMembers(realm, guild) {
      const wanted = guildHideKey(realm, guild);
      if (hiddenGuilds.has(wanted)) return [];
      return [...rows.values()].filter((p) => visible(p) && p.guild !== null && guildHideKey(p.realm, p.guild) === wanted)
        .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.name.toLowerCase().localeCompare(b.name.toLowerCase())).slice(0, ROSTER_LIMIT);
    },
    async searchGuilds(prefix) {
      const p = prefix.trim().toLowerCase();
      if (p.length < 2 || /[%_\\]/.test(p)) return [];
      const groups = new Map<string, GuildHit>();
      for (const r of rows.values()) {
        if (!visible(r) || r.guild === null || !r.guild.toLowerCase().startsWith(p)) continue;
        const k = guildHideKey(r.realm, r.guild);
        if (hiddenGuilds.has(k)) continue;
        const have = groups.get(k);
        if (have) { have.members += 1; if (r.lastSeen > have.lastSeen) have.lastSeen = r.lastSeen; }
        else groups.set(k, { realm: r.realm, guild: r.guild, members: 1, lastSeen: r.lastSeen });
      }
      return [...groups.values()].sort((a, b) => a.guild.toLowerCase().localeCompare(b.guild.toLowerCase()) || a.realm.localeCompare(b.realm)).slice(0, SEARCH_LIMIT);
    },
    async suppressGuild(realm, guild) { hiddenGuilds.add(guildHideKey(realm, guild)); },
    async hiddenGuilds() { return new Set(hiddenGuilds); },
  };
}

/** The store this deployment uses: Supabase when its variables are set, memory in development, nothing in production without them. */
export function playerStoreFrom(env: Record<string, string | undefined> = process.env, doFetch?: typeof fetch): PlayerStore {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) return createCloudPlayerStore(url, key, doFetch);
  if (env.NODE_ENV === "production") throw new Error("Player storage is not configured");
  return createMemoryPlayerStore();
}

const held = globalThis as typeof globalThis & { __everlootPlayers?: PlayerStore };
/** One store per server process, so the development store keeps its rows between requests, whichever route bundle asks. */
export function playerStore(): PlayerStore {
  return (held.__everlootPlayers ??= playerStoreFrom());
}
