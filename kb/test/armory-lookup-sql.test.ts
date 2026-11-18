import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), "utf8");

/** The armory migrations up to the on-demand lookup, on a disposable database. */
async function database(): Promise<PGlite> {
  const db = new PGlite();
  // Unrelated prerequisites are minimal stand-ins; the armory and quota SQL is real.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.users(id uuid primary key);
    create table public.character_suppressions(realm text,character text);
    create function public.create_api_key(uuid,text,text,text,text[]) returns text language sql as 'select null::text';`);
  await db.exec(read("migrations/20261007220000_intake_quotas.sql"));
  const links = read("migrations/20261021190000_character_links.sql");
  await db.exec(links.slice(0, links.indexOf("alter table public.api_keys")));
  for (const migration of [
    "20261021130000_players", "20261109120000_armory", "20261109130000_armory_touch_members",
    "20261112190000_armory_profiles", "20261117120000_armory_progress", "20261117140000_armory_full_name_search", "20261117150000_armory_lookup",
  ]) await db.exec(read(`migrations/${migration}.sql`));
  return db;
}

test("the lookup asks only regions where the slug is neither hidden nor stored, keeps misses six hours, and has its own quota", async () => {
  const db = await database();
  try {
    await db.exec(read("migrations/20261117150000_armory_lookup.sql"));
    await db.exec(read("tests/armory_lookup.sql"));
    expect((await db.query("select count(*)::int as n from public.armory_lookup_misses")).rows).toEqual([{ n: 0 }]);
  } finally { await db.close(); }
}, 60_000);
