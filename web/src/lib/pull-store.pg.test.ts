import { readdir, readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// The pull tables' write and a hide of the same character, from two connections at once, on real Postgres: neither may
// pass the other with the hidden character left stored (supabase/migrations/20261102130000_pull_summaries.sql, the
// lock at its top). Disposable local database only: this drops the public schema.
// PULL_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/pull_summaries_test npx vitest run src/lib/pull-store.pg.test.ts
const databaseUrl = process.env.PULL_TEST_DATABASE_URL;

const pull = (eventId: string, names: string[]) => ({
  installId: "install-1234", eventId, capturedAt: "2026-11-02T12:01:15Z",
  summary: { kind: "pull_summary", encounterId: 1144, name: "Rhahk'zor", instanceMapId: 36, success: true, realm: "Forever Pioneer" },
  members: names.map((name) => ({ name, realm: "Forever Pioneer", class: "MAGE" })),
});

describe.skipIf(!databaseUrl)("pull summaries and hides, two connections at once", () => {
  let admin: Pool;
  let upload: PoolClient;
  let hide: PoolClient;

  beforeAll(async () => {
    const url = new URL(databaseUrl ?? "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local test database required");
    if (url.pathname !== "/pull_summaries_test") throw new Error("Dedicated test database required");
    admin = new Pool({ connectionString: url.toString(), max: 3 });
    // The same start as auth.pg.test.ts: an empty schema, Supabase's roles and defaults, every migration.
    await admin.query("drop schema public cascade");
    await admin.query("create schema public");
    await admin.query("grant all on schema public to public");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
    }
    await admin.query("alter role service_role bypassrls");
    await admin.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    await admin.query((await Promise.all(files.map((file) => readFile(new URL(file, dir), "utf8")))).join("\n"));
    upload = await admin.connect();
    hide = await admin.connect();
  });

  afterAll(async () => {
    upload?.release();
    hide?.release();
    await admin?.end();
  });

  /** Waits, up to five seconds, until a session waits on an advisory lock; false if none does. */
  async function someoneWaits(): Promise<boolean> {
    for (let i = 0; i < 50; i++) {
      const { rows } = await admin.query("select 1 from pg_locks where locktype = 'advisory' and not granted");
      if (rows.length) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }
  const members = async () => (await admin.query("select name_key from public.pull_members order by name_key")).rows.map((r) => r.name_key);

  test("a hide made while an upload of the character is still open deletes the member once the upload commits", async () => {
    await upload.query("begin");
    await upload.query("select public.insert_pull_summaries($1::jsonb)", [JSON.stringify([pull("race:1", ["Racer", "Bystander"])])]);
    // A verified owner's opt-out: a direct insert, in another connection, with the realm only lower-cased.
    const hidden = hide.query("insert into public.character_suppressions (realm, character) values ('forever-pioneer', 'racer')");
    const waited = await someoneWaits();
    await upload.query("commit");
    await hidden;
    expect(await members()).toEqual(["bystander"]);
    expect(waited).toBe(true);
  });

  test("an upload made while a hide of the character is still open leaves the member out once the hide commits", async () => {
    await hide.query("begin");
    await hide.query("select public.suppress_player('Forever Pioneer', 'Sneaky')");
    const written = upload.query("select public.insert_pull_summaries($1::jsonb) as n", [JSON.stringify([pull("race:2", ["Sneaky", "Onlooker"])])]);
    const waited = await someoneWaits();
    await hide.query("commit");
    expect((await written).rows[0].n).toBe(1);
    expect(await members()).toEqual(["bystander", "onlooker"]);
    expect(waited).toBe(true);
  });

  test("a second upload of the same characters waits for the first, then finishes", async () => {
    await upload.query("begin");
    await upload.query("select public.insert_pull_summaries($1::jsonb)", [JSON.stringify([pull("order:1", ["Alpha"]), pull("order:2", ["Omega"])])]);
    const other = hide.query("select public.insert_pull_summaries($1::jsonb) as n", [JSON.stringify([pull("order:3", ["Omega"]), pull("order:4", ["Alpha"])])]);
    await upload.query("commit");
    expect((await other).rows[0].n).toBe(2);
    expect((await admin.query("select count(*)::int as n from public.pull_summaries where event_id like 'order:%'")).rows[0].n).toBe(4);
  });
});
