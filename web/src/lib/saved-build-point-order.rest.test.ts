import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// The site's own saved-builds code through a real PostgREST: on the schema production runs before
// 20261027120000_saved_build_point_order.sql, then in the same process once it is applied, and after its rollback.
// The code may be deployed before the migration: Chat goes on listing and saving, a save that names no order goes
// through save_build, and one that names an order is refused with nothing written until the process finds the
// migration in. Only the session is made up. Disposable local fixtures only: this drops the public schema of its own
// database.
// docker network create saved-build-point-order-rest
// docker run -d --name saved-build-point-order-rest-db --network saved-build-point-order-rest -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54411:5432 postgres:17
// docker exec saved-build-point-order-rest-db createdb -U postgres saved_build_point_order_rest_test
// docker run -d --name saved-build-point-order-rest-api --network saved-build-point-order-rest -p 127.0.0.1:54412:3000 -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=<a local secret of 32 characters or more> -e PGRST_DB_URI=postgres://postgres@saved-build-point-order-rest-db:5432/saved_build_point_order_rest_test postgrest/postgrest:v12.2.12
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54411/saved_build_point_order_rest_test LOCAL_REST_URL=http://127.0.0.1:54412 LOCAL_REST_JWT_SECRET=<the same> npx vitest run src/lib/saved-build-point-order.rest.test.ts
const databaseUrl = process.env.QUOTA_TEST_DATABASE_URL;
const restUrl = process.env.LOCAL_REST_URL;
const secret = process.env.LOCAL_REST_JWT_SECRET;

const session = vi.hoisted(() => ({ user: null as { id: string; name: string } | null }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  getUser: async () => session.user,
}));

import { POST as accountSave } from "@/app/api/me/builds/route";
import { GET as chatList, POST as chatSave } from "@/app/api/me/chat/builds/route";
import { ORDERS_RECHECK_MS, sharedBuild } from "@/lib/saved-builds-store";

const DATABASE = "saved_build_point_order_rest_test";
const repo = new URL("../../../", import.meta.url);
// What production has applied, in its order (as in scripts/saved-builds-legacy.integration.mjs).
const CHAIN = [
  "20261003000000_auth_schema.sql", "20261004000000_uploads_waitlist.sql", "20261007070647_verified_publication.sql",
  "20261007220000_intake_quotas.sql", "20261010120000_mcp_quota_scope.sql", "20261018120000_usage_counters.sql",
  "20261019120000_data_guard.sql", "20261021130000_players.sql", "20261021150000_saved_builds.sql",
  "20261025191223_chat_workspace.sql", "20261022160000_players_realm_key.sql", "20261025120000_guilds.sql",
  "20261021170000_account_profiles.sql",
];
const migration = (file: string) => readFile(new URL(`supabase/migrations/${file}`, repo), "utf8");
const SITE = "https://everloot.app";
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE4 = "EL1-mage-0-1.60.1.70450-MTE6NA";
const MAGE2 = "EL1-mage-1482-1.60.1.70450-MjE6MQ";
const ORDER = "O1p-AAAAA";
const ORDER2 = "O1g-A";
const UNAVAILABLE = "Saving spend orders isn't available yet, so this build was not saved.";

describe.skipIf(!databaseUrl || !restUrl || !secret)("saved builds through PostgREST, before and after the spend-order migration", () => {
  let pool: Pool;
  let direct: typeof fetch;
  let token = "";
  let skew = 0;
  let owner = "";
  let other = "";
  let chatBuild = "";
  let ordered = "";

  /** PostgREST itself, as the service role. */
  async function rest(path: string, body?: object): Promise<{ status: number; body: { code?: string; message?: string } | null }> {
    const res = await direct(new URL(path, restUrl), {
      method: body ? "POST" : "GET", body: body && JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  /** Waits for PostgREST's schema cache, which reloads on the notify each file sends. */
  async function until(ready: () => Promise<boolean>, what: string) {
    for (let i = 0; i < 100; i++) {
      if (await ready()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`PostgREST did not ${what}`);
  }
  const chat = (build?: object) => build
    ? chatSave(new Request(`${SITE}/api/me/chat/builds`, {
      method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ expectedAccountId: session.user!.id, build }),
    }))
    : chatList(new Request(`${SITE}/api/me/chat/builds`));
  const account = (body: object, headers: Record<string, string> = {}) =>
    accountSave(new Request(`${SITE}/api/me/builds`, { method: "POST", headers: { origin: SITE, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  /** An account's builds as stored, its count against the daily saves, and how many it has. */
  const state = async (user: string, orders = false) => ({
    rows: (await pool.query(`select id, name, code, code2, shared, show_name, active${orders ? ", point_order, point_order2" : ""} from public.saved_builds
      where user_id = $1 order by id`, [user])).rows,
    saves: (await pool.query("select count from public.intake_quota_buckets where bucket = $1", [`builds:${user}`])).rows[0]?.count ?? 0,
  });

  beforeAll(async () => {
    const database = new URL(databaseUrl!);
    const api = new URL(restUrl!);
    for (const url of [database, api]) expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    expect(database.pathname).toBe(`/${DATABASE}`);
    expect(database.search + database.hash).toBe("");
    expect(secret!.length).toBeGreaterThanOrEqual(32);
    pool = new Pool({ host: database.hostname, port: Number(database.port || 5432), database: DATABASE, user: decodeURIComponent(database.username) || "postgres" });
    expect((await pool.query("select current_database() as name")).rows[0].name).toBe(DATABASE);

    // The service role's key, as the site holds it, signed with the fixture's secret.
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const head = `${part({ alg: "HS256", typ: "JWT" })}.${part({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    token = `${head}.${createHmac("sha256", secret!).update(head).digest("base64url")}`;
    vi.stubEnv("SUPABASE_URL", api.origin);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", token);
    vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
    vi.stubEnv("EVERLOOT_CHAT_WORKSPACE", "1");
    // Supabase serves PostgREST under /rest/v1/, and the local one answers at its root. Nothing else may be fetched.
    direct = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(`${api.origin}/rest/v1/`)) throw new Error(`Unexpected fetch: ${url}`);
      return direct(url.replace("/rest/v1/", "/"), init);
    });
    // The clock this process keeps, so the test can let the minute pass after which it asks for the migration again.
    const real = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => real() + skew);

    await pool.query("drop schema public cascade");
    await pool.query("create schema public");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await pool.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
    }
    await pool.query("alter role service_role bypassrls");
    await pool.query("grant usage on schema public to anon, authenticated, service_role");
    await pool.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
    await pool.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
    for (const file of CHAIN) await pool.query(await migration(file));
    await pool.query("notify pgrst, 'reload schema'");
    await until(async () => (await rest("saved_builds?select=id&limit=0")).status === 200, "load the legacy schema");
    const user = async (bnet: string, tag: string) => (await pool.query("insert into public.users (bnet_id, battletag) values ($1, $2) returning id", [bnet, tag])).rows[0].id;
    owner = await user("bnet-87017", "Thrall#1234");
    other = await user("bnet-87018", "Jaina#2002");
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await pool?.end();
  });

  test("PostgREST, before the migration: 42703 for the order columns, PGRST202 for save_build_plan, and nothing is written", async () => {
    const read = await rest("saved_builds?select=id,point_order,point_order2&limit=0");
    const write = await rest("rpc/save_build_plan", { p_user_id: owner, p_payload: { name: "probe" } });
    console.log("before the migration:", JSON.stringify({ read, write }));
    expect(read).toMatchObject({ status: 400, body: { code: "42703", message: "column saved_builds.point_order does not exist" } });
    expect(write).toMatchObject({ status: 404, body: { code: "PGRST202" } });
    expect(write.body?.message).toContain("public.save_build_plan(");
    expect(await state(owner)).toEqual({ rows: [], saves: 0 });
  });

  test("Chat lists and saves its private builds as it did: the reads fall back, a save that names no order goes through save_build", async () => {
    session.user = { id: owner, name: "Thrall#1234" };
    const listed = await chat();
    expect(listed.status).toBe(200);
    expect((await listed.json()).builds).toEqual([]);
    const made = await chat({ name: "Test chat build", code: MAGE });
    expect(made.status).toBe(201);
    const { build } = await made.json();
    expect(build).toMatchObject({ name: "Test chat build", code: MAGE, shared: false, showName: false, active: false, link: null });
    expect(build).not.toHaveProperty("order");
    chatBuild = build.id;
    const edited = await chat({ id: chatBuild, name: "Test chat build 2", code: MAGE4 });
    expect(edited.status).toBe(200);
    expect((await state(owner)).rows).toEqual([
      { id: chatBuild, name: "Test chat build 2", code: MAGE4, code2: null, shared: false, show_name: false, active: false },
    ]);
  });

  test("a save that names an order, an unknown one too, is refused before anything is written", async () => {
    const before = await state(owner);
    for (const res of [
      await chat({ name: "Test order", code: MAGE, order: ORDER }),
      await account({ name: "Test order", code: MAGE, order: null, order2: null, shared: true, showName: false }),
      await account({ id: chatBuild, name: "Test order", code: MAGE, order: ORDER }),
      // A transfer key is kept only by save_build_plan too: never sent to save_build, which would drop it.
      await account({ name: "Test transfer", code: MAGE, shared: false, showName: false, transferKey: "Test-transfer-key-0000" }),
    ]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: UNAVAILABLE, code: "orders_unavailable" });
    }
    expect(await state(owner)).toEqual(before);
  });

  test("the older path keeps the explicit sharing and every owner check", async () => {
    const before = await state(owner);
    expect((await account({ name: "Test shared", code: MAGE, shared: true })).status).toBe(400);
    expect((await account({ name: "Test shared", code: MAGE }, { "x-everloot-expected-owner": other })).status).toBe(409);
    session.user = { id: other, name: "Jaina#2002" };
    expect((await chat({ id: chatBuild, name: "Mine now", code: MAGE })).status).toBe(404);
    session.user = { id: owner, name: "Thrall#1234" };
    expect(await state(owner)).toEqual(before);
    expect(await state(other)).toEqual({ rows: [], saves: 0 });
    // A calculator-style save that names its sharing and no order is saved as it says.
    const made = await account({ name: "Test shared", code: MAGE, shared: true, showName: false });
    expect(made.status).toBe(201);
    const { build } = await made.json();
    expect((await state(owner)).rows.find((r) => r.id === build.id)).toMatchObject({ shared: true, show_name: false });
    // Its short link reads as it always did, with no orders to give.
    const shared = await sharedBuild(build.slug);
    expect(shared).toMatchObject({ name: "Test shared", code: MAGE });
    expect(shared).not.toHaveProperty("order");
  });

  test("applied on the same database, the same process takes save_build_plan once it asks again", async () => {
    await pool.query(await migration("20261027120000_saved_build_point_order.sql"));
    await until(async () => (await rest("rpc/save_build_plan", { p_user_id: null, p_payload: {} })).status === 400, "load save_build_plan");
    // For the rest of the minute after it found the migration missing, the process goes on without it.
    const before = await state(owner, true);
    expect((await chat({ name: "Test order", code: MAGE, order: ORDER })).status).toBe(409);
    expect(await state(owner, true)).toEqual(before);
    skew += ORDERS_RECHECK_MS;
    const made = await chat({ name: "Test ordered", code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 });
    expect(made.status).toBe(201);
    const { build } = await made.json();
    expect(build).toMatchObject({ code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2, shared: false, showName: false });
    ordered = build.id;
    expect((await state(owner, true)).rows.find((r) => r.id === ordered)).toMatchObject({ point_order: ORDER, point_order2: ORDER2, shared: false });
    // Builds saved before the migration now read with their orders unknown; an edit from Chat that names no order keeps
    // the ones a build has while its codes stay the same.
    const { builds } = await (await chat()).json();
    expect(builds.find((b: { id: string }) => b.id === chatBuild)).toMatchObject({ order: null, order2: null });
    expect((await chat({ id: ordered, name: "Test ordered 2", code: MAGE, code2: MAGE2 })).status).toBe(200);
    expect((await state(owner, true)).rows.find((r) => r.id === ordered)).toMatchObject({ name: "Test ordered 2", point_order: ORDER, point_order2: ORDER2 });
    // The calculator's save with its orders, through the account route, and its short link with them.
    const calc = await account({ name: "Test calculator", code: MAGE, order: ORDER, order2: null, shared: true, showName: false });
    expect(calc.status).toBe(201);
    const shared = await sharedBuild((await calc.json()).build.slug);
    expect(shared).toMatchObject({ code: MAGE, order: ORDER, order2: null });
  });

  test("a new build sent again with its transfer key is answered with the build it made, and two at once make one", async () => {
    const key = "Test-transfer-key-0001";
    const body = { name: "Test transferred", code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2, shared: false, showName: false, transferKey: key };
    const before = await state(owner, true);
    const first = await account(body);
    expect(first.status).toBe(201);
    const made = await first.json();
    const after = await state(owner, true);
    expect([after.rows.length, after.saves]).toEqual([before.rows.length + 1, before.saves + 1]);
    // Its first answer lost, the same save again: a 200 with the same build, nothing written and no save counted.
    const again = await account({ ...body, name: "Test renamed" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(made);
    expect(await state(owner, true)).toEqual(after);
    // Another account's same key is its own.
    session.user = { id: other, name: "Jaina#2002" };
    const theirs = await account(body);
    expect(theirs.status).toBe(201);
    expect((await theirs.json()).build.id).not.toBe(made.build.id);
    session.user = { id: owner, name: "Thrall#1234" };
    // Two at once with a new key: one build, one 201, and the other a 200 with that build.
    const raced = await Promise.all([account({ ...body, transferKey: "Test-transfer-key-0002" }), account({ ...body, transferKey: "Test-transfer-key-0002" })]);
    expect(raced.map((r) => r.status).sort()).toEqual([200, 201]);
    const [one, two] = await Promise.all(raced.map((r) => r.json()));
    expect(one).toEqual(two);
    expect((await pool.query("select count(*)::int as n from public.saved_builds where user_id = $1 and transfer_key = $2", [owner, "Test-transfer-key-0002"])).rows[0].n).toBe(1);
    // A key of another shape, or one on an update, is refused before anything is asked.
    const counted = await state(owner, true);
    expect((await account({ ...body, transferKey: "short" })).status).toBe(400);
    expect((await account({ id: made.build.id, name: "Test transferred", code: MAGE, transferKey: key })).status).toBe(400);
    expect(await state(owner, true)).toEqual(counted);
  });

  test("at the day's last save, two at once with one key are a 201 and a 200 with its build, not a 429", async () => {
    const body = { name: "Test last save", code: MAGE, shared: false, showName: false, transferKey: "Test-transfer-key-0003" };
    const bucket = `builds:${owner}`;
    const { saves } = await state(owner);
    await pool.query("update public.intake_quota_buckets set count = 299 where bucket = $1", [bucket]);
    // The account's row held, so both have looked for the key and found nothing by the time it is let go.
    const holder = await pool.connect();
    let raced: Response[];
    try {
      await holder.query("begin");
      await holder.query("select 1 from public.users where id = $1 for update", [owner]);
      const pending = Promise.all([account(body), account(body)]);
      await until(async () => (await pool.query(
        "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'")).rows[0].n >= 2,
      "send both saves");
      await holder.query("commit");
      raced = await pending;
    } catch (error) {
      await holder.query("rollback").catch(() => {});
      throw error;
    } finally {
      holder.release();
    }
    const counted = [(await state(owner)).saves,
      (await pool.query("select count(*)::int as n from public.saved_builds where user_id = $1 and transfer_key = $2", [owner, body.transferKey])).rows[0].n];
    // Put back before anything is checked, so the tests after this one keep their saves.
    await pool.query("update public.intake_quota_buckets set count = $2 where bucket = $1", [bucket, saves + 1]);
    expect(raced.map((r) => r.status).sort()).toEqual([200, 201]);
    const [one, two] = await Promise.all(raced.map((r) => r.json()));
    expect(one).toEqual(two);
    expect(counted).toEqual([300, 1]);
  });

  test("a function save_build_plan needs, missing, is a failure with nothing written, not the function missing", async () => {
    // A fault made on purpose: save_build_plan calls a helper the database does not have. PostgREST names that helper.
    await pool.query(`create or replace function public.save_build_plan(p_user_id uuid, p_payload jsonb) returns jsonb
      language plpgsql security definer set search_path = '' set lock_timeout = '3s'
      as $$ begin return public.save_build_plan_validate(p_user_id, p_payload); end; $$`);
    const probe = await rest("rpc/save_build_plan", { p_user_id: owner, p_payload: { name: "probe" } });
    console.log("a helper missing:", JSON.stringify(probe));
    expect(probe).toMatchObject({ status: 404, body: { code: "42883", message: "function public.save_build_plan_validate(uuid, jsonb) does not exist" } });
    const before = await state(owner, true);
    expect((await account({ name: "Test fault", code: MAGE, shared: true, showName: false })).status).toBe(503);
    expect((await chat({ name: "Test fault", code: MAGE })).status).toBe(503);
    expect((await chat({ id: ordered, name: "Test fault", code: MAGE, code2: MAGE2 })).status).toBe(503);
    expect(await state(owner, true)).toEqual(before);
    // The file as it is, again: the very next save with orders goes through save_build_plan, nothing remembered.
    await pool.query(await migration("20261027120000_saved_build_point_order.sql"));
    const res = await chat({ id: ordered, name: "Test ordered again", code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 });
    expect(res.status).toBe(200);
    expect((await state(owner, true)).rows.find((r) => r.id === ordered)).toMatchObject({ name: "Test ordered again", point_order: ORDER, point_order2: ORDER2 });
  });

  test("a drop PostgREST is not told about, answered from its stale schema cache, is the function missing too", async () => {
    await pool.query("drop function public.save_build_plan(uuid, jsonb)");
    const stale = await rest("rpc/save_build_plan", { p_user_id: null, p_payload: {} });
    console.log("a stale schema cache:", JSON.stringify(stale));
    expect(stale).toMatchObject({ status: 404, body: { code: "42883", message: "function public.save_build_plan(p_user_id => uuid, p_payload => jsonb) does not exist" } });
    const before = await state(owner, true);
    expect((await chat({ id: ordered, name: "Test stale", code: MAGE, code2: MAGE2, order: ORDER })).status).toBe(409);
    expect(await state(owner, true)).toEqual(before);
    expect((await chat({ id: ordered, name: "Test stale", code: MAGE, code2: MAGE2 })).status).toBe(200);
    expect((await state(owner, true)).rows.find((r) => r.id === ordered)).toMatchObject({ name: "Test stale", point_order: ORDER, point_order2: ORDER2 });
    // Put back, and let this process's minute pass.
    await pool.query(await migration("20261027120000_saved_build_point_order.sql"));
    await until(async () => (await rest("rpc/save_build_plan", { p_user_id: null, p_payload: {} })).status === 400, "load save_build_plan");
    skew += ORDERS_RECHECK_MS;
  });

  test("after the rollback the orders stay, a save that names none goes through save_build, and one that names an order is refused", async () => {
    const doc = (await readFile(new URL("docs/2026-10-27-saved-builds-activation.md", repo), "utf8")).replace(/\r\n/g, "\n");
    const rollback = doc.match(/```sql\n(-- point order rollback\n[\s\S]*?)```/)![1];
    await pool.query(rollback);
    await until(async () => (await rest("rpc/save_build_plan", { p_user_id: null, p_payload: {} })).status === 404, "drop save_build_plan");
    const kept = await state(owner, true);
    expect(kept.rows.find((r) => r.id === ordered)).toMatchObject({ point_order: ORDER, point_order2: ORDER2 });
    // The process finds out on its next save: the answer that the function is missing says nothing was written.
    expect((await chat({ id: ordered, name: "Test ordered 3", code: MAGE, code2: MAGE2 })).status).toBe(200);
    expect((await state(owner, true)).rows.find((r) => r.id === ordered)).toMatchObject({ name: "Test ordered 3", point_order: ORDER, point_order2: ORDER2 });
    const before = await state(owner, true);
    expect((await chat({ id: ordered, name: "Test ordered 4", code: MAGE, order: null })).status).toBe(409);
    expect(await state(owner, true)).toEqual(before);
    // The columns are still there, so the list still gives the orders.
    const { builds } = await (await chat()).json();
    expect(builds.find((b: { id: string }) => b.id === ordered)).toMatchObject({ order: ORDER, order2: ORDER2 });
  });
});
