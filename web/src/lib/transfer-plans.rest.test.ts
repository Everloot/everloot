// @vitest-environment jsdom
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Saving device plans to an account (components/workspace/TransferPlans.tsx) through the site's own routes and a real
// PostgREST: the panel in the page, its requests answered by the builds and characters routes, and theirs by the
// fixture's database. First on the schema production runs before 20261027120000_saved_build_point_order.sql, then with
// it applied. Only the session is made up. Disposable local fixtures only: this drops the public schema of its own
// database, and it runs only against a database of that name.
// docker network create transfer-plans-rest
// docker run -d --name transfer-plans-rest-db --network transfer-plans-rest -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:54411:5432 postgres:17
// docker exec transfer-plans-rest-db createdb -U postgres transfer_plans_rest_test
// docker run -d --name transfer-plans-rest-api --network transfer-plans-rest -p 127.0.0.1:54412:3000 -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=<a local secret of 32 characters or more> -e PGRST_DB_URI=postgres://postgres@transfer-plans-rest-db:5432/transfer_plans_rest_test postgrest/postgrest:v12.2.12
// QUOTA_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54411/transfer_plans_rest_test LOCAL_REST_URL=http://127.0.0.1:54412 LOCAL_REST_JWT_SECRET=<the same> npx vitest run src/lib/transfer-plans.rest.test.ts
const databaseUrl = process.env.QUOTA_TEST_DATABASE_URL;
const restUrl = process.env.LOCAL_REST_URL;
const secret = process.env.LOCAL_REST_JWT_SECRET;
const DATABASE = "transfer_plans_rest_test";

const session = vi.hoisted(() => ({ user: null as { id: string; name: string } | null }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  getUser: async () => session.user,
}));

import { GET as listBuilds, POST as postBuild } from "@/app/api/me/builds/route";
import { POST as postCharacter } from "@/app/api/me/characters/route";
import TransferPlans from "@/components/workspace/TransferPlans";
import { bucketKey, readTransfers, type LocalPlan, type Owner, type PlayerWorkspace } from "@/lib/player-workspace";
import { ORDERS_UNAVAILABLE, ORDERS_UNAVAILABLE_CODE } from "@/lib/saved-builds";
import { ORDERS_RECHECK_MS } from "@/lib/saved-builds-store";

// A path, not a URL: under jsdom the global URL is jsdom's, which does not resolve file URLs.
const repo = resolve(import.meta.dirname, "../../..");
// What production has applied, in its order (as in saved-build-point-order.rest.test.ts).
const CHAIN = [
  "20261003000000_auth_schema.sql", "20261004000000_uploads_waitlist.sql", "20261007070647_verified_publication.sql",
  "20261007220000_intake_quotas.sql", "20261010120000_mcp_quota_scope.sql", "20261018120000_usage_counters.sql",
  "20261019120000_data_guard.sql", "20261021130000_players.sql", "20261021150000_saved_builds.sql",
  "20261025191223_chat_workspace.sql", "20261022160000_players_realm_key.sql", "20261025120000_guilds.sql",
  "20261021170000_account_profiles.sql",
];
const migration = (file: string) => readFile(resolve(repo, "supabase/migrations", file), "utf8");
const SITE = "https://everloot.app";
// Codes and orders the site's catalog reads (as in saved-build-point-order.rest.test.ts).
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE2 = "EL1-mage-1482-1.60.1.70450-MjE6MQ";
const ANON: Owner = { kind: "anonymous" };
const id = (n: number) => `1a2b3c4d-0000-4000-8000-${String(n).padStart(12, "0")}`;
const plan = (n: number, name: string, over: Partial<LocalPlan> = {}): LocalPlan => ({
  id: id(n), name, classSlug: "mage", code: MAGE, code2: null, order: "O1p-AAAAA", order2: null, notes: "",
  updatedAt: "2026-10-20T12:00:00.000Z", boundTo: null, ...over,
});
const seed = (plans: LocalPlan[]) => localStorage.setItem(bucketKey(ANON), JSON.stringify({
  format: "everloot.player-workspace", version: 2, owner: ANON, plans, alts: [], watches: [],
} satisfies PlayerWorkspace));
const stored = (owner: Owner) => JSON.parse(localStorage.getItem(bucketKey(owner)) ?? "null") as PlayerWorkspace | null;
/** Everything this browser keeps, to show that nothing changed. */
const device = () => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));

describe.skipIf(!databaseUrl || !restUrl || !secret || !databaseUrl.endsWith(`/${DATABASE}`))("saving device plans to an account through the routes and PostgREST", () => {
  let pool: Pool;
  let direct: typeof fetch;
  let token = "";
  let skew = 0;
  let owner = "";
  let api: URL;
  /** Every build request the panel made: its key and the site's status. */
  let sent: Array<{ key: unknown; status: number }>;
  /** Set by a test: what happens to a build request's answer once the route has given it. */
  let onAnswer: ((response: Response) => Promise<Response>) | null;
  let container: HTMLDivElement;
  let root: Root;
  /** Every panel mounted in a test, the latest one being `container` and `root`. */
  let mounted: Array<{ container: HTMLDivElement; root: Root }>;

  /** PostgREST itself, as the service role. */
  async function rest(path: string, body?: object) {
    const res = await direct(new URL(path, restUrl), {
      method: body ? "POST" : "GET", body: body && JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
    });
    return res.status;
  }
  async function until(ready: () => boolean | Promise<boolean>, what: string) {
    for (let i = 0; i < 250; i++) {
      if (await ready()) return;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    }
    throw new Error(`Timed out waiting for ${what}`);
  }
  /** The account's builds, counted, on any schema. */
  const builds = async () => Number((await pool.query("select count(*) from public.saved_builds where user_id = $1", [owner])).rows[0].count);
  const rows = async () => (await pool.query(
    "select name, shared, show_name, point_order, point_order2, transfer_key from public.saved_builds where user_id = $1 order by name, id", [owner],
  )).rows as Array<{ name: string; shared: boolean; show_name: boolean; point_order: string | null; point_order2: string | null; transfer_key: string | null }>;

  /** What the panel asks of the site, answered by the site's routes; the routes' own requests go to the fixture. */
  async function site(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    if (url.startsWith(`${api.origin}/rest/v1/`)) return direct(url.replace("/rest/v1/", "/"), init);
    if (url === "/api/auth/me") return Response.json({ user: session.user && { ...session.user, entitlements: [] } });
    const headers = { ...(init?.headers as Record<string, string> | undefined), origin: SITE };
    const request = new Request(`${SITE}${url}`, { method: init?.method ?? "GET", headers, body: init?.body });
    if (url === "/api/me/characters") return postCharacter(request);
    if (url !== "/api/me/builds") throw new Error(`Unexpected request: ${url}`);
    if ((init?.method ?? "GET") === "GET") return listBuilds(request);
    const response = await postBuild(request);
    sent.push({ key: JSON.parse(String(init?.body)).transferKey, status: response.status });
    return onAnswer ? onAnswer(response) : response;
  }

  const text = () => container.textContent ?? "";
  const button = (label: RegExp) => [...container.querySelectorAll("button")].find((b) => label.test(b.textContent?.trim() ?? ""));
  const field = (label: string) =>
    [...container.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select") ?? null;
  async function click(el: Element | null | undefined) {
    if (!el) throw new Error("Nothing to click");
    await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  }
  async function choose(control: HTMLSelectElement | null, value: string) {
    if (!control) throw new Error("No field");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => { setter.call(control, value); control.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  /** The panel, opened on the account and with these plans chosen, private: then Save. */
  async function transfer(names: string[]) {
    await until(() => !!button(/^Choose plans to save to your account$/), "the offer");
    await click(button(/^Choose plans to save to your account$/));
    await until(() => text().includes("Saving to your account, Thrall#1234, the one signed in here now."), "the account's builds");
    for (const name of names) {
      await click(field(`Save ${name} to your account`));
      await choose(field(`Sharing for ${name}`) as HTMLSelectElement, "private");
    }
    await click(button(/^Save to your account$/));
  }
  async function mount() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mounted.push({ container, root });
    await act(async () => root.render(createElement(TransferPlans)));
  }

  beforeAll(async () => {
    const database = new URL(databaseUrl!);
    api = new URL(restUrl!);
    for (const url of [database, api]) expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    expect(database.pathname).toBe(`/${DATABASE}`);
    expect(database.search + database.hash).toBe("");
    expect(secret!.length).toBeGreaterThanOrEqual(32);
    pool = new Pool({ host: database.hostname, port: Number(database.port || 5432), database: DATABASE, user: decodeURIComponent(database.username) || "postgres" });
    expect((await pool.query("select current_database() as name")).rows[0].name).toBe(DATABASE);
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const head = `${part({ alg: "HS256", typ: "JWT" })}.${part({ role: "service_role", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    token = `${head}.${createHmac("sha256", secret!).update(head).digest("base64url")}`;
    vi.stubEnv("SUPABASE_URL", api.origin);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", token);
    vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
    direct = globalThis.fetch;
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
    for (let i = 0; i < 100 && (await rest("saved_builds?select=id&limit=0")) !== 200; i++) await new Promise((r) => setTimeout(r, 100));
    owner = (await pool.query("insert into public.users (bnet_id, battletag) values ('bnet-93001', 'Thrall#1234') returning id")).rows[0].id;
    session.user = { id: owner, name: "Thrall#1234" };
  });

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", site);
    localStorage.clear();
    sent = [];
    onAnswer = null;
    mounted = [];
  });

  afterEach(async () => {
    for (const panel of mounted) {
      await act(async () => panel.root.unmount());
      panel.container.remove();
    }
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await pool?.end();
  });

  test("before the spend-order migration a transfer is refused with orders_unavailable, nothing is written, and the device is as it was", async () => {
    seed([plan(1, "Frost")]);
    const before = device();
    await mount();
    await transfer(["Frost"]);
    await until(() => text().includes("Saving spend orders isn't available yet"), "the refusal");
    expect(text()).toContain("Saving spend orders isn't available yet, so no plans were saved to your account. They stay on this device as they were, spend orders included.");
    expect(sent.map((s) => s.status)).toEqual([409]);
    expect(sent[0].key).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(device()).toEqual(before);
    expect(await builds()).toBe(0);
    // The route's own answer to a save with a key: the code and the message, and still nothing written.
    const res = await postBuild(new Request(`${SITE}/api/me/builds`, {
      method: "POST", headers: { origin: SITE, "content-type": "application/json", "x-everloot-expected-owner": owner },
      body: JSON.stringify({ name: "Frost", code: MAGE, shared: false, showName: false, order: "O1p-AAAAA", order2: null, transferKey: "device-plan-0123456789" }),
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: ORDERS_UNAVAILABLE, code: ORDERS_UNAVAILABLE_CODE });
    expect(await builds()).toBe(0);
  });

  test("with the migration in, a transfer lands with both spend orders, private, each plan under a key of its own", async () => {
    await pool.query(await migration("20261027120000_saved_build_point_order.sql"));
    for (let i = 0; i < 100 && (await rest("rpc/save_build_plan", { p_user_id: null, p_payload: {} })) !== 400; i++) await new Promise((r) => setTimeout(r, 100));
    // The process found the migration missing in the test before: it asks again after its minute.
    skew += ORDERS_RECHECK_MS;
    seed([plan(1, "Frost"), plan(2, "Fire", { code2: MAGE2, order: "O1g-AAAAA", order2: "O1p-A", notes: "For raids" })]);
    await mount();
    await transfer(["Frost", "Fire"]);
    await until(() => text().includes("Saved 2 plans to your account."), "the saves");
    expect(sent.map((s) => s.status)).toEqual([201, 201]);
    const saved = await rows();
    expect(saved.map(({ transfer_key: _, ...row }) => row)).toEqual([
      { name: "Fire", shared: false, show_name: false, point_order: "O1g-AAAAA", point_order2: "O1p-A" },
      { name: "Frost", shared: false, show_name: false, point_order: "O1p-AAAAA", point_order2: null },
    ]);
    expect(new Set(saved.map((r) => r.transfer_key)).size).toBe(2);
    expect(saved.map((r) => r.transfer_key).sort()).toEqual(sent.map((s) => s.key).sort());
    expect(stored(ANON)!.plans).toEqual([]);
    expect(stored({ kind: "account", userId: owner })!.plans.map((p) => [p.name, p.order, p.order2, p.boundTo?.userId])).toEqual([
      ["Frost", "O1p-AAAAA", null, owner], ["Fire", "O1g-AAAAA", "O1p-A", owner],
    ]);
  });

  test("a save whose answer is lost is sent again with the same key, answered 200 with the build it made, and there is one build", async () => {
    seed([plan(3, "Arcane")]);
    await mount();
    // The route saves the build; its answer never reaches the panel.
    onAnswer = async () => { onAnswer = null; throw new TypeError("The connection dropped after the save"); };
    await transfer(["Arcane"]);
    await until(() => text().includes("Your account could not be reached while Arcane was being saved"), "the lost answer");
    expect((await rows()).filter((r) => r.name === "Arcane")).toHaveLength(1);
    const kept = readTransfers(localStorage);
    expect(kept.ok && kept.transfers.receipts.find((r) => r.planId === id(3))).toMatchObject({ state: "sending", key: sent[0].key });
    await transfer(["Arcane"]);
    await until(() => text().includes("Saved 1 plan to your account."), "the retry");
    expect(sent.map((s) => s.status)).toEqual([201, 200]);
    expect(sent[1].key).toBe(sent[0].key);
    expect((await rows()).filter((r) => r.name === "Arcane")).toHaveLength(1);
    expect(stored({ kind: "account", userId: owner })!.plans.find((p) => p.id === id(3))?.boundTo?.userId).toBe(owner);
    expect(stored(ANON)!.plans).toEqual([]);
  });

  test("a resend the route answers 200 with the build it made earlier keeps a copy changed since then here, unsaved", async () => {
    seed([plan(6, "Fury")]);
    await mount();
    onAnswer = async () => { onAnswer = null; throw new TypeError("The connection dropped after the save"); };
    await transfer(["Fury"]);
    await until(() => text().includes("Your account could not be reached while Fury was being saved"), "the lost answer");
    // Changed here before the retry: the route has the plan as it was first sent, and says only 200.
    const changed = plan(6, "Fury", { notes: "Changed after the lost answer", updatedAt: "2026-10-27T12:00:00.000Z" });
    seed([changed]);
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: bucketKey(ANON) })); });
    await transfer(["Fury"]);
    await until(() => text().includes("Fury was saved to your account before, and the copy here differs from it now, so the copy here stays, signed out."), "the replay");
    expect(sent.map((s) => s.status)).toEqual([201, 200]);
    expect(sent[1].key).toBe(sent[0].key);
    expect((await pool.query("select notes from public.saved_builds where user_id = $1 and name = 'Fury'", [owner])).rows).toEqual([{ notes: null }]);
    expect(stored(ANON)!.plans).toEqual([changed]);
    // Nothing was bound: this device keeps no copy for the account.
    expect(stored({ kind: "account", userId: owner })).toBeNull();
  });

  test("two transfers of the same plans at once make one build per plan", async () => {
    seed([plan(4, "Holy"), plan(5, "Shadow", { order: "O1g-AAAAA" })]);
    await mount();
    const first = { container, root };
    // The first transfer's first save is made, and its answer waits.
    let release = () => {};
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    onAnswer = async (response) => { onAnswer = null; await waiting; return response; };
    await transfer(["Holy", "Shadow"]);
    await until(() => sent.length === 1, "the first save");
    // A second transfer of the same plans, in another panel, while the first waits.
    await mount();
    await transfer(["Holy", "Shadow"]);
    await until(() => text().includes("Saved 2 plans to your account."), "the second transfer");
    release();
    container = first.container;
    root = first.root;
    await until(() => text().includes("Saved 1 plan to your account."), "the first transfer");
    const made = (await rows()).filter((r) => r.name === "Holy" || r.name === "Shadow");
    expect(made.map((r) => r.name)).toEqual(["Holy", "Shadow"]);
    // The first transfer's save of Holy made it (201); the second's was answered with it (200), under the same key, and
    // made Shadow (201). The first then found Shadow saved, and sent nothing more.
    expect(sent).toEqual([{ key: sent[0].key, status: 201 }, { key: sent[0].key, status: 200 }, { key: sent[2].key, status: 201 }]);
    expect(sent[2].key).not.toBe(sent[0].key);
    expect(stored(ANON)!.plans).toEqual([]);
  });
});
