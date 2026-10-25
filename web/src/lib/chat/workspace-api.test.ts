import { expect, test, vi } from "vitest";
import { listConversations, saveConversation, saveEntry, sameSitePath, whoAmI, WorkspaceError, deleteProject, importConversation, exportWorkspace } from "./workspace-api";

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

/** Export pages by section, answered in order; a page may be a status with a body instead. */
function exportSender(pages: Record<string, Array<object | [number, object]>>) {
  return vi.fn<typeof fetch>(async (url, init) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const section = new URL(String(url), "https://everloot.app").searchParams.get("section")!;
    const next = pages[section].shift()!;
    return Array.isArray(next) ? Response.json(next[1], { status: next[0] }) : Response.json({ accountId: ME, ...next });
  });
}

test("the export reads every page and assembles one JSON file, asking only for builds the entries name", async () => {
  const send = exportSender({
    projects: [{ projects: [{ id: ID }], nextCursor: null }],
    conversations: [{ conversations: [{ id: "c1" }], nextCursor: "n1" }, { conversations: [{ id: "c2" }], nextCursor: null }],
    entries: [{ entries: [{ id: "e1", kind: "build", buildId: OTHER }, { id: "e2", kind: "note", buildId: null }], nextCursor: null }],
    builds: [{ builds: [{ id: OTHER, code: "EL1-mage-1-0.1-x" }], nextCursor: null }],
  });
  const data = JSON.parse(await (await exportWorkspace({ accountId: ME, send })).text());
  expect(send.mock.calls.map(([u]) => u)).toEqual([
    "/api/me/chat/export?section=projects", "/api/me/chat/export?section=conversations", "/api/me/chat/export?section=conversations&cursor=n1",
    "/api/me/chat/export?section=entries", `/api/me/chat/export?section=builds&ids=${OTHER}`,
  ]);
  expect(data).toMatchObject({ version: 1, accountId: ME, conversations: [{ id: "c1" }, { id: "c2" }], builds: [{ id: OTHER }] });
  expect(Date.parse(data.exportedAt)).not.toBeNaN();
});

test("a failed page fails the whole export instead of saving part of it", async () => {
  const send = exportSender({
    projects: [{ projects: [], nextCursor: null }],
    conversations: [{ conversations: [{ id: "c1" }], nextCursor: "n1" }, [503, { error: "down" }]],
  });
  await expect(exportWorkspace({ accountId: ME, send })).rejects.toMatchObject({ code: "unavailable" });
  const signedOut = exportSender({ projects: [[401, { error: "x" }]] });
  await expect(exportWorkspace({ accountId: ME, send: signedOut })).rejects.toMatchObject({ code: "signed_out" });
});

test("a cursor that does not move is refused rather than read forever", async () => {
  const send = exportSender({
    projects: [{ projects: [], nextCursor: null }],
    conversations: [{ conversations: [], nextCursor: "same" }, { conversations: [], nextCursor: "same" }],
  });
  await expect(exportWorkspace({ accountId: ME, send })).rejects.toMatchObject({ code: "unavailable" });
});

test("cancelling between pages stops the export", async () => {
  const stop = new AbortController();
  const send = exportSender({
    projects: [{ projects: [], nextCursor: null }],
    conversations: [{ conversations: [{ id: "c1" }], nextCursor: "n1" }, { conversations: [], nextCursor: null }],
  });
  send.mockImplementationOnce(async () => { stop.abort(); return Response.json({ accountId: ME, projects: [], nextCursor: null }); });
  await expect(exportWorkspace({ accountId: ME, send, signal: stop.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(send).toHaveBeenCalledTimes(1);
});
