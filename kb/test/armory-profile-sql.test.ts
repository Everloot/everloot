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
    for (const migration of ["20261021130000_players", "20261025120000_guilds", "20261109120000_armory", "20261109130000_armory_touch_members", "20261112190000_armory_profiles", "20261112190000_armory_profiles", "20261117160000_armory_discovery", "20261125110000_armory_roster_last_login"]) {
      await db.exec(read(`migrations/${migration}.sql`));
    }
    await db.exec(read("tests/armory.sql"));
    await db.exec("create role backup_exporter; grant usage on schema public to backup_exporter;");
    await db.exec(read("migrations/20261112190000_armory_profiles.sql"));
    await db.exec(read("tests/armory_profiles.sql"));
    await db.exec(read("migrations/20261117120000_armory_progress.sql"));
    await db.exec(read("tests/armory_profiles.sql"));
    await db.exec(read("tests/armory_progress.sql"));
    await db.exec(read("migrations/20261117160000_armory_discovery.sql"));
    await db.exec(read("tests/armory_discovery.sql"));
    await db.exec(read("migrations/20261119190000_guild_profiles.sql"));
    await db.exec(read("migrations/20261119190000_guild_profiles.sql"));
    const crest = { emblem: { id: 1, color: { rgba: { r: 1, g: 2, b: 3, a: 1 } } }, border: { id: 2, color: { rgba: { r: 4, g: 5, b: 6, a: 1 } } }, background: { color: { rgba: { r: 7, g: 8, b: 9, a: 1 } } } };
    await db.query("select public.armory_upsert_guild('us',$1::jsonb,'[]'::jsonb)", [JSON.stringify({ slug: "star-watch", guild_id: 12, name: "Star Watch", faction: "Alliance", ruleset_id: 2, ruleset: "Normal", member_count: 0, crest })]);
    expect((await db.query<{ crest: unknown }>("select crest from public.armory_guild('us','star-watch')")).rows[0].crest).toEqual(crest);
    expect((await db.query("select count(*)::int as n from public.armory_characters")).rows).toEqual([{ n: 0 }]);
  } finally { await db.close(); }
}, 30_000);
