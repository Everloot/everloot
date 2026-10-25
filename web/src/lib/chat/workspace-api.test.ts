import { expect, test, vi } from "vitest";
import { listConversations, saveConversation, saveEntry, sameSitePath, whoAmI, WorkspaceError, deleteProject, importConversation } from "./workspace-api";

const ME = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function sender(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => Response.json(body, { status }));
}
const sentBody = (send: ReturnType<typeof sender>) => JSON.parse(String(send.mock.calls[0][1]?.body));

test("the signed-in identity is the session's own user from /api/auth/me", async () => {
  expect(await whoAmI(sender(200, { user: { id: ME, name: "Jaina#1234", email: "x@y" } }))).toEqual({ id: ME, name: "Jaina#1234" });
  expect(await whoAmI(sender(200, { user: null }))).toBeNull();
  await expect(whoAmI(sender(503, { error: "down" }))).rejects.toMatchObject({ code: "unavailable" });
});

test("a save names the expected account and revision, never caches, and returns the stored record", async () => {
  const conversation = { id: ID, title: "Linen", projectId: null, pinned: false, messages: [] };
  const send = sender(200, { accountId: ME, conversation: { ...conversation, revision: 1, updatedAt: "2026-10-25T00:00:00Z" } });
  const saved = await saveConversation(conversation, 0, { accountId: ME, send });
  expect(saved.revision).toBe(1);
  const [url, init] = send.mock.calls[0];
  expect(url).toBe("/api/me/chat/conversations");
  expect(init).toMatchObject({ method: "POST", cache: "no-store" });
  expect(sentBody(send)).toEqual({ expectedAccountId: ME, expectedRevision: 0, conversation });
});

test("a response for another account is refused, so it is never shown or saved over", async () => {
  const send = sender(200, { accountId: OTHER, conversations: [{ id: ID }], nextCursor: null });
  await expect(listConversations({}, { accountId: ME, send })).rejects.toMatchObject({ code: "account_changed" });
});

test("statuses become codes the screen can act on", async () => {
  const opts = (status: number, body: unknown = { error: "x" }) => ({ accountId: ME, send: sender(status, body) });
  const entry = { id: ID, projectId: null, kind: "note" as const, title: "T", buildId: null, href: null, text: "n", sources: [] };
  await expect(saveEntry(entry, 3, opts(409, { error: "changed", code: "revision_conflict" }))).rejects.toMatchObject({ code: "conflict" });
  await expect(saveEntry(entry, 3, opts(401))).rejects.toMatchObject({ code: "signed_out" });
  await expect(saveEntry(entry, 3, opts(404))).rejects.toMatchObject({ code: "not_found" });
  await expect(saveEntry(entry, 3, opts(413, { error: "Too many entries." }))).rejects.toMatchObject({ code: "too_large", message: "Too many entries." });
  await expect(saveEntry(entry, 3, opts(503))).rejects.toMatchObject({ code: "unavailable" });
  const offline = { accountId: ME, send: vi.fn<typeof fetch>(async () => { throw new TypeError("Failed to fetch"); }) };
  await expect(saveEntry(entry, 3, offline)).rejects.toBeInstanceOf(WorkspaceError);
});

test("deletes and imports carry the account they expect", async () => {
  const del = sender(200, { accountId: ME, ok: true });
  await deleteProject(ID, 4, { accountId: ME, send: del });
  expect(del.mock.calls[0][0]).toBe(`/api/me/chat/projects/${ID}`);
  expect(del.mock.calls[0][1]?.method).toBe("DELETE");
  expect(sentBody(del)).toEqual({ expectedAccountId: ME, expectedRevision: 4 });

  const imp = sender(200, { accountId: ME, conversation: { id: ID, revision: 1 }, created: true });
  await importConversation({ sourceId: OTHER, legacyId: "old-1", conversation: { title: "T", messages: [] } }, { accountId: ME, send: imp });
  expect(sentBody(imp)).toEqual({ expectedAccountId: ME, sourceId: OTHER, legacyId: "old-1", conversation: { title: "T", messages: [] } });
});

test("list queries skip empty filters", async () => {
  const send = sender(200, { accountId: ME, conversations: [], nextCursor: null });
  await listConversations({ query: "linen", projectId: ID }, { accountId: ME, send });
  expect(send.mock.calls[0][0]).toBe(`/api/me/chat/conversations?query=linen&projectId=${ID}`);
});

test("only this site's pages can be saved, kept as their path", () => {
  expect(sameSitePath("/database/items/2589")).toBe("/database/items/2589");
  expect(sameSitePath("https://everloot.app/database/npcs/3?x=1#a")).toBe("/database/npcs/3?x=1#a");
  expect(sameSitePath("https://www.everloot.app/guides")).toBe("/guides");
  expect(sameSitePath("//evil.example/x")).toBeNull();
  expect(sameSitePath("/\\evil.example")).toBeNull();
  expect(sameSitePath("https://evil.example/database")).toBeNull();
  expect(sameSitePath("javascript:alert(1)")).toBeNull();
  expect(sameSitePath(`/${"a".repeat(2048)}`)).toBeNull();
});
