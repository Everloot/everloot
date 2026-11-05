import { guildKey, guildSlug } from "../../../kb/src/guilds";
import { linkRealmKey } from "./character-links";
import { DEFAULT_RULESET, realmSlug, type Player, type PlayerUpsert } from "./player-pages";
import { readAllRows } from "./postgrest-pages";

/**
 * Where the player rows live: Supabase in production (the functions in 20261021130000_players.sql and
 * 20261025120000_guilds.sql), and a map in memory in development, which behaves the same way and forgets
 * everything on restart. Every call is one request, and a write is one batched call per upload, never one per row.
 */

/** One guild the search found: where it is, how many characters were seen in it and the newest day. */
export interface GuildHit { realm: string; guild: string; members: number; lastSeen: string }

/** One realm with guilds seen on it: how many guilds, and how many characters were seen in them. */
export interface GuildRealm { realm: string; guilds: number; characters: number }

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
  /** Every realm with a visible guild, with its guild and character counts, most guilds first, at most 200. */
  guildRealms(): Promise<GuildRealm[]>;
  /**
   * The visible guilds seen on the realm whose `realmSlugOf` is `slug`, most members seen first, then name, at most
   * 1000. Hidden guilds are left out; empty when no realm has that slug.
   */
  realmGuilds(slug: string): Promise<GuildHit[]>;
  /** Hide a guild: every guild read leaves it out from then on. The characters keep their own rows. */
  suppressGuild(realm: string, guild: string): Promise<void>;
  /** Every hidden guild, as `guildHideKey` keys, so the ladder can leave them out too. */
  hiddenGuilds(): Promise<Set<string>>;
  /**
   * Every hidden character, as `playerHideKey` keys, so names that come from somewhere other than the players
   * table (the roster, loot and attendance the officers publish) can be left out too.
   */
  hiddenPlayers(): Promise<Set<string>>;
}

const SEARCH_LIMIT = 25;
const ROSTER_LIMIT = 500;
const REALM_LIMIT = 200;
/** The most guilds one realm's read returns; the realm page says so when a realm reaches it. */
export const REALM_GUILD_LIMIT = 1000;
export const PLAYER_KEPT_DAYS = 90;

/**
 * The key a guild hide is recorded under: the realm as the players table keys it (so a spelling cannot dodge
 * the hide), then the guild name, cleaned the way the ladder keys guilds.
 */
export const guildHideKey = (realm: string, guild: string): string => guildKey(linkRealmKey(realm), guild);

/**
 * A realm's address segment: the guild slug of its players-table key, as public.realm_slug writes it, so every
 * spelling of a realm ("Mal'Ganis", "mal’ganis") has the one address the realm page is found by.
 */
export const realmSlugOf = (realm: string): string => guildSlug(linkRealmKey(realm));

/** The key a character hide is matched under: the realm as the players table keys it, then the name in lower case. */
export const playerHideKey = (realm: string, name: string): string => `${linkRealmKey(realm)}\u0000${name.trim().toLowerCase()}`;

interface Stored { name: string; realm: string; ruleset?: string; race: string; class: string; level: number; guild: string | null; last_seen: string }
interface StoredGuild { realm: string; guild: string; members: number; last_seen: string }

const toPlayer = (row: Stored, ruleset: string): Player => ({
  name: row.name, realm: row.realm, ruleset: row.ruleset ?? ruleset, race: row.race, class: row.class, level: row.level, guild: row.guild, lastSeen: row.last_seen,
});
const toGuild = (row: StoredGuild): GuildHit => ({ realm: row.realm, guild: row.guild, members: Number(row.members), lastSeen: row.last_seen });

/** A refused call, with PostgREST's error code when it gave one. */
export class PlayerStoreError extends Error {
  constructor(readonly status: number, readonly code: string | null) {
    super(`Player storage unavailable (${status})`);
  }
}

/**
 * Whether `err` is PostgREST saying the function is not there: not in its schema cache (PGRST202), or in a stale cache
 * but not in PostgreSQL (42883). That is a migration the owner has not applied yet, not an outage.
 */
export function missingFunction(err: unknown): boolean {
  return err instanceof PlayerStoreError && err.status === 404 && (err.code === "PGRST202" || err.code === "42883");
}

/** How long the whole hide list may take to read, every page together. Past it, the read fails and pages withhold names. */
export const HIDDEN_READ_MS = 5_000;

export function createCloudPlayerStore(url: string, key: string, doFetch: typeof fetch = fetch, hiddenReadMs = HIDDEN_READ_MS): PlayerStore {
  async function rpc<T>(fn: string, body: unknown): Promise<T> {
    const response = await doFetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const said = (await response.json().catch(() => null)) as { code?: unknown } | null;
      throw new PlayerStoreError(response.status, typeof said?.code === "string" ? said.code : null);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  // character_suppressions is read as a table, as the publication check already reads it (the server's key may
  // select it since 20261007070647_verified_publication.sql), a thousand rows a request, every page under one deadline.
  async function suppressions(): Promise<{ realm: string; character: string }[]> {
    const signal = AbortSignal.timeout(hiddenReadMs);
    return await readAllRows(async (offset) => {
      const response = await doFetch(`${url.replace(/\/$/, "")}/rest/v1/character_suppressions?select=realm,character&order=realm,character&limit=1000&offset=${offset}`, {
        cache: "no-store", signal, headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "count=exact" },
      });
      if (!response.ok) throw new Error(`Player storage unavailable (${response.status})`);
      return response;
    }) as { realm: string; character: string }[];
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
    async guildRealms() {
      const rows = await rpc<{ realm: string; guilds: number; characters: number }[]>("guild_realms", { p_ruleset: DEFAULT_RULESET });
      return Array.isArray(rows) ? rows.map((row) => ({ realm: row.realm, guilds: Number(row.guilds), characters: Number(row.characters) })) : [];
    },
    async realmGuilds(slug) {
      const rows = await rpc<StoredGuild[]>("realm_guilds", { p_ruleset: DEFAULT_RULESET, p_realm_slug: slug, p_limit: REALM_GUILD_LIMIT });
      return Array.isArray(rows) ? rows.map(toGuild) : [];
    },
    async suppressGuild(realm, guild) { await rpc("suppress_guild", { p_realm: realm, p_guild: guild }); },
    async hiddenGuilds() {
      const rows = await rpc<{ realm_key: string; guild_key: string }[]>("hidden_guilds", {});
      return new Set(Array.isArray(rows) ? rows.map((row) => guildHideKey(row.realm_key, row.guild_key)) : []);
    },
    async hiddenPlayers() {
      return new Set((await suppressions()).map((row) => playerHideKey(row.realm, row.character)));
    },
  };
}

/** The same rules as the SQL, for development without a database. */
export function createMemoryPlayerStore(now: () => Date = () => new Date()): PlayerStore {
  const rows = new Map<string, Player>();
  const hidden = new Set<string>();
  const hiddenGuilds = new Set<string>();
  const hiddenPlayers = new Set<string>();
  const key = (realm: string, name: string) => `${realm.trim().toLowerCase()}\u0000${name.toLowerCase()}`;
  const visible = (p: Player) => !hidden.has(key(p.realm, p.name));
  /** The visible rows with a guild that `keep` accepts, one group per realm and guild, hidden guilds left out. */
  const seenGuilds = (keep: (p: Player) => boolean) => {
    const groups = new Map<string, GuildHit>();
    for (const r of rows.values()) {
      if (!visible(r) || r.guild === null || !keep(r)) continue;
      const k = guildHideKey(r.realm, r.guild);
      if (hiddenGuilds.has(k)) continue;
      const have = groups.get(k);
      if (have) { have.members += 1; if (r.lastSeen > have.lastSeen) have.lastSeen = r.lastSeen; }
      else groups.set(k, { realm: r.realm, guild: r.guild, members: 1, lastSeen: r.lastSeen });
    }
    return groups;
  };
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
    async suppress(realm, name) { hidden.add(key(realm, name)); hiddenPlayers.add(playerHideKey(realm, name)); rows.delete(key(realm, name)); },
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
      return [...seenGuilds((r) => r.guild!.toLowerCase().startsWith(p)).values()]
        .sort((a, b) => a.guild.toLowerCase().localeCompare(b.guild.toLowerCase()) || a.realm.localeCompare(b.realm)).slice(0, SEARCH_LIMIT);
    },
    async guildRealms() {
      const realms = new Map<string, GuildRealm>();
      for (const g of seenGuilds(() => true).values()) {
        const k = linkRealmKey(g.realm);
        const have = realms.get(k);
        if (have) { have.guilds += 1; have.characters += g.members; }
        else realms.set(k, { realm: g.realm, guilds: 1, characters: g.members });
      }
      return [...realms.entries()].sort(([a, x], [b, y]) => y.guilds - x.guilds || a.localeCompare(b)).map(([, r]) => r).slice(0, REALM_LIMIT);
    },
    async realmGuilds(slug) {
      // The realm key with that slug and the most rows, as the SQL chooses it.
      const keys = new Map<string, number>();
      for (const r of rows.values()) {
        const k = linkRealmKey(r.realm);
        if (guildSlug(k) === slug) keys.set(k, (keys.get(k) ?? 0) + 1);
      }
      const wanted = [...keys].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0]?.[0];
      if (wanted === undefined) return [];
      return [...seenGuilds((r) => linkRealmKey(r.realm) === wanted).values()]
        .sort((a, b) => b.members - a.members || a.guild.toLowerCase().localeCompare(b.guild.toLowerCase())).slice(0, REALM_GUILD_LIMIT);
    },
    async suppressGuild(realm, guild) { hiddenGuilds.add(guildHideKey(realm, guild)); },
    async hiddenGuilds() { return new Set(hiddenGuilds); },
    async hiddenPlayers() { return new Set(hiddenPlayers); },
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
