import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Saved builds on the schema production runs: Battle.net users without the accounts v2 columns, the #450 saved-builds
// file applied once, the Chat workspace, realm keys, guilds and profiles. Turning EVERLOOT_SAVED_BUILDS on runs no
// migration, so this runs the read-only checks in docs/2026-10-27-saved-builds-activation.md as written, shows each one
// catching what it names, and then does what the switch lets the site do, through the site's own calls. Disposable
// local Postgres only: this fixture drops the public schema.
// docker run -d --name saved-builds-legacy-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54406:5432 postgres:17
// docker exec saved-builds-legacy-test createdb -U postgres saved_builds_legacy_test
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54406/saved_builds_legacy_test node scripts/saved-builds-legacy.integration.mjs
const DATABASE = "saved_builds_legacy_test";
const url = new URL(process.env.QUOTA_TEST_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Local test database required");
assert.equal(url.pathname, `/${DATABASE}`, "Dedicated test database required");
// Options in the query (host=, dbname=) could send the pool elsewhere: none are taken, and no connection string.
assert.equal(url.search + url.hash, "", "No connection options");
const pool = new pg.Pool({
  host: url.hostname, port: Number(url.port || 5432), database: DATABASE, max: 24,
  user: decodeURIComponent(url.username) || "postgres", password: decodeURIComponent(url.password) || undefined,
});

const migrations = new URL("../../supabase/migrations/", import.meta.url);
const read = (file) => readFile(new URL(file, migrations), "utf8");
// What production has applied, in its order: the legacy base and players, the #450 saved-builds file once and the
// Chat workspace (10/25), realm keys and guilds (10/26), profiles (10/27). Never accounts v2, never the saved-builds
// file from before #450, none of the later files production does not have.
const CHAIN = [
  "20261003000000_auth_schema.sql", "20261004000000_uploads_waitlist.sql", "20261007070647_verified_publication.sql",
  "20261007220000_intake_quotas.sql", "20261010120000_mcp_quota_scope.sql", "20261018120000_usage_counters.sql",
  "20261019120000_data_guard.sql", "20261021130000_players.sql", "20261021150000_saved_builds.sql",
  "20261025191223_chat_workspace.sql", "20261022160000_players_realm_key.sql", "20261025120000_guilds.sql",
  "20261021170000_account_profiles.sql",
];
const SAVED_BUILDS = "20261021150000_saved_builds.sql";

// The runbook's SQL, run as written.
const doc = (await readFile(new URL("../../docs/2026-10-27-saved-builds-activation.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const block = (name) => {
  const found = doc.match(new RegExp("```sql\\n(-- " + name + "\\n[\\s\\S]*?)```"));
  assert.ok(found, `No ${name} block in the runbook`);
  return found[1];
};
const [SCHEMA, PRIVATE] = ["schema checks", "private so far"].map(block);
// The columns the site reads (web/src/lib/saved-builds.ts), from its source, so the two cannot drift apart.
const site = await readFile(new URL("../src/lib/saved-builds.ts", import.meta.url), "utf8");
const columns = (name) => site.match(new RegExp(`export const ${name} = "([a-z0-9_,]+)"`))[1];
const [BUILD_COLUMNS, CHARACTER_COLUMNS] = ["BUILD_COLUMNS", "CHARACTER_COLUMNS"].map(columns);

/** The names of the rows that are not `t`. */
const failing = async (sql, db = pool) => (await db.query(sql)).rows.filter((r) => r.ok !== true).map((r) => r.check_name);

/** A runbook check in a read-only transaction: it fails if the check writes anything. */
async function readOnly(sql) {
  const client = await pool.connect();
  try { await client.query("BEGIN READ ONLY"); return await failing(sql, client); }
  finally { await client.query("ROLLBACK"); client.release(); }
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

// The site's calls (web/src/lib/saved-builds-store.ts and api-keys.ts) as PostgREST makes them: named arguments, and
// table reads with the columns above.
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE2 = "EL1-mage-1482-1.60.1.70450-MjE6MQ";
const MAGE_OLD = "EL1-mage-0-1.50.0.1-MTE6NQ";
const WARRIOR = "EL1-warrior-0-1.60.1.70450-MTE6NQ";
let slugs = 0;
const slug = () => `W${String(++slugs).padStart(7, "0")}`;
const saveBuild = async (user, b = {}) => (await service(
  "select * from public.save_build(p_user_id => $1, p_id => $2, p_slug => $3, p_character_id => $4, p_name => $5, "
    + "p_notes => $6, p_code => $7, p_code2 => $8, p_shared => $9, p_active => $10, p_show_name => $11)",
  [user, b.id ?? null, b.id ? null : b.slug ?? slug(), b.characterId ?? null, b.name ?? "Test fire", b.notes ?? null,
    b.code ?? MAGE, b.code2 ?? null, b.shared ?? null, b.active ?? null, b.showName ?? null],
))[0];
const saveLabel = async (user, l = {}) => (await service(
  "select * from public.save_build_character(p_user_id => $1, p_id => $2, p_name => $3, p_class_slug => $4, p_realm => $5, p_note => $6)",
  [user, l.id ?? null, l.name ?? "Test Jaina", l.classSlug ?? "mage", l.realm ?? null, l.note ?? null],
))[0];
const deleteBuild = async (user, id) => (await service("select public.delete_build(p_user_id => $1, p_id => $2) as ok", [user, id]))[0].ok;
const deleteLabel = async (user, id) => (await service("select public.delete_build_character(p_user_id => $1, p_id => $2) as ok", [user, id]))[0].ok;
const sharedBuild = async (s) => (await service("select * from public.shared_build(p_slug => $1)", [s]))[0] ?? null;
/** GET /api/me/builds for a session: the account's labels and its builds, newest first. */
const listOwn = async (user) => ({
  characters: await service(`select ${CHARACTER_COLUMNS} from public.build_characters where user_id = $1`, [user]),
  builds: await service(`select ${BUILD_COLUMNS} from public.saved_builds where user_id = $1 order by updated_at desc, id asc`, [user]),
});
const hash = (token) => createHash("sha256").update(token).digest("hex");
const key = (n) => `evl_${n.toString(16).padStart(64, "0")}`;
const makeKey = async (user, n, scopes) => (await service(
  "select * from public.create_api_key(p_user_id => $1, p_token_hash => $2, p_hint => 'abcd', p_label => ''"
    + (scopes ? ", p_scopes => $3)" : ")"),
  scopes ? [user, hash(key(n)), scopes] : [user, hash(key(n))],
))[0];
const forKey = async (n, count = true) => (await service(
  "select * from public.own_builds_for_key(p_token_hash => $1, p_count => $2)", [hash(key(n)), count]))[0];
const count = async (table, user) => (await pool.query(`select count(*)::int as n from public.${table} where user_id = $1`, [user])).rows[0].n;
const saves = async (user) => (await pool.query("select count from public.intake_quota_buckets where bucket = $1", [`builds:${user}`])).rows[0]?.count ?? 0;

/** Every function body, setting and grant, every table, column and grant, constraint, index and policy in public. */
const catalog = async () => (await pool.query(`
  select format('function %s %s %s %s %s', p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.proconfig, p.proacl) as item
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select format('table %s %s %s %s', c.oid::regclass, c.relrowsecurity, c.relacl,
      (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || coalesce(' ' || a.attacl::text, ''), ', ' order by a.attnum)
         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
  union all
  select format('constraint %s %s', conrelid::regclass, pg_get_constraintdef(oid)) from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select format('index %s', pg_get_indexdef(indexrelid)) from pg_index i join pg_class c on c.oid = i.indrelid
    where c.relnamespace = 'public'::regnamespace
  union all
  select format('policy %s %s', tablename, policyname) from pg_policies where schemaname = 'public'
  order by 1`)).rows.map((r) => r.item);

async function productionSchema() {
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
  }
  await pool.query("alter role service_role bypassrls");
  await pool.query("grant usage on schema public to anon, authenticated, service_role");
  // Production's tables were made under Supabase's old defaults, which grant every new table and function to the
  // API roles; each migration revokes what it must.
  await pool.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
  await pool.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
  for (const file of CHAIN) await pool.query(await read(file));
  const users = (await pool.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'users' order by 1",
  )).rows.map((r) => r.column_name);
  assert.deepEqual(users, ["battletag", "bnet_id", "created_at", "id", "updated_at"], "the legacy users table");
}

async function schemaChecksCatchEachCondition() {
  const only = (setup) => rolledBack(async (db) => { await db.query(setup); return failing(SCHEMA, db); });
  const SAVE_BUILD = "public.save_build(uuid, uuid, text, uuid, text, text, text, text, boolean, boolean, boolean)";
  assert.deepEqual(await only("alter table public.users add column name text, add column email text"),
    ["users is the Battle.net table, without accounts v2 columns"]);
  assert.deepEqual(await only("alter table public.build_characters rename column note to label"), ["build_characters has the file's columns"]);
  // A column from a later migration means these checks no longer describe production: stop and update them.
  assert.deepEqual(await only("alter table public.saved_builds add column point_order text"), ["saved_builds has the file's columns"]);
  // The one later set they allow is the spend-order file's, all three of its columns and nothing short of them.
  const spendOrder = ["point_order", "point_order2", "transfer_key"];
  assert.deepEqual(await only(`alter table public.saved_builds ${spendOrder.map((c) => `add column ${c} text`).join(", ")}`), []);
  for (const short of [spendOrder.slice(0, 2), spendOrder.slice(1), [spendOrder[0], spendOrder[2]]]) {
    assert.deepEqual(await only(`alter table public.saved_builds ${short.map((c) => `add column ${c} text`).join(", ")}`),
      ["saved_builds has the file's columns"], short.join(", "));
  }
  assert.deepEqual(await only("alter table public.saved_builds drop constraint saved_builds_character_id_fkey, "
    + "add foreign key (character_id) references public.build_characters(id) on delete cascade"),
  ["rows go with their account, and a build loses only its label when the label goes"]);
  for (const lost of ["drop index public.saved_builds_one_active", "alter table public.saved_builds drop constraint saved_builds_slug_key"]) {
    assert.deepEqual(await only(lost), ["a slug names one build, and a label has at most one active build"], lost);
  }
  for (const open of ["alter table public.saved_builds disable row level security", "create policy anyone on public.build_characters for select using (true)"]) {
    assert.deepEqual(await only(open), ["row level security is on for both tables, with no policies"], open);
  }
  for (const grant of ["grant select on public.saved_builds to anon", "grant select (name) on public.build_characters to authenticated"]) {
    assert.deepEqual(await only(grant), ["anon and authenticated have nothing on either table, or on any of its columns"], grant);
  }
  assert.deepEqual(await only("grant update (shared) on public.saved_builds to service_role"),
    ["service_role reads both tables and writes them only through the functions"]);

  // Another function by one of the names: PostgREST would see two, and the site's call by name could pick either.
  const overloads = ["the seven saved-builds functions, one signature each", "each takes the named arguments the site sends",
    "each runs as its owner with an empty search_path and a 3 s lock wait", "their bodies are the #450 file's, word for word",
    "only service_role may call the six site functions and create_api_key"];
  assert.deepEqual(await only("create function public.save_build(p_user_id uuid) returns void language sql as ''"), overloads);
  // The four-argument create_api_key from the data guard, back beside the saved-builds one.
  assert.deepEqual(await only("create function public.create_api_key(p_user_id uuid, p_token_hash text, p_hint text, p_label text) "
    + "returns table (key_ref uuid, refusal text) language sql as 'select null::uuid, null::text'"),
  ["create_api_key is the saved-builds version, with scopes, and the only one", ...overloads.slice(1)]);

  assert.deepEqual(await only("alter function public.delete_build(uuid, uuid) reset all"),
    ["each runs as its owner with an empty search_path and a 3 s lock wait"]);
  assert.deepEqual(await only("alter function public.shared_build(text) security invoker"),
    ["each runs as its owner with an empty search_path and a 3 s lock wait"]);
  // A body changed by hand, with the same arguments and settings.
  assert.deepEqual(await only("create or replace function public.delete_build(p_user_id uuid, p_id uuid) returns boolean "
    + "language plpgsql security definer set search_path = '' set lock_timeout = '3s' as $$ begin return false; end; $$"),
  ["their bodies are the #450 file's, word for word"]);
  // The shared_build from before #450, which fell back to the BattleTag.
  const current = (await pool.query("select pg_get_functiondef('public.shared_build(text)'::regprocedure) as def")).rows[0].def;
  const old = current.replace("to_jsonb(u) ->> 'bnet_id' is null then to_jsonb(u) ->> 'name'",
    "true then coalesce(to_jsonb(u) ->> 'name', to_jsonb(u) ->> 'battletag')");
  assert.notEqual(old, current);
  assert.deepEqual(await only(old), ["their bodies are the #450 file's, word for word", "shared_build is the #450 version, with no Battle.net owner name"]);

  assert.deepEqual(await only(`grant execute on function ${SAVE_BUILD} to anon`), ["only service_role may call the six site functions and create_api_key"]);
  assert.deepEqual(await only("grant execute on function public.take_build_save(uuid) to service_role"), ["nobody may call take_build_save directly"]);
  // Quota columns out of order: take_build_save inserts by position, so the first save would fail.
  const reordered = "alter table public.intake_quota_buckets rename to intake_quota_buckets_kept; "
    + "create table public.intake_quota_buckets (bucket text primary key, reset_at timestamptz not null, count integer not null)";
  assert.deepEqual(await only(reordered), ["intake_quota_buckets is bucket, count, reset_at in that order, keyed by bucket"]);
  await rolledBack(async (db) => {
    await db.query(reordered);
    const [{ id }] = (await db.query("insert into public.users (bnet_id, battletag) values ('bnet-reorder', 'Order#1') returning id")).rows;
    await assert.rejects(db.query("select * from public.save_build($1, null, 'Reorder1', null, 'x', null, $2, null, null, null, null)", [id, MAGE]));
  });
  assert.deepEqual(await only("alter table public.api_key_usage drop constraint api_key_usage_surface_check, "
    + "add constraint api_key_usage_surface_check check (surface in ('corpus', 'drops', 'market', 'mcp'))"),
  ["key reads of builds are counted under their own surface"]);
  assert.deepEqual(await only("revoke select on public.sessions from service_role"), ["service_role reads users, sessions and api_keys"]);

  // A build that is already shared would go live with the switch.
  assert.deepEqual(await rolledBack(async (db) => {
    const [{ id }] = (await db.query("insert into public.users (bnet_id, battletag) values ('bnet-shared', 'Shared#1') returning id")).rows;
    await db.query("select * from public.save_build($1, null, 'Shared01', null, 'x', null, $2, null, true, null, null)", [id, MAGE]);
    return failing(PRIVATE, db);
  }), ["every build saved so far is private, as Chat saves them, so the switch publishes nothing"]);
}

async function browserRolesAndDirectWritesAreRefused(user) {
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(asRole(role, "select * from public.saved_builds"), /permission denied/);
    await assert.rejects(asRole(role, "select name from public.build_characters"), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.shared_build('abcdefgh')"), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.own_builds_for_key($1)", ["a".repeat(64)]), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.save_build($1, null, 'abcdefgh', null, 'x', null, $2, null, null, null, null)", [user, MAGE]), /permission denied/);
    await assert.rejects(asRole(role, "select public.delete_build($1, $1)", [user]), /permission denied/);
  }
  await assert.rejects(service("insert into public.saved_builds (user_id, slug, name, class_slug, code, game_build) values ($1, 'abcdefgh', 'x', 'mage', $2, '1')", [user, MAGE]), /permission denied/);
  await assert.rejects(service("update public.saved_builds set shared = true"), /permission denied/);
  await assert.rejects(service("delete from public.build_characters"), /permission denied/);
  await assert.rejects(service("select public.take_build_save($1)", [user]), /permission denied/);
}

async function legacyAccounts() {
  const [{ id: owner }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('bnet-87017', 'Thrall#1234') returning id")).rows;
  const [{ id: other }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('bnet-87018', 'Jaina#2002') returning id")).rows;
  await browserRolesAndDirectWritesAreRefused(owner);

  // Before the switch, Chat's builds are the only kind production has: private, unmarked, with no name shown.
  const chat = await saveBuild(owner, { name: "Chat build", shared: false, showName: false, active: false });
  assert.equal(chat.refusal, null);
  assert.deepEqual(await readOnly(PRIVATE), []);
  assert.equal(await sharedBuild(chat.build_slug), null);

  // A legacy session resolves the way the site's getUser reads it.
  const tokenHash = "ab".repeat(32);
  await pool.query("insert into public.sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [owner, tokenHash]);
  const [session] = await service("select user_id from public.sessions where token_hash = $1 and expires_at > now() limit 1", [tokenHash]);
  const [account] = await service("select id, bnet_id, battletag from public.users where id = $1 limit 1", [session.user_id]);
  assert.equal(account.id, owner);

  // Signed out, the calculator keeps the plan in the browser. Signed in, Save sends its codes, and the account's list
  // gives back the same plan, both sets, as sent.
  const made = await saveBuild(account.id, { name: "Test fire", notes: "Raid night", code: MAGE, code2: MAGE2, shared: true, showName: false });
  assert.equal(made.refusal, null);
  const first = (await listOwn(owner)).builds.find((b) => b.id === made.build_ref);
  assert.deepEqual(Object.keys(first), BUILD_COLUMNS.split(","));
  assert.deepEqual([first.code, first.code2, first.name, first.notes, first.class_slug, first.game_build, first.shared, first.show_name, first.active],
    [MAGE, MAGE2, "Test fire", "Raid night", "mage", "1.60.1.70450", true, false, false]);

  // Update: the same build and short link; a switch the save leaves out keeps its stored value.
  const updated = await saveBuild(owner, { id: made.build_ref, name: "Test fire 2", notes: "Raid night", code: MAGE_OLD, code2: MAGE2 });
  assert.deepEqual([updated.build_ref, updated.build_slug, updated.refusal], [made.build_ref, made.build_slug, null]);
  const open = await sharedBuild(made.build_slug);
  assert.deepEqual([open.name, open.code, open.code2, open.game_build], ["Test fire 2", MAGE_OLD, MAGE2, "1.50.0.1"]);

  // Copy (Save as new, or Duplicate on /me): another build and short link; the first is unchanged.
  const copy = await saveBuild(owner, { name: "Test fire 2 (copy)", notes: "Raid night", code: MAGE_OLD, code2: MAGE2, shared: true });
  assert.equal(copy.refusal, null);
  assert.notEqual(copy.build_ref, made.build_ref);
  assert.notEqual(copy.build_slug, made.build_slug);
  assert.equal((await sharedBuild(made.build_slug)).name, "Test fire 2");

  // Reopen: the list, newest first, carries each build's codes for the calculator; each short link reads the same.
  const mine = (await listOwn(owner)).builds;
  assert.deepEqual(mine.map((b) => b.id), [copy.build_ref, made.build_ref, chat.build_ref]);
  for (const b of mine.filter((b) => b.shared)) {
    const read = await sharedBuild(b.slug);
    assert.deepEqual([read.name, read.code, read.code2], [b.name, b.code, b.code2]);
  }

  // Unshare: the short link stops at once, and the owner keeps the build. Shared again, the same link works.
  await saveBuild(owner, { id: copy.build_ref, name: "Test fire 2 (copy)", code: MAGE_OLD, code2: MAGE2, shared: false });
  assert.equal(await sharedBuild(copy.build_slug), null);
  assert.equal((await listOwn(owner)).builds.find((b) => b.id === copy.build_ref).shared, false);
  await saveBuild(owner, { id: copy.build_ref, name: "Test fire 2 (copy)", code: MAGE_OLD, code2: MAGE2, shared: true });
  assert.equal((await sharedBuild(copy.build_slug)).name, "Test fire 2 (copy)");
  await saveBuild(owner, { id: copy.build_ref, name: "Test fire 2 (copy)", code: MAGE_OLD, code2: MAGE2, shared: false });

  // Delete: gone from the list and from its short link. Another account's delete, or a second one, finds nothing.
  assert.equal(await deleteBuild(other, made.build_ref), false);
  assert.notEqual(await sharedBuild(made.build_slug), null, "another account's delete changes nothing");
  assert.equal(await deleteBuild(owner, made.build_ref), true);
  assert.equal(await deleteBuild(owner, made.build_ref), false);
  assert.equal(await sharedBuild(made.build_slug), null);
  assert.ok(!(await listOwn(owner)).builds.some((b) => b.id === made.build_ref));

  // Another account finds none of the owner's builds or labels, and changes nothing.
  const label = await saveLabel(owner, { name: "Test Jaina", realm: "Pioneer", note: "private note" });
  assert.equal(label.refusal, null);
  assert.equal((await saveBuild(other, { id: copy.build_ref, name: "Mine now" })).refusal, "not_found");
  assert.equal((await saveBuild(other, { characterId: label.character_ref })).refusal, "not_found");
  assert.equal((await saveLabel(other, { id: label.character_ref, name: "Taken" })).refusal, "not_found");
  assert.equal(await deleteLabel(other, label.character_ref), false);
  assert.deepEqual(await listOwn(other), { characters: [], builds: [] });
  assert.equal((await listOwn(owner)).builds.find((b) => b.id === copy.build_ref).name, "Test fire 2 (copy)");

  // A refused save writes nothing and costs no save; malformed input rolls back whole.
  const before = [await count("saved_builds", owner), await saves(owner)];
  assert.equal((await saveBuild(owner, { characterId: label.character_ref, code: WARRIOR })).refusal, "class_mismatch");
  assert.equal((await saveBuild(owner, { slug: copy.build_slug })).refusal, "slug_taken");
  await assert.rejects(saveBuild(owner, { name: "x".repeat(61) }), /Invalid build/);
  await assert.rejects(saveBuild(owner, { code2: WARRIOR }), /Invalid build/);
  assert.deepEqual([await count("saved_builds", owner), await saves(owner)], before);

  // What a short link reads is the build's own fields. The page shows neither the label nor, for a Battle.net
  // account, an owner name, even with show_name on; no private account data is in the row at all.
  const filed = await saveBuild(owner, { characterId: label.character_ref, name: "Test filed", shared: true, showName: true, active: true });
  const row = await sharedBuild(filed.build_slug);
  assert.deepEqual(Object.keys(row), ["name", "notes", "class_slug", "code", "code2", "game_build", "character_name", "character_class", "owner_name", "updated_at"]);
  assert.equal(row.owner_name, null);
  const text = JSON.stringify(row);
  for (const hidden of ["Thrall#1234", "bnet-87017", owner, label.character_ref, filed.build_ref, "Pioneer", "private note"]) {
    assert.ok(!text.includes(hidden), hidden);
  }

  // With profiles on, a public profile lists shared builds only: never Chat's, never an unshared one, never an id.
  assert.equal((await service("select * from public.save_profile(p_user_id => $1, p_handle => 'test-thrall', p_display_name => null, "
    + "p_public => true, p_show_characters => false, p_show_builds => true, p_show_status => false)", [owner]))[0].refusal, null);
  const profile = (await service("select * from public.public_profile(p_handle => 'test-thrall')"))[0];
  assert.deepEqual(profile.builds.map((b) => b.name), ["Test filed"]);
  for (const hidden of ["Chat build", "Test fire 2 (copy)", owner, filed.build_ref, "Thrall#1234"]) assert.ok(!JSON.stringify(profile).includes(hidden), hidden);
  assert.equal((await service("select * from public.save_profile(p_user_id => $1, p_handle => null, p_display_name => null, "
    + "p_public => false, p_show_characters => true, p_show_builds => true, p_show_status => true)", [owner]))[0].refusal, null);

  // Keys: read:own gives the key's owner their own builds and labels, with no account id; a read:public key is refused.
  assert.equal((await makeKey(owner, 1)).refusal, null);
  assert.equal((await makeKey(owner, 2, ["read:public", "read:own"])).refusal, null);
  assert.equal((await makeKey(other, 3, ["read:public", "read:own"])).refusal, null);
  assert.equal((await forKey(1)).refusal, "no_scope");
  const listed = await forKey(2);
  assert.equal(listed.refusal, null);
  assert.deepEqual(listed.builds.map((b) => b.id).sort(), (await listOwn(owner)).builds.map((b) => b.id).sort());
  assert.deepEqual(listed.characters.map((c) => c.id), [label.character_ref]);
  assert.ok(!JSON.stringify(listed).includes(owner) && !JSON.stringify(listed).includes(other));
  assert.deepEqual((await forKey(3)).builds, []);

  // Limits, counted in the legacy quota table by position: 200 builds and 30 labels per account, 300 saves a day.
  const many = await Promise.all(Array.from({ length: 205 }, () => saveBuild(other, { name: "Test limit" })));
  assert.equal(many.filter((r) => r.refusal === null).length, 200);
  assert.ok(many.filter((r) => r.refusal !== null).every((r) => r.refusal === "build_limit"));
  const labels = await Promise.all(Array.from({ length: 33 }, (_, i) => saveLabel(other, { name: `Test alt ${i}` })));
  assert.equal(labels.filter((r) => r.refusal === null).length, 30);
  assert.ok(labels.filter((r) => r.refusal !== null).every((r) => r.refusal === "character_limit"));
  const [bucket] = (await pool.query(
    "select count, reset_at > now() and reset_at <= now() + interval '1 day' as today from public.intake_quota_buckets where bucket = $1",
    [`builds:${other}`])).rows;
  assert.deepEqual([bucket.count, bucket.today], [230, true]);
  await pool.query("update public.intake_quota_buckets set count = 299 where bucket = $1", [`builds:${other}`]);
  const kept = many.find((r) => r.refusal === null).build_ref;
  assert.equal((await saveBuild(other, { id: kept, name: "Test last one today" })).refusal, null);
  assert.equal((await saveBuild(other, { id: kept, name: "Test one too many" })).refusal, "daily_limit");
  assert.equal((await listOwn(other)).builds.find((b) => b.id === kept).name, "Test last one today");

  // Deleting the account deletes its builds and labels, and nothing of another account's.
  await pool.query("delete from public.users where id = $1", [owner]);
  assert.deepEqual([await count("saved_builds", owner), await count("build_characters", owner)], [0, 0]);
  assert.deepEqual([await count("saved_builds", other), await count("build_characters", other)], [200, 30]);
}

try {
  const [{ database }] = (await pool.query("select current_database() as database")).rows;
  assert.equal(database, DATABASE, "Connected to the dedicated test database");
  await productionSchema();
  const before = await catalog();

  // Preflight: every row `t`, in a transaction that may not write.
  assert.deepEqual(await readOnly(SCHEMA), []);
  assert.deepEqual(await readOnly(PRIVATE), []);
  await schemaChecksCatchEachCondition();
  assert.deepEqual(await catalog(), before, "the checks and their failures leave nothing behind");

  // The switch runs nothing here: what follows is what it lets the site do.
  await legacyAccounts();

  // Postflight: still every row `t`, and nothing outside the data moved. Turning the switch off needs no SQL.
  assert.deepEqual(await readOnly(SCHEMA), []);
  assert.deepEqual(await catalog(), before, "saving, sharing and deleting change no function, grant or table");

  // #450's check that the file applies twice on the legacy users table, rolled back: the rollout never runs it.
  await rolledBack(async (db) => {
    await db.query(await read(SAVED_BUILDS));
    assert.deepEqual(await failing(SCHEMA, db), []);
  });
  assert.deepEqual(await catalog(), before);
  console.log("saved builds legacy integration: ok");
} finally {
  await pool.end();
}
