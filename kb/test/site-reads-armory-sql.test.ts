import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), "utf8");

/** The character-link, armory, private sync and gear board migrations, on a disposable database. */
async function database(): Promise<PGlite> {
  const db = new PGlite();
  // Unrelated prerequisites are minimal stand-ins; the SQL under test is real.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.users(id uuid primary key);
    create table public.character_suppressions(realm text,character text);
    create table public.intake_quota_buckets(bucket text primary key,count int,reset_at timestamptz);
    create table public.api_keys(id uuid primary key default gen_random_uuid(),user_id uuid,token_hash text,scopes text[],
      revoked_at timestamptz,expires_at timestamptz,last_used_at timestamptz);
    create function public.create_api_key(uuid,text,text,text,text[]) returns text language sql as 'select null::text';
    create function public.issue_api_key(uuid,text,text,text,text,text[],timestamptz) returns text language sql as 'select null::text';`);
  const links = read("migrations/20261021190000_character_links.sql");
  await db.exec(links.slice(0, links.indexOf("alter table public.api_keys")));
  for (const migration of [
    "20261021130000_players", "20261106120000_private_sync", "20261107120000_gear_board", "20261107140000_private_sync_stats_pvp",
    "20261107150000_profile_pipeline", "20261109120000_armory", "20261109130000_armory_touch_members", "20261112190000_armory_profiles",
    "20261117120000_armory_progress",
  ]) await db.exec(read(`migrations/${migration}.sql`));
  return db;
}

const LINK = "20000000-0000-4000-8000-000000000001";

test("the site-reads-armory migration deletes the retired sync rows and the board history, and is safe twice", async () => {
  const db = await database();
  try {
    await db.exec(`insert into public.users(id) values('10000000-0000-4000-8000-000000000001');
      insert into public.character_links(id,user_id,link_key,ruleset,realm_key,name_key,realm,name,race,class,faction,level,completion_ref)
      values('${LINK}','10000000-0000-4000-8000-000000000001',repeat('a',64),'forever','us1 realm 4 pvp','ember','US1 Realm 4 PvP','Ember','Troll','WARLOCK','Horde',26,repeat('b',64));
      insert into public.character_visibility(link_id) values('${LINK}');`);
    for (const category of ["gear", "stats", "talents", "pvp", "professions", "reputations", "raids", "achievements"]) {
      const data = category === "achievements" ? `{"achievements":[{"id":6,"on":null}],"titleIds":[3,7]}` : category === "raids" ? `{"lockouts":[]}` : "{}";
      await db.exec(`insert into public.character_sync_consent(link_id,category) values('${LINK}','${category}');
        insert into public.character_facts(link_id,category,captured_at,data,data_hash,source_ref)
        values('${LINK}','${category}','2026-11-10T00:00:00Z','${data}',repeat('c',64),repeat('d',64));`);
    }
    await db.exec(`insert into public.character_track(link_id,day,metric,value,source) values('${LINK}','2026-11-10','item_level',60,'owner_sync');`);
    for (let i = 0; i < 2; i++) await db.exec(read("migrations/20261117130000_site_reads_armory.sql"));
    const facts = await db.query<{ category: string; data: unknown; data_hash: string }>("select category,data,data_hash from public.character_facts order by category");
    expect(facts.rows.map((r) => r.category)).toEqual(["achievements", "raids"]);
    expect(facts.rows[0]!.data).toEqual({ titleIds: [3, 7] });
    const hash = await db.query<{ h: string }>(`select encode(sha256(convert_to('{"titleIds": [3, 7]}', 'UTF8')), 'hex') as h`);
    expect(facts.rows[0]!.data_hash).toBe(hash.rows[0]!.h);
    expect((await db.query("select category from public.character_sync_consent order by category")).rows).toEqual([{ category: "achievements" }, { category: "raids" }]);
    expect((await db.query("select count(*)::int as n from public.character_track")).rows).toEqual([{ n: 0 }]);
    await db.exec(read("tests/site_reads_armory.sql"));
  } finally { await db.close(); }
}, 60_000);
