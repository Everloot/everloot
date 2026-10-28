import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

// Disposable local Postgres only. This fixture drops the public schema.
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/intake_quota_test node scripts/chat-workspace.integration.mjs
const url = new URL(process.env.QUOTA_TEST_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Local test database required");
assert.equal(url.pathname, "/intake_quota_test", "Dedicated test database required");
const pool = new pg.Pool({ connectionString: url.toString(), max: 24 });
const dir = new URL("../../supabase/migrations/", import.meta.url);
const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
const read = (file) => readFile(new URL(file, dir), "utf8");
const MIGRATION = files.find((file) => file.endsWith("_chat_workspace.sql"));
assert.ok(MIGRATION, "chat workspace migration missing");

async function asRole(role, query, params = []) {
  assert.ok(["service_role", "anon", "authenticated"].includes(role));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await client.query(query, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
const service = (query, params) => asRole("service_role", query, params);
const one = async (query, params) => (await service(query, params))[0];

const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const msg = (text, role = "user") => ({ role, text, at: "2026-10-25T12:00:00.000Z", model: null, sources: [], steps: [] });
const MESSAGES = [msg("Where does the Hogger drop?"), msg("Elwynn.", "assistant")];

const project = (user, f = {}) => one("select * from public.chat_save_project($1,$2,$3,$4,$5)",
  [user, f.id ?? randomUUID(), f.rev ?? 0, f.name ?? "Warrior leveling", f.description ?? null]);
const conversation = (user, f = {}) => one("select * from public.chat_save_conversation($1,$2,$3,$4,$5,$6,$7)",
  [user, f.id ?? randomUUID(), f.rev ?? 0, f.title ?? "Hogger", f.project ?? null, f.pinned ?? false, JSON.stringify(f.messages ?? MESSAGES)]);
const entry = (user, f = {}) => one("select * from public.chat_save_entry($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
  [user, f.id ?? randomUUID(), f.rev ?? 0, f.project ?? null, f.kind ?? "note", f.title ?? "Plan", f.build ?? null, f.href ?? null,
    f.text === undefined ? "Farm Hogger at 10" : f.text, f.sources ?? []]);
const importChat = (user, f = {}) => one("select * from public.chat_import_conversation($1,$2,$3,$4,$5)",
  [user, f.source ?? SOURCE, f.legacy ?? "local-1", f.title ?? "Old chat", JSON.stringify(f.messages ?? MESSAGES)]);
const remove = async (kind, user, id, rev) => (await one(`select public.chat_delete_${kind}($1,$2,$3) as r`, [user, id, rev])).r;
const list = async (user, f = {}) => (await one("select public.chat_list_conversations($1,$2,$3,$4,$5,$6,$7) as r",
  [user, f.project ?? null, f.query ?? null, f.after?.pinned ?? null, f.after?.updatedAt ?? null, f.after?.id ?? null, f.limit ?? 51])).r;
const entries = async (user, f = {}) => (await one("select public.chat_list_entries($1,$2,$3,$4,$5) as r",
  [user, f.project ?? null, f.after?.updatedAt ?? null, f.after?.id ?? null, f.limit ?? 51])).r;
const projects = async (user) => (await one("select public.chat_list_projects($1) as r", [user])).r;
const getChat = async (user, id) => (await one("select public.chat_get_conversation($1,$2) as r", [user, id])).r;
const count = async (table, user) => (await pool.query(`select count(*)::int as n from public.${table} where user_id = $1`, [user])).rows[0].n;
const resetDaily = () => pool.query("delete from public.chat_daily_saves");
const SOURCE = randomUUID();

try {
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
  await pool.query("grant all on schema public to public");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
  }
  await pool.query("alter role service_role bypassrls");
  // Match Supabase's permissive defaults: the migrations must revoke them.
  await pool.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
  await pool.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
  await pool.query("grant usage on schema public to anon, authenticated, service_role");
  // Production may not have saved builds yet: the migration needs only users, and a build entry is then refused.
  await pool.query(await read(files[0]));
  await pool.query(await read(MIGRATION));
  const [{ id: alone }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('0', 'Solo#0') returning id")).rows;
  assert.equal((await entry(alone, { kind: "build", text: null, build: randomUUID() })).refusal, "build_not_found");
  assert.equal((await entry(alone)).refusal, null);
  await pool.query("drop schema public cascade");
  await pool.query("create schema public");
  await pool.query("grant all on schema public to public");
  await pool.query("grant usage on schema public to anon, authenticated, service_role");
  for (const file of files) await pool.query(await read(file));
  // Applied twice: the new migration must be safe to re-run.
  await pool.query(await read(MIGRATION));

  const [{ id: owner }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('1', 'Thrall#1') returning id")).rows;
  const [{ id: other }] = (await pool.query("insert into public.users (bnet_id, battletag) values ('2', 'Jaina#2') returning id")).rows;

  // Browser roles can touch nothing; the service role reads but writes only through the functions.
  const tables = ["chat_projects", "chat_conversations", "chat_entries", "chat_imports", "chat_daily_saves"];
  for (const role of ["anon", "authenticated"]) {
    for (const table of tables) await assert.rejects(asRole(role, `select * from public.${table}`), /permission denied/);
    await assert.rejects(asRole(role, "select * from public.chat_save_project($1,$2,0,'x',null)", [owner, randomUUID()]), /permission denied/);
    await assert.rejects(asRole(role, "select public.chat_list_conversations($1,null,null,null,null,null,50)", [owner]), /permission denied/);
    await assert.rejects(asRole(role, "select public.chat_export($1)", [owner]), /permission denied/);
    await assert.rejects(asRole(role, "select public.chat_clear_workspace($1)", [owner]), /permission denied/);
  }
  for (const table of tables) {
    assert.ok((await pool.query("select relrowsecurity from pg_class where oid = $1::regclass", [`public.${table}`])).rows[0].relrowsecurity, `RLS off on ${table}`);
  }
  await assert.rejects(service("insert into public.chat_projects (user_id, id, name, revision, bytes) values ($1, $2, 'x', 1, 1)", [owner, randomUUID()]), /permission denied/);
  await assert.rejects(service("update public.chat_conversations set pinned = true"), /permission denied/);
  await assert.rejects(service("select public.chat_take_mutation($1)", [owner]), /permission denied/);

  // Shape: the database refuses what the server should never send.
  await assert.rejects(project(owner, { name: " " }), /Invalid project/);
  await assert.rejects(project(owner, { name: "x".repeat(101) }), /Invalid project/);
  await assert.rejects(project(owner, { description: "x".repeat(1001) }), /Invalid project/);
  await assert.rejects(project(owner, { rev: -1 }), /Invalid project/);
  await assert.rejects(conversation(owner, { title: "x".repeat(101) }), /Invalid conversation/);
  await assert.rejects(conversation(owner, { messages: Array.from({ length: 201 }, () => msg("a")) }), /Invalid conversation/);
  await assert.rejects(conversation(owner, { messages: { not: "a list" } }), /Invalid conversation/);
  await assert.rejects(conversation(owner, { messages: ["text"] }), /Invalid conversation/);
  await assert.rejects(entry(owner, { kind: "file" }), /Invalid entry/);
  await assert.rejects(entry(owner, { kind: "note", text: null }), /Invalid entry/);
  await assert.rejects(entry(owner, { kind: "page", text: null, href: "//evil.example/x" }), /Invalid entry/);
  await assert.rejects(entry(owner, { kind: "page", text: null, href: "https://evil.example/x" }), /Invalid entry/);
  await assert.rejects(entry(owner, { kind: "build", text: null }), /Invalid entry/);
  await assert.rejects(entry(owner, { sources: Array.from({ length: 21 }, () => "s") }), /Invalid entry/);
  await assert.rejects(entry(owner, { sources: ["x".repeat(513)] }), /Invalid entry/);
  await assert.rejects(entry(owner, { text: "x".repeat(20001) }), /Invalid entry/);
  const huge = await conversation(owner, { messages: Array.from({ length: 60 }, () => msg("x".repeat(20000))) });
  assert.deepEqual([huge.refusal, huge.conversation], ["size_exceeded", null]);

  // Create, read, update with the last revision; a stale or repeated create is a conflict, not an overwrite.
  const raid = await project(owner, { name: "  Raid prep ", description: "MC" });
  assert.equal(raid.refusal, null);
  assert.deepEqual([raid.project.name, raid.project.description, raid.project.revision], ["Raid prep", "MC", 1]);
  assert.match(raid.project.updatedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal((await project(owner, { id: raid.project.id, name: "Again" })).refusal, "revision_conflict");
  const renamed = await project(owner, { id: raid.project.id, rev: 1, name: "Raid" });
  assert.deepEqual([renamed.refusal, renamed.project.revision, renamed.project.name], [null, 2, "Raid"]);
  assert.equal((await project(owner, { id: raid.project.id, rev: 1, name: "Old device" })).refusal, "revision_conflict");
  assert.equal((await projects(owner))[0].name, "Raid");
  assert.equal((await project(owner, { id: randomUUID(), rev: 3, name: "Ghost" })).refusal, "not_found");

  const chat = await conversation(owner, { project: raid.project.id, pinned: true });
  assert.equal(chat.refusal, null);
  assert.deepEqual([chat.conversation.projectId, chat.conversation.pinned, chat.conversation.revision, chat.conversation.messages.length],
    [raid.project.id, true, 1, 2]);
  const moved = await conversation(owner, { id: chat.conversation.id, rev: 1, title: "Hogger run", project: null, messages: [...MESSAGES, msg("Thanks")] });
  assert.deepEqual([moved.refusal, moved.conversation.revision, moved.conversation.projectId], [null, 2, null]);
  assert.equal((await conversation(owner, { id: chat.conversation.id, rev: 1, title: "Other device" })).refusal, "revision_conflict");
  assert.equal((await getChat(owner, chat.conversation.id)).title, "Hogger run");
  assert.equal(await remove("conversation", owner, chat.conversation.id, 1), "revision_conflict");

  // Two owners: another account sees, changes and files under nothing of the owner's, even with the right ids.
  const [{ build_ref: build }] = await service("select * from public.save_build($1,null,'AbCd1234',null,'Fire',null,$2,null,null,null,null)", [owner, MAGE]);
  assert.equal((await project(other, { id: raid.project.id, rev: 2, name: "Mine" })).refusal, "not_found");
  assert.equal(await remove("project", other, raid.project.id, 2), "not_found");
  assert.equal((await conversation(other, { id: chat.conversation.id, rev: 2, title: "Mine" })).refusal, "not_found");
  assert.equal(await remove("conversation", other, chat.conversation.id, 2), "not_found");
  assert.equal((await conversation(other, { project: raid.project.id })).refusal, "project_not_found");
  assert.equal((await entry(other, { project: raid.project.id })).refusal, "project_not_found");
  assert.equal((await entry(other, { kind: "build", text: null, build })).refusal, "build_not_found");
  assert.equal(await getChat(other, chat.conversation.id), null);
  assert.deepEqual(await projects(other), []);
  assert.deepEqual(await list(other), []);
  assert.deepEqual(await entries(other), []);
  // The same id in another account is that account's own record, not a collision with the owner's.
  const twin = await project(other, { id: raid.project.id, name: "Twin" });
  assert.deepEqual([twin.refusal, twin.project.revision], [null, 1]);
  assert.equal((await projects(owner))[0].name, "Raid");
  assert.equal(await remove("project", other, raid.project.id, 1), null);

  // Entries: all four kinds; a build is referenced by the owner's id, never copied.
  const linked = await entry(owner, { kind: "build", title: "", text: null, build, project: raid.project.id });
  assert.equal(linked.refusal, null);
  assert.deepEqual([linked.entry.kind, linked.entry.buildId, linked.entry.href, linked.entry.text], ["build", build, null, null]);
  const page = await entry(owner, { kind: "page", title: "My boots", text: null, href: "/item/2589?x=1#drops", project: raid.project.id });
  assert.equal(page.refusal, null);
  const answer = await entry(owner, { kind: "answer", text: "Hogger drops it.", sources: ["https://everloot.app/npc/448"] });
  assert.deepEqual(answer.entry.sources, ["https://everloot.app/npc/448"]);
  const note = await entry(owner, { project: raid.project.id });
  assert.equal(note.entry.revision, 1);
  assert.equal((await entry(owner, { id: note.entry.id, rev: 1, text: "Edited", project: raid.project.id })).entry.revision, 2);
  assert.equal((await entries(owner, { project: raid.project.id })).length, 3);
  const filed = await conversation(owner, { project: raid.project.id });

  // Removing a project unfiles its chats and entries (a new revision each) and never deletes the build.
  assert.equal(await remove("project", owner, raid.project.id, 1), "revision_conflict");
  assert.equal(await remove("project", owner, raid.project.id, 2), null);
  assert.deepEqual(await projects(owner), []);
  const unfiled = await getChat(owner, filed.conversation.id);
  assert.deepEqual([unfiled.projectId, unfiled.revision], [null, 2]);
  const after = await entries(owner);
  assert.equal(after.length, 4);
  assert.ok(after.every((e) => e.projectId === null));
  assert.equal(after.find((e) => e.id === linked.entry.id).revision, 2);
  assert.equal((await pool.query("select count(*)::int as n from public.saved_builds where id = $1", [build])).rows[0].n, 1);
  assert.equal(await remove("entry", owner, linked.entry.id, 2), null);
  assert.equal((await pool.query("select count(*)::int as n from public.saved_builds where id = $1", [build])).rows[0].n, 1);
  assert.equal(await remove("entry", owner, linked.entry.id, 2), "not_found");

  // Pages: pinned first, then newest; a keyset cursor, a title search (no wildcards) and a project filter.
  await pool.query("delete from public.chat_conversations where user_id = $1", [owner]);
  await resetDaily();
  const folder = (await project(owner, { name: "Gold" })).project;
  for (let i = 0; i < 55; i++) await conversation(owner, { title: i === 7 ? "Gold 100% farm" : `Chat ${i}`, project: i < 3 ? folder.id : null, pinned: i === 54 });
  const first = await list(owner, { limit: 51 });
  assert.equal(first.length, 51);
  assert.equal(first[0].title, "Chat 54");
  assert.equal(first[1].title, "Chat 53");
  assert.ok(first.every((c) => !("messages" in c)));
  const last = first[49];
  const rest = await list(owner, { after: last, limit: 51 });
  assert.equal(rest.length, 5);
  assert.equal(new Set([...first.slice(0, 50), ...rest].map((c) => c.id)).size, 55);
  assert.deepEqual((await list(owner, { query: "100%" })).map((c) => c.title), ["Gold 100% farm"]);
  assert.deepEqual(await list(owner, { query: "%" }), (await list(owner, { query: "100%" })));
  assert.equal((await list(owner, { project: folder.id })).length, 3);
  assert.equal((await list(owner, { limit: 500 })).length, 51);

  // The day's 300 changes: a refusal costs none, deletes are not counted, and the next day starts over.
  await pool.query("update public.chat_daily_saves set count = 299 where user_id = $1", [owner]);
  assert.equal((await project(owner, { name: "Last today" })).refusal, null);
  const tired = await project(owner, { name: "One too many" });
  assert.deepEqual([tired.refusal, tired.project], ["daily_limit", null]);
  assert.equal(await remove("project", owner, folder.id, 1), null);
  await pool.query("update public.chat_daily_saves set reset_at = now() - interval '1 second' where user_id = $1", [owner]);
  assert.equal((await project(owner, { name: "Tomorrow" })).refusal, null);

  // Counts hold under concurrent saves: 100 projects, 500 conversations, 1000 entries.
  await resetDaily();
  await pool.query("delete from public.chat_projects where user_id = $1", [other]);
  const many = await Promise.all(Array.from({ length: 105 }, (_, i) => project(other, { name: `P${i}` })));
  assert.equal(many.filter((r) => r.refusal === null).length, 100);
  assert.ok(many.filter((r) => r.refusal !== null).every((r) => r.refusal === "quota_exceeded"));
  assert.equal(await count("chat_projects", other), 100);
  await pool.query(`insert into public.chat_conversations (user_id, id, title, messages, revision, bytes)
    select $1, gen_random_uuid(), 'filler', '[]', 1, 2 from generate_series(1, 499)`, [other]);
  const race = await Promise.all([conversation(other), conversation(other), conversation(other)]);
  assert.deepEqual(race.map((r) => r.refusal).sort((a, b) => String(a).localeCompare(String(b))), [null, "quota_exceeded", "quota_exceeded"]);
  assert.equal(await count("chat_conversations", other), 500);
  await pool.query(`insert into public.chat_entries (user_id, id, kind, title, text, revision, bytes)
    select $1, gen_random_uuid(), 'note', '', 'x', 1, 1 from generate_series(1, 999)`, [other]);
  const notes = await Promise.all([entry(other), entry(other)]);
  assert.equal(notes.filter((r) => r.refusal === null).length, 1);
  assert.equal(await count("chat_entries", other), 1000);
  // 10 MiB per account, counted across the three kinds; an update that grows past it is refused, the old copy kept.
  await pool.query("update public.chat_entries set bytes = 10485760 - (select coalesce(sum(bytes), 0) from public.chat_projects where user_id = $1) - (select coalesce(sum(bytes), 0) from public.chat_conversations where user_id = $1) - 998 where user_id = $1 and id = (select id from public.chat_entries where user_id = $1 order by id limit 1)", [other]);
  const kept = (await list(other, { limit: 1 }))[0];
  const grown = await conversation(other, { id: kept.id, rev: kept.revision, title: kept.title, messages: [msg("x".repeat(2000))] });
  assert.equal(grown.refusal, "size_exceeded");
  assert.equal((await getChat(other, kept.id)).revision, kept.revision);
  await pool.query("delete from public.chat_conversations where user_id = $1 and title = 'filler'", [other]);
  await pool.query("delete from public.chat_entries where user_id = $1", [other]);

  // Import: once per account, source and legacy id, even when sent twice at once; another account gets its own copy.
  await resetDaily();
  const twice = await Promise.all([importChat(owner), importChat(owner)]);
  assert.deepEqual(twice.map((r) => r.created).sort(), [false, true]);
  assert.equal(twice[0].conversation.id, twice[1].conversation.id);
  assert.deepEqual([twice[0].conversation.projectId, twice[0].conversation.pinned, twice[0].conversation.revision], [null, false, 1]);
  const again = await importChat(owner, { title: "Changed", messages: [msg("different")] });
  assert.deepEqual([again.created, again.conversation.id, again.conversation.title], [false, twice[0].conversation.id, "Old chat"]);
  const theirs = await importChat(other);
  assert.equal(theirs.created, true);
  assert.notEqual(theirs.conversation.id, twice[0].conversation.id);
  assert.equal(await getChat(other, twice[0].conversation.id), null);
  assert.equal((await importChat(owner, { legacy: "local-2" })).created, true);
  // Deleting the imported copy lets a later import make it again.
  const imported = twice[0].conversation;
  assert.equal(await remove("conversation", owner, imported.id, 1), null);
  assert.equal(await count("chat_imports", owner), 1);
  assert.equal((await importChat(owner)).created, true);

  // Export is the account's own workspace, with no owner column, nothing of another account's.
  const exported = (await one("select public.chat_export($1) as r", [owner])).r;
  assert.deepEqual(Object.keys(exported).sort(), ["conversations", "entries", "projects"]);
  assert.ok(exported.conversations.every((c) => Array.isArray(c.messages)));
  assert.equal(exported.conversations.length, await count("chat_conversations", owner));
  const text = JSON.stringify(exported);
  assert.ok(!text.includes(other) && !text.includes(theirs.conversation.id) && !text.includes("user_id") && !text.includes("Twin"));

  // Clearing the workspace removes the account's chat records only: login, builds and the other account stay.
  const otherBefore = await Promise.all(tables.map((t) => count(t, other)));
  assert.equal((await one("select public.chat_clear_workspace($1) as r", [owner])).r, true);
  for (const table of tables.slice(0, 4)) assert.equal(await count(table, owner), 0);
  // The day's count stays, so clearing is not a way round the daily limit.
  assert.equal(await count("chat_daily_saves", owner), 1);
  assert.equal((await pool.query("select count(*)::int as n from public.users where id = $1", [owner])).rows[0].n, 1);
  assert.equal(await count("saved_builds", owner), 1);
  assert.deepEqual(await Promise.all(tables.map((t) => count(t, other))), otherBefore);

  // Deleting the account deletes all of its workspace, filed chats and import records included.
  await resetDaily();
  await one("select public.chat_clear_workspace($1) as r", [other]);
  const last2 = (await project(other, { name: "Last" })).project;
  await conversation(other, { project: last2.id });
  await entry(other, { project: last2.id });
  await importChat(other);
  for (const table of tables) assert.ok(await count(table, other) > 0, `nothing in ${table} before the account goes`);
  await pool.query("delete from public.users where id = $1", [other]);
  for (const table of tables) assert.equal(await count(table, other), 0);
  console.log("chat workspace integration: ok");
} finally {
  await pool.end();
}
