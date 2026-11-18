import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), "utf8");

/** The armory migrations up to the full-name search, on a disposable database. */
async function database(): Promise<PGlite> {
  const db = new PGlite();
  // Unrelated prerequisites are minimal stand-ins; the armory SQL is real.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.users(id uuid primary key);
    create table public.character_suppressions(realm text,character text);
    create table public.intake_quota_buckets(bucket text primary key,count int,reset_at timestamptz);
    create function public.create_api_key(uuid,text,text,text,text[]) returns text language sql as 'select null::text';`);
  const links = read("migrations/20261021190000_character_links.sql");
  await db.exec(links.slice(0, links.indexOf("alter table public.api_keys")));
  for (const migration of [
    "20261021130000_players", "20261109120000_armory", "20261109130000_armory_touch_members", "20261112190000_armory_profiles",
    "20261117120000_armory_progress", "20261117140000_armory_full_name_search", "20261117160000_armory_discovery",
  ]) await db.exec(read(`migrations/${migration}.sql`));
  return db;
}

test("armory search finds a character by first name, surname or full name, never a hidden one, and is safe twice", async () => {
  const db = await database();
  try {
    await db.exec(read("migrations/20261117140000_armory_full_name_search.sql"));
    await db.exec(read("tests/armory_search.sql"));
    await db.exec(read("tests/armory.sql"));
    expect((await db.query("select count(*)::int as n from public.armory_characters")).rows).toEqual([{ n: 0 }]);
  } finally { await db.close(); }
}, 60_000);

test("each part of the search can use its prefix index", async () => {
  const db = await database();
  try {
    await db.exec("set enable_seqscan = off;");
    for (const [index, where] of [
      ["armory_characters_name", "lower(name) like 'volvik%'"],
      ["armory_characters_surname", "lower(surname) like 'morning%'"],
      ["armory_characters_full_name", "lower(name || ' ' || surname) like 'volvik morn%'"],
    ] as const) {
      const plan = await db.query<{ "QUERY PLAN": string }>(`explain select slug from public.armory_characters where ${where}`);
      expect(plan.rows.map((r) => r["QUERY PLAN"]).join("\n")).toContain(index);
    }
  } finally { await db.close(); }
}, 60_000);
