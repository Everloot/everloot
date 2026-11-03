import { linkRealmKey } from "./character-links";
import { PULL_KEPT_DAYS, type PullUpsert } from "./pull-summaries";

/**
 * Where pull summaries live: Supabase in production (the functions in 20261102130000_pull_summaries.sql), and a map
 * in memory in development, which follows the same rules and forgets everything on restart. A write is one batched
 * call per upload.
 */
export interface PullStore {
  /** Write an upload's pulls. A hidden character is skipped, a pull left with no member is not written, and a pull
   * already stored (same install and event) is left as it is. */
  insert(rows: PullUpsert[]): Promise<void>;
  /** Hide a character from the pulls: delete its member rows and every pull left with none, and skip it from then on. */
  forget(realm: string, name: string): Promise<void>;
  /** Delete every pull received more than a year ago. Nothing to do, and no error, where the pull tables were never made. */
  prune(): Promise<void>;
}

export function createCloudPullStore(url: string, key: string, doFetch: typeof fetch = fetch): PullStore {
  /** Calls a function; with `absentOk`, PostgREST's answer that it has no such function (PGRST202) is not an error. */
  async function rpc(fn: string, body: unknown, absentOk = false): Promise<void> {
    const response = await doFetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return;
    if (absentOk && response.status === 404) {
      const said = (await response.json().catch(() => null)) as { code?: unknown } | null;
      if (said?.code === "PGRST202") return;
    }
    throw new Error(`Pull storage unavailable (${response.status})`);
  }
  return {
    async insert(rows) { if (rows.length) await rpc("insert_pull_summaries", { p_rows: rows }); },
    async forget(realm, name) { await rpc("forget_pull_member", { p_realm: realm, p_name: name }); },
    // Retention runs whether or not the site collects, so rows kept while it did still go after a year; before the
    // migration there is no such function, and so nothing to delete.
    async prune() { await rpc("prune_pull_summaries", {}, true); },
  };
}

/** A stored pull in the memory store, as tests read it back. */
export interface MemoryPull extends PullUpsert { receivedAt: string }

/** The same rules as the SQL, for development and tests. `pulls()` reads back what is stored. */
export function createMemoryPullStore(now: () => Date = () => new Date()): PullStore & { pulls(): MemoryPull[] } {
  const stored = new Map<string, MemoryPull>();
  const hidden = new Set<string>();
  const character = (realm: string, name: string) => `${linkRealmKey(realm)}\u0000${name.trim().toLowerCase()}`;
  return {
    async insert(rows) {
      for (const row of rows) {
        const id = JSON.stringify([row.installId, row.eventId]);
        const members = row.members.filter((m) => !hidden.has(character(m.realm, m.name)));
        if (stored.has(id) || members.length === 0) continue;
        stored.set(id, { ...row, members, receivedAt: now().toISOString() });
      }
    },
    async forget(realm, name) {
      const who = character(realm, name);
      hidden.add(who);
      for (const [id, pull] of stored) {
        const members = pull.members.filter((m) => character(m.realm, m.name) !== who);
        if (members.length === 0) stored.delete(id);
        else if (members.length !== pull.members.length) stored.set(id, { ...pull, members });
      }
    },
    async prune() {
      const cutoff = now().getTime() - PULL_KEPT_DAYS * 86_400_000;
      for (const [id, pull] of stored) if (Date.parse(pull.receivedAt) < cutoff) stored.delete(id);
    },
    pulls() { return [...stored.values()].map((p) => structuredClone(p)); },
  };
}

/** The store this deployment uses: Supabase when its variables are set, memory in development, nothing in production without them. */
export function pullStoreFrom(env: Record<string, string | undefined> = process.env, doFetch?: typeof fetch): PullStore {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) return createCloudPullStore(url, key, doFetch);
  if (env.NODE_ENV === "production") throw new Error("Pull storage is not configured");
  return createMemoryPullStore();
}

const held = globalThis as typeof globalThis & { __everlootPulls?: PullStore };
/** One store per server process, so the development store keeps its rows between requests, whichever route bundle asks. */
export function pullStore(): PullStore {
  return (held.__everlootPulls ??= pullStoreFrom());
}
