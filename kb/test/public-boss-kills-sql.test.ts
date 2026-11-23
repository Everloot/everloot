import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("public boss history uses linked identities, armory rosters and hide tools", async () => {
  const db = new PGlite();
  const read = (path: string) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), "utf8");
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table character_links(id uuid primary key,user_id uuid,status text default 'linked',ruleset text,realm_key text,name_key text,realm text,name text,class text,faction text,race text);
      create function link_realm_key(text) returns text language sql as 'select lower(replace($1, ''-'', '' ''))';
      create table armory_links(link_id uuid,region text,slug text);
      create table armory_characters(region text,slug text,name text,class text,faction text,race text,ruleset_id int);
      create table armory_members(region text,guild_slug text,character_slug text);
      create table armory_guilds(region text,slug text,name text);
      create table armory_hides(region text,slug text);
      create table character_suppressions(realm text,character text);
      create table guild_suppressions(realm_key text,guild_key text);`);
    await db.exec(read("migrations/20261114120000_private_boss_kills.sql"));
    await db.exec(read("migrations/20261120100000_public_boss_kills.sql"));
    await db.exec(read("migrations/20261120100000_public_boss_kills.sql"));
    await db.exec(read("tests/public_boss_kills.sql"));
    await db.exec("alter table armory_characters add column surname text default 'Dawn'");
    await db.exec(read("migrations/20261123110000_dungeon_progress.sql"));
    await db.exec(read("migrations/20261123110000_dungeon_progress.sql"));
    await db.exec(read("tests/dungeon_progress.sql"));
    expect((await db.query("select count(*)::int as n from character_boss_kills")).rows).toEqual([{ n: 1 }]);
  } finally { await db.close(); }
}, 30_000);
