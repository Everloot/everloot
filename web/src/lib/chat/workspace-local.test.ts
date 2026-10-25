import { expect, test, vi } from "vitest";
import { loadConversations, saveConversation, type ChatMessage } from "./store";
import { browserChats, importBrowserChats, removeBackups, scoped, sourceIdFor } from "./workspace-local";

const ME = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const msg = (text: string): ChatMessage => ({ role: "user", text, at: "2026-10-20T00:00:00Z", model: null, sources: [], steps: [] });
function legacy(s: ReturnType<typeof memory>, ...ids: string[]) {
  for (const id of ids) saveConversation(s, { id, title: "", updatedAt: "", messages: [msg(`question ${id}`)] });
}

test("an account's browser chats live under their own name, apart from the old shared list", () => {
  const s = memory();
  legacy(s, "old");
  saveConversation(scoped(s, ME), { id: "mine", title: "", updatedAt: "", messages: [msg("mine")] });
  expect(loadConversations(s).map((c) => c.id)).toEqual(["old"]);
  expect(loadConversations(scoped(s, ME)).map((c) => c.id)).toEqual(["mine"]);
  expect(loadConversations(scoped(s, OTHER))).toEqual([]);
});

test("the browser's import source is one stable id", () => {
  const s = memory();
  const id = sourceIdFor(s);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(sourceIdFor(s)).toBe(id);
});

test("import sends each chat once, binds it only after the account acknowledged it, and keeps the originals", async () => {
  const s = memory();
  legacy(s, "a", "b", "c");
  let n = 0;
  const post = vi.fn(async ({ legacyId }: { legacyId: string }) => {
    if (legacyId === "b" && n++ === 0) throw new Error("offline");
    return { id: `server-${legacyId}` };
  });
  const first = await importBrowserChats(s, ME, post);
  expect(first).toMatchObject({ imported: 1, total: 3, error: "offline" });
  expect(browserChats(s, ME).backups.map((c) => c.id)).toEqual(["c"]);
  expect(browserChats(s, ME).unbound.map((c) => c.id)).toEqual(["b", "a"]);

  const retry = await importBrowserChats(s, ME, post);
  expect(retry).toMatchObject({ imported: 2, total: 2, error: null });
  expect(post.mock.calls.map(([r]) => r.legacyId)).toEqual(["c", "b", "b", "a"]);
  expect(loadConversations(s).map((c) => c.id)).toEqual(["c", "b", "a"]);
  expect(post.mock.calls[0][0]).toMatchObject({ sourceId: sourceIdFor(s), conversation: { title: "question c", messages: [msg("question c")] } });
});

test("chats bound to one account are hidden from another and from signed-out visitors, and cannot be claimed", async () => {
  const s = memory();
  legacy(s, "a", "b");
  await importBrowserChats(s, ME, async () => ({ id: "x" }));
  legacy(s, "c");
  expect(browserChats(s, OTHER)).toEqual({ unbound: [expect.objectContaining({ id: "c" })], backups: [] });
  expect(browserChats(s, null).backups).toEqual([]);
  expect(browserChats(s, null).unbound.map((c) => c.id)).toEqual(["c"]);
  const post = vi.fn(async (_r: { legacyId: string }) => ({ id: "y" }));
  await importBrowserChats(s, OTHER, post);
  expect(post.mock.calls.map(([r]) => r.legacyId)).toEqual(["c"]);
  expect(browserChats(s, ME).backups.map((c) => c.id)).toEqual(["b", "a"]);
});

test("removing local copies removes only that account's backups", async () => {
  const s = memory();
  legacy(s, "a");
  await importBrowserChats(s, ME, async () => ({ id: "x" }));
  legacy(s, "b");
  expect(removeBackups(s, ME)).toBe(1);
  expect(loadConversations(s).map((c) => c.id)).toEqual(["b"]);
});
