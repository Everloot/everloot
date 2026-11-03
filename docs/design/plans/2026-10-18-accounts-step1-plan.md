# Accounts step 1: Battle.net on Better Auth — Implementation Plan

**Goal:** Battle.net sign-in runs on Better Auth against our own Postgres, behind `EVERLOOT_AUTH_V2=1`, with every existing account (and its API keys) kept.

**Architecture:** One Better Auth instance (`web/src/lib/auth/`) with a `pg` Pool on the Supabase transaction pooler, the generic OAuth plugin for Battle.net, and Better Auth's tables renamed `auth_*` beside our `users` table. The existing seam stays: `getUser()` / `revokeSession()` in `web/src/lib/supabase/server.ts` switch on the flag, and `/api/auth/bnet`, `/api/auth/me`, `/api/auth/logout` keep their URLs, so no page or component changes in this step. Flag off = today's code path, unchanged.

**Tech Stack:** Next.js 15.5 route handlers, `better-auth` 1.7.10 (exact pin), `pg` 8.23.1 (moves to `dependencies`), vitest, local-Postgres integration script.

**Spec:** [`docs/design/specs/2026-10-18-accounts-sign-in-design.md`](../specs/2026-10-18-accounts-sign-in-design.md) — §2, §3 (Battle.net row), §7, §8, §9 step 1. Steps 2 (GitHub, Google, Microsoft, `/account`) and 3 (email) get their own plans once the owner setup in spec §10 is done.

## Corrections to the spec (decided here, tell Carlos in the PR)

1. **Email can't be null.** Better Auth requires an email on every user and fails Battle.net sign-in with
   `email_is_missing` otherwise. Battle.net users get the placeholder `bnet-<accountId>@users.everloot.invalid`
   (`.invalid` is reserved by RFC 2606, so no inbox can exist), `email_verified = false`. Spec §2's "email
   (nullable, unique when set)" becomes "email not null, unique; Battle.net-only accounts hold a placeholder".
2. **Battle.net's callback URL** is `/api/auth/callback/battlenet`, as spec §10 says. (This plan first said
   `/api/auth/oauth2/callback/battlenet`; that was the generic OAuth plugin's path before 1.7, and 1.7.10
   serves `/api/auth/callback/<providerId>` for it too.)
3. **Session tokens are stored as Better Auth issues them** (spec §2 already says "a random token, stored
   server-side"), not as today's SHA-256. The `auth_session` table is reachable only by the server roles
   (`service_role`, and `everloot_auth` through its RLS policies).

## Global Constraints

- Flag: `EVERLOOT_AUTH_V2=1` turns v2 on; any other value or unset = today's behaviour, byte for byte.
- Placeholder email format: `bnet-${accountId}@users.everloot.invalid`; one helper produces it (`placeholderEmail`), nothing else builds the string.
- Cookie: prefix `everloot`, httpOnly, secure in production, `sameSite: lax`, 30-day expiry (`60 * 60 * 24 * 30`), rolling refresh once a day (`updateAge: 60 * 60 * 24`).
- Provider tokens are never stored: `access_token`, `refresh_token`, `id_token` on `auth_account` are always null.
- Sessions store no IP address and no user agent (spec §8 lists what is stored; neither is on it).
- Rate-limit keys are an HMAC-SHA256 under `BETTER_AUTH_SECRET` before they reach the database (same rule as the intake quota: never the address, and keyed so it cannot be reversed by hashing every address).
- Every new table: RLS on, `revoke all … from anon, authenticated`, `grant all … to service_role`, like `auth_schema.sql`.
- Migrations are safe to apply twice (the integration scripts apply them twice).
- New env vars: `EVERLOOT_AUTH_V2`, `BETTER_AUTH_SECRET` (≥ 32 chars), `BETTER_AUTH_URL`, `AUTH_DATABASE_URL`. `BNET_CLIENT_ID` / `BNET_CLIENT_SECRET` are reused.
- Copy rules from the repo's design guard apply to any user-facing text (no all-caps labels, no pictographs).

## Review Focus

1. **Existing account signs in under v2** → lands on the same `users.id`, so API keys and entitlements still resolve. (Task 4 test `a legacy Battle.net account keeps its id`.)
2. **A v1 sign-in happens after the migration but before the flag flips** → that user still has a placeholder email and still links under v2. (Task 1 integration assertion on the trigger; Task 3 `trustedProviders: ["battlenet"]`.)
3. **Rolling the flag back to v1 after v2 created new users** → v1 finds them by `bnet_id` instead of making duplicates. (An `auth_account` trigger fills `bnet_id` and `battletag` in the same transaction; `web/src/lib/auth/auth.pg.test.ts` and `accounts.integration.mjs` check it.)
4. **Database down under v2** → `/api/auth/me` answers 503, never `{ user: null }` that would look like a sign-out. (Task 5 test `v2 fails closed when the database is down`.)
5. **Someone registers the placeholder address on another login method** (step 3) → pre-hijack of the Battle.net account. Step 1 has no email sign-up, but `isPlaceholderEmail()` ships now and Task 2 tests it, so step 3's plan only has to call it.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261003000000_auth_schema.sql` | `git mv` of `supabase/auth_schema.sql` (spec §2: schema reproducible from migrations) |
| `supabase/migrations/20261020120000_accounts.sql` | `users` columns + trigger, `auth_session`, `auth_account`, `auth_verification`, `auth_rate_limit`, copy of existing Battle.net ids |
| `web/scripts/accounts.integration.mjs` | Applies all migrations twice on the local test DB and checks the copy, trigger and grants |
| `web/src/lib/auth/battlenet.ts` | `placeholderEmail`, `isPlaceholderEmail`, `battlenetUser`, the generic-OAuth config entry |
| `web/src/lib/auth/auth.ts` | `authV2Enabled`, `createAuth(options)`, lazy `getAuth()` singleton, hooks, hashed rate-limit storage |
| `web/src/lib/auth/db.ts` | `authPool()`: `pg` Pool on `AUTH_DATABASE_URL` with the Supabase CA |
| `web/src/app/api/auth/[...all]/route.ts` | Better Auth handler; 404 while the flag is off |
| `web/src/lib/supabase/server.ts` | `getUser()` / `revokeSession()` branch on the flag; `AccountUser` becomes `{ id, name }` |
| `web/src/app/api/auth/bnet/route.ts`, `logout/route.ts` | Under v2, start Better Auth's flow / sign-out and forward its cookies |
| `web/src/app/privacy/page.tsx` | "Battle.net sign-in" paragraph rewritten for what v2 stores |

---

### Task 1: Migrations — fold the hand-run schema in, add the accounts tables

**Files:**
- Move: `supabase/auth_schema.sql` → `supabase/migrations/20261003000000_auth_schema.sql`
- Modify: `web/scripts/data-guard.integration.mjs:41`, `web/scripts/launch-maintenance.mjs:92`, `supabase/README.md:9,27` (new path; README says "apply the files in `migrations/` in name order")
- Create: `supabase/migrations/20261020120000_accounts.sql`
- Test: `web/scripts/accounts.integration.mjs`

**Interfaces:**
- Produces (tables later tasks map Better Auth onto):
  - `public.users`: existing columns, `bnet_id` and `battletag` now nullable, plus `name text not null`, `email text not null unique`, `email_verified boolean not null default false`, `image text`, `flags jsonb not null default '{}'`.
  - `public.auth_session(id uuid pk, user_id uuid → users on delete cascade, token text unique not null, expires_at timestamptz not null, ip_address text, user_agent text, created_at, updated_at timestamptz not null default now())`
  - `public.auth_account(id uuid pk, user_id uuid → users cascade, account_id text not null, provider_id text not null, access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, password text, created_at, updated_at, unique (provider_id, account_id))` + index on `user_id`
  - `public.auth_verification(id uuid pk, identifier text not null, value text not null, expires_at timestamptz not null, created_at, updated_at)` + index on `identifier`
  - `public.auth_rate_limit(key text primary key, count integer not null, last_request bigint not null)` (written only by our hashed store, Task 3)
  - Trigger `users_fill_identity` (BEFORE INSERT OR UPDATE): when `bnet_id` is set, `name := coalesce(name, battletag)`, `email := coalesce(email, 'bnet-' || bnet_id || '@users.everloot.invalid')`. This keeps today's v1 insert (`bnet_id, battletag` only) valid after the migration, whichever ships first.

- [ ] **Step 1: Write the failing integration script** `web/scripts/accounts.integration.mjs`, same guard and role helpers as `data-guard.integration.mjs` (local host, database `intake_quota_test`). It applies every file in `supabase/migrations/` in name order, twice, then asserts:

```js
// A legacy row inserted the v1 way gets a name and a placeholder email from the trigger.
const [{ id: legacy }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('123', 'Thrall#1') returning id")).rows;
const u = (await pool.query("select name, email, email_verified from public.users where id=$1", [legacy])).rows[0];
assert.deepEqual(u, { name: "Thrall#1", email: "bnet-123@users.everloot.invalid", email_verified: false });
// Re-applying the migration copies the Battle.net id into auth_account exactly once.
await pool.query(accountsSql); await pool.query(accountsSql);
const acc = (await pool.query("select user_id, account_id, provider_id, access_token from public.auth_account")).rows;
assert.deepEqual(acc, [{ user_id: legacy, account_id: "123", provider_id: "battlenet", access_token: null }]);
// A Better Auth-style insert (no bnet_id) is accepted and left alone by the trigger.
await pool.query("insert into public.users (id, name, email) values (gen_random_uuid(), 'A', 'a@example.com')");
// Browser roles can't read any auth table.
for (const role of ["anon", "authenticated"]) for (const t of ["users", "auth_session", "auth_account", "auth_verification", "auth_rate_limit"])
  await assert.rejects(asRole(role, `select * from public.${t}`), /permission denied/);
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd web && QUOTA_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/intake_quota_test node scripts/accounts.integration.mjs`
Expected: FAIL (`column "name" … does not exist` or missing `auth_account`).

- [ ] **Step 3: `git mv` the schema, update the three references, write `20261020120000_accounts.sql`.** Order inside the file: add columns (`if not exists`), backfill `name`/`email` for rows with `bnet_id`, then `set not null` and the unique constraint (guarded with a `do $$ … if not exists` on `pg_constraint`), the trigger function (`set search_path = ''`, execute revoked from `public, anon, authenticated`), the four tables (`if not exists`), RLS + revoke/grant, then `insert into public.auth_account (id, user_id, account_id, provider_id) select gen_random_uuid(), id, bnet_id, 'battlenet' from public.users where bnet_id is not null on conflict (provider_id, account_id) do nothing`.

- [ ] **Step 4: Run the new script and the data-guard script; both pass**

Run: the Step 2 command, then `node scripts/data-guard.integration.mjs` with the same env.
Expected: both exit 0 with no assertion output.

- [ ] **Step 5: Commit** — `feat(db): accounts tables for Better Auth, and the auth schema becomes a migration` (DCO `-s`).

---

### Task 2: Battle.net mapping

**Files:**
- Create: `web/src/lib/auth/battlenet.ts`
- Test: `web/src/lib/auth/battlenet.test.ts`

**Interfaces:**
- Produces:
  - `placeholderEmail(accountId: string): string`
  - `isPlaceholderEmail(email: string): boolean` — true for any address ending `@users.everloot.invalid`, case-insensitive
  - `battlenetUser(profile: { sub?: string; id?: number; battletag?: string }): { id: string; name: string; email: string; emailVerified: false } | null` — `null` unless the id is all digits and a BattleTag is present (same check as today's callback: `sub`, else a safe-integer `id`)
  - `battlenetProvider(env: { BNET_CLIENT_ID?: string; BNET_CLIENT_SECRET?: string }): GenericOAuthConfig` with `providerId: "battlenet"`, `discoveryUrl: "https://oauth.battle.net/.well-known/openid-configuration"`, `scopes: ["openid", "wow.profile"]`, `pkce: true`, and `getUserInfo` that GETs the discovered userinfo endpoint (`https://oauth.battle.net/userinfo`) with the access token and returns `battlenetUser(json)`

- [ ] **Step 1: Write the failing tests**

```ts
test("placeholder emails are reserved-domain and recognised in any case", () => {
  expect(placeholderEmail("123")).toBe("bnet-123@users.everloot.invalid");
  expect(isPlaceholderEmail("BNET-123@Users.Everloot.Invalid")).toBe(true);
  expect(isPlaceholderEmail("someone@everloot.app")).toBe(false);
});
test("a Battle.net profile maps to a user with the BattleTag as name and an unverified placeholder", () => {
  expect(battlenetUser({ sub: "123", battletag: "Thrall#1" }))
    .toEqual({ id: "123", name: "Thrall#1", email: "bnet-123@users.everloot.invalid", emailVerified: false });
  expect(battlenetUser({ id: 456, battletag: "Jaina#2" })?.id).toBe("456");
});
test("a profile without a numeric id or a BattleTag is refused", () => {
  expect(battlenetUser({ sub: "abc", battletag: "X#1" })).toBeNull();
  expect(battlenetUser({ sub: "123" })).toBeNull();
});
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/lib/auth/battlenet.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four exports. `npm install --save-exact better-auth@1.7.10` in `web/` (check the lockfile diff has no ERESOLVE overrides) and move `pg` from `devDependencies` to `dependencies` at the same version; import the config type from `better-auth/plugins`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(web): Battle.net profile mapping for Better Auth`.

---

### Task 3: The auth instance

**Files:**
- Create: `web/src/lib/auth/db.ts`, `web/src/lib/auth/auth.ts`
- Test: `web/src/lib/auth/auth.test.ts`

**Interfaces:**
- Consumes: `battlenetProvider`, `placeholderEmail` (Task 2); tables from Task 1.
- Produces:
  - `authV2Enabled(env = process.env): boolean` — `env.EVERLOOT_AUTH_V2 === "1"`
  - `authPool(): Pool` — one Pool per process from `AUTH_DATABASE_URL`, `max: 3`, `ssl: { ca: <supabase/certs/prod-ca-2021.crt contents> }` unless the host is `localhost`/`127.0.0.1`; throws `"Authentication storage is not configured"` when the URL is empty
  - `RateLimitStore = { get(key: string): Promise<{ key: string; count: number; lastRequest: number } | null>; set(key: string, value: { key: string; count: number; lastRequest: number }): Promise<void> }`
  - `pgRateLimitStore(pool: Pool): RateLimitStore` — select / upsert on `auth_rate_limit` (`on conflict (key) do update`)
  - `createAuth(options: { database: Pool | Adapter; rateLimitStore: RateLimitStore; env?: NodeJS.ProcessEnv; onBattlenetAccount?: (userId: string, accountId: string, name: string) => Promise<void> })` — returns the `betterAuth(...)` instance
  - `getAuth()` — lazy singleton: `createAuth({ database: authPool(), rateLimitStore: pgRateLimitStore(authPool()), onBattlenetAccount: <update users set bnet_id, battletag via the pool> })`

Config `createAuth` must set (values are the decisions; the shape is Better Auth's):
- `secret: env.BETTER_AUTH_SECRET`, `baseURL: env.BETTER_AUTH_URL ?? siteUrl()`, `basePath: "/api/auth"`, `trustedOrigins: [siteUrl()]`
- `user: { modelName: "users", fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" } }`
- `session: { modelName: "auth_session", expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, fields: { userId: "user_id", expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", createdAt: "created_at", updatedAt: "updated_at" } }`
- `account: { modelName: "auth_account", fields: { … snake_case for every camelCase column in Task 1 … }, accountLinking: { enabled: true, trustedProviders: ["battlenet"] } }` — trusting `battlenet` only ever matches its own placeholder (Review Focus 2)
- `verification: { modelName: "auth_verification", fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" } }`
- `advanced: { cookiePrefix: "everloot", useSecureCookies: env.NODE_ENV === "production", database: { generateId: "uuid" } }`
- `rateLimit: { enabled: true, customStorage }` where `customStorage.get/set` call `options.rateLimitStore` with the key replaced by its SHA-256 hex (the value's `key` field too)
- `databaseHooks`: `account.create.before` and `account.update.before` return the data with `accessToken`, `refreshToken`, `idToken` set to `null`; `account.create.after` calls `onBattlenetAccount(userId, accountId, name)` when `providerId === "battlenet"`; `session.create.before` sets `ipAddress` and `userAgent` to `null`
- `plugins: [genericOAuth({ config: [battlenetProvider(env)] })]`

- [ ] **Step 1: Write the failing tests** with `createAuth({ database: memoryAdapter({ users: [], auth_session: [], auth_account: [], auth_verification: [] }), rateLimitStore: <Map-backed store>, env, onBattlenetAccount })` and a stubbed `fetch` serving the Battle.net discovery document, `/token` (returns only an `access_token`, no `id_token`, so no JWKS is needed; the plugin verifies an id token only when one is returned) and `/userinfo` (`{ sub: "123", id: 123, battletag: "Thrall#1" }`). Drive `auth.handler` through `POST /api/auth/sign-in/oauth2` → the returned URL's `state` → `GET /api/auth/oauth2/callback/battlenet?code=c&state=…` with the state cookie.

```ts
test("a Battle.net sign-in creates a session cookie and stores no provider tokens", async () => {
  const { cookies, db } = await signInWithBattlenet();
  expect(cookies).toMatch(/everloot\.session_token=/);
  expect(db.auth_account[0]).toMatchObject({ providerId: "battlenet", accountId: "123", accessToken: null, refreshToken: null, idToken: null });
  expect(db.auth_session[0]).toMatchObject({ ipAddress: null, userAgent: null });
});
test("a new Battle.net account fills bnet_id and battletag", async () => {
  const seen: unknown[] = [];
  await signInWithBattlenet({ onBattlenetAccount: async (...args) => { seen.push(args); } });
  expect(seen).toEqual([[expect.any(String), "123", "Thrall#1"]]);
});
test("rate-limit keys never contain the address", async () => {
  // ten sign-in starts with x-forwarded-for: 203.0.113.9, then inspect the Map-backed store
  expect(store.size).toBeGreaterThan(0);
  expect(JSON.stringify([...store])).not.toContain("203.0.113.9");
});
test("authV2Enabled is only on for exactly 1", () => {
  expect(authV2Enabled({ EVERLOOT_AUTH_V2: "1" })).toBe(true);
  expect(authV2Enabled({ EVERLOOT_AUTH_V2: "true" })).toBe(false);
  expect(authV2Enabled({})).toBe(false);
});
```

- [ ] **Step 2: Run** `cd web && npx vitest run src/lib/auth/auth.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `db.ts` and `auth.ts` with the config above. Field names: check each against the 1.7.10 schema (`npx @better-auth/cli generate --config src/lib/auth/auth.ts` prints it; don't commit its output).
- [ ] **Step 4: Run** the same command — Expected: PASS. Also `npx vitest run` for the whole web suite — Expected: PASS, no change elsewhere.
- [ ] **Step 5: Commit** — `feat(web): Better Auth instance for Battle.net, tokens and addresses never stored`.

---

### Task 4: Legacy accounts keep their id

**Files:**
- Test: `web/src/lib/auth/auth.test.ts` (add)

**Interfaces:**
- Consumes: the `signInWithBattlenet` helper and seeded memory tables from Task 3.

- [ ] **Step 1: Write the test** — seed `users` with `{ id: LEGACY_ID, name: "Thrall#1", email: "bnet-123@users.everloot.invalid", emailVerified: false }` and `auth_account` with `{ userId: LEGACY_ID, providerId: "battlenet", accountId: "123" }` (what the Task 1 migration produces), sign in, and assert `db.auth_session[0].userId === LEGACY_ID` and `db.users.length === 1`. Second case: seed only the `users` row (a v1 sign-in after the migration, no account row yet) and assert the same, which proves `trustedProviders: ["battlenet"]` links by placeholder.
- [ ] **Step 2: Run** `npx vitest run src/lib/auth/auth.test.ts -t "legacy"` — Expected: PASS if Task 3 is right; if the second case FAILS, fix the linking config in `auth.ts`, not the test.
- [ ] **Step 3: Commit** — `test(web): existing Battle.net accounts keep their id under Better Auth`.

---

### Task 5: Wire the flag through the existing routes

**Files:**
- Create: `web/src/app/api/auth/[...all]/route.ts`
- Modify: `web/src/lib/supabase/server.ts` (`AccountUser`, `getUser`, `revokeSession`), `web/src/app/api/auth/bnet/route.ts`, `web/src/app/api/auth/logout/route.ts`
- Test: `web/src/app/api/auth/auth.test.ts` (existing tests stay; add v2 cases), `web/src/app/api/auth/auth-v2.test.ts`

**Interfaces:**
- Consumes: `authV2Enabled`, `getAuth` (Task 3).
- Produces: `AccountUser = { id: string; name: string }` for both paths (v1 maps `battletag` → `name`); `/api/auth/me` returns `{ user: { id, name, entitlements } }`. No caller reads more than `id` today (`keys/route.ts`, `me/route.ts`).

Behaviour under `EVERLOOT_AUTH_V2=1`:
- `[...all]`: `toNextJsHandler(getAuth())` for GET and POST; with the flag off both return 404.
- `getUser()`: `getAuth().api.getSession({ headers: await headers() })` → `{ id: session.user.id, name: session.user.name }` or `null`; errors propagate (so `me` answers 503).
- `GET /api/auth/bnet`: `getAuth().api.signInWithOAuth2({ body: { providerId: "battlenet", callbackURL: "/" }, headers, asResponse: true })`, then redirect to the returned `url` carrying every `set-cookie` from that response. Keeps the 503 when `BNET_CLIENT_ID`/`SECRET` are missing.
- `POST /api/auth/logout`: same origin check, then `getAuth().api.signOut({ headers, asResponse: true })`; forward its `set-cookie`; body `{ ok: true }`.

- [ ] **Step 1: Write the failing tests** in `auth-v2.test.ts`, mocking `@/lib/auth/auth` (`authV2Enabled: () => true`, `getAuth: () => fake`):

```ts
test("v2 me returns id and name from the Better Auth session", async () => {
  fake.api.getSession.mockResolvedValue({ user: { id: USER_ID, name: "Thrall#1", email: "bnet-1@users.everloot.invalid" } });
  // entitlements fetch stubbed to []
  expect(await (await GET()).json()).toEqual({ user: { id: USER_ID, name: "Thrall#1", entitlements: [] } });
});
test("v2 fails closed when the database is down", async () => {
  fake.api.getSession.mockRejectedValue(new Error("ECONNREFUSED"));
  expect((await GET()).status).toBe(503);
});
test("v2 bnet start redirects to Battle.net and keeps Better Auth's state cookie", async () => {
  fake.api.signInWithOAuth2.mockResolvedValue(new Response(JSON.stringify({ url: "https://oauth.battle.net/authorize?x=1", redirect: true }),
    { headers: { "set-cookie": "everloot.state=s; Path=/; HttpOnly" } }));
  const res = await bnetGET(new Request("https://everloot.app/api/auth/bnet"));
  expect(res.headers.get("location")).toBe("https://oauth.battle.net/authorize?x=1");
  expect(res.headers.get("set-cookie")).toContain("everloot.state=s");
});
test("v2 logout signs out through Better Auth and refuses other origins", async () => { /* 403 for https://evil.example; ok:true + forwarded set-cookie otherwise */ });
test("with the flag off the catch-all route is 404", async () => { /* authV2Enabled: () => false */ });
```

  In `auth.test.ts`, change the first test's expectation to `{ user: { id: user.id, name: user.battletag, entitlements: […] } }` (the only v1 change).
- [ ] **Step 2: Run** `npx vitest run src/app/api/auth` — Expected: the new tests FAIL, the edited v1 test FAILS.
- [ ] **Step 3: Implement** the four changes. `getUser` reads `headers()` from `next/headers` only on the v2 path.
- [ ] **Step 4: Run** `npx vitest run` (whole web suite) — Expected: PASS, including `keys/route.test.ts`, `account-controls.test.tsx`, `api-keys.test.tsx` unchanged.
- [ ] **Step 5: Commit** — `feat(web): Battle.net sign-in through Better Auth when EVERLOOT_AUTH_V2 is on`.

---

### Task 6: Privacy copy, env example, docs

**Files:**
- Modify: `web/src/app/privacy/page.tsx:51-57` (the "Battle.net sign-in" paragraph), `web/.env.example`, `supabase/README.md` (tables list), `CHANGELOG.md`
- Test: `web/src/app/legal-pages.test.tsx` if it exists on main when you start, else add `web/src/app/privacy/privacy.test.tsx`

- [ ] **Step 1: Write the failing test**: the rendered privacy page contains `"Battle.net Account ID"`, `"BattleTag"`, `"We don't keep your Battle.net access token"` and `"no IP address"`.
- [ ] **Step 2: Run** it — Expected: FAIL on the new sentences.
- [ ] **Step 3: Rewrite the paragraph** to say, in the page's voice: we store your Battle.net Account ID and BattleTag; we don't keep your Battle.net access token after sign-in; a sign-in session is a random token in an essential cookie, kept 30 days and renewed while you use the site, stored with no IP address or browser details; signing out ends it. Add the four env vars to `.env.example` with one comment line each (`AUTH_DATABASE_URL`: the Supabase transaction-pooler URI, port 6543, for the `everloot_auth` role). README table gains the `auth_*` tables.
- [ ] **Step 4: Run** `npx vitest run` and `python scripts/check_md_links.py` — Expected: PASS.
- [ ] **Step 5: Commit** — `docs(web): privacy and setup notes for Better Auth sign-in`.

---

## After merge (owner and agent, in order; not code)

1. **Apply** `20261003000000_auth_schema.sql` (no-op on production, everything exists) and `20261020120000_accounts.sql`. The data-guard migration is still unapplied on production; this one doesn't depend on it. The accounts migration creates the `everloot_auth` role without a login, grants it `select, insert, update, delete` on `users` and the four `auth_*` tables, and gives it an RLS policy on each.
2. **Database role login** (SQL editor, agent in Carlos's browser): `alter role everloot_auth login password '<generated>'`. The password goes straight into Vercel, never into chat or git.
3. **Battle.net developer portal**: add `https://everloot.app/api/auth/callback/battlenet` (keep the old callback until cutover is done).
4. **Vercel production env**: `BETTER_AUTH_SECRET` (`openssl rand -hex 32`), `BETTER_AUTH_URL=https://everloot.app`, `AUTH_DATABASE_URL` (pooler URI as `everloot_auth.<project-ref>`). Leave `EVERLOOT_AUTH_V2` unset; deploy; check nothing changed.
5. **Cutover**: set `EVERLOOT_AUTH_V2=1`, redeploy, sign in with Battle.net on everloot.app, make and revoke an API key, sign out. Rollback = unset the flag and redeploy (Review Focus 3).
6. **A week later**, a follow-up PR removes the v1 path and drops `public.sessions` (spec §2).

## Next plans

- **Step 2**: GitHub, Google, Microsoft (`socialProviders`, `common` tenant), `/account` (linked logins, sign out everywhere, API keys moved from `/connect`, delete account). Needs the three OAuth apps from spec §10. Implicit linking only between provider-verified emails; Battle.net stays manual.
- **Step 3**: email and password (10+ chars, `haveIBeenPwned`), `emailOTP` + `magicLink` in one email, SES sender. Must refuse any address where `isPlaceholderEmail()` is true, on sign-up and on email change. Needs SES out of the sandbox.
