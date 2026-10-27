import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Spend orders for saved builds on the schema production runs: Battle.net users without the accounts v2 columns, the
// #450 saved-builds file applied once, the Chat workspace, realm keys, guilds and profiles. Then the saved-builds
// schema checks and the exact preflight, apply, postflight and rollback of docs/2026-10-27-saved-builds-activation.md
// ("Spend orders"), once with Supabase's old default grants and once with none (its default from 2026-10-30), and what
// the site does through save_build_plan and its reads. Disposable local Postgres only: this fixture drops the public
// schema.
// docker run -d --name saved-build-point-order-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54407:5432 postgres:17
// docker exec saved-build-point-order-test createdb -U postgres saved_build_point_order_test
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54407/saved_build_point_order_test node scripts/saved-build-point-order.integration.mjs
const DATABASE = "saved_build_point_order_test";
const url = new URL(process.env.QUOTA_TEST_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Local test database required");
assert.equal(url.pathname, `/${DATABASE}`, "Dedicated test database required");
// Options in the query (host=, dbname=) could send the pool elsewhere: none are taken, and no connection string.
assert.equal(url.search + url.hash, "", "No connection options");
const pool = new pg.Pool({
  host: url.hostname, port: Number(url.port || 5432), database: DATABASE, max: 12,
  user: decodeURIComponent(url.username) || "postgres", password: decodeURIComponent(url.password) || undefined,
});

const migrations = new URL("../../supabase/migrations/", import.meta.url);
const read = (file) => readFile(new URL(file, migrations), "utf8");
// What production has applied, in its order (as in saved-builds-legacy.integration.mjs). Never accounts v2, never the
// saved-builds file from before #450, none of the later files production does not have.
const CHAIN = [
  "20261003000000_auth_schema.sql", "20261004000000_uploads_waitlist.sql", "20261007070647_verified_publication.sql",
  "20261007220000_intake_quotas.sql", "20261010120000_mcp_quota_scope.sql", "20261018120000_usage_counters.sql",
  "20261019120000_data_guard.sql", "20261021130000_players.sql", "20261021150000_saved_builds.sql",
  "20261025191223_chat_workspace.sql", "20261022160000_players_realm_key.sql", "20261025120000_guilds.sql",
  "20261021170000_account_profiles.sql",
];
const migration = await read("20261027120000_saved_build_point_order.sql");
const FUNCTIONS = ["save_build_plan", "saved_build_order_follows_code"];
const CONSTRAINTS = ["saved_builds_point_order_check", "saved_builds_point_order2_check"];
const TRIGGER = "saved_builds_order_follows_code";

// The runbook's SQL, run as written.
const doc = (await readFile(new URL("../../docs/2026-10-27-saved-builds-activation.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const block = (name) => {
  const found = doc.match(new RegExp("```sql\\n(-- " + name + "\\n[\\s\\S]*?)```"));
  assert.ok(found, `No ${name} block in the runbook`);
  return found[1];
};
const PASTE = /^-- paste supabase\/migrations\/20261027120000_saved_build_point_order\.sql here, unchanged$/m;
assert.match(block("point order apply"), PASTE);
// A function, not a string: the file's $$ would read as a replacement pattern.
const APPLY = block("point order apply").replace(PASTE, () => migration);
const [SCHEMA, PRIVATE, PREFLIGHT, POSTFLIGHT, ROLLBACK] =
  ["schema checks", "private so far", "point order preflight", "point order postflight", "point order rollback"].map(block);
// The columns the site reads (web/src/lib/saved-builds.ts), from its source, so the two cannot drift apart.
const site = await readFile(new URL("../src/lib/saved-builds.ts", import.meta.url), "utf8");
const columns = (name) => site.match(new RegExp(`export const ${name} = "([a-z0-9_,]+)"`))[1];
const [BUILD_COLUMNS, ORDER_COLUMNS] = ["BUILD_COLUMNS", "ORDER_COLUMNS"].map(columns);
const READ = `${BUILD_COLUMNS},${ORDER_COLUMNS}`;

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

/** One request as PostgREST makes it: a transaction as the role, committed, or rolled back whole on any error. */
async function asRole(role, query, params = [], db = null) {
  assert.ok(["service_role", "anon", "authenticated"].includes(role));
  const client = db ?? await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await client.query(query, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { if (!db) client.release(); }
}
const service = (query, params, db) => asRole("service_role", query, params, db);

// Codes and the tokens that name their points: MAGE spends 5 points in node 11, MAGE4 4 of them, MAGE_OLD the same 5
// on an older game build, MAGE2 one point in node 21.
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE4 = "EL1-mage-0-1.60.1.70450-MTE6NA";
const MAGE_OLD = "EL1-mage-0-1.50.0.1-MTE6NQ";
const MAGE2 = "EL1-mage-1482-1.60.1.70450-MjE6MQ";
const WARRIOR = "EL1-warrior-0-1.60.1.70450-MTE6NQ";
const ORDER = "O1p-AAAAA";
const ORDER_G = "O1g-AAAAA";
const ORDER4 = "O1p-AAAA";
const ORDER2 = "O1g-A";

let slugs = 0;
const slug = () => `P${String(++slugs).padStart(7, "0")}`;
// The site's calls (web/src/lib/saved-builds-store.ts) as PostgREST makes them: named arguments, the columns above.
/** save_build_plan: the user, and the build as the server checked it, with the server's slug for a new one. */
const savePlan = async (user, payload, db) =>
  (await service("select public.save_build_plan(p_user_id => $1, p_payload => $2) as saved", [user, JSON.stringify(payload)], db))[0].saved;
/** A new build from the calculator: its sharing said, both sets' orders given. */
const fresh = (over = {}) => ({ id: null, slug: slug(), name: "Test fire", notes: null, characterId: null, code: MAGE, code2: null,
  shared: true, active: null, showName: false, ...over });
/** An update, as the calculator sends it: the build as it is now, its switches kept. */
const edit = (id, over = {}) => ({ id, slug: null, name: "Test fire", notes: null, characterId: null, code: MAGE, code2: null,
  shared: null, active: null, showName: null, ...over });
/** save_build, as the site from before this file calls it, and as nothing in this file changes. */
const oldSave = async (user, b = {}, db) => (await service(
  "select * from public.save_build(p_user_id => $1, p_id => $2, p_slug => $3, p_character_id => $4, p_name => $5, "
    + "p_notes => $6, p_code => $7, p_code2 => $8, p_shared => $9, p_active => $10, p_show_name => $11)",
  [user, b.id ?? null, b.id ? null : b.slug ?? slug(), b.characterId ?? null, b.name ?? "Test fire", b.notes ?? null,
    b.code ?? MAGE, b.code2 ?? null, b.shared ?? null, b.active ?? null, b.showName ?? null], db,
))[0];
const saveLabel = async (user, name, classSlug = "mage") => (await service(
  "select * from public.save_build_character(p_user_id => $1, p_id => null, p_name => $2, p_class_slug => $3, p_realm => 'Pioneer', p_note => 'private note')",
  [user, name, classSlug]))[0].character_ref;
/** GET /api/me/builds for a session (listOwn): the account's builds, newest first, with their orders. */
const listOwn = async (user) => service(`select ${READ} from public.saved_builds where user_id = $1 order by updated_at desc, id asc`, [user]);
const own = async (user, id) => (await listOwn(user)).find((b) => b.id === id);
const orders = async (user, id) => { const b = await own(user, id); return [b.code, b.code2, b.point_order, b.point_order2]; };
/** /b/<slug>: shared_build, then the orders beside it for that build only while it is shared (sharedBuild). */
const sharedRead = async (s) => (await service("select * from public.shared_build(p_slug => $1)", [s]))[0] ?? null;
const sharedOrders = async (s) =>
  (await service(`select code,code2,${ORDER_COLUMNS} from public.saved_builds where slug = $1 and shared limit 1`, [s]))[0] ?? null;
const count = async (user) => (await pool.query("select count(*)::int as n from public.saved_builds where user_id = $1", [user])).rows[0].n;
const saves = async (user) => (await pool.query("select count from public.intake_quota_buckets where bucket = $1", [`builds:${user}`])).rows[0]?.count ?? 0;
const hash = (token) => createHash("sha256").update(token).digest("hex");
const key = (n) => `evl_${n.toString(16).padStart(64, "0")}`;
const user = async (bnet, tag) => (await pool.query("insert into public.users (bnet_id, battletag) values ($1, $2) returning id", [bnet, tag])).rows[0].id;

/** Everything in public that is not this file's: function bodies, settings and grants; tables, their grants and columns;
 *  constraints, indexes, triggers and policies. */
const others = async () => (await pool.query(`
  select format('function %s %s %s %s %s', p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.proconfig, p.proacl) as item
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname::text <> all ($1::text[])
  union all
  select format('table %s %s %s %s', c.oid::regclass, c.relrowsecurity, c.relacl,
      (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || coalesce(' ' || a.attacl::text, ''), ', ' order by a.attnum)
         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           and (a.attrelid <> 'public.saved_builds'::regclass or a.attname not in ('point_order', 'point_order2'))))
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
  union all
  select format('constraint %s %s', conrelid::regclass, pg_get_constraintdef(oid)) from pg_constraint
    where connamespace = 'public'::regnamespace and conname::text <> all ($2::text[])
  union all
  select format('index %s', pg_get_indexdef(indexrelid)) from pg_index i join pg_class c on c.oid = i.indrelid
    where c.relnamespace = 'public'::regnamespace
  union all
  select format('trigger %s', pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgname <> $3
  union all
  select format('policy %s %s', tablename, policyname) from pg_policies where schemaname = 'public'
  order by 1`, [FUNCTIONS, CONSTRAINTS, TRIGGER])).rows.map((r) => r.item);

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
  const users = (await pool.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'users' order by 1",
  )).rows.map((r) => r.column_name);
  assert.deepEqual(users, ["battletag", "bnet_id", "created_at", "id", "updated_at"], "the legacy users table");
}

async function preflightCatchesEachCondition() {
  const only = (setup) => rolledBack(async (db) => { await db.query(setup); return failing(PREFLIGHT, db); });
  // Half applied by hand, or applied already: stop, and look before applying again.
  assert.deepEqual(await only("alter table public.saved_builds add column point_order text"), ["saved_builds has no point_order or point_order2 column yet"]);
  assert.deepEqual(await only("alter table public.saved_builds add constraint saved_builds_point_order2_check check (true)"),
    ["no constraint has a name the file adds"]);
  assert.deepEqual(await only("create function public.t() returns trigger language plpgsql as $$ begin return new; end; $$; "
    + "create trigger saved_builds_order_follows_code before update on public.saved_builds for each row execute function public.t()"),
  ["no trigger has the name the file adds"]);
  // Another function by the name: the file's would be a second one beside it, and PostgREST could pick either.
  const collision = "create function public.save_build_plan(p_user_id uuid) returns jsonb language sql as 'select null::jsonb'";
  assert.deepEqual(await only(collision), ["no function has either name the file adds"]);
  assert.deepEqual(await rolledBack(async (db) => { await db.query(collision); await db.query(migration); return failing(POSTFLIGHT, db); }), [
    "save_build_plan is the one function of its name, taking a user and a payload and answering in JSON",
    "both run as their owner with an empty search_path and a 3 s lock wait", "their bodies are the file's, word for word",
  ]);
  // A session that neither owns the table nor may create in public cannot add the columns, the trigger or the function.
  assert.deepEqual(await rolledBack(async (db) => { await db.query("set local role anon"); return failing(PREFLIGHT, db); }),
    ["this session owns saved_builds and may call save_build, as the new function will", "this session may create in public"]);
}

async function heldLockChangesNothing() {
  // A save in progress (Chat's, through save_build) holds a lock on saved_builds until it commits; the new columns and
  // the trigger need the table to themselves. The apply gives up after its lock timeout and leaves nothing behind.
  const saving = await pool.connect();
  try {
    await saving.query("BEGIN");
    await saving.query("update public.saved_builds set name = name where false");
    const started = Date.now();
    await assert.rejects(run(APPLY), (error) => error.code === "55P03");
    assert.ok(Date.now() - started < 20_000, "the wait is bounded");
  } finally {
    await saving.query("ROLLBACK");
    saving.release();
  }
  assert.deepEqual(await failing(PREFLIGHT), [], "a failed apply changes nothing");
}

async function postflightCatchesEachCondition() {
  const only = (setup) => rolledBack(async (db) => { await db.query(setup); return failing(POSTFLIGHT, db); });
  assert.deepEqual(await only("alter table public.saved_builds add column point_order3 text"), ["saved_builds ends with point_order and point_order2, nullable text"]);
  assert.deepEqual(await only("alter table public.saved_builds drop constraint saved_builds_point_order2_check"),
    ["each order has the token's shape, and a second order needs a second set"]);
  assert.deepEqual(await only("alter table public.saved_builds disable trigger saved_builds_order_follows_code"),
    ["a save that changes a code drops its order: the trigger runs before each update of code or code2, and is on"]);
  // A definer function with no settings left: its proconfig is NULL, which an aggregate would skip.
  assert.deepEqual(await only("alter function public.save_build_plan(uuid, jsonb) reset all"),
    ["both run as their owner with an empty search_path and a 3 s lock wait"]);
  assert.deepEqual(await only("create or replace function public.saved_build_order_follows_code() returns trigger language plpgsql "
    + "security definer set search_path = '' set lock_timeout = '3s' as $$ begin return new; end; $$"), ["their bodies are the file's, word for word"]);
  assert.deepEqual(await only("grant execute on function public.save_build_plan(uuid, jsonb) to authenticated"), ["only service_role may call save_build_plan"]);
  assert.deepEqual(await only("grant execute on function public.saved_build_order_follows_code() to service_role"),
    ["nobody may call the trigger's function directly"]);
  // Owned by a role that may not write the table, every save would fail after save_build.
  assert.deepEqual(await only("alter function public.save_build_plan(uuid, jsonb) owner to service_role"),
    ["save_build_plan's owner may run save_build and write saved_builds"]);
}

async function browserRolesAndDirectWritesAreRefused(owner) {
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(asRole(role, "select point_order, point_order2 from public.saved_builds"), /permission denied/);
    await assert.rejects(asRole(role, "select public.save_build_plan($1, $2)", [owner, JSON.stringify(fresh())]), /permission denied/);
    const [{ ok }] = await asRole(role, `select has_column_privilege('${role}', 'public.saved_builds', 'point_order', 'select') `
      + `or has_column_privilege('${role}', 'public.saved_builds', 'point_order2', 'select, insert, update') as ok`);
    assert.equal(ok, false, role);
  }
  // The service role reads the orders, and writes them only through save_build_plan.
  assert.deepEqual(await service(`select ${ORDER_COLUMNS} from public.saved_builds where false`), []);
  await assert.rejects(service("update public.saved_builds set point_order = null"), /permission denied/);
  await assert.rejects(service("insert into public.saved_builds (user_id, slug, name, class_slug, code, game_build, point_order) "
    + "values ($1, 'abcdefgh', 'x', 'mage', $2, '1', $3)", [owner, MAGE, ORDER]), /permission denied/);
  await assert.rejects(service("select public.saved_build_order_follows_code()"), /permission denied/);
}

/** The order write fails after save_build has filed the codes: nothing of the save stays, its count included. */
async function failedOrderWriteSavesNothing(owner, build) {
  await pool.query("create function public.test_fail_order_write() returns trigger language plpgsql as "
    + "$$ begin raise exception 'forced order write failure after code %', new.code; end; $$");
  await pool.query("create trigger test_fail_order_write before update of point_order, point_order2 on public.saved_builds "
    + "for each row execute function public.test_fail_order_write()");
  try {
    const before = [await count(owner), await saves(owner), await own(owner, build)];
    const taken = slug();
    // A new build: the row save_build inserted goes, its short link is still free, and the save is not counted.
    await assert.rejects(savePlan(owner, fresh({ slug: taken, code2: MAGE2, order: ORDER, order2: ORDER2 })),
      /forced order write failure after code EL1-mage-0-1\.60\.1\.70450-MTE6NQ/);
    // An update: the new code save_build wrote was in place when the order write failed, and goes with it.
    await assert.rejects(savePlan(owner, edit(build, { name: "Not saved", code: MAGE4, code2: MAGE2, order: ORDER4, order2: ORDER2 })),
      /forced order write failure after code EL1-mage-0-1\.60\.1\.70450-MTE6NA/);
    assert.deepEqual([await count(owner), await saves(owner), await own(owner, build)], before);
    assert.equal((await pool.query("select count(*)::int as n from public.saved_builds where slug = $1", [taken])).rows[0].n, 0);
  } finally {
    await pool.query("drop trigger test_fail_order_write on public.saved_builds");
    await pool.query("drop function public.test_fail_order_write()");
  }
}

async function legacyAccounts() {
  const owner = await user("bnet-87017", "Thrall#1234");
  const other = await user("bnet-87018", "Jaina#2002");
  await browserRolesAndDirectWritesAreRefused(owner);

  // The calculator: a new build, both sets and both orders, in one call; reopened, the same tokens, makers and all.
  const made = await savePlan(owner, fresh({ name: "Test raid", notes: "Raid night", code2: MAGE2, order: ORDER, order2: ORDER2 }));
  assert.equal(made.refusal, null);
  assert.deepEqual(Object.keys(made).sort(), ["build_ref", "build_slug", "refusal"]);
  const first = await own(owner, made.build_ref);
  assert.deepEqual(Object.keys(first), READ.split(","));
  assert.deepEqual([first.code, first.code2, first.point_order, first.point_order2, first.name, first.shared, first.show_name, first.active],
    [MAGE, MAGE2, ORDER, ORDER2, "Test raid", true, false, false]);
  // An update that sends orders writes them as sent, an unknown one as null; one that leaves them out of a save that
  // keeps the codes keeps them; the switches it leaves null keep their values.
  assert.equal((await savePlan(owner, edit(made.build_ref, { code2: MAGE2, order: ORDER_G, order2: null }))).refusal, null);
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE, MAGE2, ORDER_G, null]);
  assert.equal((await savePlan(owner, edit(made.build_ref, { code2: MAGE2, order2: ORDER2 }))).refusal, null);
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE, MAGE2, ORDER_G, ORDER2]);
  assert.equal((await own(owner, made.build_ref)).shared, true);
  // A new code with the order made for it: written after the code, so even a token like the old one is kept.
  assert.equal((await savePlan(owner, edit(made.build_ref, { code: MAGE_OLD, code2: MAGE2, order: ORDER_G, order2: ORDER2 }))).refusal, null);
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE_OLD, MAGE2, ORDER_G, ORDER2]);

  // A save of the codes and orders whose order write fails rolls back whole.
  await failedOrderWriteSavesNothing(owner, made.build_ref);

  // An older save (save_build, as the site from before this file calls it) that changes a code drops that set's order;
  // one that keeps the codes keeps both. The same talents on another game build are another code: its order goes too.
  await savePlan(owner, edit(made.build_ref, { code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 }));
  assert.equal((await oldSave(owner, { id: made.build_ref, name: "Renamed", code: MAGE, code2: MAGE2 })).refusal, null);
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE, MAGE2, ORDER, ORDER2]);
  assert.equal((await own(owner, made.build_ref)).name, "Renamed");
  await oldSave(owner, { id: made.build_ref, code: MAGE4, code2: MAGE2 });
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE4, MAGE2, null, ORDER2]);
  await oldSave(owner, { id: made.build_ref, code: MAGE4, code2: null });
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE4, null, null, null]);
  await savePlan(owner, edit(made.build_ref, { order: ORDER }));
  await oldSave(owner, { id: made.build_ref, code: MAGE_OLD });
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE_OLD, null, null, null]);
  // A page from before orders, through save_build_plan, sends none: the same rule.
  await savePlan(owner, edit(made.build_ref, { code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 }));
  await savePlan(owner, edit(made.build_ref, { name: "Kept", code: MAGE, code2: MAGE2 }));
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE, MAGE2, ORDER, ORDER2]);
  await savePlan(owner, edit(made.build_ref, { code: MAGE4, code2: MAGE2 }));
  assert.deepEqual(await orders(owner, made.build_ref), [MAGE4, MAGE2, null, ORDER2]);

  // A new build says whether it is shared and shows its owner's name; nothing picks for it, and a refusal writes nothing.
  const before = [await count(owner), await saves(owner)];
  for (const missing of [{ shared: null }, { showName: null }]) {
    await assert.rejects(savePlan(owner, fresh(missing)), /Invalid build/);
  }
  const { shared: _shared, ...unsaid } = fresh();
  await assert.rejects(savePlan(owner, unsaid), /Invalid build/);
  // Malformed payloads raise and write nothing: the server checks first, the database again.
  const bad = [
    fresh({ order: "O2p-AAAAA" }), fresh({ order: "o1p-AAAAA" }), fresh({ order: ` ${ORDER}` }), fresh({ order: "O1p-" }),
    fresh({ order: `O1p-${"A".repeat(65)}` }), fresh({ order: 5 }), fresh({ order2: ORDER2 }), fresh({ code2: MAGE2, order2: "O1x-A" }),
    fresh({ characterGiven: true }), fresh({ name: 5 }), fresh({ shared: "yes" }), fresh({ code2: WARRIOR }), fresh({ name: "x".repeat(61) }),
  ];
  for (const payload of bad) await assert.rejects(savePlan(owner, payload), /Invalid build/, JSON.stringify(payload));
  for (const payload of [[], "build", null]) await assert.rejects(savePlan(owner, payload), /Invalid build/);
  await assert.rejects(savePlan(null, fresh()), /Invalid build/);
  assert.deepEqual([await count(owner), await saves(owner)], before);

  // Unshare: the short link and its orders stop at once, and the owner keeps both. Shared again, the same link, the same orders.
  const link = await savePlan(owner, fresh({ name: "Test link", code2: MAGE2, order: ORDER, order2: ORDER2 }));
  assert.deepEqual([(await sharedRead(link.build_slug)).code, await sharedOrders(link.build_slug)],
    [MAGE, { code: MAGE, code2: MAGE2, point_order: ORDER, point_order2: ORDER2 }]);
  await savePlan(owner, edit(link.build_ref, { name: "Test link", code2: MAGE2, shared: false }));
  assert.deepEqual([await sharedRead(link.build_slug), await sharedOrders(link.build_slug)], [null, null]);
  assert.deepEqual(await orders(owner, link.build_ref), [MAGE, MAGE2, ORDER, ORDER2]);
  await savePlan(owner, edit(link.build_ref, { name: "Test link", code2: MAGE2, shared: true }));
  assert.deepEqual(await sharedOrders(link.build_slug), { code: MAGE, code2: MAGE2, point_order: ORDER, point_order2: ORDER2 });
  // What the public read gives is what it gave before: no orders, no label, no owner name for a Battle.net account,
  // no id. The page's read of the orders gives the codes and the orders and nothing else.
  const label = await saveLabel(owner, "Test Jaina");
  await savePlan(owner, edit(link.build_ref, { name: "Test link", characterId: label, code2: MAGE2, showName: true, active: true }));
  const open = await sharedRead(link.build_slug);
  assert.deepEqual(Object.keys(open), ["name", "notes", "class_slug", "code", "code2", "game_build", "character_name", "character_class", "owner_name", "updated_at"]);
  assert.equal(open.owner_name, null);
  assert.deepEqual(Object.keys(await sharedOrders(link.build_slug)), ["code", "code2", "point_order", "point_order2"]);
  for (const hidden of ["Thrall#1234", "bnet-87017", owner, label, link.build_ref, "Pioneer", "private note"]) {
    assert.ok(!JSON.stringify([open, await sharedOrders(link.build_slug)]).includes(hidden), hidden);
  }

  // Chat: a new build is private, unmarked and anonymous, with both orders; an edit with its switches null and no
  // orders keeps all of it while the codes stay; the list gives the orders back for Open in the calculator.
  const chat = await savePlan(owner, fresh({ name: "Chat build", shared: false, showName: false, active: false, code2: MAGE2, order: ORDER_G, order2: ORDER2 }));
  assert.equal(chat.refusal, null);
  await savePlan(owner, edit(chat.build_ref, { name: "Chat build 2", notes: "edited in Chat", code2: MAGE2 }));
  const chatRow = await own(owner, chat.build_ref);
  assert.deepEqual([chatRow.name, chatRow.point_order, chatRow.point_order2, chatRow.shared, chatRow.show_name, chatRow.active],
    ["Chat build 2", ORDER_G, ORDER2, false, false, false]);
  // Private: never on the public read, nor its orders.
  assert.deepEqual([await sharedRead(chat.build_slug), await sharedOrders(chat.build_slug)], [null, null]);
  // Not found: an unknown slug, a malformed one, a deleted build: no row from either read.
  for (const unknown of ["Zz9Zz9Zz", "../../x"]) assert.deepEqual([await sharedRead(unknown), await sharedOrders(unknown)], [null, null]);
  assert.equal((await service("select public.delete_build(p_user_id => $1, p_id => $2) as ok", [owner, link.build_ref]))[0].ok, true);
  assert.deepEqual([await sharedRead(link.build_slug), await sharedOrders(link.build_slug)], [null, null]);
  // Private builds stay private: the switch would publish nothing.
  assert.deepEqual(await failing(PRIVATE), ["every build saved so far is private, as Chat saves them, so the switch publishes nothing"]);

  // Another account finds none of the owner's builds and changes none of their orders; its own refusals write nothing.
  const theirs = await own(owner, chat.build_ref);
  assert.equal((await savePlan(other, edit(chat.build_ref, { name: "Mine now", code: MAGE4, order: ORDER4 }))).refusal, "not_found");
  assert.equal((await savePlan(other, fresh({ characterId: label, order: ORDER }))).refusal, "not_found");
  assert.deepEqual(await own(owner, chat.build_ref), theirs);
  assert.deepEqual(await listOwn(other), []);
  assert.equal((await savePlan(owner, fresh({ characterId: label, code: WARRIOR }))).refusal, "class_mismatch");

  // The limits hold through save_build_plan: 200 builds an account (two saves racing for the last places get them, no
  // more), 300 saves a day; a refused save writes no order.
  await pool.query("insert into public.saved_builds (user_id, slug, name, class_slug, code, game_build) "
    + "select $1, 'L' || lpad(i::text, 7, '0'), 'Test limit', 'mage', $2, '1.60.1.70450' from generate_series(1, 198) i", [other, MAGE]);
  const race = await Promise.all(Array.from({ length: 5 }, () => savePlan(other, fresh({ order: ORDER }))));
  assert.deepEqual(race.map((r) => r.refusal).sort(), [null, null, "build_limit", "build_limit", "build_limit"].sort());
  assert.equal(await count(other), 200);
  const kept = race.find((r) => r.refusal === null).build_ref;
  await pool.query("update public.intake_quota_buckets set count = 300 where bucket = $1", [`builds:${other}`]);
  assert.equal((await savePlan(other, edit(kept, { code: MAGE4, order: ORDER4 }))).refusal, "daily_limit");
  assert.deepEqual(await orders(other, kept), [MAGE, null, ORDER, null]);

  // A key's read is as it was: its builds carry the fields they always had, no orders.
  assert.equal((await service("select * from public.create_api_key(p_user_id => $1, p_token_hash => $2, p_hint => 'abcd', p_label => '', "
    + "p_scopes => $3)", [owner, hash(key(1)), ["read:public", "read:own"]]))[0].refusal, null);
  const keyed = (await service("select * from public.own_builds_for_key(p_token_hash => $1, p_count => $2)", [hash(key(1)), true]))[0];
  assert.equal(keyed.refusal, null);
  assert.ok(keyed.builds.length > 0);
  for (const b of keyed.builds) {
    assert.deepEqual(Object.keys(b).sort(), ["active", "character_id", "class_slug", "code", "code2", "game_build", "id", "name", "notes",
      "shared", "show_name", "slug", "updated_at"]);
  }

  // Deleting the account deletes its builds, orders with them, and nothing of another account's.
  const third = await user("bnet-87019", "Rexxar#3003");
  await savePlan(third, fresh({ order: ORDER }));
  await pool.query("delete from public.users where id = $1", [third]);
  assert.equal(await count(third), 0);
  assert.equal(await count(other), 200);
  return { owner, chat: chat.build_ref };
}

try {
  const [{ database }] = (await pool.query("select current_database() as database")).rows;
  assert.equal(database, DATABASE, "Connected to the dedicated test database");
  for (const defaults of ["supabase", "none"]) {
    await legacySchema(defaults);
    const before = await others();
    // Preflight: the saved-builds checks, still describing the #450 file alone, then this file's. Every row `t`.
    assert.deepEqual(await failing(SCHEMA), []);
    assert.deepEqual(await failing(PRIVATE), []);
    assert.deepEqual(await failing(PREFLIGHT), []);
    if (defaults === "supabase") {
      await preflightCatchesEachCondition();
      await heldLockChangesNothing();
    }
    assert.deepEqual(await others(), before);

    // Production's connections live long: one that ran save_build before the apply goes on running it after, and an
    // order it does not know about still goes when it changes the code.
    const chatUser = await user("bnet-87020", "Valeera#4004");
    const early = await pool.connect();
    try {
      const chat = await oldSave(chatUser, { name: "Chat build", shared: false, showName: false, active: false }, early);
      assert.equal(chat.refusal, null);

      await run(APPLY);
      assert.deepEqual(await failing(POSTFLIGHT), []);
      // The saved-builds checks hold with the two columns, and nothing was published.
      assert.deepEqual(await failing(SCHEMA), []);
      assert.deepEqual(await failing(PRIVATE), []);
      assert.deepEqual(await others(), before, "the migration alters nothing it does not own");

      assert.deepEqual(await orders(chatUser, chat.build_ref), [MAGE, null, null, null]);
      assert.equal((await savePlan(chatUser, edit(chat.build_ref, { name: "Chat build", order: ORDER }))).refusal, null);
      assert.equal((await oldSave(chatUser, { id: chat.build_ref, name: "Chat build 2" }, early)).refusal, null);
      assert.deepEqual(await orders(chatUser, chat.build_ref), [MAGE, null, ORDER, null]);
      assert.equal((await oldSave(chatUser, { id: chat.build_ref, name: "Chat build 3", code: MAGE4 }, early)).refusal, null);
      assert.deepEqual(await orders(chatUser, chat.build_ref), [MAGE4, null, null, null]);
    } finally {
      early.release();
    }

    if (defaults === "supabase") await postflightCatchesEachCondition();
    assert.deepEqual(await failing(POSTFLIGHT), []);
    const { owner, chat } = await legacyAccounts();
    assert.deepEqual(await others(), before, "saving, sharing and deleting change no function, grant or table");

    // Applied a second time, it keeps every order.
    await run(APPLY);
    assert.deepEqual(await failing(POSTFLIGHT), []);
    assert.deepEqual(await orders(owner, chat), [MAGE, MAGE2, ORDER_G, ORDER2]);

    // Rollback: the function goes; the columns, the orders in them and the trigger stay, and the saved-builds checks
    // still read `t`. Only the postflight's rows about save_build_plan fail.
    await run(ROLLBACK);
    assert.deepEqual(await failing(SCHEMA), []);
    assert.deepEqual(await failing(POSTFLIGHT), [
      "save_build_plan is the one function of its name, taking a user and a payload and answering in JSON",
      "both run as their owner with an empty search_path and a 3 s lock wait", "their bodies are the file's, word for word",
      "only service_role may call save_build_plan", "save_build_plan's owner may run save_build and write saved_builds",
    ]);
    assert.deepEqual(await others(), before, "the rollback alters nothing it does not own");
    assert.deepEqual(await orders(owner, chat), [MAGE, MAGE2, ORDER_G, ORDER2]);
    // The site from before this file saves as it did, and the trigger still drops an order whose code it changes.
    assert.equal((await oldSave(owner, { id: chat, name: "Chat build 3", code: MAGE, code2: MAGE }, null)).refusal, null);
    assert.deepEqual(await orders(owner, chat), [MAGE, MAGE, ORDER_G, null]);
    // Applying the file again brings the function back, and every order is still there.
    await run(APPLY);
    assert.deepEqual(await failing(POSTFLIGHT), []);
    assert.equal((await savePlan(owner, edit(chat, { name: "Chat build 3", code2: MAGE2, order2: ORDER2 }))).refusal, null);
    assert.deepEqual(await orders(owner, chat), [MAGE, MAGE2, ORDER_G, ORDER2]);
    assert.deepEqual(await others(), before);
    console.log(`saved build point order integration (${defaults === "none" ? "no default grants" : "Supabase default grants"}): ok`);
  }
} finally {
  await pool.end();
}
