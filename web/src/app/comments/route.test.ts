import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { GET, POST } from "./route";

const SITE = "https://everloot.app";
const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1234" };
const COMMENT = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const ROW = {
  id: COMMENT, author: "thrall", body: "Drops from **Ragnaros**", status: "visible", created_at: "2026-11-25T10:00:00+00:00",
  edited_at: null, mine: false, editable: false, reported: false,
};

const get = (query: string) => GET(new Request(`${SITE}/comments?${query}`));
const post = (body: unknown, headers: Record<string, string> = { origin: SITE }) =>
  POST(new Request(`${SITE}/comments`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const rpcCalls = (name: string) => auth.authQuery.mock.calls.filter(([path]) => path === `rpc/${name}`).map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  vi.stubEnv("EVERLOOT_COMMENTS", "1");
  vi.stubEnv("EVERLOOT_PROFILES", "1");
  auth.getUser.mockReset().mockResolvedValue(null);
  auth.authQuery.mockReset().mockImplementation(async (path: string) => {
    if (path === "rpc/entity_comments_for") return [ROW];
    if (path.startsWith("user_profiles?")) return [{ handle: "thrall", public_profile: false }];
    if (path.startsWith("rpc/")) return { comment_ref: COMMENT, refusal: null };
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

test("off unless EVERLOOT_COMMENTS=1 and profiles are on: 404 and no storage read", async () => {
  for (const [comments, profiles] of [["", "1"], ["1", ""], ["true", "1"]]) {
    vi.stubEnv("EVERLOOT_COMMENTS", comments);
    vi.stubEnv("EVERLOOT_PROFILES", profiles);
    expect((await get("type=item&id=19019")).status).toBe(404);
    expect((await post({ action: "post", type: "item", id: 19019, body: "hi" })).status).toBe(404);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
  expect(auth.getUser).not.toHaveBeenCalled();
});

test("GET reads one page's comments for anyone, uncached and unindexed, with no viewer when signed out", async () => {
  const response = await get("type=item&id=19019");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
  expect(rpcCalls("entity_comments_for")).toEqual([{ p_entity_type: "item", p_entity_id: 19019, p_viewer: null }]);
  expect(await response.json()).toEqual({
    viewer: null,
    comments: [{ id: COMMENT, author: "thrall", body: "Drops from **Ragnaros**", status: "visible", createdAt: "2026-11-25T10:00:00.000Z",
      editedAt: null, mine: false, editable: false, reported: false }],
  });
});

test("GET names the signed-in viewer by id and handle, never the BattleTag", async () => {
  auth.getUser.mockResolvedValue(USER);
  const response = await get("type=quest&id=7");
  const body = await response.json();
  expect(body.viewer).toEqual({ id: USER.id, handle: "thrall" });
  expect(JSON.stringify(body)).not.toContain("Thrall#1234");
  expect(rpcCalls("entity_comments_for")[0].p_viewer).toBe(USER.id);
});

test("GET refuses a type or id no page has", async () => {
  for (const query of ["type=guild&id=1", "type=item&id=0", "type=item&id=1.5", "type=item&id=abc", "type=item", "id=1", "type=item&id=99999999999"]) {
    expect((await get(query)).status, query).toBe(400);
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a write needs this site's Origin, a session and the account the page named", async () => {
  const body = { action: "post", type: "item", id: 19019, body: "hi" };
  expect((await post(body, { origin: "https://example.com" })).status).toBe(403);
  expect((await post(body, {})).status).toBe(403);
  expect(auth.getUser).not.toHaveBeenCalled();
  const signedOut = await post(body);
  expect(signedOut.status).toBe(401);
  auth.getUser.mockResolvedValue(USER);
  const other = await post(body, { origin: SITE, "x-everloot-expected-owner": "22222222-3333-4444-8555-666666666666" });
  expect(other.status).toBe(409);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("posting cleans the words and sends them to the database's function", async () => {
  auth.getUser.mockResolvedValue(USER);
  const response = await post({ action: "post", type: "npc", id: 11502, body: "  Line one\r\nline‮ two\u0007\n\n\n\nthree  " }, { origin: SITE, "x-everloot-expected-owner": USER.id });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(rpcCalls("post_entity_comment")).toEqual([{ p_user_id: USER.id, p_entity_type: "npc", p_entity_id: 11502, p_body: "Line one\nline two\n\nthree" }]);
});

test("a link to a site not on the list is refused before the database is asked", async () => {
  auth.getUser.mockResolvedValue(USER);
  for (const body of ["see https://evil.example/x", "[click](javascript:alert(1))", "[x](https://everloot.app.evil.example/)"]) {
    const response = await post({ action: "post", type: "item", id: 1, body });
    expect(response.status, body).toBe(422);
    expect((await response.json()).error).toContain("everloot.app");
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("the database's refusals become plain answers", async () => {
  auth.getUser.mockResolvedValue(USER);
  const cases: Array<[unknown, string, number]> = [
    [{ action: "post", type: "item", id: 1, body: "x" }, "needs_handle", 409],
    [{ action: "post", type: "item", id: 1, body: "x" }, "daily_limit", 429],
    [{ action: "edit", commentId: COMMENT, body: "x" }, "not_editable", 409],
    [{ action: "edit", commentId: COMMENT, body: "x" }, "not_found", 404],
    [{ action: "delete", commentId: COMMENT }, "not_found", 404],
    [{ action: "report", commentId: COMMENT, reason: "spam", note: "" }, "own_comment", 409],
    [{ action: "report", commentId: COMMENT, reason: "spam", note: "" }, "already_reported", 409],
    [{ action: "report", commentId: COMMENT, reason: "spam", note: "" }, "daily_limit", 429],
  ];
  for (const [body, refusal, status] of cases) {
    auth.authQuery.mockImplementation(async () => ({ comment_ref: null, refusal }));
    const response = await post(body);
    expect(response.status, refusal).toBe(status);
    if (refusal === "needs_handle") expect((await response.json()).settings).toBe("/settings");
  }
});

test("edit, delete and report reach their functions with the session's account", async () => {
  auth.getUser.mockResolvedValue(USER);
  expect((await post({ action: "edit", commentId: COMMENT, body: "fixed" })).status).toBe(200);
  expect((await post({ action: "delete", commentId: COMMENT })).status).toBe(200);
  expect((await post({ action: "report", commentId: COMMENT, reason: "spoiler", note: " names the boss " })).status).toBe(200);
  expect(rpcCalls("edit_entity_comment")).toEqual([{ p_user_id: USER.id, p_comment_id: COMMENT, p_body: "fixed" }]);
  expect(rpcCalls("delete_entity_comment")).toEqual([{ p_user_id: USER.id, p_comment_id: COMMENT }]);
  expect(rpcCalls("report_entity_comment")).toEqual([{ p_user_id: USER.id, p_comment_id: COMMENT, p_reason: "spoiler", p_note: "names the boss" }]);
});

test("malformed writes are refused with 400 and reach nothing", async () => {
  auth.getUser.mockResolvedValue(USER);
  for (const body of [
    null, [], { action: "post" }, { action: "nuke" }, { action: "post", type: "item", id: 1, body: "" },
    { action: "post", type: "item", id: 1, body: "x".repeat(2001) }, { action: "post", type: "item", id: 1, body: "x", userId: USER.id },
    { action: "edit", commentId: "not-a-uuid", body: "x" }, { action: "report", commentId: COMMENT, reason: "bored", note: "" },
    { action: "report", commentId: COMMENT, reason: "spam", note: "x".repeat(301) }, { action: "delete", commentId: COMMENT, status: "visible" },
  ]) expect((await post(body)).status, JSON.stringify(body)).toBe(400);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("storage trouble is a 503, not a crash", async () => {
  auth.authQuery.mockRejectedValue(new Error("down"));
  expect((await get("type=item&id=1")).status).toBe(503);
});
