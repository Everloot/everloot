import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Profiles on the schema production runs: Battle.net users without the accounts v2 columns, then the exact
// preflight, apply, postflight and rollback in docs/2026-10-27-profiles-activation.md, once with Supabase's old
// default grants and once with none (its default from 2026-10-30). Disposable local Postgres only: this fixture
// drops the public schema.
// docker run -d --name profiles-legacy-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54405:5432 postgres:17
// docker exec profiles-legacy-test createdb -U postgres account_profiles_legacy_test
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54405/account_profiles_legacy_test node scripts/account-profiles-legacy.integration.mjs
const DATABASE = "account_profiles_legacy_test";
const url = new URL(process.env.QUOTA_TEST_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Local test database required");
assert.equal(url.pathname, `/${DATABASE}`, "Dedicated test database required");
// Options in the query (host=, dbname=) could send the pool elsewhere: none are taken, and no connection string.
assert.equal(url.search + url.hash, "", "No connection options");
const pool = new pg.Pool({
  host: url.hostname, port: Number(url.port || 5432), database: DATABASE, max: 8,
  user: decodeURIComponent(url.username) || "postgres", password: decodeURIComponent(url.password) || undefined,
});

const migrations = new URL("../../supabase/migrations/", import.meta.url);
const read = (file) => readFile(new URL(file, migrations), "utf8");
// What production has applied, in its order: the legacy base and players, the #450 saved-builds file once and the
// Chat workspace (10/25), realm keys and guilds (10/26). Never accounts v2, never the saved-builds file from before
// #450, none of the later files production does not have.
const CHAIN = [
  "20261003000000_auth_schema.sql", "20261004000000_uploads_waitlist.sql", "20261007070647_verified_publication.sql",
  "20261007220000_intake_quotas.sql", "20261010120000_mcp_quota_scope.sql", "20261018120000_usage_counters.sql",
  "20261019120000_data_guard.sql", "20261021130000_players.sql", "20261021150000_saved_builds.sql",
  "20261025191223_chat_workspace.sql", "20261022160000_players_realm_key.sql", "20261025120000_guilds.sql",
];
const migration = await read("20261021170000_account_profiles.sql");
const FUNCTIONS = ["take_handle_change", "save_profile", "set_status", "set_main_character", "set_active_character", "public_profile"];

// The runbook's SQL, run as written.
const doc = (await readFile(new URL("../../docs/2026-10-27-profiles-activation.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const block = (name) => {
  const found = doc.match(new RegExp("```sql\\n(-- " + name + "\\n[\\s\\S]*?)```"));
  assert.ok(found, `No ${name} block in the runbook`);
  return found[1];
};
const PASTE = /^-- paste supabase\/migrations\/20261021170000_account_profiles\.sql here, unchanged$/m;
assert.match(block("apply"), PASTE);
// A function, not a string: the file's $$ would read as a replacement pattern.
const APPLY = block("apply").replace(PASTE, () => migration);
const [PREFLIGHT, POSTFLIGHT, ROLLBACK] = ["preflight", "postflight", "rollback"].map(block);

/** The names of the rows that are not `t`. */
const failing = async (sql, db = pool) => (await db.query(sql)).rows.filter((r) => r.ok !== true).map((r) => r.check_name);

/** A runbook script on one connection, as the SQL editor runs it; a failure leaves no transaction open. */
async function run(sql) {
  const client = await pool.connect();
  try { await client.query(sql); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Runs fn in a transaction that is always rolled back. */
async function rolledBack(fn) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); return await fn(client); }
  finally { await client.query("ROLLBACK"); client.release(); }
}

async function asRole(role, query, params = []) {
  assert.ok(["service_role", "anon", "authenticated"].includes(role));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await client.query(query, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
const service = (query, params) => asRole("service_role", query, params);

// The calls the site makes through PostgREST (web/src/lib/account-shell.ts): named arguments, the same columns.
const saveProfile = async (user, f = {}) => (await service(
  "select * from public.save_profile(p_user_id => $1, p_handle => $2, p_display_name => $3, p_public => $4, "
    + "p_show_characters => $5, p_show_builds => $6, p_show_status => $7)",
  [user, f.handle ?? null, f.displayName ?? null, f.public ?? false, f.showCharacters ?? true, f.showBuilds ?? true, f.showStatus ?? true],
))[0].refusal;
const setStatus = (user, emoji, text, clearsAt = null) => service(
  "select public.set_status(p_user_id => $1, p_emoji => $2, p_text => $3, p_clears_at => $4) as ok", [user, emoji, text, clearsAt]);
const setMain = async (user, id) => (await service("select public.set_main_character(p_user_id => $1, p_id => $2) as ok", [user, id]))[0].ok;
const setActive = async (user, id) => (await service("select public.set_active_character(p_user_id => $1, p_id => $2) as ok", [user, id]))[0].ok;
const publicRead = async (handle) => (await service("select * from public.public_profile(p_handle => $1)", [handle]))[0] ?? null;
const readProfile = async (user) => (await service(
  "select handle,display_name,status_emoji,status_text,status_clears_at,public_profile,show_characters,show_builds,show_status,"
    + "main_character_id,active_character_id from public.user_profiles where user_id = $1 limit 1", [user]))[0] ?? null;
// Saved builds' own functions make the characters and builds: with EVERLOOT_SAVED_BUILDS off the site cannot.
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const character = async (user, name, classSlug = "mage") => (await service(
  "select * from public.save_build_character($1,null,$2,$3,'Pioneer','private note')", [user, name, classSlug],
))[0].character_ref;
let slugs = 0;
const build = async (user, name, shared, showName = false) => (await service(
  "select * from public.save_build($1,null,$2,null,$3,null,$4,null,$5,false,$6)",
  [user, `L${String(++slugs).padStart(7, "0")}`, name, MAGE, shared, showName],
))[0];

/** Everything in public that is not the migration's: function bodies, settings and grants; tables; policies. */
const others = async () => (await pool.query(`
  select format('function %s %s %s %s %s', p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.proconfig, p.proacl) as item
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname::text <> all ($1::text[])
  union all
  select format('table %s %s %s %s', c.oid::regclass, c.relrowsecurity, c.relacl,
      (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and c.relname <> 'user_profiles'
  union all
  select format('policy %s %s', tablename, policyname) from pg_policies where schemaname = 'public'
  order by 1`, [FUNCTIONS])).rows.map((r) => r.item);

const ROLES = ["anon", "authenticated", "service_role"];
async function legacySchema(defaults) {
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
  for (const role of ROLES) {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
  }
  await pool.query("alter role service_role bypassrls");
  await pool.query("grant usage on schema public to anon, authenticated, service_role");
  // Production's tables were made under Supabase's old defaults, which grant every new table and function to the
  // API roles; each migration revokes what it must.
  await pool.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
  await pool.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
  for (const file of CHAIN) await pool.query(await read(file));
  if (defaults === "none") {
    // From 2026-10-30 Supabase grants new tables nothing by default; tables made before keep their grants.
    for (const kind of ["tables", "sequences", "functions"]) {
      await pool.query(`alter default privileges in schema public revoke all on ${kind} from anon, authenticated, service_role`);
    }
  }
  const columns = (await pool.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'users' order by 1",
  )).rows.map((r) => r.column_name);
  assert.deepEqual(columns, ["battletag", "bnet_id", "created_at", "id", "updated_at"], "the legacy users table");
}

async function preflightCatchesEachCondition() {
  const only = async (setup) => rolledBack(async (db) => { await db.query(setup); return failing(PREFLIGHT, db); });
  assert.deepEqual(await only("alter table public.users add column name text, add column email text"),
    ["users is the Battle.net table, without accounts v2 columns"]);
  assert.deepEqual(await only("alter table public.build_characters rename column note to label"),
    ["build_characters and saved_builds have the 13 columns profiles read"]);
  // The saved-builds function from before #450, which fell back to the BattleTag.
  const current = (await pool.query("select pg_get_functiondef('public.shared_build(text)'::regprocedure) as def")).rows[0].def;
  const old = current.replace("to_jsonb(u) ->> 'bnet_id' is null then to_jsonb(u) ->> 'name'",
    "true then coalesce(to_jsonb(u) ->> 'name', to_jsonb(u) ->> 'battletag')");
  assert.notEqual(old, current);
  assert.deepEqual(await only(old), ["shared_build is the #450 version, with no Battle.net owner name"]);
  assert.deepEqual(await only("insert into public.intake_quota_buckets values ('handle:00000000-0000-4000-8000-000000000000', 1, now())"),
    ["no handle counters from an earlier attempt"]);
  assert.deepEqual(await only("create table public.user_profiles (user_id uuid)"), ["user_profiles does not exist yet"]);
  assert.deepEqual(await only("revoke select on public.sessions from service_role"), ["service_role reads users, sessions and build_characters"]);

  // Another function by one of the names: the migration applies beside it and PostgREST sees two.
  const collision = "create function public.set_status(p_text text) returns void language sql as ''";
  assert.deepEqual(await only(collision), ["no function has any of the six names"]);
  assert.deepEqual(await rolledBack(async (db) => { await db.query(collision); await db.query(migration); return failing(POSTFLIGHT, db); }), [
    "the six functions, one signature each", "each runs as its owner with an empty search_path", "only service_role may call the five site functions",
  ]);

  // Quota columns out of order: the migration applies, and the first handle change then fails.
  const reordered = "alter table public.intake_quota_buckets rename to intake_quota_buckets_kept; "
    + "create table public.intake_quota_buckets (bucket text primary key, reset_at timestamptz not null, count integer not null)";
  assert.deepEqual(await only(reordered), ["intake_quota_buckets is bucket, count, reset_at in that order, keyed by bucket"]);
  await rolledBack(async (db) => {
    await db.query(reordered);
    await db.query(migration);
    const [{ id }] = (await db.query("insert into public.users (bnet_id, battletag) values ('bnet-reorder', 'Order#1') returning id")).rows;
    await assert.rejects(db.query("select * from public.save_profile($1,'order-1',null,false,true,true,true)", [id]), /reset_at/);
  });
}

async function heldLockChangesNothing() {
  // A sign-in in progress holds a row-exclusive lock on users until it commits; the new foreign key needs to wait
  // for it. The apply gives up after its lock timeout and leaves nothing behind.
  const signIn = await pool.connect();
  try {
    await signIn.query("BEGIN");
    await signIn.query("update public.users set updated_at = updated_at where false");
    const started = Date.now();
    await assert.rejects(run(APPLY), (error) => error.code === "55P03");
    assert.ok(Date.now() - started < 20_000, "the wait is bounded");
  } finally {
    await signIn.query("ROLLBACK");
    signIn.release();
  }
  assert.deepEqual(await failing(PREFLIGHT), [], "a failed apply changes nothing");
}

async function browserRolesAndDirectWritesAreRefused(user) {
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(asRole(role, "select * from public.user_profiles"), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.public_profile('thrall')"), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.save_profile($1,'x1x',null,false,true,true,true)", [user]), /permission denied/);
    await assert.rejects(asRole(role, "select public.set_status($1,null,'hi',null)", [user]), /permission denied/);
    await assert.rejects(asRole(role, "select public.set_main_character($1,null)", [user]), /permission denied/);
    await assert.rejects(asRole(role, "select public.set_active_character($1,null)", [user]), /permission denied/);
  }
  await assert.rejects(service("insert into public.user_profiles (user_id) values ($1)", [user]), /permission denied/);
  await assert.rejects(service("update public.user_profiles set public_profile = true"), /permission denied/);
  await assert.rejects(service("delete from public.user_profiles"), /permission denied/);
  await assert.rejects(service("select public.take_handle_change($1)", [user]), /permission denied/);
}

async function legacyAccounts() {
  const [{ id: owner }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('bnet-87017', 'Thrall#1234') returning id")).rows;
  const [{ id: other }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('bnet-87018', 'Jaina#2002') returning id")).rows;
  // The legacy schema's old profiles table holds the BattleTag too; nothing here reads it.
  await pool.query("insert into public.profiles (id, bnet_id, battletag) values ($1, 'bnet-87017', 'Thrall#1234')", [owner]);
  await browserRolesAndDirectWritesAreRefused(owner);

  // A legacy session resolves the way the site's getUser reads it.
  const tokenHash = "ab".repeat(32);
  await pool.query("insert into public.sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [owner, tokenHash]);
  const [session] = await service("select user_id from public.sessions where token_hash = $1 and expires_at > now() limit 1", [tokenHash]);
  const [account] = await service("select id, bnet_id, battletag from public.users where id = $1 limit 1", [session.user_id]);
  assert.equal(account.id, owner);

  // Profile, status, main and active character, through the site's calls.
  assert.equal(await saveProfile(owner, { handle: "  Thrall-1 ", displayName: "  Go'el " }), null);
  await setStatus(owner, "🔥", "Farming Molten Core", new Date(Date.now() + 30 * 60_000).toISOString());
  await assert.rejects(setStatus(owner, null, "x".repeat(81)), /Invalid status/);
  const jaina = await character(owner, "Jaina");
  const thrall = await character(owner, "Thrall", "warrior");
  const theirs = await character(other, "Sylvanas", "hunter");
  assert.equal(await setMain(owner, theirs), false);
  assert.equal(await setActive(owner, theirs), false);
  assert.equal(await setMain(owner, jaina), true);
  assert.equal(await setActive(owner, thrall), true);
  let row = await readProfile(owner);
  assert.deepEqual(
    [row.handle, row.display_name, row.status_emoji, row.status_text, row.public_profile, row.main_character_id, row.active_character_id],
    ["thrall-1", "Go'el", "🔥", "Farming Molten Core", false, jaina, thrall],
  );
  assert.equal((await service("select id,name,class_slug,realm,note from public.build_characters where user_id = $1", [owner])).length, 2);
  assert.equal(await saveProfile(other, { handle: "THRALL-1" }), "handle_taken");
  assert.equal(await saveProfile(other, { handle: "Settings" }), "handle_reserved");
  assert.equal(await saveProfile(other, { public: true }), "needs_handle");

  // Private, unknown or malformed: no row, the same for each.
  for (const handle of ["thrall-1", "THRALL-1", "nobody", "th%", "ab"]) assert.equal(await publicRead(handle), null, handle);

  // Public: only the ticked parts. Never the BattleTag, the Battle.net id, an id, a note or a build not shared.
  await build(owner, "Fire", true);
  await build(owner, "Secret frost", false);
  await build(owner, "Chat build", false); // Chat's builds are private
  const only = async (part) => {
    assert.equal(await saveProfile(owner, { handle: "thrall-1", displayName: "Go'el", public: true,
      showCharacters: part === "characters", showBuilds: part === "builds", showStatus: part === "status" }), null);
    const open = await publicRead("Thrall-1");
    assert.deepEqual([open.handle, open.display_name], ["thrall-1", "Go'el"]);
    return [open.characters, open.builds, open.status_emoji, open.status_text];
  };
  assert.deepEqual(await only("characters"), [[
    { name: "Jaina", class_slug: "mage", realm: "Pioneer", main: true },
    { name: "Thrall", class_slug: "warrior", realm: "Pioneer", main: false },
  ], null, null, null]);
  const [, builds] = await only("builds");
  assert.deepEqual(builds.map((b) => b.name), ["Fire"]);
  assert.deepEqual(await only("status"), [null, null, "🔥", "Farming Molten Core"]);
  assert.deepEqual(await only("none"), [null, null, null, null]);
  assert.equal(await saveProfile(owner, { handle: "thrall-1", displayName: "Go'el", public: true }), null);
  const open = await publicRead("thrall-1");
  assert.deepEqual(Object.keys(open).sort(), ["builds", "characters", "display_name", "handle", "status_emoji", "status_text"]);
  for (const c of open.characters) assert.deepEqual(Object.keys(c).sort(), ["class_slug", "main", "name", "realm"]);
  for (const b of open.builds) assert.deepEqual(Object.keys(b).sort(), ["class_slug", "name", "slug", "updated_at"]);
  const text = JSON.stringify(open);
  for (const hidden of ["Thrall#1234", "bnet-87017", owner, jaina, thrall, "private note", "Secret frost", "Chat build"]) {
    assert.ok(!text.includes(hidden), hidden);
  }
  // Shared builds keep the Battle.net owner's name off with profiles applied, even with show_name on.
  const shown = await build(owner, "Shown", true, true);
  assert.equal((await service("select * from public.shared_build($1)", [shown.build_slug]))[0].owner_name, null);
  // A status past its clear-after reads as none; private again is a 404 again.
  await pool.query("update public.user_profiles set status_clears_at = now() - interval '1 second' where user_id = $1", [owner]);
  assert.equal((await publicRead("thrall-1")).status_text, null);
  assert.equal(await saveProfile(owner, { handle: "thrall-1", public: false }), null);
  assert.equal(await publicRead("thrall-1"), null);

  // Five handle changes a day, counted by position in the legacy quota table; the sixth is refused.
  for (const handle of ["t-2", "t-3", "t-4", "t-5"]) assert.equal(await saveProfile(owner, { handle }), null);
  assert.equal(await saveProfile(owner, { handle: "t-6" }), "handle_limit");
  assert.equal((await readProfile(owner)).handle, "t-5");
  const [bucket] = (await pool.query(
    "select count, reset_at > now() and reset_at <= now() + interval '1 day' as today from public.intake_quota_buckets where bucket = $1",
    [`handle:${owner}`])).rows;
  assert.deepEqual([bucket.count, bucket.today], [5, true]);
  // Two legacy accounts racing for one handle: one gets it.
  const [{ id: third }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('bnet-87019', 'Rexxar#3003') returning id")).rows;
  const race = await Promise.all([saveProfile(other, { handle: "rexxar" }), saveProfile(third, { handle: "rexxar" })]);
  assert.deepEqual(race.map(String).sort(), ["handle_taken", "null"]);

  // Deleting a character clears it as main or active; deleting the account deletes its profile.
  await service("select public.delete_build_character($1,$2)", [owner, thrall]);
  row = await readProfile(owner);
  assert.deepEqual([row.main_character_id, row.active_character_id], [jaina, null]);
  await pool.query("delete from public.users where id = $1", [third]);
  assert.equal(await readProfile(third), null);
  return owner;
}

try {
  const [{ database }] = (await pool.query("select current_database() as database")).rows;
  assert.equal(database, DATABASE, "Connected to the dedicated test database");
  for (const defaults of ["supabase", "none"]) {
    await legacySchema(defaults);
    const before = await others();
    assert.deepEqual(await failing(PREFLIGHT), []);
    if (defaults === "supabase") {
      await preflightCatchesEachCondition();
      await heldLockChangesNothing();
    }
    assert.deepEqual(await others(), before);

    await run(APPLY);
    assert.deepEqual(await failing(POSTFLIGHT), []);
    assert.deepEqual(await others(), before, "the migration alters nothing it does not own");
    const owner = await legacyAccounts();
    // Applied a second time, it keeps every profile.
    await run(APPLY);
    assert.deepEqual(await failing(POSTFLIGHT), []);
    assert.equal((await readProfile(owner)).handle, "t-5");

    await run(ROLLBACK);
    assert.deepEqual(await failing(PREFLIGHT), [], "the rollback returns to the schema before the apply");
    assert.deepEqual(await others(), before);
    // Characters, builds and their counters belong to saved builds and stay.
    assert.equal((await pool.query("select count(*)::int as n from public.build_characters where user_id = $1", [owner])).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int as n from public.intake_quota_buckets where bucket = $1", [`builds:${owner}`])).rows[0].n, 1);
    console.log(`account profiles legacy integration (${defaults === "none" ? "no default grants" : "Supabase default grants"}): ok`);
  }
} finally {
  await pool.end();
}
