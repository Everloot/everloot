import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), "utf8");

test("character directory SQL filters, sorts, hides, pages and restricts execution; safe twice", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.users(id uuid primary key);
      create table public.character_suppressions(realm text,character text);
      create table public.intake_quota_buckets(bucket text primary key,count int,reset_at timestamptz);
      create function public.create_api_key(uuid,text,text,text,text[]) returns text language sql as 'select null::text';`);
    const links = read("migrations/20261021190000_character_links.sql");
    await db.exec(links.slice(0, links.indexOf("alter table public.api_keys")));
    for (const migration of ["20261021130000_players", "20261022160000_players_realm_key", "20261109120000_armory", "20261117140000_armory_full_name_search"]) {
      await db.exec(read(`migrations/${migration}.sql`));
    }
    for (let i = 0; i < 2; i++) await db.exec(read("migrations/20261119120000_armory_directory.sql"));
    await db.exec(read("tests/armory_directory.sql"));
    expect((await db.query("select count(*)::int as n from public.armory_characters")).rows).toEqual([{ n: 0 }]);
  } finally { await db.close(); }
}, 60_000);
