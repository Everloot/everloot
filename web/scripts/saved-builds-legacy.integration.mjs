import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

// Saved builds on a database where the accounts migration has not run: users has only id, bnet_id, battletag
// and the timestamps, as in production today. Disposable local Postgres only. This fixture drops the public schema.
// createdb -h 127.0.0.1 -U postgres saved_builds_legacy_test
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/saved_builds_legacy_test node scripts/saved-builds-legacy.integration.mjs
const url = new URL(process.env.QUOTA_TEST_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Local test database required");
assert.equal(url.pathname, "/saved_builds_legacy_test", "Dedicated test database required");
const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
const dir = new URL("../../supabase/migrations/", import.meta.url);
const SAVED_BUILDS = "20261021150000_saved_builds.sql";
// Everything saved builds stands on, without the accounts migration.
const files = (await readdir(dir))
  .filter((file) => file.endsWith(".sql") && file < SAVED_BUILDS && file !== "20261020120000_accounts.sql")
  .sort();
const read = (file) => readFile(new URL(file, dir), "utf8");

const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const service = async (query, params = []) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    const result = await client.query(query, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
};
const save = async (user, fields) => (await service(
  "select * from public.save_build($1,$2,$3,null,'Fire',null,$4,null,$5,null,$6)",
  [user, fields.id ?? null, fields.id ? null : fields.slug, MAGE, fields.shared ?? null, fields.showName ?? null],
))[0];
const ownerName = async (slug) => (await service("select * from public.shared_build($1)", [slug]))[0]?.owner_name;
const userColumns = async () => (await pool.query(
  "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'users' order by 1",
)).rows.map((r) => r.column_name);

try {
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
  await pool.query("grant all on schema public to public");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
  }
  await pool.query("alter role service_role bypassrls");
  await pool.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
  await pool.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
  await pool.query("grant usage on schema public to anon, authenticated, service_role");
  for (const file of files) await pool.query(await read(file));
  assert.deepEqual(await userColumns(), ["battletag", "bnet_id", "created_at", "id", "updated_at"]);

  // The migration applies, twice, on the legacy users table.
  await pool.query(await read(SAVED_BUILDS));
  await pool.query(await read(SAVED_BUILDS));
  // The approved workspace can follow without applying accounts, realm or guild migrations.
  await pool.query(await read("20261025191223_chat_workspace.sql"));

  const [{ id: owner }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('1', 'Thrall#1') returning id")).rows;
  const hidden = await save(owner, { slug: "Hidden01", shared: false, showName: true });
  assert.equal(hidden.refusal, null);
  assert.equal((await service("select * from public.shared_build($1)", ["Hidden01"])).length, 0, "a private build has no public read");
  const open = await save(owner, { slug: "Shared01", shared: true });
  assert.equal(open.refusal, null);
  assert.equal(await ownerName("Shared01"), null, "no name unless the owner chose to show it");
  await save(owner, { id: open.build_ref, showName: true });
  assert.equal(await ownerName("Shared01"), null, "a legacy BattleTag must never be published as the owner name");

  // Account names remain private for Battle.net users, even after a rename.
  await pool.query("alter table public.users add column name text");
  await pool.query("update public.users set name = battletag where id = $1", [owner]);
  assert.equal(await ownerName("Shared01"), null, "the accounts migration's BattleTag-derived default must stay private");
  await pool.query("update public.users set battletag = 'Thrall#2' where id = $1", [owner]);
  assert.equal(await ownerName("Shared01"), null, "a stale BattleTag in name must stay private after a rename");
  await pool.query("update public.users set name = 'Thrall' where id = $1", [owner]);
  assert.equal(await ownerName("Shared01"), null, "Battle.net account names are not public profile display names");
  await save(owner, { id: open.build_ref, showName: false });
  assert.equal(await ownerName("Shared01"), null);
  console.log("saved builds legacy users integration: ok");
} finally {
  await pool.end();
}
