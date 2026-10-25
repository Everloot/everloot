import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

// Disposable local Postgres only. This fixture drops the public schema.
// QUOTA_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/intake_quota_test node scripts/saved-builds.integration.mjs
const url = new URL(process.env.QUOTA_TEST_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Local test database required");
assert.equal(url.pathname, "/intake_quota_test", "Dedicated test database required");
const pool = new pg.Pool({ connectionString: url.toString(), max: 24 });
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
const read = (file) => readFile(new URL(file, dir), "utf8");
const hex = (n) => n.toString(16).padStart(64, "0");
const hash = (token) => createHash("sha256").update(token).digest("hex");

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

const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE_OLD = "EL1-mage-0-1.50.0.1-MTE6NQ";
const WARRIOR = "EL1-warrior-0-1.60.1.70450-MTE6NQ";
let slugs = 0;
const slug = () => `S${String(++slugs).padStart(7, "0")}`;
const save = async (user, fields = {}) => (await service(
  "select * from public.save_build($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
  [user, fields.id ?? null, fields.id ? null : fields.slug ?? slug(), fields.character ?? null, fields.name ?? "Fire", fields.notes ?? null,
    fields.code ?? MAGE, fields.code2 ?? null, fields.shared ?? null, fields.active ?? null, fields.showName ?? null],
))[0];
const character = async (user, fields = {}) => (await service(
  "select * from public.save_build_character($1,$2,$3,$4,$5,$6)",
  [user, fields.id ?? null, fields.name ?? "Jaina", fields.classSlug ?? "mage", fields.realm ?? null, fields.note ?? null],
))[0];
const shared = async (s) => (await service("select * from public.shared_build($1)", [s]))[0] ?? null;
const forKey = async (token) => (await service("select * from public.own_builds_for_key($1)", [hash(token)]))[0];

try {
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
  await pool.query("grant all on schema public to public");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
  }
  await pool.query("alter role service_role bypassrls");
  // Match Supabase's permissive defaults: the migrations must revoke them.
  await pool.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
  await pool.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
  await pool.query("grant usage on schema public to anon, authenticated, service_role");
  for (const file of files) await pool.query(await read(file));
  // Applied twice: the new migration must be safe to re-run.
  await pool.query(await read("20261021150000_saved_builds.sql"));

  const [{ id: owner }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('1', 'Thrall#1') returning id")).rows;
  const [{ id: other }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('2', 'Jaina#2') returning id")).rows;

  // Browser roles can touch nothing; the service role reads but writes only through the functions.
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(asRole(role, "select * from public.saved_builds"), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.build_characters"), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.shared_build('abcdefgh')"), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.own_builds_for_key($1)", [hex(1)]), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.save_build($1,null,'abcdefgh',null,'x',null,$2,null,null,null,null)", [owner, MAGE]), /permission denied/);
  }
  await assert.rejects(service("insert into public.saved_builds (user_id, slug, name, class_slug, code, game_build) values ($1, 'abcdefgh', 'x', 'mage', $2, '1')", [owner, MAGE]), /permission denied/);
  await assert.rejects(service("update public.saved_builds set shared = false"), /permission denied/);
  await assert.rejects(service("select public.take_build_save($1)", [owner]), /permission denied/);

  // Shape: lengths, code, class of the second set.
  await assert.rejects(save(owner, { name: " " }), /Invalid build/);
  await assert.rejects(save(owner, { name: "x".repeat(61) }), /Invalid build/);
  await assert.rejects(save(owner, { notes: "x".repeat(1001) }), /Invalid build/);
  await assert.rejects(save(owner, { code: "EL1-mage-0-1.60-" }), /Invalid build/);
  await assert.rejects(save(owner, { code: "EL1-monk-0-1.60-MTE6NQ" }), /Invalid build/);
  await assert.rejects(save(owner, { code2: WARRIOR }), /Invalid build/);
  await assert.rejects(save(owner, { slug: "short" }), /Invalid slug/);

  // Create, then update in place by id; the class and game build come from the code.
  const made = await save(owner, { name: "  Fire  ", notes: "  ", code2: MAGE_OLD });
  assert.equal(made.refusal, null);
  assert.match(made.build_slug, /^S\d{7}$/);
  const row = (await service("select * from public.saved_builds where id = $1", [made.build_ref]))[0];
  assert.deepEqual([row.name, row.notes, row.class_slug, row.game_build, row.shared, row.show_name, row.active], ["Fire", null, "mage", "1.60.1.70450", true, false, false]);
  const updated = await save(owner, { id: made.build_ref, name: "Frost", code: MAGE_OLD, shared: false });
  assert.deepEqual([updated.build_ref, updated.build_slug, updated.refusal], [made.build_ref, made.build_slug, null]);
  const after = (await service("select * from public.saved_builds where id = $1", [made.build_ref]))[0];
  assert.deepEqual([after.name, after.game_build, after.shared, after.code2], ["Frost", "1.50.0.1", false, null]);
  // A null switch keeps the stored value.
  await save(owner, { id: made.build_ref, name: "Frost" });
  assert.equal((await service("select shared from public.saved_builds where id = $1", [made.build_ref]))[0].shared, false);

  // Ownership: another account's build or character is not found, and nothing changes.
  assert.equal((await save(other, { id: made.build_ref, name: "Mine now" })).refusal, "not_found");
  assert.equal((await service("select name from public.saved_builds where id = $1", [made.build_ref]))[0].name, "Frost");
  assert.equal((await service("select public.delete_build($1,$2) as ok", [other, made.build_ref]))[0].ok, false);
  const jaina = await character(owner, { name: " Jaina ", realm: " ", note: "alt" });
  assert.equal(jaina.refusal, null);
  assert.equal((await save(other, { character: jaina.character_ref })).refusal, "not_found");
  assert.equal((await character(other, { id: jaina.character_ref, name: "Taken" })).refusal, "not_found");
  assert.equal((await service("select public.delete_build_character($1,$2) as ok", [other, jaina.character_ref]))[0].ok, false);
  const label = (await service("select * from public.build_characters where id = $1", [jaina.character_ref]))[0];
  assert.deepEqual([label.name, label.realm, label.note], ["Jaina", null, "alt"]);
  await assert.rejects(character(owner, { name: "x".repeat(25) }), /Invalid character/);
  await assert.rejects(character(owner, { classSlug: "monk" }), /Invalid character/);
  await assert.rejects(character(owner, { realm: "x".repeat(33) }), /Invalid character/);

  // A character takes builds of its own class only, and keeps one active build.
  assert.equal((await save(owner, { character: jaina.character_ref, code: WARRIOR })).refusal, "class_mismatch");
  const one = await save(owner, { character: jaina.character_ref, active: true });
  const two = await save(owner, { character: jaina.character_ref, active: true });
  const actives = await service("select id from public.saved_builds where character_id = $1 and active", [jaina.character_ref]);
  assert.deepEqual(actives.map((r) => r.id), [two.build_ref]);
  await save(owner, { id: one.build_ref, character: jaina.character_ref, active: true });
  assert.deepEqual((await service("select id from public.saved_builds where character_id = $1 and active", [jaina.character_ref])).map((r) => r.id), [one.build_ref]);
  // Moving a build to another character does not take that character's active mark, unless asked.
  const alt = await character(owner, { name: "Alt mage" });
  const altActive = await save(owner, { character: alt.character_ref, active: true });
  const mover = await save(owner, { character: jaina.character_ref, active: true });
  await save(owner, { id: mover.build_ref, character: alt.character_ref });
  const altMarks = await service("select id from public.saved_builds where character_id = $1 and active", [alt.character_ref]);
  assert.deepEqual(altMarks.map((r) => r.id), [altActive.build_ref]);
  await save(owner, { id: mover.build_ref, character: alt.character_ref, active: true });
  assert.deepEqual((await service("select id from public.saved_builds where character_id = $1 and active", [alt.character_ref])).map((r) => r.id), [mover.build_ref]);
  // A null p_active on the same character keeps the mark.
  await save(owner, { id: mover.build_ref, character: alt.character_ref, name: "Renamed" });
  assert.equal((await service("select active from public.saved_builds where id = $1", [mover.build_ref]))[0].active, true);
  await save(owner, { id: one.build_ref, character: jaina.character_ref, active: true });
  // A build without a character is never active.
  const loose = await save(owner, { active: true });
  assert.equal((await service("select active from public.saved_builds where id = $1", [loose.build_ref]))[0].active, false);
  // The class of a character with builds cannot change; its name can.
  assert.equal((await character(owner, { id: jaina.character_ref, classSlug: "warrior" })).refusal, "has_builds");
  assert.equal((await character(owner, { id: jaina.character_ref, name: "Jaina P" })).refusal, null);
  // Deleting the character keeps its builds, with no character and no active mark.
  assert.equal((await service("select public.delete_build_character($1,$2) as ok", [owner, jaina.character_ref]))[0].ok, true);
  const orphans = await service("select character_id, active from public.saved_builds where id = any($1)", [[one.build_ref, two.build_ref]]);
  assert.ok(orphans.every((r) => r.character_id === null && r.active === false));

  // The public read: shared builds only, the owner's name only when chosen, nothing once deleted.
  const open = await save(owner, { name: "Open", notes: "Two sets", code2: MAGE });
  const sharedRow = await shared(open.build_slug);
  assert.deepEqual([sharedRow.name, sharedRow.notes, sharedRow.class_slug, sharedRow.code2, sharedRow.owner_name], ["Open", "Two sets", "mage", MAGE, null]);
  await save(owner, { id: open.build_ref, name: "Open", showName: true });
  assert.equal((await shared(open.build_slug)).owner_name, null, "a BattleTag-derived account name stays private");
  await pool.query("update public.users set battletag = 'Thrall#2' where id = $1", [owner]);
  assert.equal((await shared(open.build_slug)).owner_name, null, "a stale BattleTag in name stays private after a rename");
  await pool.query("update public.users set name = 'Thrall' where id = $1", [owner]);
  assert.equal((await shared(open.build_slug)).owner_name, null, "Battle.net account names are not public profile display names");
  const [{ id: emailOwner }] = (await pool.query("insert into public.users (name,email) values ('Email owner','workspace-fixture@example.invalid') returning id")).rows;
  const emailBuild = await save(emailOwner, { shared: true, showName: true });
  assert.equal((await shared(emailBuild.build_slug)).owner_name, "Email owner");
  await save(emailOwner, { id: emailBuild.build_ref, showName: false });
  assert.equal((await shared(emailBuild.build_slug)).owner_name, null);
  await save(emailOwner, { id: emailBuild.build_ref, showName: true });
  await pool.query("update public.users set bnet_id = '3', battletag = 'Linked#3' where id = $1", [emailOwner]);
  assert.equal((await shared(emailBuild.build_slug)).owner_name, null, "linking Battle.net hides the account name");
  assert.equal(await shared(made.build_slug), null, "an unshared build has no public read");
  assert.equal(await shared("nope"), null);
  assert.equal(await shared("%%%%%%%%"), null);
  assert.equal((await service("select public.delete_build($1,$2) as ok", [owner, open.build_ref]))[0].ok, true);
  assert.equal(await shared(open.build_slug), null, "a deleted build has no public read");
  // A slug already in use is refused, not overwritten, and costs no save.
  const savesBefore = (await pool.query("select count from public.intake_quota_buckets where bucket = $1", [`builds:${other}`])).rows[0]?.count ?? 0;
  assert.equal((await save(other, { slug: made.build_slug })).refusal, "slug_taken");
  const savesAfter = (await pool.query("select count from public.intake_quota_buckets where bucket = $1", [`builds:${other}`])).rows[0]?.count ?? 0;
  assert.equal(savesAfter, savesBefore);

  // Limits: 200 builds and 30 characters per account, 300 saves a day.
  await pool.query("delete from public.saved_builds");
  await pool.query("delete from public.build_characters");
  await pool.query("delete from public.intake_quota_buckets");
  const many = await Promise.all(Array.from({ length: 205 }, () => save(other)));
  assert.equal(many.filter((r) => r.refusal === null).length, 200);
  assert.ok(many.filter((r) => r.refusal !== null).every((r) => r.refusal === "build_limit"));
  const labels = await Promise.all(Array.from({ length: 33 }, (_, i) => character(other, { name: `Alt ${i}` })));
  assert.equal(labels.filter((r) => r.refusal === null).length, 30);
  assert.ok(labels.filter((r) => r.refusal !== null).every((r) => r.refusal === "character_limit"));
  assert.equal((await pool.query("select count from public.intake_quota_buckets where bucket = $1", [`builds:${other}`])).rows[0].count, 230);
  await pool.query("update public.intake_quota_buckets set count = 299 where bucket = $1", [`builds:${other}`]);
  const kept = many.find((r) => r.refusal === null).build_ref;
  assert.equal((await save(other, { id: kept, name: "Last one today" })).refusal, null);
  assert.equal((await save(other, { id: kept, name: "One too many" })).refusal, "daily_limit");
  assert.equal((await character(other, { name: "Late" })).refusal, "character_limit");
  await pool.query("update public.intake_quota_buckets set reset_at = now() - interval '1 second' where bucket = $1", [`builds:${other}`]);
  assert.equal((await save(other, { id: kept, name: "Next day" })).refusal, null);

  // Keys: read:own reads the owner's builds and characters, counted against the hourly allowance.
  const makeKey = async (n, scopes) => (await service(
    scopes ? "select * from public.create_api_key($1,$2,'abcd','',$3)" : "select * from public.create_api_key($1,$2,'abcd','')",
    scopes ? [owner, hash(`evl_${hex(n)}`), scopes] : [owner, hash(`evl_${hex(n)}`)],
  ))[0];
  const publicKey = await makeKey(1);
  assert.deepEqual((await service("select scopes from public.api_keys where id = $1", [publicKey.key_ref]))[0].scopes, ["read:public"]);
  const ownKey = await makeKey(2, ["read:public", "read:own", "read:own"]);
  assert.deepEqual((await service("select scopes from public.api_keys where id = $1", [ownKey.key_ref]))[0].scopes, ["read:own", "read:public"]);
  await assert.rejects(makeKey(3, ["write:own"]), /Invalid scopes/);
  await assert.rejects(makeKey(3, []), /Invalid scopes/);

  const thrall = await character(owner, { name: "Thrall", classSlug: "warrior", realm: "Pioneer" });
  const older = await save(owner, { name: "Older" });
  const newer = await save(owner, { name: "Newer", character: thrall.character_ref, code: WARRIOR, active: true });
  assert.deepEqual(await forKey(`evl_${hex(1)}`), { refusal: "no_scope", retry_after: 0, characters: null, builds: null });
  assert.deepEqual(await forKey(`evl_${hex(9)}`), { refusal: "unknown_key", retry_after: 0, characters: null, builds: null });
  const listed = await forKey(`evl_${hex(2)}`);
  assert.equal(listed.refusal, null);
  assert.deepEqual(listed.characters.map((c) => [c.name, c.class_slug, c.realm]), [["Thrall", "warrior", "Pioneer"]]);
  assert.deepEqual(listed.builds.map((b) => b.id), [newer.build_ref, older.build_ref]);
  assert.deepEqual([listed.builds[0].character_id, listed.builds[0].active, listed.builds[0].code], [thrall.character_ref, true, WARRIOR]);
  assert.ok(listed.builds.every((b) => !JSON.stringify(b).includes(other)));
  const usage = await service("select surface, count::int from public.api_key_usage where key_id = $1", [ownKey.key_ref]);
  assert.deepEqual(usage, [{ surface: "builds", count: 1 }]);
  // A read the data guard already counted (MCP) is not counted twice.
  const bucket = async () => (await pool.query("select count from public.intake_quota_buckets where bucket = $1", [`user:${owner}`])).rows[0].count;
  const counted = await bucket();
  const uncounted = (await service("select * from public.own_builds_for_key($1, false)", [hash(`evl_${hex(2)}`)]))[0];
  assert.equal(uncounted.refusal, null);
  assert.equal(uncounted.builds.length, 2);
  assert.equal(await bucket(), counted);
  assert.deepEqual(await service("select surface, count::int from public.api_key_usage where key_id = $1", [ownKey.key_ref]), usage);
  assert.equal((await service("select * from public.own_builds_for_key($1, false)", [hash(`evl_${hex(1)}`)]))[0].refusal, "no_scope");
  await pool.query("update public.intake_quota_buckets set count = 2000 where bucket = $1", [`user:${owner}`]);
  const limited = await forKey(`evl_${hex(2)}`);
  assert.equal(limited.refusal, "limited");
  assert.ok(limited.retry_after >= 1 && limited.retry_after <= 3600 && limited.builds === null);
  await service("update public.api_keys set revoked_at = now() where id = $1", [ownKey.key_ref]);
  assert.equal((await forKey(`evl_${hex(2)}`)).refusal, "unknown_key");
  await assert.rejects(service("select * from public.own_builds_for_key('nope')"), /Invalid key/);

  // Deleting the account deletes its builds and labels.
  await pool.query("delete from public.users where id = $1", [owner]);
  assert.equal((await pool.query("select count(*)::int as n from public.saved_builds where user_id = $1", [owner])).rows[0].n, 0);
  assert.equal((await pool.query("select count(*)::int as n from public.build_characters where user_id = $1", [owner])).rows[0].n, 0);
  console.log("saved builds integration: ok");
} finally {
  await pool.end();
}
