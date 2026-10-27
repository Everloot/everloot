import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

// The site's own guide-draft route through a real PostgREST, on the schema production runs with the profiles file and
// 20261027140000_guide_submissions.sql applied: the calls' shapes, ownership, revisions kept as they were sent, and the
// browser roles' keys refused. Only the session is made up. Disposable local fixtures only: this drops the public schema
// of its own database.
// docker network create guide-submissions-rest
// docker run -d --name guide-submissions-rest-db --network guide-submissions-rest -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54423:5432 postgres:17
// docker exec guide-submissions-rest-db createdb -h 127.0.0.1 -U postgres guide_submissions_rest_test
// docker run -d --name guide-submissions-rest-api --network guide-submissions-rest -p 127.0.0.1:54424:3000 -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=<a local secret of 32 characters or more> -e PGRST_DB_URI=postgres://postgres@guide-submissions-rest-db:5432/guide_submissions_rest_test postgrest/postgrest:v12.2.12
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54423/guide_submissions_rest_test LOCAL_REST_URL=http://127.0.0.1:54424 LOCAL_REST_JWT_SECRET=<the same> npx vitest run src/lib/guide-submissions.rest.test.ts
const databaseUrl = process.env.QUOTA_TEST_DATABASE_URL;
const restUrl = process.env.LOCAL_REST_URL;
const secret = process.env.LOCAL_REST_JWT_SECRET;

const session = vi.hoisted(() => ({ user: null as { id: string; name: string } | null }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  getUser: async () => session.user,
}));
// Every class reads the made-up test tree, not game data.
vi.mock("@/lib/talents/catalogs", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/talents/catalogs")>();
  const { fixture } = await import("@/lib/talents/fixture");
  return { ...real, loadCatalog: async (slug: string) => ({ ...fixture, classSlug: slug }) };
});

import { GET, POST } from "@/app/api/me/guides/route";
import { fixture } from "@/lib/talents/fixture";
import { encodeBuild, encodeOrder } from "@/lib/talents/share";
import type { Ranks } from "@/lib/talents/types";

const DATABASE = "guide_submissions_rest_test";
const repo = new URL("../../../", import.meta.url);
// What production has applied, in its order (as in scripts/guide-submissions.integration.mjs), and this file.
const CHAIN = [
  "20261003000000_auth_schema.sql", "20261004000000_uploads_waitlist.sql", "20261007070647_verified_publication.sql",
  "20261007220000_intake_quotas.sql", "20261010120000_mcp_quota_scope.sql", "20261018120000_usage_counters.sql",
  "20261019120000_data_guard.sql", "20261021130000_players.sql", "20261021150000_saved_builds.sql",
  "20261025191223_chat_workspace.sql", "20261022160000_players_realm_key.sql", "20261025120000_guilds.sql",
  "20261021170000_account_profiles.sql", "20261027140000_guide_submissions.sql",
];
const migration = (file: string) => readFile(new URL(`supabase/migrations/${file}`, repo), "utf8");
const SITE = "https://everloot.app";
const RANKS: Ranks = { 11: { rank: 5 }, 21: { rank: 1 } };
const CODE = encodeBuild({ classSlug: "mage", specId: fixture.specId, build: fixture.build, ranks: RANKS });
const PLANNED = encodeOrder(RANKS, [11, 11, 11, 11, 11, 21], "planned")!;
const SOURCE = "https://worldofwarcraft.blizzard.com/en-us/news/24302498";
// Test text, not advice.
const filler = (n: number) => Array.from({ length: n }, (_, i) => ["stone", "river", "road", "hill", "mine"][i % 5]).join(" ");
const BODY = [
  "## Who it is for", "", `Players who level a mage on their own. ${filler(40)}`, "",
  "## Why this plan", "", `Blizzard [named the class changes](${SOURCE}) that shape this plan. ${filler(40)}`, "",
  "## How to play it", "", `At level 10, put 5 points in Talent 11, then take Talent 21 at level 15. ${filler(40)}`, "",
  "## What we do not know yet", "", `Whether the point levels hold in the live game is not confirmed. ${filler(20)}`,
].join("\n");
const DRAFT = {
  title: "Test frost leveling", summary: "A plan for leveling a mage on your own.", classSlug: "mage", activity: "leveling",
  roles: ["damage"], levels: { from: 10, to: 60 }, code: CODE, order: PLANNED, code2: null, order2: null,
  sources: [{ title: "Blizzard's announcement", url: SOURCE, checkedOn: "2026-10-19" }], body: BODY,
};

describe.skipIf(!databaseUrl || !restUrl || !secret)("community guide drafts through PostgREST", () => {
  let pool: Pool;
  let direct: typeof fetch;
  let owner = "";
  let other = "";
  let guide = "";
  const token = (role: string) => {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const head = `${part({ alg: "HS256", typ: "JWT" })}.${part({ role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    return `${head}.${createHmac("sha256", secret!).update(head).digest("base64url")}`;
  };
  /** PostgREST itself, with a key of the given role. */
  async function rest(path: string, role: string, body?: object) {
    const res = await direct(new URL(path, restUrl), {
      method: body ? "POST" : "GET", body: body && JSON.stringify(body),
      headers: { authorization: `Bearer ${token(role)}`, "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  async function until(ready: () => Promise<boolean>, what: string) {
    for (let i = 0; i < 100; i++) {
      if (await ready()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`PostgREST did not ${what}`);
  }
  const post = (body: object) => POST(new Request(`${SITE}/api/me/guides`, {
    method: "POST", headers: { origin: SITE, "content-type": "application/json", "x-everloot-expected-owner": session.user!.id }, body: JSON.stringify(body),
  }));
  const list = async () => (await GET(new Request(`${SITE}/api/me/guides`))).json();
  const stored = async (id: string) => (await pool.query(
    "select revision, status, title, author_handle from public.guide_submission_revisions where guide_id = $1 order by revision", [id])).rows;

  beforeAll(async () => {
    const database = new URL(databaseUrl!);
    const api = new URL(restUrl!);
    for (const url of [database, api]) expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    expect(database.pathname).toBe(`/${DATABASE}`);
    expect(database.search + database.hash).toBe("");
    expect(secret!.length).toBeGreaterThanOrEqual(32);
    pool = new Pool({ host: database.hostname, port: Number(database.port || 5432), database: DATABASE, user: decodeURIComponent(database.username) || "postgres" });
    expect((await pool.query("select current_database() as name")).rows[0].name).toBe(DATABASE);

    vi.stubEnv("SUPABASE_URL", api.origin);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", token("service_role"));
    vi.stubEnv("EVERLOOT_GUIDE_SUBMISSIONS", "1");
    vi.stubEnv("EVERLOOT_PROFILES", "1");
    // Supabase serves PostgREST under /rest/v1/, and the local one answers at its root. Nothing else may be fetched.
    direct = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(`${api.origin}/rest/v1/`)) throw new Error(`Unexpected fetch: ${url}`);
      return direct(url.replace("/rest/v1/", "/"), init);
    });

    const probe = async () => (await rest("rpc/withdraw_guide", "service_role", { p_user_id: null, p_guide_id: null, p_revision: null })).status;
    await pool.query("drop schema public cascade");
    await pool.query("create schema public");
    // A database an earlier run used leaves its functions in PostgREST's schema cache. Once the cache has let them go, the
    // wait below can only be answered by this run's.
    await pool.query("notify pgrst, 'reload schema'");
    await until(async () => (await probe()) === 404, "drop the earlier run's schema");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await pool.query(`DO $$ BEGIN IF NOT EXISTS (select from pg_roles where rolname='${role}') THEN CREATE ROLE ${role}; END IF; END $$`);
    }
    await pool.query("alter role service_role bypassrls");
    await pool.query("grant usage on schema public to anon, authenticated, service_role");
    await pool.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
    await pool.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
    for (const file of CHAIN) await pool.query(await migration(file));
    await pool.query("notify pgrst, 'reload schema'");
    await until(async () => (await probe()) === 400, "load the guide functions");
    const user = async (bnet: string, tag: string) => (await pool.query("insert into public.users (bnet_id, battletag) values ($1, $2) returning id", [bnet, tag])).rows[0].id;
    owner = await user("bnet-87017", "Thrall#1234");
    other = await user("bnet-87018", "Jaina#2002");
    await pool.query("select * from public.save_profile($1, 'thrall', null, false, true, true, true)", [owner]);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await pool?.end();
  });

  test("a draft is saved, edited in place and listed for its owner alone, named by handle", async () => {
    session.user = { id: owner, name: "Thrall#1234" };
    expect(await list()).toEqual({ guides: [], author: { handle: "thrall", publicProfile: false } });
    const made = await post({ action: "save", guideId: null, draft: DRAFT });
    expect(made.status).toBe(201);
    ({ guideId: guide } = await made.json());
    const edited = await post({ action: "save", guideId: guide, draft: { ...DRAFT, title: "Test frost leveling, edited" } });
    expect([edited.status, await edited.json()]).toEqual([200, { guideId: guide, revision: 1, status: "draft" }]);
    const { guides } = await list();
    expect(guides).toEqual([{ id: guide, revisions: [expect.objectContaining({ revision: 1, status: "draft", title: "Test frost leveling, edited", author: null })] }]);
    expect(JSON.stringify(guides)).not.toContain("Thrall#1234");
  });

  test("another account sees none of it and cannot touch it", async () => {
    session.user = { id: other, name: "Jaina#2002" };
    expect(await list()).toEqual({ guides: [], author: { handle: null, publicProfile: false } });
    expect((await post({ action: "save", guideId: guide, draft: { ...DRAFT, title: "Mine now" } })).status).toBe(404);
    expect((await post({ action: "withdraw", guideId: guide, revision: 1 })).status).toBe(404);
    // No handle: nothing of theirs can be submitted either.
    const theirs = await (await post({ action: "save", guideId: null, draft: DRAFT })).json();
    expect((await post({ action: "submit", guideId: theirs.guideId, draft: DRAFT, alias: "jaina" })).status).toBe(409);
    expect(await stored(guide)).toEqual([{ revision: 1, status: "draft", title: "Test frost leveling, edited", author_handle: null }]);
  });

  test("the browser roles' keys read and call nothing, through the API itself", async () => {
    // PostgREST 12 answers permission denied (42501); later versions leave what a role may not use out of its schema
    // cache and answer that it is not there (PGRST205 for a table, PGRST202 for a function). Either way, nothing.
    const refused = (res: { status: number; body: { code?: string } }) => [401, 403, 404].includes(res.status) && ["42501", "PGRST205", "PGRST202"].includes(res.body.code ?? "");
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["guide_submissions", "guide_submission_revisions", "guide_moderators"]) {
        const read = await rest(`${table}?select=*`, role);
        expect(refused(read), `${role} ${table}: ${JSON.stringify(read)}`).toBe(true);
      }
      const call = await rest("rpc/save_guide_draft", role, { p_user_id: owner, p_guide_id: guide, p_payload: DRAFT });
      expect(refused(call), `${role}: ${JSON.stringify(call)}`).toBe(true);
      console.log(`${role}:`, JSON.stringify({ status: call.status, code: call.body.code }));
    }
    expect(await stored(guide)).toEqual([{ revision: 1, status: "draft", title: "Test frost leveling, edited", author_handle: null }]);
  });

  test("submitted, the revision is kept as sent under the handle; the owner can withdraw it, once", async () => {
    session.user = { id: owner, name: "Thrall#1234" };
    const sent = await post({ action: "submit", guideId: guide, draft: DRAFT, alias: "thrall" });
    expect([sent.status, await sent.json()]).toEqual([200, { guideId: guide, revision: 1, status: "submitted" }]);
    expect(await stored(guide)).toEqual([{ revision: 1, status: "submitted", title: "Test frost leveling", author_handle: "thrall" }]);
    await expect(pool.query("update public.guide_submission_revisions set title = 'Changed' where guide_id = $1", [guide])).rejects.toThrow(/kept as it was sent/);
    // The profile was not made public by it.
    expect((await pool.query("select public_profile from public.user_profiles where user_id = $1", [owner])).rows[0].public_profile).toBe(false);
    const again = await post({ action: "submit", guideId: guide, draft: DRAFT, alias: "thrall" });
    expect(again.status).toBe(409);
    expect((await post({ action: "withdraw", guideId: guide, revision: 1 })).status).toBe(200);
    expect((await post({ action: "withdraw", guideId: guide, revision: 1 })).status).toBe(409);
    expect((await list()).guides[0].revisions).toEqual([expect.objectContaining({ revision: 1, status: "withdrawn", author: "thrall" })]);
  });
});
