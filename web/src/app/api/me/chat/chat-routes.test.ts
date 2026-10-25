import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import * as projects from "./projects/route";
import * as project from "./projects/[id]/route";
import * as conversations from "./conversations/route";
import * as conversation from "./conversations/[id]/route";
import * as entries from "./entries/route";
import * as entry from "./entries/[id]/route";
import * as importRoute from "./import/route";
import * as exportRoute from "./export/route";
import * as workspace from "./workspace/route";
import { encodeCursor } from "@/lib/chat/workspace";

const USER = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const OTHER = "99999999-2222-4333-8444-555555555555";
const ID = "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11";
const PROJECT = "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22";
const AT = "2026-10-25T12:00:00.123+00:00";
const SITE = "https://everloot.app";
const msg = { role: "user", text: "Where does it drop?", at: "2026-10-25T12:00:00.000Z", model: null, sources: [], steps: [] };

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${SITE}/api/me/chat${path}`, {
    method, headers: { origin: SITE, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const rpc = (i = 0) => ({ path: auth.authQuery.mock.calls[i][0] as string, body: JSON.parse(auth.authQuery.mock.calls[i][1].body) });
const projectRow = (over = {}) => ({ id: PROJECT, name: "Raid", description: null, revision: 1, updatedAt: AT, ...over });
const chatRow = (over = {}) => ({ id: ID, title: "Hogger", updatedAt: AT, projectId: null, pinned: false, revision: 1, ...over });
const saveProject = (over = {}, headers = {}) => projects.POST(req("POST", "/projects",
  { expectedAccountId: USER.id, expectedRevision: 0, project: { id: PROJECT, name: "Raid", description: null }, ...over }, headers));

// Every route, as a call that should be refused before the database is asked.
const everyRoute = (headers: Record<string, string> = {}) => [
  () => projects.GET(req("GET", "/projects", undefined, headers)),
  () => saveProject({}, headers),
  () => project.DELETE(req("DELETE", `/projects/${PROJECT}`, { expectedAccountId: USER.id, expectedRevision: 1 }, headers), params(PROJECT)),
  () => conversations.GET(req("GET", "/conversations", undefined, headers)),
  () => conversations.POST(req("POST", "/conversations", { expectedAccountId: USER.id, expectedRevision: 0, conversation: { id: ID, title: "a", projectId: null, pinned: false, messages: [] } }, headers)),
  () => conversation.GET(req("GET", `/conversations/${ID}`, undefined, headers), params(ID)),
  () => conversation.DELETE(req("DELETE", `/conversations/${ID}`, { expectedAccountId: USER.id, expectedRevision: 1 }, headers), params(ID)),
  () => entries.GET(req("GET", "/entries", undefined, headers)),
  () => entries.POST(req("POST", "/entries", { expectedAccountId: USER.id, expectedRevision: 0, entry: { id: ID, kind: "note", title: "", text: "x" } }, headers)),
  () => entry.DELETE(req("DELETE", `/entries/${ID}`, { expectedAccountId: USER.id, expectedRevision: 1 }, headers), params(ID)),
  () => importRoute.POST(req("POST", "/import", { expectedAccountId: USER.id, sourceId: ID, legacyId: "a", conversation: { title: "a", messages: [] } }, headers)),
  () => exportRoute.GET(req("GET", "/export", undefined, headers)),
  () => workspace.DELETE(req("DELETE", "/workspace", { expectedAccountId: USER.id }, headers)),
];
const WRITES = [1, 2, 4, 6, 8, 9, 10, 12];

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHAT_WORKSPACE", "1");
  auth.getUser.mockReset().mockResolvedValue(USER);
  auth.authQuery.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); });

test("with the switch off every route is a 404 and nothing is read, even with saved builds on", async () => {
  vi.stubEnv("EVERLOOT_CHAT_WORKSPACE", "");
  vi.stubEnv("EVERLOOT_SAVED_BUILDS", "1");
  for (const call of everyRoute()) expect((await call()).status).toBe(404);
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("signed out is a 401 with where to sign in, and a bearer key is not a session", async () => {
  auth.getUser.mockResolvedValue(null);
  for (const call of everyRoute({ authorization: `Bearer evl_${"a".repeat(64)}` })) {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to keep Chat projects on your account.", signIn: "/sign-in?returnTo=%2Fchat" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("another site, or a write with no Origin, cannot change anything", async () => {
  const routes = everyRoute({ origin: "https://evil.example" });
  for (const i of WRITES) expect((await routes[i]()).status).toBe(403);
  const bare = new Request(`${SITE}/api/me/chat/workspace`, { method: "DELETE", body: JSON.stringify({ expectedAccountId: USER.id }) });
  expect((await workspace.DELETE(bare)).status).toBe(403);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("a write meant for another account is refused before anything is saved", async () => {
  auth.getUser.mockResolvedValue({ id: OTHER, name: "Jaina#2" });
  for (const i of WRITES) {
    const res = await everyRoute()[i]();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "account_mismatch" });
  }
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("projects list and save as the owner, through the functions, with the account id in every answer", async () => {
  auth.authQuery.mockResolvedValueOnce([projectRow()]);
  const listed = await projects.GET(req("GET", "/projects"));
  expect(listed.status).toBe(200);
  expect(listed.headers.get("cache-control")).toBe("private, no-store");
  expect(await listed.json()).toEqual({ accountId: USER.id, projects: [{ ...projectRow(), updatedAt: "2026-10-25T12:00:00.123Z" }] });
  expect(rpc()).toEqual({ path: "rpc/chat_list_projects", body: { p_user_id: USER.id } });

  auth.authQuery.mockResolvedValueOnce([{ refusal: null, project: projectRow() }]);
  const made = await saveProject({ project: { id: PROJECT, name: " Raid ", description: "MC", owner: OTHER } });
  expect(made.status).toBe(201);
  expect(await made.json()).toMatchObject({ accountId: USER.id, project: { id: PROJECT, revision: 1 } });
  expect(rpc(1)).toEqual({ path: "rpc/chat_save_project",
    body: { p_user_id: USER.id, p_id: PROJECT, p_expected_revision: 0, p_name: "Raid", p_description: "MC" } });

  auth.authQuery.mockResolvedValueOnce([{ refusal: null, project: projectRow({ revision: 2 }) }]);
  expect((await saveProject({ expectedRevision: 1 })).status).toBe(200);
});

test.each([
  ["revision_conflict", 409, "revision_conflict"], ["not_found", 404, "not_found"], ["project_not_found", 404, "not_found"],
  ["build_not_found", 404, "not_found"], ["quota_exceeded", 413, "quota_exceeded"], ["size_exceeded", 413, "size_exceeded"],
  ["daily_limit", 429, "daily_limit"],
])("a %s refusal is a %i", async (refusal, status, code) => {
  auth.authQuery.mockResolvedValueOnce([{ refusal, project: null }]);
  const res = await saveProject({ expectedRevision: 2 });
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ code });
});

test("removing a project and deleting a chat or entry name the revision; a stale one is a conflict", async () => {
  auth.authQuery.mockResolvedValueOnce(null);
  const gone = await project.DELETE(req("DELETE", `/projects/${PROJECT}`, { expectedAccountId: USER.id, expectedRevision: 2 }), params(PROJECT));
  expect(gone.status).toBe(200);
  expect(await gone.json()).toEqual({ accountId: USER.id, ok: true });
  expect(rpc()).toEqual({ path: "rpc/chat_delete_project", body: { p_user_id: USER.id, p_id: PROJECT, p_expected_revision: 2 } });
  auth.authQuery.mockResolvedValueOnce("revision_conflict");
  expect((await conversation.DELETE(req("DELETE", `/conversations/${ID}`, { expectedAccountId: USER.id, expectedRevision: 1 }), params(ID))).status).toBe(409);
  expect(rpc(1).path).toBe("rpc/chat_delete_conversation");
  auth.authQuery.mockResolvedValueOnce("not_found");
  expect((await entry.DELETE(req("DELETE", `/entries/${ID}`, { expectedAccountId: USER.id, expectedRevision: 1 }), params(ID))).status).toBe(404);
  expect(rpc(2).path).toBe("rpc/chat_delete_entry");
  expect((await entry.DELETE(req("DELETE", "/entries/nope", { expectedAccountId: USER.id, expectedRevision: 1 }), params("nope"))).status).toBe(400);
  expect(auth.authQuery).toHaveBeenCalledTimes(3);
});

test("chats are listed 50 at a time with a cursor, searched and filtered, and read one at a time", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => chatRow({ id: `0b6f1c1e-3f43-4a4e-9a51-${String(i).padStart(12, "0")}`, pinned: i === 0 }));
  auth.authQuery.mockResolvedValueOnce(rows);
  const res = await conversations.GET(req("GET", `/conversations?query=%20hog%20&projectId=${PROJECT}`));
  const body = await res.json();
  expect(body.conversations).toHaveLength(50);
  expect(body.nextCursor).toBe(encodeCursor([false, "2026-10-25T12:00:00.123Z", rows[49].id]));
  expect(rpc()).toEqual({ path: "rpc/chat_list_conversations", body: {
    p_user_id: USER.id, p_project_id: PROJECT, p_query: "hog", p_after_pinned: null, p_after_updated_at: null, p_after_id: null, p_limit: 51 } });

  auth.authQuery.mockResolvedValueOnce([chatRow()]);
  const next = await (await conversations.GET(req("GET", `/conversations?cursor=${body.nextCursor}`))).json();
  expect(next).toEqual({ accountId: USER.id, conversations: [{ ...chatRow(), updatedAt: "2026-10-25T12:00:00.123Z" }], nextCursor: null });
  expect(rpc(1).body).toMatchObject({ p_after_pinned: false, p_after_updated_at: "2026-10-25T12:00:00.123Z", p_after_id: rows[49].id, p_project_id: null });

  for (const bad of ["cursor=nope", "projectId=x", `query=${"x".repeat(101)}`]) {
    expect((await conversations.GET(req("GET", `/conversations?${bad}`))).status).toBe(400);
  }
  auth.authQuery.mockResolvedValueOnce({ ...chatRow(), messages: [msg] });
  const one = await conversation.GET(req("GET", `/conversations/${ID}`), params(ID));
  expect(await one.json()).toMatchObject({ accountId: USER.id, conversation: { id: ID, messages: [msg] } });
  expect(rpc(2)).toEqual({ path: "rpc/chat_get_conversation", body: { p_user_id: USER.id, p_id: ID } });
  auth.authQuery.mockResolvedValueOnce(null);
  expect((await conversation.GET(req("GET", `/conversations/${ID}`), params(ID))).status).toBe(404);
});

test("a chat is saved with its checked messages only", async () => {
  auth.authQuery.mockResolvedValueOnce([{ refusal: null, conversation: { ...chatRow({ projectId: PROJECT }), messages: [msg] } }]);
  const res = await conversations.POST(req("POST", "/conversations", { expectedAccountId: USER.id, expectedRevision: 0,
    conversation: { id: ID, title: "Hogger", projectId: PROJECT, pinned: false, messages: [{ ...msg, card: { tooltip: "x" } }] } }));
  expect(res.status).toBe(201);
  expect(rpc()).toEqual({ path: "rpc/chat_save_conversation", body: {
    p_user_id: USER.id, p_id: ID, p_expected_revision: 0, p_title: "Hogger", p_project_id: PROJECT, p_pinned: false, p_messages: [msg] } });
});

test("an oversized body is a 413 before it is read as JSON", async () => {
  const big = req("POST", "/conversations", { expectedAccountId: USER.id, pad: "x".repeat(2 * 1024 * 1024) });
  expect((await conversations.POST(big)).status).toBe(413);
  const declared = new Request(`${SITE}/api/me/chat/projects`, { method: "POST", headers: { origin: SITE, "content-length": String(10 * 1024 * 1024) }, body: "{}" });
  expect((await projects.POST(declared)).status).toBe(413);
  expect((await projects.POST(new Request(`${SITE}/api/me/chat/projects`, { method: "POST", headers: { origin: SITE }, body: "{" }))).status).toBe(400);
  expect(auth.authQuery).not.toHaveBeenCalled();
});

test("entries save each kind and list by project", async () => {
  const saved = { id: ID, projectId: null, kind: "page", title: "", buildId: null, href: "/item/2589", text: null, sources: [], revision: 1, updatedAt: AT };
  auth.authQuery.mockResolvedValueOnce([{ refusal: null, entry: saved }]);
  const res = await entries.POST(req("POST", "/entries", { expectedAccountId: USER.id, expectedRevision: 0,
    entry: { id: ID, projectId: null, kind: "page", title: "", buildId: null, href: "/item/2589", text: null, sources: [] } }));
  expect(res.status).toBe(201);
  expect(rpc().body).toEqual({ p_user_id: USER.id, p_id: ID, p_expected_revision: 0, p_project_id: null, p_kind: "page", p_title: "",
    p_build_id: null, p_href: "/item/2589", p_text: null, p_sources: [] });
  expect((await entries.POST(req("POST", "/entries", { expectedAccountId: USER.id, expectedRevision: 0,
    entry: { id: ID, kind: "page", href: "https://evil.example/" } }))).status).toBe(400);
  auth.authQuery.mockResolvedValueOnce([saved]);
  expect(await (await entries.GET(req("GET", `/entries?projectId=${PROJECT}`))).json())
    .toEqual({ accountId: USER.id, entries: [{ ...saved, updatedAt: "2026-10-25T12:00:00.123Z" }], nextCursor: null });
  expect(rpc(1)).toEqual({ path: "rpc/chat_list_entries", body: { p_user_id: USER.id, p_project_id: PROJECT, p_after_updated_at: null, p_after_id: null, p_limit: 51 } });
});

test("import is idempotent per account, browser and local id", async () => {
  const made = { ...chatRow(), messages: [msg] };
  auth.authQuery.mockResolvedValueOnce([{ refusal: null, conversation: made, created: true }]).mockResolvedValueOnce([{ refusal: null, conversation: made, created: false }]);
  const body = { expectedAccountId: USER.id, sourceId: PROJECT, legacyId: "k3x9", conversation: { title: "Old", messages: [msg] } };
  const first = await importRoute.POST(req("POST", "/import", body));
  expect(first.status).toBe(201);
  expect(await first.json()).toMatchObject({ accountId: USER.id, created: true, conversation: { id: ID } });
  const again = await importRoute.POST(req("POST", "/import", body));
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({ created: false, conversation: { id: ID } });
  expect(rpc()).toEqual({ path: "rpc/chat_import_conversation",
    body: { p_user_id: USER.id, p_source_id: PROJECT, p_legacy_id: "k3x9", p_title: "Old", p_messages: [msg] } });
});

test("export is the owner's workspace in private pages; clearing takes only the workspace", async () => {
  auth.authQuery.mockResolvedValueOnce([projectRow()]);
  const res = await exportRoute.GET(req("GET", "/export?section=projects"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ accountId: USER.id, projects: [{ ...projectRow(), updatedAt: "2026-10-25T12:00:00.123Z" }], nextCursor: null });
  expect(rpc()).toEqual({ path: "rpc/chat_list_projects", body: { p_user_id: USER.id } });

  auth.authQuery.mockResolvedValueOnce(true);
  const cleared = await workspace.DELETE(req("DELETE", "/workspace", { expectedAccountId: USER.id }));
  expect(await cleared.json()).toEqual({ accountId: USER.id, ok: true });
  expect(rpc(1)).toEqual({ path: "rpc/chat_clear_workspace", body: { p_user_id: USER.id } });
});

test("storage trouble is a 503 that never claims a save", async () => {
  auth.authQuery.mockRejectedValueOnce(new Error("Authentication storage failed (500)"));
  const res = await saveProject();
  expect(res.status).toBe(503);
  expect(await res.json()).not.toHaveProperty("project");
  auth.authQuery.mockResolvedValueOnce([]);
  expect((await saveProject()).status).toBe(503);
});
