import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("armory profile migration and behavior on a disposable PostgreSQL database", async () => {
  const db = new PGlite();
  const read = (path: string) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), "utf8");
  try {
    // Unrelated prerequisite tables are minimal; character-link/public-reader and armory SQL are real.
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.users(id uuid primary key);
      create table public.character_suppressions(realm text,character text);
      create table public.intake_quota_buckets(bucket text primary key,count int,reset_at timestamptz);
      create function public.create_api_key(uuid,text,text,text,text[]) returns text language sql as 'select null::text';`);
    const links = read("migrations/20261021190000_character_links.sql");
    await db.exec(links.slice(0, links.indexOf("alter table public.api_keys")));
    for (const migration of ["20261021130000_players", "20261109120000_armory", "20261109130000_armory_touch_members", "20261112190000_armory_profiles", "20261112190000_armory_profiles"]) {
      await db.exec(read(`migrations/${migration}.sql`));
    }
    await db.exec(read("tests/armory.sql"));
    await db.exec("create role backup_exporter; grant usage on schema public to backup_exporter;");
    await db.exec(read("migrations/20261112190000_armory_profiles.sql"));
    await db.exec(read("tests/armory_profiles.sql"));
    expect((await db.query("select count(*)::int as n from public.armory_characters")).rows).toEqual([{ n: 0 }]);
  } finally { await db.close(); }
}, 30_000);
