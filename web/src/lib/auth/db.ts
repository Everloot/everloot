import { Pool } from "pg";
import { supabaseCa } from "./supabase-ca";

// Better Auth 1.7 asks a custom store for one atomic check-and-count per request.
export type RateLimitStore = {
  consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }>;
};

let pool: Pool | undefined;

// pg lays these URL parameters over the `ssl` option, so any of them could swap the pinned CA or turn
// verification off. `host` would send the connection somewhere other than the hostname checked below.
// AUTH_DATABASE_URL must not carry them.
const REFUSED_PARAMS = new Set(["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl", "uselibpqcompat", "sslnegotiation", "host"]);

// Never chained to the cause: a URL parse error holds the whole URL, password included.
const notConfigured = () => new Error("Authentication storage is not configured");

// Created on first use, never at import: the Next build imports route modules.
export function authPool(): Pool {
  if (pool) return pool;
  const url = process.env.AUTH_DATABASE_URL?.trim();
  if (!url) throw notConfigured();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw notConfigured();
  }
  if ([...parsed.searchParams.keys()].some((name) => REFUSED_PARAMS.has(name.toLowerCase()))) throw notConfigured();
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  pool = new Pool({
    connectionString: url, max: 3, ssl: local ? undefined : { ca: supabaseCa },
    // Fail fast, so /api/auth/me answers 503 instead of hanging.
    connectionTimeoutMillis: 5_000, query_timeout: 10_000,
  });
  // An idle client's error is emitted on the pool; unheard, it would crash the instance.
  // Only the Postgres error code is logged: the message can carry the host.
  pool.on("error", (error: Error & { code?: string }) => console.error("Authentication storage connection failed", error.code ?? "no code"));
  return pool;
}

const PRUNE_AFTER_MS = 60 * 60 * 1000;
const DAILY_PRUNE_AFTER_MS = 25 * 60 * 60 * 1000;

// One statement, so concurrent requests cannot both pass a stale read. `last_request` holds the
// start of the current window in ms: an expired window restarts at 1, otherwise the count grows.
// About one call in a hundred also deletes rows whose window started over an hour ago, or over
// a day ago for a key that counts over a day (named `daily:...`, the free chat model's).
export function pgRateLimitStore(pool: Pool, random: () => number = Math.random): RateLimitStore {
  return {
    async consume(key, { window, max }) {
      const now = Date.now();
      const windowMs = window * 1000;
      const { rows } = await pool.query<{ count: number; last_request: string }>(
        `insert into public.auth_rate_limit as r (key, count, last_request) values ($1, 1, $2::bigint)
         on conflict (key) do update set
           count = case when r.last_request <= $2::bigint - $3::bigint then 1 else r.count + 1 end,
           last_request = case when r.last_request <= $2::bigint - $3::bigint then $2::bigint else r.last_request end
         returning count, last_request`,
        [key, now, windowMs],
      );
      if (random() < 0.01) {
        await pool.query(
          "delete from public.auth_rate_limit where last_request < $1 and (key not like 'daily:%' or last_request < $2)",
          [now - PRUNE_AFTER_MS, now - DAILY_PRUNE_AFTER_MS],
        );
      }
      const { count, last_request } = rows[0];
      if (count <= max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: Math.ceil((Number(last_request) + windowMs - now) / 1000) };
    },
  };
}
