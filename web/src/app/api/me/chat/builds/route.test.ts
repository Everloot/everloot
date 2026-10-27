import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { GET, POST } from "./route";
import { ORDERS_RECHECK_MS } from "@/lib/saved-builds-store";

const SITE = "https://everloot.app";
const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const OTHER = "99999999-2222-4333-8444-555555555555";
const BUILD_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const CHARACTER_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE2 = "EL1-mage-1482-1.60.1.70450-MjE6MQ";
// MAGE's 5 points in node 11 and MAGE2's one in node 21, in spend order: one planned, one generated.
const ORDER = "O1p-AAAAA";
const ORDER2 = "O1g-A";
const row = (over: object = {}) => ({
  id: BUILD_ID, slug: "AbCd1234", name: "Fire", notes: null, class_slug: "mage", character_id: CHARACTER_ID, code: MAGE, code2: null,
  game_build: "1.60.1.70450", shared: true, show_name: true, active: true, updated_at: "2026-10-20T12:00:00+00:00",
  point_order: null, point_order2: null, ...over,
});
const call = (method: string, body?: object, headers: Record<string, string> = {}) =>
  new Request(`${SITE}/api/me/chat/builds`, {
    method, headers: { origin: SITE, "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
const save = (build: object, over: object = {}, headers: Record<string, string> = {}) =>
  POST(call("POST", { expectedAccountId: USER.id, build, ...over }, headers));
const saveCall = () => auth.authQuery.mock.calls.find(([p]) => p === "rpc/save_build_plan");
/** What save_build_plan was sent: the account, and the build with its orders. */
const rpc = () => JSON.parse(saveCall()![1].body) as { p_user_id: string; p_payload: Record<string, unknown> };
const sent = () => rpc().p_payload;
const SAVED = { build_ref: BUILD_ID, build_slug: "AbCd1234", refusal: null };
/** The database: the owner's list, save_build_plan's answer and the saved row read back. */
function database(owned: object[], saved: object = row()) {
  auth.authQuery.mockImplementation(async (path: string) => {
    if (path.startsWith("build_characters")) return [];
    if (path === "rpc/save_build_plan") return SAVED;
    if (path.includes("&id=eq.")) return [saved];
    return owned;
  });
}

/** A request PostgREST refused, as authQuery throws it: the status, and the code and message from the body. */
const refused = (status: number, code: string, reason: string) =>
  Object.assign(new Error(`Authentication storage failed (${status})`), { status, code, reason });
/** Production's database before 20261027120000_saved_build_point_order.sql, as PostgREST answers for it. */
function beforeMigration(owned: object[]) {
  const legacyRow = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("point_order")));
  auth.authQuery.mockImplementation(async (path: string) => {
    if (path === "rpc/save_build_plan") throw refused(404, "PGRST202", "Could not find the function public.save_build_plan(p_payload, p_user_id) in the schema cache");
    if (path.includes("point_order")) throw refused(400, "42703", "column saved_builds.point_order does not exist");
    if (path.startsWith("build_characters")) return [];
    if (path === "rpc/save_build") return [SAVED];
    return owned.map((r) => legacyRow(r as Record<string, unknown>));
  });
}
const legacySent = () => JSON.parse(auth.authQuery.mock.calls.find(([p]) => p === "rpc/save_build")![1].body);

// Each test starts more than a minute after the one before, so a migration one test found missing is asked for again.
let now = Date.now();

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHAT_WORKSPACE", "1");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
  now += ORDERS_RECHECK_MS + 1;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("before the spend-order migration, with saved builds off, Chat lists and saves its private builds as it did", async () => {
  beforeMigration([row({ shared: false, show_name: false, active: false })]);
  const list = await GET(call("GET"));
  expect(list.status).toBe(200);
  const { builds } = await list.json();
  expect(builds[0]).toMatchObject({ id: BUILD_ID, shared: false });
  expect(builds[0]).not.toHaveProperty("order");
  // A new build: save_build, private, unmarked and anonymous.
  expect((await save({ name: "Fire", code: MAGE })).status).toBe(201);
  expect(legacySent()).toMatchObject({ p_user_id: USER.id, p_id: null, p_name: "Fire", p_code: MAGE, p_shared: false, p_show_name: false, p_active: false });
  // An edit of the account's own build keeps its switches, through save_build too.
  auth.authQuery.mockClear();
  expect((await save({ id: BUILD_ID, name: "Frost", code: MAGE })).status).toBe(200);
  expect(legacySent()).toMatchObject({ p_id: BUILD_ID, p_name: "Frost", p_shared: null, p_show_name: null, p_active: null });
});

test("a function save_build_plan needs, missing, is not save_build_plan missing: unconfirmed, no older save, and the next save asks again", async () => {
  auth.authQuery.mockImplementation(async (path: string) => {
    if (path === "rpc/save_build_plan") throw refused(404, "42883", "function public.save_build_plan_validate(uuid, jsonb) does not exist");
    if (path === "rpc/save_build") return [SAVED];
    return path.startsWith("build_characters") ? [] : [row()];
  });
  const res = await save({ name: "Fire", code: MAGE });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "We could not confirm the save. Check your builds before trying again.", code: "save_unconfirmed" });
  expect(auth.authQuery.mock.calls.find(([p]) => p === "rpc/save_build")).toBeUndefined();
  database([], row({ shared: false, show_name: false, active: false, point_order: ORDER }));
  auth.authQuery.mockClear();
  expect((await save({ name: "Fire", code: MAGE, order: ORDER })).status).toBe(201);
  expect(saveCall()).toBeDefined();
});

test("before the migration a Chat save that names an order is refused as not saved, never as unconfirmed", async () => {
  beforeMigration([row()]);
  const res = await save({ name: "Fire", code: MAGE, order: ORDER });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "Saving spend orders isn't available yet, so this build was not saved.", code: "orders_unavailable" });
  expect(auth.authQuery.mock.calls.find(([p]) => p === "rpc/save_build")).toBeUndefined();
});

test("the workspace switch alone opens it: off is a 404 even with saved builds on", async () => {
  vi.stubEnv("EVERLOOT_CHAT_WORKSPACE", "");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  expect((await GET(call("GET"))).status).toBe(404);
  expect((await save({ name: "a", code: MAGE })).status).toBe(404);
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("signed out is a 401, and a bearer key is not a session", async () => {
  auth.getUser.mockResolvedValue(null);
  const key = { authorization: `Bearer evl_${"a".repeat(64)}` };
  for (const res of [await GET(call("GET", undefined, key)), await save({ name: "a", code: MAGE }, {}, key)]) {
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("another site, or no Origin, cannot save", async () => {
  expect((await save({ name: "a", code: MAGE }, {}, { origin: "https://evil.example" })).status).toBe(403);
  const bare = new Request(`${SITE}/api/me/chat/builds`, { method: "POST", body: JSON.stringify({ expectedAccountId: USER.id, build: { name: "a", code: MAGE } }) });
  expect((await POST(bare)).status).toBe(403);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a save meant for another account is refused before anything is read or saved", async () => {
  auth.getUser.mockResolvedValue({ id: OTHER, name: "Jaina#2" });
  const res = await save({ name: "a", code: MAGE });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code: "account_mismatch" });
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("GET lists the owner's builds and characters with the account id", async () => {
  auth.authQuery.mockImplementation(async (path: string) => path.startsWith("build_characters")
    ? [{ id: CHARACTER_ID, name: "Jaina", class_slug: "mage", realm: null, note: null }] : [row({ shared: false })]);
  const res = await GET(call("GET"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const body = await res.json();
  expect(body).toMatchObject({ accountId: USER.id, characters: [{ id: CHARACTER_ID }], builds: [{ id: BUILD_ID, shared: false, link: null }] });
  for (const [path] of auth.authQuery.mock.calls) expect(path).toContain(`user_id=eq.${USER.id}`);
});

test("a new build is private: shared, showName and active are false even when the body asks to share", async () => {
  database([], row({ shared: false, show_name: false, active: false }));
  const res = await save({ name: " Fire ", code: MAGE, notes: "Raids", shared: true, showName: true, active: true, scopes: ["read:own"] },
    { shared: true });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ accountId: USER.id, build: { id: BUILD_ID, shared: false, link: null } });
  expect(rpc().p_user_id).toBe(USER.id);
  expect(sent()).toMatchObject({ id: null, name: "Fire", notes: "Raids", code: MAGE, shared: false, showName: false, active: false });
  expect(sent().slug).toMatch(/^[A-Za-z0-9]{8}$/);
  // Only the build's own fields go on: nothing posted beside them reaches the database.
  expect(Object.keys(sent()).sort()).toEqual(["active", "characterId", "code", "code2", "id", "name", "notes", "shared", "showName", "slug"]);
});

test("updating an owned build keeps its sharing, name display, mark and character as they are", async () => {
  database([row()], row({ name: "Frost" }));
  const res = await save({ id: BUILD_ID, name: "Frost", code: MAGE, shared: false, showName: false, active: false });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ accountId: USER.id, build: { id: BUILD_ID, shared: true } });
  // Null leaves the stored value in save_build_plan, read at write time, so sharing is never switched off here.
  expect(sent()).toMatchObject({ id: BUILD_ID, slug: null, name: "Frost", characterId: CHARACTER_ID, shared: null, showName: null, active: null });
  // The ownership check came first.
  expect(auth.authQuery.mock.calls[0][0]).not.toBe("rpc/save_build_plan");
});

test("an update may move the build to another character label or none", async () => {
  database([row()]);
  expect((await save({ id: BUILD_ID, name: "Frost", code: MAGE, characterId: null })).status).toBe(200);
  expect(sent()).toMatchObject({ characterId: null, shared: null });
});

test("a new private build keeps both sets' spend orders, each with its maker's letter", async () => {
  database([], row({ code2: MAGE2, shared: false, show_name: false, active: false, point_order: ORDER, point_order2: ORDER2 }));
  const res = await save({ name: "Fire", code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 });
  expect(res.status).toBe(201);
  expect(sent()).toMatchObject({ code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2, shared: false, showName: false });
  expect((await res.json()).build).toMatchObject({ order: ORDER, order2: ORDER2, shared: false });
});

test("an edit without orders sends none: the database keeps the stored ones while the codes stay as they are", async () => {
  database([row({ code2: MAGE2, point_order: ORDER, point_order2: ORDER2 })], row({ name: "Frost", code2: MAGE2, point_order: ORDER, point_order2: ORDER2 }));
  const res = await save({ id: BUILD_ID, name: "Frost", code: MAGE, code2: MAGE2 });
  expect(res.status).toBe(200);
  expect(sent()).not.toHaveProperty("order");
  expect(sent()).not.toHaveProperty("order2");
  expect((await res.json()).build).toMatchObject({ name: "Frost", order: ORDER, order2: ORDER2 });
  // An edit that brings orders sends them, an unknown one as null.
  auth.authQuery.mockClear();
  expect((await save({ id: BUILD_ID, name: "Frost", code: MAGE, code2: MAGE2, order: ORDER, order2: null })).status).toBe(200);
  expect(sent()).toMatchObject({ order: ORDER, order2: null });
});

test("the list carries each set's order, so a build reopened from Chat opens with it", async () => {
  auth.authQuery.mockImplementation(async (path: string) => path.startsWith("build_characters") ? []
    : [row({ shared: false, code2: MAGE2, point_order: ORDER, point_order2: ORDER2 })]);
  const body = await (await GET(call("GET"))).json();
  expect(body.builds[0]).toMatchObject({ code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 });
});

test("an id that is not one of the account's builds is a 404 and nothing is saved", async () => {
  database([row({ id: "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33" })]);
  const res = await save({ id: BUILD_ID, name: "Mine", code: MAGE });
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ code: "not_found" });
  expect(saveCall()).toBeUndefined();
});

test("bad input is a 400 before the database is asked", async () => {
  for (const build of [undefined, { name: "", code: MAGE }, { name: "a", code: "nope" }, { name: "a", code: MAGE, code2: "EL1-warrior-0-1.60-MTE6NQ" },
    { id: "x", name: "a", code: MAGE }, { name: "a", code: MAGE, characterId: "x" },
    { name: "a", code: MAGE, order: "O1p-AAAA" }, { name: "a", code: MAGE, order2: ORDER2 }, { id: BUILD_ID, name: "a", code: MAGE, code2: MAGE2, order2: ORDER }]) {
    expect((await save(build as object)).status).toBe(400);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test.each([
  ["not_found", 404, "not_found"], ["class_mismatch", 400, "class_mismatch"], ["build_limit", 409, "build_limit"], ["daily_limit", 429, "daily_limit"],
])("save_build_plan refusing %s is a %i that says so", async (refusal, status, code) => {
  auth.authQuery.mockImplementation(async (path: string) =>
    path === "rpc/save_build_plan" ? { build_ref: null, build_slug: null, refusal } : []);
  const res = await save({ name: "a", code: MAGE, characterId: CHARACTER_ID });
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body.code).toBe(code);
  expect(body).not.toHaveProperty("build");
});

const UNCONFIRMED = "We could not confirm the save. Check your builds before trying again.";

test.each([
  ["save_build_plan fails", (path: string) => path === "rpc/save_build_plan"],
  ["the saved row cannot be read back", (path: string) => path.includes("&id=eq.")],
])("when %s the answer is a 503 that says the save is unconfirmed, not unsaved", async (_name, broken) => {
  auth.authQuery.mockImplementation(async (path: string) => {
    if (broken(path)) throw new Error("down");
    if (path === "rpc/save_build_plan") return SAVED;
    return [];
  });
  const res = await save({ name: "a", code: MAGE });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: UNCONFIRMED, code: "save_unconfirmed" });
});

test("when the ownership check cannot be read nothing was saved, and the answer says so", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  const res = await save({ id: BUILD_ID, name: "a", code: MAGE });
  expect(res.status).toBe(503);
  expect((await res.json()).error).toMatch(/Nothing was saved/);
  expect(saveCall()).toBeUndefined();
});

test("storage trouble is a 503, never a silent save", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  expect((await GET(call("GET"))).status).toBe(503);
  const res = await save({ name: "a", code: MAGE });
  expect(res.status).toBe(503);
  expect(await res.json()).not.toHaveProperty("build");
});
