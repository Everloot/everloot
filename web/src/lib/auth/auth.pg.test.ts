import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createAuth } from "./auth";
import { pgRateLimitStore } from "./db";

// Better Auth against real Postgres, connected as everloot_auth the way production is: no superuser,
// no BYPASSRLS. Disposable local database only: this drops the public schema.
// QUOTA_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/intake_quota_test npx vitest run src/lib/auth/auth.pg.test.ts
const databaseUrl = process.env.QUOTA_TEST_DATABASE_URL;

const env = {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "https://everloot.app",
  BNET_CLIENT_ID: "client",
  BNET_CLIENT_SECRET: "secret",
} as NodeJS.ProcessEnv;

const discovery = {
  issuer: "https://oauth.battle.net",
  authorization_endpoint: "https://oauth.battle.net/authorize",
  token_endpoint: "https://oauth.battle.net/token",
  userinfo_endpoint: "https://oauth.battle.net/userinfo",
  jwks_uri: "https://oauth.battle.net/jwks/certs",
  id_token_signing_alg_values_supported: ["RS256"],
};

function stubBattlenet() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://oauth.battle.net/.well-known/openid-configuration") return Response.json(discovery);
    if (url.startsWith(discovery.token_endpoint)) return Response.json({ access_token: "at", token_type: "bearer", expires_in: 86400 });
    if (url.startsWith(discovery.userinfo_endpoint)) return Response.json({ sub: "123", id: 123, battletag: "Thrall#1" });
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

const cookieHeader = (response: Response) => response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

describe.skipIf(!databaseUrl)("Better Auth on Postgres as everloot_auth", () => {
  let admin: Pool;
  let authDb: Pool;

  beforeAll(async () => {
    const url = new URL(databaseUrl ?? "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local test database required");
    if (url.pathname !== "/intake_quota_test") throw new Error("Dedicated test database required");
    admin = new Pool({ connectionString: url.toString(), max: 2 });
    // The same start as scripts/accounts.integration.mjs: an empty schema, Supabase's roles and defaults.
    await admin.query("drop schema public cascade");
    await admin.query("create schema public");
    await admin.query("grant all on schema public to public");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
    }
    await admin.query("alter role service_role bypassrls");
    await admin.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
    const dir = new URL("../../../../supabase/migrations/", import.meta.url);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    await admin.query((await Promise.all(files.map((file) => readFile(new URL(file, dir), "utf8")))).join("\n"));
    // The owner's step after merge, with a throwaway password.
    await admin.query("alter role everloot_auth login password 'test'");
    const asAuth = new URL(url);
    asAuth.username = "everloot_auth";
    asAuth.password = "test";
    authDb = new Pool({ connectionString: asAuth.toString(), max: 3 });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await authDb?.end();
    await admin?.end();
  });

  test("a Battle.net sign-in writes users, auth_account and auth_session, and the session is found again", async () => {
    stubBattlenet();
    const auth = createAuth({ database: authDb, rateLimitStore: pgRateLimitStore(authDb), env });
    const start = await auth.handler(new Request("https://everloot.app/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://everloot.app", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ provider: "battlenet", callbackURL: "/" }),
    }));
    expect(start.status).toBe(200);
    const { url } = await start.json() as { url: string };
    const state = new URL(url).searchParams.get("state") ?? "";
    const callback = await auth.handler(new Request(
      `https://everloot.app/api/auth/callback/battlenet?code=c&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookieHeader(start), "x-forwarded-for": "203.0.113.9", "user-agent": "test-agent" } },
    ));
    const session = callback.headers.getSetCookie().find((c) => c.startsWith("everloot.session_token="));
    expect(session).toBeDefined();

    const users = (await admin.query("select id, name, email, email_verified, bnet_id, battletag from public.users")).rows;
    expect(users).toEqual([{
      id: expect.any(String), name: "Thrall#1", email: "bnet-123@users.everloot.invalid", email_verified: false,
      bnet_id: "123", battletag: "Thrall#1",
    }]);
    expect((await admin.query("select user_id, provider_id, account_id, access_token, refresh_token, id_token from public.auth_account")).rows)
      .toEqual([{ user_id: users[0].id, provider_id: "battlenet", account_id: "123", access_token: null, refresh_token: null, id_token: null }]);
    expect((await admin.query("select user_id, ip_address, user_agent from public.auth_session")).rows)
      .toEqual([{ user_id: users[0].id, ip_address: null, user_agent: null }]);

    const found = await auth.api.getSession({ headers: new Headers({ cookie: (session ?? "").split(";")[0] }) });
    expect(found?.user).toMatchObject({ id: users[0].id, name: "Thrall#1" });
  });

  test("provider tokens, addresses and user agents cannot be stored", async () => {
    const [{ id }] = (await admin.query("select id from public.users limit 1")).rows;
    await expect(authDb.query("update public.auth_account set access_token = 'at' where user_id = $1", [id])).rejects.toThrow(/check constraint/);
    await expect(authDb.query("update public.auth_account set id_token = 'it' where user_id = $1", [id])).rejects.toThrow(/check constraint/);
    await expect(authDb.query("update public.auth_session set ip_address = '203.0.113.9' where user_id = $1", [id])).rejects.toThrow(/check constraint/);
  });

  test("the rate-limit store counts per key in a window and prunes stale rows", async () => {
    const store = pgRateLimitStore(authDb, () => 0.5);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await store.consume("key-a", { window: 60, max: 3 }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfter).toBeGreaterThan(0);
    expect(results[3].retryAfter).toBeLessThanOrEqual(60);
    expect((await store.consume("key-b", { window: 60, max: 3 })).allowed).toBe(true);

    await authDb.query("insert into public.auth_rate_limit (key, count, last_request) values ('stale', 1, $1)", [Date.now() - 2 * 60 * 60 * 1000]);
    // A day's count outlives the hour; one older than a day goes with the rest.
    await authDb.query("insert into public.auth_rate_limit (key, count, last_request) values ('daily:today', 1, $1), ('daily:yesterday', 1, $2)", [Date.now() - 2 * 60 * 60 * 1000, Date.now() - 26 * 60 * 60 * 1000]);
    await store.consume("key-a", { window: 60, max: 3 });
    expect((await admin.query("select count(*)::int as n from public.auth_rate_limit where key = 'stale'")).rows[0].n).toBe(1);

    await pgRateLimitStore(authDb, () => 0).consume("key-c", { window: 60, max: 3 });
    const keys = (await admin.query("select key from public.auth_rate_limit")).rows.map((r) => r.key);
    expect(keys).not.toContain("stale");
    expect(keys).toContain("daily:today");
    expect(keys).not.toContain("daily:yesterday");
    expect(keys).toEqual(expect.arrayContaining(["key-a", "key-b", "key-c"]));
  });
});
