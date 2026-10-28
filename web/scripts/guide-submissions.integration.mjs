import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

// Community guide drafts on the schema production runs: Battle.net users without the accounts v2 columns, the production
// chain and the profiles file, then the preflight, apply, postflight, reviewer, backup and rollback in
// docs/2026-10-27-guide-submissions-activation.md exactly as written, once with Supabase's old default grants and once
// with none (its default from 2026-10-30). Ownership, grants, limits, revisions kept as they were sent, data kept to what
// the owner typed, and applying twice. Disposable local Postgres only: this fixture drops the public schema.
// docker run -d --name guide-submissions-test -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54421:5432 postgres:17
// docker exec guide-submissions-test createdb -h 127.0.0.1 -U postgres guide_submissions_test
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54421/guide_submissions_test node scripts/guide-submissions.integration.mjs
const DATABASE = "guide_submissions_test";
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
// What production has applied, in its order (as in account-profiles-legacy.integration.mjs), then the profiles file: a
// guide names its author by handle. Never accounts v2, never the saved-builds file from before #450.
const CHAIN = [
  "20261003000000_auth_schema.sql", "20261004000000_uploads_waitlist.sql", "20261007070647_verified_publication.sql",
  "20261007220000_intake_quotas.sql", "20261010120000_mcp_quota_scope.sql", "20261018120000_usage_counters.sql",
  "20261019120000_data_guard.sql", "20261021130000_players.sql", "20261021150000_saved_builds.sql",
  "20261025191223_chat_workspace.sql", "20261022160000_players_realm_key.sql", "20261025120000_guilds.sql",
  "20261021170000_account_profiles.sql",
];
const migration = (await read("20261027140000_guide_submissions.sql")).replace(/\r\n/g, "\n");
const TABLES = ["guide_moderators", "guide_submission_revisions", "guide_submissions"];
const SITE_FUNCTIONS = ["save_guide_draft", "submit_guide", "withdraw_guide"];
const FUNCTIONS = [...SITE_FUNCTIONS, "guide_draft_row", "guide_revision_is_kept", "take_guide_count"].sort();

// The runbook's SQL, run as written.
const doc = (await readFile(new URL("../../docs/2026-10-27-guide-submissions-activation.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const block = (name) => {
  const found = doc.match(new RegExp("```sql\\n(-- " + name + "\\n[\\s\\S]*?)```"));
  assert.ok(found, `No ${name} block in the runbook`);
  return found[1];
};
const PASTE = /^-- paste supabase\/migrations\/20261027140000_guide_submissions\.sql here, unchanged$/m;
assert.match(block("apply"), PASTE);
// A function, not a string: the file's $$ would read as a replacement pattern.
const APPLY = block("apply").replace(PASTE, () => migration);
const [PREFLIGHT, POSTFLIGHT, BACKUP, ROLLBACK, MODERATOR] = ["preflight", "postflight", "backup", "rollback", "moderator"].map(block);
const ACCOUNT = /'<the verified account id>'/g;
assert.match(MODERATOR, ACCOUNT);
// The file's closing comment gives the same rollback, for anyone who reads the migration alone.
const statements = (sql) => sql.split("\n").filter((l) => l && !l.startsWith("--") && !/^(begin|commit);$/.test(l) && !l.startsWith("set local "));
const commented = migration.slice(migration.indexOf("\n-- Rollback")).split("\n").filter((l) => l.startsWith("--   ")).map((l) => l.slice(5));
assert.deepEqual(statements(ROLLBACK), commented, "the runbook's rollback is the one the file's comment gives");

/** The names of the rows that are not `t`. */
const failing = async (sql, db = pool) => (await db.query(sql)).rows.filter((r) => r.ok !== true).map((r) => r.check_name);

const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const WARRIOR = "EL1-warrior-0-1.60.1.70450-MTE6NQ";
const PLANNED = "O1p-AAAAAF";
const PROVISIONAL = "O1g-AAAAAF";
const SOURCE = { title: "Blizzard's announcement", url: "https://worldofwarcraft.blizzard.com/en-us/news/24302498", checkedOn: "2026-10-19" };
// A draft as the server sends it (GuideDraft in web/src/lib/guide-submissions.ts).
const DRAFT = {
  title: "Frost leveling", summary: "A plan for leveling a mage on your own.", classSlug: "mage", activity: "leveling",
  roles: ["damage"], levels: { from: 10, to: 60 }, code: MAGE, order: PLANNED, code2: null, order2: null,
  sources: [SOURCE], body: "## Who it is for\n\nPlayers who level alone.",
};

/** A script on one connection, as the SQL editor runs it; a failure leaves no transaction open. Its last result's rows. */
async function run(sql) {
  const client = await pool.connect();
  try {
    const results = [await client.query(sql)].flat();
    return results.filter((r) => r.command === "SELECT").at(-1)?.rows ?? [];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
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

// The calls the site makes through PostgREST (web/src/lib/guide-submissions.ts): named arguments, the payload as JSON.
const save = async (user, guide, payload) => (await service(
  "select public.save_guide_draft(p_user_id => $1, p_guide_id => $2, p_payload => $3) as r", [user, guide, JSON.stringify(payload)]))[0].r;
const submit = async (user, guide, payload, alias) => (await service(
  "select public.submit_guide(p_user_id => $1, p_guide_id => $2, p_payload => $3, p_alias => $4) as r", [user, guide, JSON.stringify(payload), alias]))[0].r;
const withdraw = async (user, guide, revision) => (await service(
  "select public.withdraw_guide(p_user_id => $1, p_guide_id => $2, p_revision => $3) as r", [user, guide, revision]))[0].r;
// The site's reads, as the service role, always for one account.
const revisions = async (guide) => (await service(
  "select revision, status, title, summary, class_slug, roles, level_from, level_to, code, point_order, code2, point_order2, sources, body,"
    + " author_handle, submitted_at is not null as submitted, withdrawn_at is not null as withdrawn"
    + " from public.guide_submission_revisions where guide_id = $1 order by revision desc", [guide]));
const count = async (sql, params = []) => (await pool.query(sql, params)).rows[0].n;
const bucket = async (name) => (await pool.query("select count from public.intake_quota_buckets where bucket = $1", [name])).rows[0]?.count ?? 0;
const profileRow = async (user) => (await pool.query("select * from public.user_profiles where user_id = $1", [user])).rows[0] ?? null;

/** Everything in public that is not the migration's: function bodies, settings and grants; tables; policies. */
const others = async () => (await pool.query(`
  select format('function %s %s %s %s %s', p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.proconfig, p.proacl) as item
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname::text <> all ($1::text[])
  union all
  select format('table %s %s %s %s', c.oid::regclass, c.relrowsecurity, c.relacl,
      (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
         from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped))
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and c.relname::text <> all ($2::text[])
  union all
  select format('policy %s %s', tablename, policyname) from pg_policies where schemaname = 'public'
  order by 1`, [FUNCTIONS, TABLES])).rows.map((r) => r.item);

/** The migration's own objects: row security on and nothing for the browser roles; definer functions with an empty
 *  search path and a lock timeout, the site's three callable by the service role alone. */
async function postflight() {
  const tables = (await pool.query(`
    select c.relname as name, c.relrowsecurity as rls,
      has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger') as anon,
      has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger') as authenticated,
      has_table_privilege('service_role', c.oid, 'select') as service_reads,
      has_table_privilege('service_role', c.oid, 'insert, update, delete, truncate, references, trigger') as service_writes
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any ($1::text[]) order by 1`, [TABLES])).rows;
  assert.deepEqual(tables, TABLES.map((name) => ({ name, rls: true, anon: false, authenticated: false, service_reads: true, service_writes: false })));
  assert.equal(await count("select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = any ($1::text[])", [TABLES]), 0);
  const functions = (await pool.query(`
    select p.proname as name, p.prosecdef as definer, p.proconfig as config,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
      has_function_privilege('service_role', p.oid, 'execute') as service
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any ($1::text[]) order by 1, 2`, [FUNCTIONS])).rows;
  assert.deepEqual(functions, FUNCTIONS.map((name) => ({
    name, definer: true, config: ['search_path=""', "lock_timeout=3s"], anon: false, authenticated: false, service: SITE_FUNCTIONS.includes(name),
  })));
}

const ROLES = ["anon", "authenticated", "service_role"];
async function legacySchema(defaults) {
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
  for (const role of ROLES) {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
  }
  await pool.query("alter role service_role bypassrls");
  await pool.query("grant usage on schema public to anon, authenticated, service_role");
  // Production's tables were made under Supabase's old defaults, which grant every new table and function to the API
  // roles; each migration revokes what it must.
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

async function needsProfilesFirst() {
  await rolledBack(async (db) => {
    await db.query("drop table public.user_profiles cascade");
    await assert.rejects(db.query(migration), /Apply 20261021170000_account_profiles\.sql first/);
  });
}

async function preflightCatchesEachCondition() {
  const only = async (setup) => rolledBack(async (db) => { await db.query(setup); return failing(PREFLIGHT, db); });
  assert.deepEqual(await only("drop table public.user_profiles cascade"),
    ["user_profiles is there, with the handle a guide names its author by", "service_role reads users, sessions and user_profiles"]);
  assert.deepEqual(await only("insert into public.intake_quota_buckets values ('guide_saves:00000000-0000-4000-8000-000000000000', 1, now())"),
    ["no guide counters from an earlier attempt"]);
  assert.deepEqual(await only("create table public.guide_moderators (user_id uuid)"), ["none of the three tables exists yet"]);
  assert.deepEqual(await only("revoke select on public.sessions from service_role"), ["service_role reads users, sessions and user_profiles"]);
  const reordered = "alter table public.intake_quota_buckets rename to intake_quota_buckets_kept; "
    + "create table public.intake_quota_buckets (bucket text primary key, reset_at timestamptz not null, count integer not null)";
  assert.deepEqual(await only(reordered), ["intake_quota_buckets is bucket, count, reset_at in that order, keyed by bucket"]);

  // Another function by one of the names: the migration applies beside it and PostgREST sees two.
  const collision = "create function public.submit_guide(p_text text) returns void language sql as ''";
  assert.deepEqual(await only(collision), ["no function has any of the six names"]);
  assert.deepEqual(await rolledBack(async (db) => { await db.query(collision); await db.query(migration); return failing(POSTFLIGHT, db); }), [
    "the six functions, one signature each", "each runs as its owner with an empty search_path and a lock timeout",
    "only service_role may call the three site functions",
  ]);
  // Each other postflight row on its own, after the migration as it is.
  const after = async (change) => rolledBack(async (db) => {
    await db.query(migration);
    assert.deepEqual(await failing(POSTFLIGHT, db), []);
    await db.query(change);
    return failing(POSTFLIGHT, db);
  });
  // A definer function with no settings left: its proconfig is NULL, which an aggregate would skip.
  assert.deepEqual(await after("alter function public.withdraw_guide(uuid, uuid, integer) reset all"),
    ["each runs as its owner with an empty search_path and a lock timeout"]);
  assert.deepEqual(await after("grant select on public.guide_submission_revisions to anon"), ["anon and authenticated have nothing on the three"]);
  assert.deepEqual(await after("grant execute on function public.guide_draft_row(jsonb) to service_role"), ["nobody may call the other three directly"]);
  assert.deepEqual(await after("alter table public.guide_submission_revisions disable trigger guide_submission_revisions_kept"),
    ["a sent revision is kept as it was: the trigger is on, before update or delete"]);
  assert.deepEqual(await after("drop index public.guide_moderators_one"), ["guide_moderators holds one account at most"]);
  assert.deepEqual(await after("alter table public.guide_moderators disable row level security"), ["row level security is on for the three, with no policies"]);
}

async function heldLockChangesNothing() {
  // A sign-in in progress holds a row-exclusive lock on users until it commits; the new foreign keys need to wait for
  // it. The apply gives up after its lock timeout and leaves nothing behind.
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
    for (const table of TABLES) await assert.rejects(asRole(role, `select * from public.${table}`), /permission denied/, `${role} ${table}`);
    await assert.rejects(asRole(role, "select public.save_guide_draft($1, null, $2)", [user, JSON.stringify(DRAFT)]), /permission denied/);
    await assert.rejects(asRole(role, "select public.submit_guide($1, $1, $2, 'thrall')", [user, JSON.stringify(DRAFT)]), /permission denied/);
    await assert.rejects(asRole(role, "select public.withdraw_guide($1, $1, 1)", [user]), /permission denied/);
  }
  // The server reads; it writes only through the functions, which hold the owner and the limits.
  for (const table of TABLES) {
    await assert.rejects(service(`insert into public.${table} (user_id) values ($1)`, [user]), /permission denied/, table);
    await assert.rejects(service(`update public.${table} set user_id = user_id`), /permission denied/, table);
    await assert.rejects(service(`delete from public.${table}`), /permission denied/, table);
  }
  await assert.rejects(service("select public.take_guide_count('guide_saves:x', 1)"), /permission denied/);
  await assert.rejects(service("select public.guide_draft_row($1)", [JSON.stringify(DRAFT)]), /permission denied/);
}

async function eachDraftHasOneOwner(owner, other) {
  const made = await save(owner, null, DRAFT);
  assert.deepEqual(Object.keys(made).sort(), ["created", "guide_ref", "refusal", "revision"]);
  assert.deepEqual([made.revision, made.created, made.refusal], [1, true, null]);
  const guide = made.guide_ref;
  assert.deepEqual(await save(owner, guide, { ...DRAFT, title: "Frost leveling, first words" }), { guide_ref: guide, revision: 1, created: false, refusal: null });
  assert.equal(await count("select count(*)::int as n from public.guide_submissions where user_id = $1", [owner]), 1);
  assert.deepEqual((await revisions(guide)).map((r) => [r.revision, r.status, r.title, r.author_handle]), [[1, "draft", "Frost leveling, first words", null]]);

  // Another account cannot read, change, submit or withdraw it: to them it is not there.
  const before = await revisions(guide);
  assert.equal((await save(other, guide, DRAFT)).refusal, "not_found");
  assert.equal((await submit(other, guide, DRAFT, "jaina")).refusal, "not_found");
  assert.equal((await withdraw(other, guide, 1)).refusal, "not_found");
  assert.deepEqual(await revisions(guide), before);

  // Owner, status, review and moderator fields, any other shape, an unknown account: refused, nothing written.
  const forged = [{ user_id: other }, { userId: other }, { status: "published" }, { reviewed: { by: "Carlos" } }, { author: "carlos" }, { moderator: true }, { revision: 7 }];
  for (const field of forged) {
    await assert.rejects(save(owner, guide, { ...DRAFT, ...field }), /Invalid guide/, JSON.stringify(field));
    await assert.rejects(submit(owner, guide, { ...DRAFT, ...field }, "thrall"), /Invalid guide/, JSON.stringify(field));
  }
  const { body: _body, ...withoutBody } = DRAFT;
  const shapes = [
    withoutBody, { ...DRAFT, roles: "damage" }, { ...DRAFT, roles: ["damage", "damage"] }, { ...DRAFT, roles: ["dps"] },
    { ...DRAFT, levels: { from: 10 } }, { ...DRAFT, levels: { from: "10", to: 60 } }, { ...DRAFT, levels: { from: 10, to: 60.5 } },
    { ...DRAFT, levels: { from: 0, to: 60 } }, { ...DRAFT, title: "" }, { ...DRAFT, title: "x".repeat(91) }, { ...DRAFT, title: "a\u0007b" },
    { ...DRAFT, summary: "x".repeat(301) }, { ...DRAFT, body: "x".repeat(20_001) }, { ...DRAFT, body: "tab\there" },
    { ...DRAFT, classSlug: "deathknight" }, { ...DRAFT, activity: "pvp" }, { ...DRAFT, code: "EL1-nope" }, { ...DRAFT, order: "O1x-A" },
    { ...DRAFT, code: null, order: PLANNED }, { ...DRAFT, order2: PLANNED }, { ...DRAFT, title: 5 },
    { ...DRAFT, sources: [{ ...SOURCE, url: "javascript:alert(1)" }] }, { ...DRAFT, sources: [{ ...SOURCE, url: "http://news.blizzard.com/x" }] },
    { ...DRAFT, sources: [{ ...SOURCE, url: "https://user@news.blizzard.com/x" }] }, { ...DRAFT, sources: [{ ...SOURCE, checkedOn: "2026-02-30" }] },
    { ...DRAFT, sources: [{ ...SOURCE, extra: 1 }] }, { ...DRAFT, sources: [{ ...SOURCE, title: " " }] }, { ...DRAFT, sources: ["https://news.blizzard.com/x"] },
    { ...DRAFT, sources: Array.from({ length: 21 }, () => SOURCE) }, "a draft", [DRAFT],
  ];
  for (const payload of shapes) await assert.rejects(save(owner, guide, payload), /Invalid guide/, JSON.stringify(payload).slice(0, 80));
  await assert.rejects(save("00000000-0000-4000-8000-000000000000", null, DRAFT), /Unknown user/);
  assert.deepEqual(await revisions(guide), before);
  return guide;
}

async function submittedRevisionsAreKept(owner, other, guide) {
  // A handle is required, and the name is the one the owner saw: never the BattleTag.
  const theirs = (await save(other, null, DRAFT)).guide_ref;
  assert.equal((await submit(other, theirs, DRAFT, "jaina")).refusal, "needs_handle");
  for (const alias of ["Thrall#1234", "THRALL", "thrall-2"]) assert.equal((await submit(owner, guide, DRAFT, alias)).refusal, "alias_changed", alias);
  const profile = await profileRow(owner);
  assert.deepEqual(await submit(owner, guide, DRAFT, "thrall"), { guide_ref: guide, revision: 1, refusal: null });
  // What was submitted is the payload, frozen, under the handle the owner saw.
  const [kept] = await revisions(guide);
  assert.deepEqual([kept.revision, kept.status, kept.title, kept.author_handle, kept.submitted, kept.withdrawn], [1, "submitted", "Frost leveling", "thrall", true, false]);
  assert.deepEqual(kept.sources, [SOURCE]);
  // Submitting opts nothing in: the private profile is exactly as it was.
  assert.deepEqual(await profileRow(owner), profile);
  assert.equal(profile.public_profile, false);

  // Kept as it was sent: its words never change, it never goes back to draft, and it is never deleted on its own.
  const at = "where guide_id = $1 and revision = 1";
  for (const change of ["title = 'Changed'", "body = ''", "sources = '[]'", "author_handle = 'jaina'", "point_order = null", "status = 'draft'",
    "submitted_at = now() - interval '1 day'", "revision = 9", "created_at = now()"]) {
    await assert.rejects(pool.query(`update public.guide_submission_revisions set ${change} ${at}`, [guide]), /kept as it was sent/, change);
  }
  await assert.rejects(pool.query(`delete from public.guide_submission_revisions ${at}`, [guide]), /kept as it was sent/);
  // Its status moves (review, later, is a status), and nothing else does.
  await rolledBack(async (db) => { await db.query(`update public.guide_submission_revisions set status = 'approved', updated_at = now() ${at}`, [guide]); });

  // Edited after submitting: the next revision is a new draft, and the submitted one stays as it was.
  assert.deepEqual(await save(owner, guide, { ...DRAFT, title: "Frost leveling, revised" }), { guide_ref: guide, revision: 2, created: false, refusal: null });
  assert.deepEqual((await revisions(guide)).map((r) => [r.revision, r.status, r.title]), [[2, "draft", "Frost leveling, revised"], [1, "submitted", "Frost leveling"]]);
  // One revision waits for review at a time.
  assert.equal((await submit(owner, guide, { ...DRAFT, title: "Frost leveling, revised" }, "thrall")).refusal, "already_submitted");
  // Withdrawn by its owner, once; a draft is not waiting.
  assert.deepEqual(await withdraw(owner, guide, 1), { guide_ref: guide, revision: 1, refusal: null });
  assert.equal((await withdraw(owner, guide, 1)).refusal, "not_submitted");
  assert.equal((await withdraw(owner, guide, 2)).refusal, "not_submitted");
  assert.equal((await withdraw(owner, guide, 9)).refusal, "not_submitted");
  const withdrawn = (await revisions(guide)).find((r) => r.revision === 1);
  assert.deepEqual([withdrawn.status, withdrawn.title, withdrawn.author_handle, withdrawn.withdrawn], ["withdrawn", "Frost leveling", "thrall", true]);
  assert.deepEqual(await submit(owner, guide, { ...DRAFT, title: "Frost leveling, revised" }, "thrall"), { guide_ref: guide, revision: 2, refusal: null });
  // With no draft saved, a submission is the next revision.
  assert.deepEqual(await withdraw(owner, guide, 2), { guide_ref: guide, revision: 2, refusal: null });
  assert.deepEqual(await submit(owner, guide, DRAFT, "thrall"), { guide_ref: guide, revision: 3, refusal: null });
  assert.deepEqual((await revisions(guide)).map((r) => [r.revision, r.status]), [[3, "submitted"], [2, "withdrawn"], [1, "withdrawn"]]);

  // The database's floor under the server's guide check: complete, planned orders, the class's own codes, Blizzard's posts.
  const next = (await save(owner, null, DRAFT)).guide_ref;
  const unfinished = [
    { order: PROVISIONAL }, { code2: MAGE, order2: PROVISIONAL }, { code: WARRIOR, order: null }, { code2: WARRIOR }, { classSlug: null },
    { activity: null }, { roles: [] }, { levels: null }, { code: null, order: null }, { summary: "" }, { body: " \n " },
    { sources: [{ ...SOURCE, url: "https://www.example.com/guides/frost" }] }, { sources: [{ ...SOURCE, url: "https://news.blizzard.com.evil.example/x" }] },
  ];
  for (const change of unfinished) assert.equal((await submit(owner, next, { ...DRAFT, ...change }, "thrall")).refusal, "incomplete", JSON.stringify(change));
  assert.deepEqual((await revisions(next)).map((r) => [r.revision, r.status]), [[1, "draft"]]);
  return next;
}

async function limitsAreTheDatabases(owner, guide, next) {
  // 300 draft saves a day: the 300th is saved, the 301st refused with nothing written.
  const saves = `guide_saves:${owner}`;
  await pool.query("update public.intake_quota_buckets set count = 299 where bucket = $1", [saves]);
  assert.equal((await save(owner, next, { ...DRAFT, title: "The day's last save" })).refusal, null);
  const counted = await revisions(next);
  assert.equal((await save(owner, next, { ...DRAFT, title: "Over" })).refusal, "daily_limit");
  assert.deepEqual(await revisions(next), counted);
  assert.equal(await bucket(saves), 300);
  // A save that raises is rolled back whole, its count included.
  await pool.query("update public.intake_quota_buckets set count = 5 where bucket = $1", [saves]);
  await assert.rejects(save(owner, next, { ...DRAFT, roles: ["dps"] }), /Invalid guide/);
  assert.equal(await bucket(saves), 5);
  // A day later the count starts again.
  await pool.query("update public.intake_quota_buckets set count = 300, reset_at = now() - interval '1 second' where bucket = $1", [saves]);
  assert.equal((await save(owner, next, DRAFT)).refusal, null);
  assert.equal(await bucket(saves), 1);

  // 10 submissions a day.
  const submits = `guide_submits:${owner}`;
  await pool.query("update public.intake_quota_buckets set count = 9 where bucket = $1", [submits]);
  assert.deepEqual(await submit(owner, next, DRAFT, "thrall"), { guide_ref: next, revision: 1, refusal: null });
  assert.equal((await withdraw(owner, next, 1)).refusal, null);
  const before = await revisions(next);
  assert.equal((await submit(owner, next, DRAFT, "thrall")).refusal, "submit_limit");
  assert.deepEqual(await revisions(next), before);
  assert.equal(await bucket(submits), 10);

  // 20 guides an account.
  const have = await count("select count(*)::int as n from public.guide_submissions where user_id = $1", [owner]);
  for (let i = have; i < 20; i++) assert.equal((await save(owner, null, { ...DRAFT, title: `Guide ${i + 1}` })).refusal, null);
  assert.deepEqual(await save(owner, null, DRAFT), { guide_ref: null, revision: null, refusal: "guide_limit" });
  assert.equal(await count("select count(*)::int as n from public.guide_submissions where user_id = $1", [owner]), 20);

  // 100 revisions a guide.
  await pool.query(`insert into public.guide_submission_revisions (guide_id, revision, user_id, status, title, author_handle, submitted_at, withdrawn_at)
    select $1, n, $2, 'withdrawn', 'Old revision', 'thrall', now(), now() from generate_series(4, 100) n`, [guide, owner]);
  assert.equal((await withdraw(owner, guide, 3)).refusal, null);
  assert.deepEqual(await save(owner, guide, DRAFT), { guide_ref: null, revision: null, refusal: "revision_limit" });
  assert.deepEqual(await submit(owner, guide, DRAFT, "thrall"), { guide_ref: null, revision: null, refusal: "revision_limit" });
  assert.equal(await count("select max(revision)::int as n from public.guide_submission_revisions where guide_id = $1", [guide]), 100);
}

async function onlyWhatTheOwnerTyped(owner) {
  const columns = async (table) => (await pool.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [table],
  )).rows.map((r) => r.column_name);
  assert.deepEqual(await columns("guide_submissions"), ["id", "user_id", "created_at", "updated_at"]);
  assert.deepEqual(await columns("guide_submission_revisions"), [
    "guide_id", "revision", "user_id", "status", "title", "summary", "class_slug", "activity", "roles", "level_from", "level_to",
    "code", "point_order", "code2", "point_order2", "sources", "body", "author_handle", "created_at", "updated_at", "submitted_at", "withdrawn_at",
  ]);
  assert.deepEqual(await columns("guide_moderators"), ["user_id", "granted_at", "note"]);
  // Nothing of the account but its id: no BattleTag, no Battle.net id, no address, anywhere in the guide tables.
  const stored = JSON.stringify((await pool.query(`
    select jsonb_agg(to_jsonb(r)) as rows from (
      select to_jsonb(g) as row from public.guide_submissions g
      union all select to_jsonb(v) from public.guide_submission_revisions v
      union all select to_jsonb(m) from public.guide_moderators m) r`)).rows);
  for (const hidden of ["Thrall#1234", "bnet-87017", "Jaina#2002", "bnet-87018"]) assert.ok(!stored.includes(hidden), hidden);
  assert.ok(stored.includes(owner));
}

async function carlosAloneUntilHeNamesOthers(owner, other) {
  // Applied, the table is empty: nobody can review until the operator adds Carlos's account by hand, with the runbook's
  // block. Unedited, the block stops at its placeholder; an id that is no account adds nobody.
  assert.equal(await count("select count(*)::int as n from public.guide_moderators"), 0);
  await assert.rejects(run(MODERATOR), /invalid input syntax for type uuid/);
  const reviewer = (id) => run(MODERATOR.replace(ACCOUNT, `'${id}'`));
  assert.deepEqual(await reviewer("00000000-0000-4000-8000-000000000000"), [{ one_moderator: false, that_account: null }]);
  assert.deepEqual(await reviewer(owner), [{ one_moderator: true, that_account: true }]);
  // A second account is refused while Carlos is the only reviewer, and the first stays.
  await assert.rejects(reviewer(other), /guide_moderators_one/);
  assert.deepEqual(await service("select user_id, note from public.guide_moderators"), [{ user_id: owner, note: "Carlos, the owner" }]);
  assert.deepEqual(await failing(POSTFLIGHT), []);
}

async function backupHoldsEveryRow() {
  const [{ backup }] = await run(BACKUP);
  for (const [key, table] of [["guides", "guide_submissions"], ["revisions", "guide_submission_revisions"], ["moderators", "guide_moderators"]]) {
    const n = await count(`select count(*)::int as n from public.${table}`);
    assert.ok(n > 0, table);
    assert.equal(backup[key].length, n, key);
  }
}

async function deletionsCascade(owner, other, guide) {
  // A guide's or an account's deletion removes its revisions, submitted ones included; nothing else does.
  const theirs = (await pool.query("select id from public.guide_submissions where user_id = $1", [other])).rows.map((r) => r.id);
  assert.equal(theirs.length, 1);
  await pool.query("delete from public.guide_submissions where id = $1", [theirs[0]]);
  assert.equal(await count("select count(*)::int as n from public.guide_submission_revisions where user_id = $1", [other]), 0);
  assert.ok(await count("select count(*)::int as n from public.guide_submission_revisions where guide_id = $1 and status <> 'draft'", [guide]) > 0);
  await pool.query("delete from public.guide_submissions where id = $1", [guide]);
  assert.equal(await count("select count(*)::int as n from public.guide_submission_revisions where guide_id = $1", [guide]), 0);
  assert.ok(await count("select count(*)::int as n from public.guide_submission_revisions where user_id = $1 and status <> 'draft'", [owner]) > 0);
  await pool.query("delete from public.users where id = $1", [owner]);
  for (const table of TABLES) assert.equal(await count(`select count(*)::int as n from public.${table} where user_id = $1`, [owner]), 0, table);
}

try {
  const [{ database }] = (await pool.query("select current_database() as database")).rows;
  assert.equal(database, DATABASE, "Connected to the dedicated test database");
  for (const defaults of ["supabase", "none"]) {
    await legacySchema(defaults);
    const before = await others();
    assert.deepEqual(await failing(PREFLIGHT), []);
    if (defaults === "supabase") {
      await needsProfilesFirst();
      await preflightCatchesEachCondition();
      await heldLockChangesNothing();
    }
    assert.deepEqual(await others(), before);

    await run(APPLY);
    assert.deepEqual(await failing(POSTFLIGHT), []);
    await postflight();
    assert.deepEqual(await others(), before, "the migration alters nothing it does not own");
    const user = async (bnet, tag) => (await pool.query("insert into public.users (bnet_id, battletag) values ($1, $2) returning id", [bnet, tag])).rows[0].id;
    const owner = await user("bnet-87017", "Thrall#1234");
    const other = await user("bnet-87018", "Jaina#2002");
    assert.equal((await service("select * from public.save_profile($1, 'thrall', null, false, true, true, true)", [owner]))[0].refusal, null);
    await browserRolesAndDirectWritesAreRefused(owner);
    const guide = await eachDraftHasOneOwner(owner, other);
    const next = await submittedRevisionsAreKept(owner, other, guide);
    await limitsAreTheDatabases(owner, guide, next);
    await carlosAloneUntilHeNamesOthers(owner, other);
    await onlyWhatTheOwnerTyped(owner);
    await backupHoldsEveryRow();

    // Applied a second time, it keeps every draft and revision, and the reviewer.
    const kept = await count("select count(*)::int as n from public.guide_submission_revisions");
    await run(APPLY);
    assert.deepEqual(await failing(POSTFLIGHT), []);
    await postflight();
    assert.equal(await count("select count(*)::int as n from public.guide_submission_revisions"), kept);
    assert.equal(await count("select count(*)::int as n from public.guide_moderators"), 1);
    await deletionsCascade(owner, other, guide);

    assert.ok(await count("select count(*)::int as n from public.intake_quota_buckets where bucket like 'guide\\_%'") >= 3);
    await run(ROLLBACK);
    assert.deepEqual(await failing(PREFLIGHT), [], "the rollback returns to the schema before the apply");
    assert.deepEqual(await others(), before);
    assert.equal(await count("select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relname = any ($1::text[])", [TABLES]), 0);
    assert.equal(await count("select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname = any ($1::text[])", [FUNCTIONS]), 0);
    assert.equal(await count("select count(*)::int as n from public.intake_quota_buckets where bucket like 'guide\\_%'"), 0);
    // The account and its profile belong to the files before and stay.
    assert.equal(await count("select count(*)::int as n from public.users where id = $1", [other]), 1);
    assert.equal((await service("select * from public.save_profile($1, 'jaina', null, false, true, true, true)", [other]))[0].refusal, null);
    console.log(`guide submissions integration (${defaults === "none" ? "no default grants" : "Supabase default grants"}): ok`);
  }
} finally {
  await pool.end();
}
