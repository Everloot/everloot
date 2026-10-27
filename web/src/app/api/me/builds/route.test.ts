import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";
import { hashKey } from "@/lib/api-keys";
import { newSlug } from "@/lib/saved-builds-store";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const BUILD_ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const CHARACTER_ID = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const MAGE = "EL1-mage-0-1.60.1.70450-MTE6NQ";
const MAGE2 = "EL1-mage-1482-1.60.1.70450-MjE6MQ";
// MAGE's 5 points in node 11 and MAGE2's one in node 21, in spend order: one planned, one generated.
const ORDER = "O1p-AAAAA";
const ORDER2 = "O1g-A";
const KEY = `evl_${"a".repeat(64)}`;
/** A build as a table read returns it: the #450 columns and the two order columns. */
const row = (over: object = {}) => ({
  id: BUILD_ID, slug: "AbCd1234", name: "Fire", notes: null, class_slug: "mage", character_id: CHARACTER_ID, code: MAGE, code2: null,
  game_build: "1.60.1.70450", shared: true, show_name: false, active: true, updated_at: "2026-10-20T12:00:00+00:00",
  point_order: null, point_order2: null, ...over,
});
/** A build as own_builds_for_key returns it, which carries no orders. */
const keyRow = () => {
  const { point_order: _order, point_order2: _order2, ...rest } = row();
  return rest;
};
/** A new build says whether it is shared and shows its owner's name. */
const NEW = { shared: true, showName: false };
const call = (method: string, body?: object, headers: Record<string, string> = {}, path = "/api/me/builds") =>
  new Request(`https://everloot.app${path}`, {
    method, headers: { origin: "https://everloot.app", "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
const remove = (id: string, origin = "https://everloot.app") =>
  DELETE(call("DELETE", undefined, { origin }, `/api/me/builds/${id}`), { params: Promise.resolve({ id }) });
const rpcBody = (i = 0) => JSON.parse(auth.authQuery.mock.calls[i][1].body);
/** save_build_plan's answer: the build it saved, or a refusal. */
const saved = (refusal: string | null = null) => refusal ? { build_ref: null, build_slug: null, refusal } : { build_ref: BUILD_ID, build_slug: "AbCd1234", refusal: null };
/** The database: save_build_plan saves, and every read returns `rows`. */
const database = (rows: object[] = [row()]) =>
  auth.authQuery.mockImplementation(async (path: string) => (path === "rpc/save_build_plan" ? saved() : rows));
/** Every call that writes: the RPCs other than the reads. */
const writes = () => auth.authQuery.mock.calls.map(([path]) => path as string).filter((path) => path.startsWith("rpc/"));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with the switch off every route is a 404 and nothing is read", async () => {
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "");
  for (const res of [await GET(call("GET")), await POST(call("POST", { name: "a", code: MAGE })), await remove(BUILD_ID),
    await GET(call("GET", undefined, { authorization: `Bearer ${KEY}` }))]) {
    expect(res.status).toBe(404);
  }
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("signed out, the answer is 401 with where to sign in and come back", async () => {
  auth.getUser.mockResolvedValue(null);
  for (const res of [await GET(call("GET")), await POST(call("POST", { name: "a", code: MAGE })), await remove(BUILD_ID)]) {
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to save builds.", signIn: "/sign-in?returnTo=%2Fme" });
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("another site cannot save or delete with the visitor's cookie", async () => {
  expect((await POST(call("POST", { name: "a", code: MAGE }, { origin: "https://evil.example" }))).status).toBe(403);
  expect((await remove(BUILD_ID, "https://evil.example")).status).toBe(403);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a save or delete meant for another account than the session's is a private 409, before anything is read or written", async () => {
  const other = { "x-everloot-expected-owner": "99999999-2222-4333-8444-555555555555" };
  const saved = await POST(call("POST", { name: "a", code: MAGE }, other));
  expect(saved.status).toBe(409);
  expect(saved.headers.get("cache-control")).toBe("private, no-store");
  expect(await saved.json()).toEqual({ error: "This was meant for another account than the one signed in now. Nothing was saved.", code: "account_mismatch" });
  expect((await DELETE(call("DELETE", undefined, other, `/api/me/builds/${BUILD_ID}`), { params: Promise.resolve({ id: BUILD_ID }) })).status).toBe(409);
  // Anything that is not the session's own id is another account, a malformed one too.
  expect((await POST(call("POST", { name: "a", code: MAGE }, { "x-everloot-expected-owner": "" }))).status).toBe(409);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a list asked for another account than the session's is a private 409, and nothing is read", async () => {
  const res = await GET(call("GET", undefined, { "x-everloot-expected-owner": "99999999-2222-4333-8444-555555555555" }));
  expect(res.status).toBe(409);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect((await res.json()).code).toBe("account_mismatch");
  expect(auth.authQuery).not.toHaveBeenCalled();
  auth.authQuery.mockResolvedValue([]);
  expect((await GET(call("GET", undefined, { "x-everloot-expected-owner": USER.id }))).status).toBe(200);
});

test("naming the session's own account saves as before, and so does a save that names none", async () => {
  database();
  expect((await POST(call("POST", { name: "a", code: MAGE, ...NEW }, { "x-everloot-expected-owner": USER.id }))).status).toBe(201);
  expect(rpcBody(0).p_user_id).toBe(USER.id);
  expect((await POST(call("POST", { name: "a", code: MAGE, ...NEW }))).status).toBe(201);
  // The header is only a check: the owner is always the session's account.
  expect(rpcBody(2).p_user_id).toBe(USER.id);
});

test("the list is the account's own, in the agreed shape, newest first", async () => {
  auth.authQuery.mockImplementation(async (path: string) => path.startsWith("build_characters")
    ? [{ id: CHARACTER_ID, name: "Jaina", class_slug: "mage", realm: null, note: "alt" }]
    : [row(), row({ id: "3b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e33", slug: "Zz9Zz9Zz", shared: false, character_id: null, active: false })]);
  const res = await GET(call("GET"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const body = await res.json();
  expect(body).toEqual({
    characters: [{ id: CHARACTER_ID, name: "Jaina", classSlug: "mage", realm: null, note: "alt" }],
    builds: [
      { id: BUILD_ID, slug: "AbCd1234", name: "Fire", notes: null, classSlug: "mage", characterId: CHARACTER_ID, code: MAGE, code2: null,
        gameBuild: "1.60.1.70450", shared: true, active: true, link: "https://everloot.app/b/AbCd1234", updatedAt: "2026-10-20T12:00:00.000Z", showName: false,
        order: null, order2: null },
      expect.objectContaining({ slug: "Zz9Zz9Zz", shared: false, link: null, characterId: null }),
    ],
  });
  for (const [path] of auth.authQuery.mock.calls) expect(path).toContain(`user_id=eq.${USER.id}`);
  const list = auth.authQuery.mock.calls.find(([p]) => p.startsWith("saved_builds"))![0];
  expect(list).toContain("order=updated_at.desc");
  expect(list).toContain(",point_order,point_order2&");
});

test("reopening lists each set's spend order as it was saved, its maker's letter included", async () => {
  database([row({ code2: MAGE2, point_order: ORDER, point_order2: ORDER2 })]);
  const { builds } = await (await GET(call("GET"))).json();
  expect(builds[0]).toMatchObject({ code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 });
});

test("a new build is saved through save_build_plan with a fresh short link and answered with 201", async () => {
  database([row({ character_id: null, active: false })]);
  const res = await POST(call("POST", { name: " Fire ", code: MAGE, notes: "For raids", shared: true, showName: false }));
  expect(res.status).toBe(201);
  expect((await res.json()).build).toMatchObject({ id: BUILD_ID, link: "https://everloot.app/b/AbCd1234" });
  expect(auth.authQuery.mock.calls[0][0]).toBe("rpc/save_build_plan");
  const { p_user_id, p_payload } = rpcBody();
  expect(p_user_id).toBe(USER.id);
  expect(p_payload).toMatchObject({ id: null, name: "Fire", notes: "For raids", characterId: null, code: MAGE, code2: null, shared: true, showName: false, active: null });
  expect(p_payload.slug).toMatch(/^[A-Za-z0-9]{8}$/);
  expect(auth.authQuery.mock.calls[1][0]).toContain(`user_id=eq.${USER.id}`);
});

test("saving with an id updates that build in place, without a new slug", async () => {
  database([row({ name: "Frost" })]);
  const res = await POST(call("POST", { id: BUILD_ID, name: "Frost", code: MAGE, characterId: CHARACTER_ID, active: true }));
  expect(res.status).toBe(200);
  expect(rpcBody().p_payload).toMatchObject({ id: BUILD_ID, slug: null, characterId: CHARACTER_ID, active: true, shared: null, showName: null });
});

test("a save writes its codes and both spend orders in one call, and nothing else writes", async () => {
  database([row({ code2: MAGE2, point_order: ORDER, point_order2: ORDER2 })]);
  const res = await POST(call("POST", { name: "Fire", code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2, ...NEW }));
  expect(res.status).toBe(201);
  expect(writes()).toEqual(["rpc/save_build_plan"]);
  expect(rpcBody().p_payload).toMatchObject({ code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 });
  // The answer is the row as saved, orders and all, read back for this account.
  expect((await res.json()).build).toMatchObject({ order: ORDER, order2: ORDER2 });
});

test("when that one call fails nothing is announced, and nothing else is tried: no second write for the order, no older save", async () => {
  auth.authQuery.mockImplementation(async (path: string) => {
    if (path === "rpc/save_build_plan") throw new Error("Authentication storage failed (500)");
    return [row()];
  });
  const res = await POST(call("POST", { id: BUILD_ID, name: "Fire", code: MAGE, code2: MAGE2, order: ORDER, order2: ORDER2 }));
  expect(res.status).toBe(503);
  const body = await res.json();
  expect(body).toEqual({ error: "Saved builds are unavailable right now. Try again in a minute." });
  expect(writes()).toEqual(["rpc/save_build_plan"]);
});

test("a new build says whether it is shared and shows its owner's name: nothing picks for it", async () => {
  for (const body of [{ name: "a", code: MAGE }, { name: "a", code: MAGE, shared: true }, { name: "a", code: MAGE, showName: false }]) {
    const res = await POST(call("POST", body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A new build needs shared and showName, each true or false.");
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
  // A private one is as explicit as a shared one; an update may leave both as they are.
  database();
  expect((await POST(call("POST", { name: "a", code: MAGE, shared: false, showName: false }))).status).toBe(201);
  expect((await POST(call("POST", { id: BUILD_ID, name: "a", code: MAGE }))).status).toBe(200);
});

test("a page from before orders sends none, and none are passed on: the database keeps them only while the codes stay", async () => {
  database();
  expect((await POST(call("POST", { id: BUILD_ID, name: "Fire", code: MAGE, code2: MAGE2, shared: true, showName: false }))).status).toBe(200);
  const { p_payload } = rpcBody();
  expect(p_payload).not.toHaveProperty("order");
  expect(p_payload).not.toHaveProperty("order2");
  // An unknown order is said out loud.
  expect((await POST(call("POST", { id: BUILD_ID, name: "Fire", code: MAGE, order: null, order2: null }))).status).toBe(200);
  expect(rpcBody(2).p_payload).toMatchObject({ order: null, order2: null });
});

test("another player's build or character is a 404, and the limits answer plainly", async () => {
  const refuse = (refusal: string) => auth.authQuery.mockResolvedValueOnce(saved(refusal));
  refuse("not_found");
  expect((await POST(call("POST", { id: BUILD_ID, name: "Mine", code: MAGE }))).status).toBe(404);
  refuse("class_mismatch");
  expect((await POST(call("POST", { name: "a", code: MAGE, characterId: CHARACTER_ID, ...NEW }))).status).toBe(400);
  refuse("build_limit");
  const full = await POST(call("POST", { name: "a", code: MAGE, ...NEW }));
  expect(full.status).toBe(409);
  expect((await full.json()).error).toContain("200 saved builds");
  refuse("daily_limit");
  const busy = await POST(call("POST", { name: "a", code: MAGE, ...NEW }));
  expect(busy.status).toBe(429);
  expect((await busy.json()).error).toContain("300 times");
});

test("a taken short link is retried with another one", async () => {
  auth.authQuery
    .mockResolvedValueOnce(saved("slug_taken"))
    .mockResolvedValueOnce(saved())
    .mockResolvedValueOnce([row()]);
  expect((await POST(call("POST", { name: "a", code: MAGE, ...NEW }))).status).toBe(201);
  expect(rpcBody(0).p_payload.slug).not.toBe(rpcBody(1).p_payload.slug);
});

test("bad input is a 400 before the database is asked", async () => {
  for (const body of [{ name: "", code: MAGE }, { name: "a", code: "nope" }, { name: "a", code: MAGE, code2: "EL1-warrior-0-1.60-MTE6NQ" }, { id: "x", name: "a", code: MAGE },
    // A spend order that does not name exactly its own set's points.
    { name: "a", code: MAGE, order: "O1p-AAAA", ...NEW }, { name: "a", code: MAGE, code2: MAGE2, order2: ORDER, ...NEW }, { id: BUILD_ID, name: "a", code: MAGE, order2: ORDER2 }]) {
    expect((await POST(call("POST", body))).status).toBe(400);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("deleting is for the owner's builds only", async () => {
  auth.authQuery.mockResolvedValueOnce(true);
  expect((await remove(BUILD_ID)).status).toBe(200);
  expect(auth.authQuery.mock.calls[0][0]).toBe("rpc/delete_build");
  expect(rpcBody()).toEqual({ p_user_id: USER.id, p_id: BUILD_ID });
  auth.authQuery.mockResolvedValueOnce(false);
  expect((await remove(BUILD_ID)).status).toBe(404);
  expect((await remove("nope")).status).toBe(400);
});

test("a key with read:own reads its owner's builds; the key itself never reaches the database", async () => {
  auth.authQuery.mockResolvedValueOnce([{ refusal: null, retry_after: 0, characters: [], builds: [keyRow()] }]);
  const res = await GET(call("GET", undefined, { authorization: `Bearer ${KEY}`, origin: "" }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ characters: [], builds: [{ id: BUILD_ID, link: "https://everloot.app/b/AbCd1234" }] });
  // own_builds_for_key carries no orders, so the keyed answer keeps the shape it had: no order fields at all.
  expect(Object.keys(body.builds[0]).sort()).toEqual(["active", "characterId", "classSlug", "code", "code2", "gameBuild", "id", "link", "name", "notes",
    "shared", "showName", "slug", "updatedAt"]);
  expect(auth.authQuery.mock.calls[0][0]).toBe("rpc/own_builds_for_key");
  expect(rpcBody()).toEqual({ p_token_hash: hashKey(KEY), p_count: true });
  expect(auth.getUser).not.toHaveBeenCalled();
});

test("an expired key is a 401: the database answers unknown_key for a key past its end date (api-key-expiry.integration.mjs)", async () => {
  auth.authQuery.mockResolvedValueOnce([{ refusal: "unknown_key", retry_after: 0, characters: null, builds: null }]);
  const res = await GET(call("GET", undefined, { authorization: `Bearer ${KEY}` }));
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  expect(await res.json()).not.toHaveProperty("builds");
});

test("a key without read:own is a 403, a dead key a 401, a spent allowance a 429 with Retry-After", async () => {
  const answer = (refusal: string, retry_after = 0) => auth.authQuery.mockResolvedValueOnce([{ refusal, retry_after, characters: null, builds: null }]);
  const keyed = () => GET(call("GET", undefined, { authorization: `Bearer ${KEY}` }));
  answer("no_scope");
  const scope = await keyed();
  expect(scope.status).toBe(403);
  expect(await scope.json()).toEqual({ error: "This key can't read your saved builds" });
  answer("unknown_key");
  expect((await keyed()).status).toBe(401);
  answer("limited", 120);
  const limited = await keyed();
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("120");
  // A malformed key is refused without a database call.
  auth.authQuery.mockClear();
  expect((await GET(call("GET", undefined, { authorization: "Bearer evl_nothex" }))).status).toBe(401);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("storage trouble is a 503, never a silent success", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  expect((await GET(call("GET"))).status).toBe(503);
  expect((await POST(call("POST", { name: "a", code: MAGE, ...NEW }))).status).toBe(503);
  expect((await GET(call("GET", undefined, { authorization: `Bearer ${KEY}` }))).status).toBe(503);
});

test("short links are eight base62 characters and do not repeat", () => {
  const slugs = new Set(Array.from({ length: 2000 }, newSlug));
  expect(slugs.size).toBe(2000);
  for (const slug of slugs) expect(slug).toMatch(/^[A-Za-z0-9]{8}$/);
});
