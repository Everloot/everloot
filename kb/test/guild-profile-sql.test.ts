import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

let db: PGlite;
const owner = "00000000-0000-0000-0000-000000000001";
const editor = "00000000-0000-0000-0000-000000000002";
const other = "00000000-0000-0000-0000-000000000003";
const migration = readFileSync(new URL("../../supabase/migrations/20261119120000_guild_profiles.sql", import.meta.url), "utf8");
const fields = ["A plain bio", { raidDays: "Tuesday", discord: "https://discord.gg/example", website: "https://example.org" }, { on: true, lookingFor: "Healers", classes: ["PRIEST"] }];
async function call(name: string, user = owner, extra: unknown[] = []) {
  const args = [user, "us", "star-watch", ...extra];
  return (await db.query<{ result: unknown }>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0].result;
}
beforeAll(async () => {
  db = new PGlite();
  // Minimal unrelated schema; functions, grants, policies and joins under test are the real migration.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table users(id uuid primary key);
    create table armory_guilds(region text,slug text,name text,primary key(region,slug));
    create table guild_suppressions(realm_key text,guild_key text);
    create table armory_characters(region text,slug text,name text,surname text,guild_slug text);
    create table armory_members(region text,guild_slug text,character_slug text,rank smallint);
    create table character_links(id uuid,user_id uuid,status text,realm_key text,name_key text);
    create table armory_links(link_id uuid,region text,slug text);
    create table armory_hides(region text,slug text);
    create table character_suppressions(realm text,character text);
    create function link_realm_key(text) returns text language sql as 'select lower($1)';
    create table intake_quota_buckets(bucket text primary key,count integer,reset_at timestamptz);`);
  // Crest upsert replaces an existing function; its body is exercised by the armory integration suite.
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`truncate guild_editors,guild_profiles,users,armory_guilds,armory_characters,armory_members,character_links,armory_links,armory_hides,character_suppressions,guild_suppressions,intake_quota_buckets cascade;
    insert into users values('${owner}'),('${editor}'),('${other}');
    insert into armory_guilds(region,slug,name) values('us','star-watch','Star Watch');
    insert into armory_characters values('us','mira-dawn','Mira','Dawn','star-watch'),('us','tavi-reed','Tavi','Reed','star-watch');
    insert into armory_members values('us','star-watch','mira-dawn',0),('us','star-watch','tavi-reed',3);
    insert into character_links values('${owner}','${owner}','linked','us pve','mira'),('${editor}','${editor}','linked','us pve','tavi');
    insert into armory_links values('${owner}','us','mira-dawn'),('${editor}','us','tavi-reed');`);
});
test("only an associated active rank-0 member claims, in the right region", async () => {
  expect(await call("claim_guild", other)).toBe(false);
  expect(await call("claim_guild", editor)).toBe(false);
  expect(await call("guild_profile_access", editor)).toMatchObject({ eligible: false });
  await db.exec(`update character_links set status='frozen' where user_id='${owner}'`);
  expect(await call("claim_guild")).toBe(false);
  await db.exec(`update character_links set status='linked'; update armory_links set region='eu' where link_id='${owner}'`);
  expect(await call("claim_guild")).toBe(false);
  await db.exec(`update armory_links set region='us'`);
  expect(await call("claim_guild")).toBe(true);
  expect(await call("claim_guild")).toBe(true);
});
test("a later claimant only replaces a stale owner and clears editors", async () => {
  await call("claim_guild"); await call("appoint_guild_editor", owner, [editor]);
  await db.exec(`update armory_members set rank=0 where character_slug='tavi-reed'`);
  expect(await call("claim_guild", editor)).toBe(false);
  await db.exec(`update armory_members set rank=4 where character_slug='mira-dawn'`);
  expect(await call("claim_guild", editor)).toBe(true);
  expect((await db.query("select * from guild_editors")).rows).toEqual([]);
  expect(await call("save_guild_profile", owner, fields)).toBe("forbidden");
});
test("owner appoints only linked members; editors save but cannot manage or release", async () => {
  await call("claim_guild");
  expect(await call("appoint_guild_editor", owner, [other])).toBe(false);
  expect(await call("appoint_guild_editor", owner, [owner])).toBe(false);
  expect(await call("appoint_guild_editor", owner, [editor])).toBe(true);
  expect(await call("appoint_guild_editor", editor, [other])).toBe(false);
  expect(await call("release_guild", editor)).toBe(false);
  expect(await call("remove_guild_editor", editor, [editor])).toBe(false);
  expect(await call("save_guild_profile", editor, fields)).toBe("saved");
  expect((await db.query<{ updated_by: string }>("select updated_by from guild_profiles")).rows[0].updated_by).toBe(editor);
  expect(await call("remove_guild_editor", owner, [editor])).toBe(true);
  expect(await call("save_guild_profile", editor, fields)).toBe("forbidden");
  expect(await call("release_guild")).toBe(true);
  expect((await db.query("select owner_user_id,updated_by from guild_profiles")).rows[0]).toEqual({ owner_user_id: null, updated_by: owner });
});
test.each(["rank", "left", "frozen", "unlinked", "hidden"])("rechecks the claiming character on every edit: %s", async (change) => {
  await call("claim_guild"); await call("appoint_guild_editor", owner, [editor]);
  await db.exec({ rank: "update armory_members set rank=1 where rank=0", left: "delete from armory_members where rank=0",
    frozen: `update character_links set status='frozen' where user_id='${owner}'`, unlinked: `delete from armory_links where link_id='${owner}'`,
    hidden: "insert into armory_hides values('us','mira-dawn')" }[change]!);
  expect(await call("save_guild_profile", owner, fields)).toBe("forbidden");
  expect(await call("save_guild_profile", editor, fields)).toBe("forbidden");
  expect(await call("appoint_guild_editor", owner, [editor])).toBe(false);
  expect(await call("remove_guild_editor", owner, [editor])).toBe(false);
  expect(await call("release_guild")).toBe(false);
  expect(await call("guild_profile_access")).toMatchObject({ stale: true, owner: false, editor: false });
});
test("an editor who leaves loses access even while the owner remains", async () => {
  await call("claim_guild"); await call("appoint_guild_editor", owner, [editor]);
  await db.exec("delete from armory_members where rank=3");
  expect(await call("save_guild_profile", editor, fields)).toBe("forbidden");
});
test("SQL rejects invalid shapes, limits, non-HTTPS and unknown classes", async () => {
  await call("claim_guild");
  for (const invalid of [
    ["x".repeat(1001), fields[1], fields[2]], ["", { raidDays: "", discord: "http://example.org", website: "" }, fields[2]],
    ["", { raidDays: "", discord: "https://user:pass@example.org", website: "" }, fields[2]],
    ["", fields[1], { on: true, lookingFor: "x".repeat(201), classes: [] }],
    ["", fields[1], { on: true, lookingFor: "", classes: ["BARD"] }], ["", {}, fields[2]],
  ]) expect(await call("save_guild_profile", owner, invalid)).toBe("invalid");
});
test("saves use a per-user hourly quota and audit every accepted write", async () => {
  await call("claim_guild");
  for (let i = 0; i < 30; i++) expect(await call("save_guild_profile", owner, fields)).toBe("saved");
  expect(await call("save_guild_profile", owner, fields)).toBe("limited");
  await db.exec("update intake_quota_buckets set reset_at=now()-interval '1 second'");
  expect(await call("save_guild_profile", owner, fields)).toBe("saved");
});
test("RLS allows public reads and grants neither direct writes nor spoofed RPC calls", async () => {
  await call("claim_guild");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    expect((await db.query("select * from guild_profiles")).rows).toHaveLength(1);
    await expect(db.exec("update guild_profiles set bio='bypass'")).rejects.toThrow(/permission denied/);
    await expect(db.exec("insert into guild_editors values('us','star-watch',null,null,now())")).rejects.toThrow(/permission denied/);
    if (role !== "service_role") await expect(call("claim_guild")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  }
});
test("existing guild hides also withhold profile/editor reads and reject edits", async () => {
  await call("claim_guild"); await call("appoint_guild_editor", owner, [editor]);
  await db.exec("insert into guild_suppressions values('camwow us1 realm 4 pvp','star watch')");
  expect(await call("save_guild_profile", owner, fields)).toBe("forbidden");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    expect((await db.query("select * from guild_profiles")).rows).toEqual([]);
    expect((await db.query("select * from guild_editors")).rows).toEqual([]);
    await db.exec("reset role");
  }
});
