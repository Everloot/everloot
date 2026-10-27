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
const KEY = `evl_${"a".repeat(64)}`;
const row = (over: object = {}) => ({
  id: BUILD_ID, slug: "AbCd1234", name: "Fire", notes: null, class_slug: "mage", character_id: CHARACTER_ID, code: MAGE, code2: null,
  game_build: "1.60.1.70450", shared: true, show_name: false, active: true, updated_at: "2026-10-20T12:00:00+00:00", ...over,
});
const call = (method: string, body?: object, headers: Record<string, string> = {}, path = "/api/me/builds") =>
  new Request(`https://everloot.app${path}`, {
    method, headers: { origin: "https://everloot.app", "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
const remove = (id: string, origin = "https://everloot.app") =>
  DELETE(call("DELETE", undefined, { origin }, `/api/me/builds/${id}`), { params: Promise.resolve({ id }) });
const rpcBody = (i = 0) => JSON.parse(auth.authQuery.mock.calls[i][1].body);

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

test("naming the session's own account saves as before, and so does a save that names none", async () => {
  auth.authQuery.mockImplementation(async (path: string) => path === "rpc/save_build"
    ? [{ build_ref: BUILD_ID, build_slug: "AbCd1234", refusal: null }] : [row()]);
  expect((await POST(call("POST", { name: "a", code: MAGE }, { "x-everloot-expected-owner": USER.id }))).status).toBe(201);
  expect(rpcBody(0).p_user_id).toBe(USER.id);
  expect((await POST(call("POST", { name: "a", code: MAGE }))).status).toBe(201);
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
        gameBuild: "1.60.1.70450", shared: true, active: true, link: "https://everloot.app/b/AbCd1234", updatedAt: "2026-10-20T12:00:00.000Z", showName: false },
      expect.objectContaining({ slug: "Zz9Zz9Zz", shared: false, link: null, characterId: null }),
    ],
  });
  for (const [path] of auth.authQuery.mock.calls) expect(path).toContain(`user_id=eq.${USER.id}`);
  expect(auth.authQuery.mock.calls.find(([p]) => p.startsWith("saved_builds"))![0]).toContain("order=updated_at.desc");
});

test("a new build is saved through save_build with a fresh short link and answered with 201", async () => {
  auth.authQuery.mockImplementation(async (path: string) => path === "rpc/save_build"
    ? [{ build_ref: BUILD_ID, build_slug: "AbCd1234", refusal: null }]
    : [row({ character_id: null, active: false })]);
  const res = await POST(call("POST", { name: " Fire ", code: MAGE, notes: "For raids", shared: true }));
  expect(res.status).toBe(201);
  expect((await res.json()).build).toMatchObject({ id: BUILD_ID, link: "https://everloot.app/b/AbCd1234" });
  const sent = rpcBody();
  expect(sent).toMatchObject({ p_user_id: USER.id, p_id: null, p_name: "Fire", p_notes: "For raids", p_code: MAGE, p_code2: null, p_shared: true, p_active: null });
  expect(sent.p_slug).toMatch(/^[A-Za-z0-9]{8}$/);
  expect(auth.authQuery.mock.calls[1][0]).toContain(`user_id=eq.${USER.id}`);
});

test("saving with an id updates that build in place, without a new slug", async () => {
  auth.authQuery.mockImplementation(async (path: string) => path === "rpc/save_build"
    ? [{ build_ref: BUILD_ID, build_slug: "AbCd1234", refusal: null }] : [row({ name: "Frost" })]);
  const res = await POST(call("POST", { id: BUILD_ID, name: "Frost", code: MAGE, characterId: CHARACTER_ID, active: true }));
  expect(res.status).toBe(200);
  expect(rpcBody()).toMatchObject({ p_id: BUILD_ID, p_slug: null, p_character_id: CHARACTER_ID, p_active: true });
});

test("another player's build or character is a 404, and the limits answer plainly", async () => {
  const refuse = (refusal: string) => auth.authQuery.mockResolvedValueOnce([{ build_ref: null, build_slug: null, refusal }]);
  refuse("not_found");
  expect((await POST(call("POST", { id: BUILD_ID, name: "Mine", code: MAGE }))).status).toBe(404);
  refuse("class_mismatch");
  expect((await POST(call("POST", { name: "a", code: MAGE, characterId: CHARACTER_ID }))).status).toBe(400);
  refuse("build_limit");
  const full = await POST(call("POST", { name: "a", code: MAGE }));
  expect(full.status).toBe(409);
  expect((await full.json()).error).toContain("200 saved builds");
  refuse("daily_limit");
  const busy = await POST(call("POST", { name: "a", code: MAGE }));
  expect(busy.status).toBe(429);
  expect((await busy.json()).error).toContain("300 times");
});

test("a taken short link is retried with another one", async () => {
  auth.authQuery
    .mockResolvedValueOnce([{ build_ref: null, build_slug: null, refusal: "slug_taken" }])
    .mockResolvedValueOnce([{ build_ref: BUILD_ID, build_slug: "AbCd1234", refusal: null }])
    .mockResolvedValueOnce([row()]);
  expect((await POST(call("POST", { name: "a", code: MAGE }))).status).toBe(201);
  expect(rpcBody(0).p_slug).not.toBe(rpcBody(1).p_slug);
});

test("bad input is a 400 before the database is asked", async () => {
  for (const body of [{ name: "", code: MAGE }, { name: "a", code: "nope" }, { name: "a", code: MAGE, code2: "EL1-warrior-0-1.60-MTE6NQ" }, { id: "x", name: "a", code: MAGE }]) {
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
  auth.authQuery.mockResolvedValueOnce([{ refusal: null, retry_after: 0, characters: [], builds: [row()] }]);
  const res = await GET(call("GET", undefined, { authorization: `Bearer ${KEY}`, origin: "" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ characters: [], builds: [{ id: BUILD_ID, link: "https://everloot.app/b/AbCd1234" }] });
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
  expect((await POST(call("POST", { name: "a", code: MAGE }))).status).toBe(503);
  expect((await GET(call("GET", undefined, { authorization: `Bearer ${KEY}` }))).status).toBe(503);
});

test("short links are eight base62 characters and do not repeat", () => {
  const slugs = new Set(Array.from({ length: 2000 }, newSlug));
  expect(slugs.size).toBe(2000);
  for (const slug of slugs) expect(slug).toMatch(/^[A-Za-z0-9]{8}$/);
});
