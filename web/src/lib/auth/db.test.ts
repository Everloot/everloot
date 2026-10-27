import { inspect } from "node:util";
import type { Pool } from "pg";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });

// authPool keeps one pool per process, so every case loads a fresh copy of the module.
async function poolFor(url: string) {
  vi.stubEnv("AUTH_DATABASE_URL", url);
  const { authPool } = await import("./db");
  return authPool;
}

function thrown(fn: () => unknown): unknown {
  try { fn(); } catch (error) { return error; }
  throw new Error("expected a throw");
}

test("a malformed AUTH_DATABASE_URL fails with a generic error that carries no part of it", async () => {
  const authPool = await poolFor("postgres://everloot_auth:hunter2-secret@[not-a-host:6543/postgres");
  const error = thrown(authPool) as Error;
  expect(error.message).toBe("Authentication storage is not configured");
  expect(error.cause).toBeUndefined();
  expect(inspect(error, { depth: 5 })).not.toContain("hunter2");
});

test.each(["sslmode=disable", "sslmode=no-verify", "sslrootcert=/tmp/ca.pem", "sslcert=c", "sslkey=k", "ssl=false", "uselibpqcompat=true", "SSLMode=disable", "sslnegotiation=direct", "host=attacker.example.com", "HOST=attacker.example.com"])(
  "an AUTH_DATABASE_URL with %s is refused, so it cannot replace the pinned CA or the host it is checked against",
  async (param) => {
    const authPool = await poolFor(`postgres://everloot_auth:hunter2-secret@db.example.supabase.co:6543/postgres?${param}`);
    const error = thrown(authPool) as Error;
    expect(error.message).toBe("Authentication storage is not configured");
    expect(inspect(error, { depth: 5 })).not.toContain("hunter2");
  },
);

test("the pool verifies the Supabase CA, gives up on slow connections and queries, and survives idle-client errors", async () => {
  const authPool = await poolFor("postgres://everloot_auth:hunter2-secret@db.example.supabase.co:6543/postgres");
  const pool = authPool() as Pool & { options: Record<string, unknown> };
  expect(pool.options).toMatchObject({ connectionTimeoutMillis: 5_000, query_timeout: 10_000, ssl: { ca: expect.stringContaining("BEGIN CERTIFICATE") } });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  // Without a listener this emit would throw and take the instance down.
  pool.emit("error", Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }));
  expect(log).toHaveBeenCalledTimes(1);
  // The Postgres error code says which failure it was without carrying the message text.
  expect(inspect(log.mock.calls)).toContain("57P01");
  expect(inspect(log.mock.calls)).not.toContain("hunter2");
  expect(inspect(log.mock.calls)).not.toContain("supabase.co");
  await pool.end();
});

function fakePool(now: number) {
  const query = vi.fn(async (sql: string) => sql.trim().startsWith("insert")
    ? { rows: [{ count: 1, last_request: String(now) }] }
    : { rows: [] });
  return { pool: { query } as unknown as Pool, query };
}

test("about one consume call in a hundred prunes rows idle for over an hour", async () => {
  const { pgRateLimitStore } = await import("./db");
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);

  const kept = fakePool(now);
  await pgRateLimitStore(kept.pool, () => 0.01).consume("k", { window: 60, max: 3 });
  expect(kept.query).toHaveBeenCalledTimes(1);

  const pruned = fakePool(now);
  await pgRateLimitStore(pruned.pool, () => 0.009).consume("k", { window: 60, max: 3 });
  expect(pruned.query).toHaveBeenCalledTimes(2);
  expect(pruned.query.mock.calls[1]).toEqual([expect.stringMatching(/^delete from public\.auth_rate_limit where last_request < \$1/), [now - 60 * 60 * 1000, now - 25 * 60 * 60 * 1000]]);
});

test("a daily: key outlives the hour, so a count over a day is not pruned halfway through it", async () => {
  const { pgRateLimitStore } = await import("./db");
  const pruned = fakePool(Date.now());
  await pgRateLimitStore(pruned.pool, () => 0).consume("k", { window: 60, max: 3 });
  expect(pruned.query.mock.calls[1][0]).toBe("delete from public.auth_rate_limit where last_request < $1 and (key not like 'daily:%' or last_request < $2)");
});
