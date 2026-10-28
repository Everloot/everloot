import { beforeEach, afterEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn(), authQuery: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getUser: auth.getUser, authQuery: auth.authQuery, siteUrl: () => "https://everloot.app" }));

import { GET } from "./route";
import { decodeCursor, encodeCursor } from "@/lib/chat/workspace";
import { exportWorkspace } from "@/lib/chat/workspace-api";

const SITE = "https://everloot.app";
const ME = { id: "11111111-2222-4333-8444-555555555555", name: "Thrall#1" };
const YOU = { id: "99999999-2222-4333-8444-555555555555", name: "Jaina#2" };
/** Vercel's response body limit; every export page must stay under it. */
const VERCEL_LIMIT = 4.5 * 1024 * 1024;

const id = (n: number, prefix = "a") => `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (n: number) => new Date(Date.UTC(2026, 9, 25, 12, 0, n)).toISOString();
const msg = (text: string) => ({ role: "user", text, at: at(0), model: null, sources: [], steps: [] });

type Row = Record<string, unknown> & { id: string; updatedAt: string };
interface Account { projects: Row[]; conversations: Row[]; entries: Row[]; builds: Record<string, unknown>[] }
let db: Record<string, Account>;

// A stand-in for PostgREST: the workspace functions and the saved_builds read, each scoped to the owner it is given.
function fakeQuery(path: string, init?: { body?: string }) {
  const body = init?.body ? JSON.parse(init.body) : {};
  const own = db[body.p_user_id] ?? { projects: [], conversations: [], entries: [], builds: [] };
  switch (path) {
    case "rpc/chat_list_projects": return own.projects;
    case "rpc/chat_list_conversations": {
      const key = (c: Row) => [c.pinned ? 1 : 0, c.updatedAt, c.id].join("|");
      const sorted = [...own.conversations].sort((a, b) => key(b).localeCompare(key(a)));
      const after = body.p_after_id ? [body.p_after_pinned ? 1 : 0, body.p_after_updated_at, body.p_after_id].join("|") : null;
      return sorted.filter((c) => after === null || key(c) < after).slice(0, body.p_limit)
        .map(({ messages: _messages, ...summary }) => summary);
    }
    case "rpc/chat_get_conversation": return own.conversations.find((c) => c.id === body.p_id) ?? null;
    case "rpc/chat_list_entries": {
      const key = (e: Row) => `${e.updatedAt}|${e.id}`;
      const sorted = [...own.entries].sort((a, b) => key(b).localeCompare(key(a)));
      const after = body.p_after_id ? `${body.p_after_updated_at}|${body.p_after_id}` : null;
      return sorted.filter((e) => after === null || key(e) < after).slice(0, body.p_limit);
    }
    case "rpc/chat_export": throw new Error("The export must not read the whole account in one answer");
  }
  const owner = /user_id=eq\.([0-9a-f-]+)/.exec(path)?.[1] ?? "";
  if (path.startsWith("build_characters?")) return [];
  if (path.startsWith("saved_builds?")) return db[owner]?.builds ?? [];
  throw new Error(`Unexpected query ${path}`);
}

const get = (query: string) => GET(new Request(`${SITE}/api/me/chat/export${query}`));
const buildRow = (n: number, over = {}) => ({
  id: id(n, "b"), slug: `Slug${String(n).padStart(4, "0")}`, name: `Build ${n}`, notes: "mine", class_slug: "mage", character_id: id(n, "c"),
  code: `EL1-mage-1-0.1-${n}`, code2: null, game_build: "0.1", shared: true, show_name: true, active: true, updated_at: at(n), ...over,
});

beforeEach(() => {
  vi.stubEnv("EVERLOOT_CHAT_WORKSPACE", "1");
  auth.getUser.mockReset().mockResolvedValue(ME);
  auth.authQuery.mockReset().mockImplementation(async (path: string, init?: { body?: string }) => fakeQuery(path, init));
  db = { [ME.id]: { projects: [], conversations: [], entries: [], builds: [] }, [YOU.id]: { projects: [], conversations: [], entries: [], builds: [] } };
});
afterEach(() => { vi.unstubAllEnvs(); });

test("each section is a private page naming its account; a missing or unknown section or a bad cursor is a 400", async () => {
  db[ME.id].projects = [{ id: id(1, "d"), name: "Raid", description: null, revision: 1, updatedAt: at(1) }];
  const res = await get("?section=projects");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ accountId: ME.id, projects: db[ME.id].projects, nextCursor: null });

  for (const q of ["", "?section=everything", "?section=entries&cursor=nope", "?section=conversations&cursor=" + encodeCursor([at(1), id(1)]),
    "?section=builds", `?section=builds&ids=${id(1)},not-an-id`, `?section=builds&ids=${Array.from({ length: 51 }, (_, i) => id(i, "b")).join(",")}`]) {
    const bad = await get(q);
    expect(bad.status, q).toBe(400);
    expect(bad.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("conversations come one whole chat per page, in list order, with a cursor that moves past it", async () => {
  db[ME.id].conversations = [1, 2, 3].map((n) => ({ id: id(n), title: `Chat ${n}`, updatedAt: at(n), projectId: null, pinned: n === 1, revision: 1, messages: [msg(`m${n}`)] }));
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await get(`?section=conversations${cursor ? `&cursor=${cursor}` : ""}`);
    const body = await res.json();
    expect(body.accountId).toBe(ME.id);
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].messages).toHaveLength(1);
    seen.push(body.conversations[0].id);
    cursor = body.nextCursor;
  } while (cursor);
  expect(seen).toEqual([id(1), id(3), id(2)]);
});

test("a chat deleted between the list and the read is skipped, not an error", async () => {
  db[ME.id].conversations = [1, 2].map((n) => ({ id: id(n), title: "c", updatedAt: at(n), projectId: null, pinned: false, revision: 1, messages: [] }));
  auth.authQuery.mockImplementation(async (path: string, init?: { body?: string }) =>
    path === "rpc/chat_get_conversation" && JSON.parse(init!.body!).p_id === id(2) ? null : fakeQuery(path, init));
  const first = await (await get("?section=conversations")).json();
  expect(first.conversations).toEqual([]);
  expect(decodeCursor(first.nextCursor, true)).toEqual([false, at(2), id(2)]);
  const second = await (await get(`?section=conversations&cursor=${first.nextCursor}`)).json();
  expect(second).toMatchObject({ conversations: [{ id: id(1) }], nextCursor: null });
});

test("an entries page stops before 3 MiB and its cursor resumes after the last entry it holds", async () => {
  const big = "\u0001".repeat(20_000); // escapes to six bytes each in JSON
  db[ME.id].entries = Array.from({ length: 50 }, (_, n) => ({
    id: id(n), projectId: null, kind: "note", title: "", buildId: null, href: null, text: big, sources: [], revision: 1, updatedAt: at(n),
  }));
  const res = await get("?section=entries");
  const text = await res.text();
  expect(Buffer.byteLength(text)).toBeLessThan(3.5 * 1024 * 1024);
  const body = JSON.parse(text);
  expect(body.entries.length).toBeGreaterThan(0);
  expect(body.entries.length).toBeLessThan(50);
  const last = body.entries.at(-1);
  expect(decodeCursor(body.nextCursor, false)).toEqual([last.updatedAt, last.id]);
});

test("builds are the account's own builds asked for by id, as code and notes only", async () => {
  db[ME.id].builds = [buildRow(1), buildRow(2)];
  db[YOU.id].builds = [buildRow(3)];
  const res = await get(`?section=builds&ids=${id(1, "b")},${id(3, "b")}`);
  expect(await res.json()).toEqual({ accountId: ME.id, builds: [
    { id: id(1, "b"), name: "Build 1", notes: "mine", classSlug: "mage", code: "EL1-mage-1-0.1-1", code2: null, gameBuild: "0.1", updatedAt: at(1) },
  ], nextCursor: null });
  expect(auth.authQuery.mock.calls.some(([p]) => String(p).includes(YOU.id))).toBe(false);
});

test("a workspace far over 4.5 MB downloads whole through pages that each stay under the limit", async () => {
  const chat = (n: number) => ({ id: id(n), title: `Chat ${n}`, updatedAt: at(n), projectId: null, pinned: false, revision: 1,
    messages: Array.from({ length: 9 }, (_, i) => msg(`${n}.${i} ${"é".repeat(50_000)}`)) });
  db[ME.id].projects = Array.from({ length: 100 }, (_, n) => ({ id: id(n, "d"), name: `P${n}`, description: "d".repeat(1000), revision: 1, updatedAt: at(n) }));
  db[ME.id].conversations = Array.from({ length: 8 }, (_, n) => chat(n));
  db[ME.id].entries = Array.from({ length: 120 }, (_, n) => ({
    id: id(n, "e"), projectId: null, kind: n % 10 === 0 ? "build" : "note", title: "", buildId: n % 10 === 0 ? id(n, "b") : null,
    href: null, text: n % 10 === 0 ? null : "x".repeat(20_000), sources: [], revision: 1, updatedAt: at(n),
  }));
  db[ME.id].builds = [buildRow(0), buildRow(10), buildRow(999)];

  const sizes: number[] = [];
  const send = vi.fn<typeof fetch>(async (url, init) => {
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    const res = await GET(new Request(`${SITE}${url}`));
    const text = await res.text();
    sizes.push(Buffer.byteLength(text));
    return new Response(text, { status: res.status, headers: res.headers });
  });
  const blob = await exportWorkspace({ accountId: ME.id, send });
  const data = JSON.parse(await blob.text());

  expect(blob.type).toBe("application/json");
  expect(blob.size).toBeGreaterThan(VERCEL_LIMIT);
  expect(Math.max(...sizes)).toBeLessThan(4 * 1024 * 1024);
  expect(sizes.length).toBeGreaterThan(3);
  expect(Object.keys(data).sort()).toEqual(["accountId", "builds", "conversations", "entries", "exportedAt", "projects", "version"]);
  expect(data).toMatchObject({ version: 1, accountId: ME.id });
  expect(data.projects).toHaveLength(100);
  expect(data.conversations).toHaveLength(8);
  expect(data.conversations.every((c: { messages: unknown[] }) => c.messages.length === 9)).toBe(true);
  expect(data.entries).toHaveLength(120);
  expect(data.builds.map((b: { id: string }) => b.id).sort()).toEqual([id(0, "b"), id(10, "b")]);
  for (const build of data.builds) expect(Object.keys(build).sort()).toEqual(["classSlug", "code", "code2", "gameBuild", "id", "name", "notes", "updatedAt"]);
  expect(auth.authQuery.mock.calls.map(([p]) => p)).not.toContain("rpc/chat_export");
});

test("an empty workspace downloads as empty lists without asking for builds", async () => {
  const send = vi.fn<typeof fetch>(async (url) => GET(new Request(`${SITE}${url}`)));
  const data = JSON.parse(await (await exportWorkspace({ accountId: ME.id, send })).text());
  expect(data).toMatchObject({ version: 1, accountId: ME.id, projects: [], conversations: [], entries: [], builds: [] });
  expect(send.mock.calls.map(([u]) => String(u))).toEqual([
    "/api/me/chat/export?section=projects", "/api/me/chat/export?section=conversations", "/api/me/chat/export?section=entries",
  ]);
});

test("a switch of account partway through stops the download with nothing to save", async () => {
  db[ME.id].conversations = [1, 2].map((n) => ({ id: id(n), title: "c", updatedAt: at(n), projectId: null, pinned: false, revision: 1, messages: [] }));
  db[YOU.id].conversations = [{ id: id(9), title: "theirs", updatedAt: at(9), projectId: null, pinned: false, revision: 1, messages: [] }];
  let calls = 0;
  const send = vi.fn<typeof fetch>(async (url) => {
    if (++calls === 3) auth.getUser.mockResolvedValue(YOU);
    return GET(new Request(`${SITE}${url}`));
  });
  await expect(exportWorkspace({ accountId: ME.id, send })).rejects.toMatchObject({ code: "account_changed" });
});
