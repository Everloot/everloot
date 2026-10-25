// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat/store";
import type { WorkspaceConversation, WorkspaceEntry, WorkspaceProject } from "@/lib/chat/workspace-types";
import ChatClient from "./ChatClient";

// The private workspace as the plan's contract describes it (docs/superpowers/plans/2026-10-25-chat-workspace.md),
// held in memory for two accounts. The model is never called: these chats run on Everloot search.

const ME = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const BUILD = "bbbbbbbb-2222-4333-8444-555555555555";
const HIT = "[guide] Fury\nRage.\nMore: https://everloot.app/guides/fury\nSource: https://warcraft.wiki.gg/wiki/Fury (CC-BY-SA-4.0, retrieved 2023-11-13)\n";
const CARD = { type: "item", id: 2589, title: "Linen Cloth", quality: 1, color: null, icon: null, lines: ["Item Level 5"], foot: null };

interface Store { projects: Map<string, WorkspaceProject>; conversations: Map<string, WorkspaceConversation>; entries: Map<string, WorkspaceEntry>; imports: Map<string, string> }
const store = (): Store => ({ projects: new Map(), conversations: new Map(), entries: new Map(), imports: new Map() });

let accounts: Record<string, Store>;
let who: { id: string; name: string } | null;
let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
let failNext: { path: string; status: number; body?: unknown; times?: number } | null;
let hold: { path: string; release: () => void; done: Promise<void> } | null;
let buildName: string;
let meFails: number;
let exportFails: boolean;

function sse(events: unknown[]): Response {
  const raw = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new TextEncoder().encode(raw), { status: 200, headers: { "content-type": "text/event-stream" } });
}

const now = () => new Date().toISOString();
const builds = () => [{ id: BUILD, slug: "abcdefgh", name: buildName, notes: null, classSlug: "warrior", characterId: null, code: "x", code2: null, gameBuild: "1", shared: false, active: false, link: null, updatedAt: now(), showName: false }];
const summary = ({ messages: _m, ...s }: WorkspaceConversation) => s;

function server() {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "https://everloot.app");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ url: `${url.pathname}${url.search}`, method, body });
    const path = url.pathname;
    if (hold && path === hold.path) { const h = hold; hold = null; await h.done; }
    if (path === "/api/auth/me") {
      if (meFails > 0) { meFails--; return Response.json({ error: "down" }, { status: 503 }); }
      return Response.json({ user: who });
    }
    if (url.host === "openrouter.ai") {
      if (path.endsWith("/chat/completions")) return sse([{ model: "m", choices: [{ delta: { content: "Bring potions." } }] }]);
      return Response.json({ data: [] });
    }
    if (path.startsWith("/schema/mcp/")) return Response.json({ title: "T", inputSchema: { type: "object", properties: {} } });
    if (path.startsWith("/api/tools/item_page")) return Response.json({ answer: { connected: true, dataAsOf: null, page: { drops: [] } } });
    if (path.startsWith("/api/tools/")) return Response.json({ text: HIT });
    if (path === "/database/card/item/2589") return Response.json({ ok: true, card: CARD });
    if (path === "/api/me/builds") return Response.json({ characters: [], builds: builds() });
    if (!path.startsWith("/api/me/chat")) throw new Error(`Unexpected request ${path}`);

    if (!who) return Response.json({ error: "Sign in" }, { status: 401 });
    const owner = who.id;
    const s = accounts[owner] ??= store();
    if (body && body.expectedAccountId !== owner) return Response.json({ error: "Account changed" }, { status: 409, headers: {} });
    if (failNext && path === failNext.path && method !== "GET") { const f = failNext; if (!f.times || --f.times === 0) failNext = null; return Response.json(f.body ?? { error: "down" }, { status: f.status }); }
    const ok = (data: object) => Response.json({ accountId: owner, ...data });
    const conflict = () => Response.json({ error: "changed", code: "revision_conflict" }, { status: 409 });
    const rev = body?.expectedRevision as number;
    const [, , , , kind, id] = path.split("/");

    // The account's private builds for a project's picker (ProjectView), read live: Jaina has one.
    if (kind === "builds" && method === "GET") return ok({ characters: [], builds: owner === ME ? builds() : [] });
    // The export, one section a request, each list in a single page here.
    if (kind === "export") {
      const section = url.searchParams.get("section");
      if (exportFails && section === "conversations") return Response.json({ error: "down" }, { status: 503 });
      if (section === "projects") return ok({ projects: [...s.projects.values()] });
      if (section === "conversations") return ok({ conversations: [...s.conversations.values()], nextCursor: null });
      if (section === "entries") return ok({ entries: [...s.entries.values()], nextCursor: null });
      if (section === "builds") return ok({ builds: [] });
      return Response.json({ error: "Say which section." }, { status: 400 });
    }

    if (kind === "projects") {
      if (method === "GET") return ok({ projects: [...s.projects.values()] });
      if (method === "DELETE") {
        const p = s.projects.get(id);
        if (!p) return Response.json({ error: "missing" }, { status: 404 });
        if (p.revision !== rev) return conflict();
        s.projects.delete(id);
        // As chat_delete_project does: what moves to Unfiled gets a new revision.
        for (const c of s.conversations.values()) if (c.projectId === id) { c.projectId = null; c.revision++; }
        for (const e of s.entries.values()) if (e.projectId === id) { e.projectId = null; e.revision++; }
        return ok({ ok: true });
      }
      const input = body!.project as WorkspaceProject;
      const old = s.projects.get(input.id);
      if ((old?.revision ?? 0) !== rev) return conflict();
      const p = { ...input, revision: rev + 1, updatedAt: now() };
      s.projects.set(p.id, p);
      return ok({ project: p });
    }
    if (kind === "conversations") {
      if (method === "GET" && id) { const c = s.conversations.get(id); return c ? ok({ conversation: c }) : Response.json({ error: "missing" }, { status: 404 }); }
      if (method === "GET") {
        const q = url.searchParams.get("query")?.toLowerCase() ?? "";
        const project = url.searchParams.get("projectId");
        const list = [...s.conversations.values()].filter((c) => c.title.toLowerCase().includes(q) && (!project || c.projectId === project)).reverse();
        return ok({ conversations: list.map(summary), nextCursor: null });
      }
      if (method === "DELETE") { s.conversations.delete(id); return ok({ ok: true }); }
      const input = body!.conversation as WorkspaceConversation;
      const old = s.conversations.get(input.id);
      if ((old?.revision ?? 0) !== rev) return conflict();
      const c = { ...input, revision: rev + 1, updatedAt: now() };
      s.conversations.delete(c.id);
      s.conversations.set(c.id, c);
      return ok({ conversation: c });
    }
    if (kind === "entries") {
      if (method === "GET") {
        const project = url.searchParams.get("projectId");
        return ok({ entries: [...s.entries.values()].filter((e) => !project || e.projectId === project).reverse(), nextCursor: null });
      }
      if (method === "DELETE") { s.entries.delete(id); return ok({ ok: true }); }
      const input = body!.entry as WorkspaceEntry;
      if ((s.entries.get(input.id)?.revision ?? 0) !== rev) return conflict();
      const e = { ...input, revision: rev + 1, updatedAt: now() };
      s.entries.set(e.id, e);
      return ok({ entry: e });
    }
    if (kind === "import") {
      const key = `${body!.sourceId}:${body!.legacyId}`;
      const existing = s.imports.get(key);
      if (existing) return ok({ conversation: s.conversations.get(existing), created: false });
      const c = { id: crypto.randomUUID(), ...(body!.conversation as { title: string; messages: ChatMessage[] }), projectId: null, pinned: false, revision: 1, updatedAt: now() };
      s.conversations.set(c.id, c);
      s.imports.set(key, c.id);
      return ok({ conversation: c, created: true });
    }
    if (kind === "workspace") { accounts[owner] = store(); return ok({ ok: true }); }
    throw new Error(`Unexpected workspace request ${method} ${path}`);
  }));
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // A desktop window: the sidebar starts open.
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/chat");
  accounts = {};
  who = { id: ME, name: "Jaina#1234" };
  calls = [];
  failNext = null;
  hold = null;
  buildName = "Fury leveling";
  meFails = 0;
  exportFails = false;
  server();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async () => { for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (props: { workspace?: boolean; savedBuilds?: boolean } = { workspace: true }) => { await act(async () => root.render(<ChatClient {...props} />)); await settle(); };
const text = () => container.textContent ?? "";
const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const field = (label: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
async function click(label: string) {
  const b = button(label);
  if (!b) throw new Error(`No button ${label} in: ${text()}`);
  await act(async () => { b.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); b.click(); });
  await settle();
}
async function type(label: string, value: string) {
  const el = field(label);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await settle();
}
async function submit(label: string) {
  await act(async () => { field(label).closest("form")!.requestSubmit(); });
  await settle();
}
async function ask(question: string) {
  await type("Your question", question);
  await click("Send");
}
const posts = (path: string) => calls.filter((c) => c.method === "POST" && c.url === path).map((c) => c.body!);
const mine = () => accounts[ME];
const msg = (role: "user" | "assistant", text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ role, text, at: now(), model: null, sources: [], steps: [], ...extra });
function seedChat(owner: string, title: string, extra: Partial<WorkspaceConversation> = {}) {
  const s = accounts[owner] ??= store();
  const c: WorkspaceConversation = { id: crypto.randomUUID(), title, updatedAt: now(), projectId: null, pinned: false, revision: 1, messages: [msg("user", title), msg("assistant", "An answer.")], ...extra };
  s.conversations.set(c.id, c);
  return c;
}

test("flag off: Chat stays in the browser and never calls the private workspace", async () => {
  await render({});
  await ask("Plan a level 40 Fury warrior");
  expect(calls.some((c) => c.url.startsWith("/api/me/chat"))).toBe(false);
  expect(button("Import 1 browser chat")).toBeUndefined();
  expect(JSON.parse(localStorage.getItem("everloot.chat.conversations.v1")!)).toHaveLength(1);
});

test("a signed-in player's new chat goes to their account by default, each completed turn saved with its revision", async () => {
  await render();
  expect(container.querySelector<HTMLInputElement>('input[name="chat-store"]:checked')?.parentElement?.textContent).toBe("Your account");
  await ask("Plan a level 40 Fury warrior");
  const saves = posts("/api/me/chat/conversations");
  expect(saves.map((b) => b.expectedRevision)).toEqual([0, 1]);
  expect(saves.every((b) => b.expectedAccountId === ME)).toBe(true);
  expect((saves[1].conversation as { messages: ChatMessage[] }).messages).toHaveLength(2);
  expect(text()).toContain("In your account · Saved");
  expect(field("Recent").textContent).toContain("Plan a level 40 Fury warrior");
  expect(localStorage.getItem("everloot.chat.conversations.v1")).toBeNull();
});

test("This browser keeps a signed-in chat under that account's own browser list, and the account never sees it", async () => {
  await render();
  const radio = Array.from(container.querySelectorAll<HTMLInputElement>('input[name="chat-store"]')).find((r) => r.parentElement?.textContent === "This browser")!;
  await act(async () => radio.click());
  await ask("Plan a level 40 Fury warrior");
  expect(posts("/api/me/chat/conversations")).toEqual([]);
  expect(JSON.parse(localStorage.getItem(`everloot.chat.conversations.v1@${ME}`)!)).toHaveLength(1);
  expect(field("This browser").textContent).toContain("Plan a level 40 Fury warrior");
});

test("signed out: chats stay in the browser and projects ask for a sign-in", async () => {
  who = null;
  await render();
  expect(text()).toContain("Sign in to keep chats and projects in your account.");
  expect(container.querySelector('input[name="chat-store"]')).toBeNull();
  await ask("Plan a level 40 Fury warrior");
  expect(calls.some((c) => c.url.startsWith("/api/me/chat"))).toBe(false);
  expect(JSON.parse(localStorage.getItem("everloot.chat.conversations.v1")!)).toHaveLength(1);
});

test("projects are created, renamed and removed; removing moves their chats to Unfiled", async () => {
  await render();
  await click("New project");
  await type("Project name", "Warrior leveling");
  await click("Create project");
  const [project] = mine().projects.values();
  expect(window.location.search).toBe(`?project=${project.id}`);
  expect(container.querySelector("h2.text-2xl")?.textContent).toBe("Warrior leveling");
  for (const h of ["Saved", "Chats", "Notes"]) expect(text()).toContain(h);

  await click("New chat in this project");
  expect(text()).toContain("In Warrior leveling");
  expect(container.querySelector('input[name="chat-store"]')).toBeNull();
  await ask("Plan a level 40 Fury warrior");
  const chat = [...mine().conversations.values()][0];
  expect(chat.projectId).toBe(project.id);

  await click("Warrior leveling");
  await click("Rename project");
  await type("Project name", "Fury 1-60");
  await click("Save project");
  expect(posts("/api/me/chat/projects").at(-1)).toMatchObject({ expectedRevision: 1, project: { name: "Fury 1-60" } });
  expect(button("Fury 1-60")).toBeDefined();

  await click("Remove project");
  expect(text()).toContain("Its chats and saved items move to Unfiled. Builds and pages are not deleted.");
  await click("Yes, remove");
  expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ url: `/api/me/chat/projects/${project.id}`, body: { expectedAccountId: ME, expectedRevision: 2 } });
  expect(mine().conversations.get(chat.id)?.projectId).toBeNull();
  expect(window.location.search).toBe("?view=all");
  expect(text()).toContain("Unfiled");
});

test("notes, pages and live build references are saved in a project; a note reaches the model only through its chip", async () => {
  const project = { id: crypto.randomUUID(), name: "Raid prep", description: null, revision: 1, updatedAt: now() };
  (accounts[ME] = store()).projects.set(project.id, project);
  window.history.replaceState(null, "", `/chat?project=${project.id}`);
  await render({ workspace: true, savedBuilds: true });

  await type("Note title", "Consumables");
  await type("Note", "Bring 20 Major Healing Potions.");
  await click("Add note");
  expect(posts("/api/me/chat/entries")[0]).toMatchObject({ expectedRevision: 0, entry: { kind: "note", projectId: project.id, title: "Consumables", text: "Bring 20 Major Healing Potions." } });

  await type("Page link", "https://evil.example/x");
  await click("Save page");
  expect(text()).toContain("Only Everloot pages can be saved");
  await type("Page link", "https://everloot.app/database/items/2589");
  await type("Label (optional)", "Cloth to farm");
  await click("Save page");
  expect(posts("/api/me/chat/entries")[1]).toMatchObject({ entry: { kind: "page", href: "/database/items/2589", title: "Cloth to farm", text: null } });
  await click("Show card");
  expect(text()).toContain("Linen Cloth");
  expect(JSON.stringify(mine().entries)).not.toContain("Linen Cloth");

  await type("Add a build", BUILD);
  expect(posts("/api/me/chat/entries")[2]).toMatchObject({ entry: { kind: "build", buildId: BUILD, href: null } });
  buildName = "Fury leveling v2";
  await click("Back to chat");
  await click("Raid prep");
  expect(text()).toContain("Fury leveling v2");

  await click("Use in question");
  expect(text()).toContain("Note: Consumables");
  await ask("What should I bring?");
  const sent = posts("/api/me/chat/conversations")[0].conversation as { messages: ChatMessage[] };
  // The project keeps the note; the chat's history does not carry a copy of it.
  expect(sent.messages[0]).toMatchObject({ text: "What should I bring?" });
  expect(sent.messages[0].context).toBeUndefined();
  expect(text()).not.toContain("Note: Consumables");
  await ask("And for the next boss?");
  expect(JSON.stringify(posts("/api/me/chat/conversations"))).not.toContain("Major Healing Potions");
});

test("a project's builds are read from Chat's private builds even with the My builds switch off", async () => {
  const project = { id: crypto.randomUUID(), name: "Raid prep", description: null, revision: 1, updatedAt: now() };
  (accounts[ME] = store()).projects.set(project.id, project);
  mine().entries.set("e1", { id: "e1", projectId: project.id, kind: "build", title: "Fury leveling", buildId: BUILD, href: null, text: null, sources: [], revision: 1, updatedAt: now() });
  mine().entries.set("e2", { id: "e2", projectId: project.id, kind: "build", title: "Gone build", buildId: crypto.randomUUID(), href: null, text: null, sources: [], revision: 1, updatedAt: now() });
  window.history.replaceState(null, "", `/chat?project=${project.id}`);
  await render();
  expect(container.querySelector<HTMLAnchorElement>('[aria-labelledby="project-saved"] a')?.textContent).toBe("Fury leveling");
  expect(text()).toContain("This build is no longer in your account.");
  expect(calls.some((c) => c.url === "/api/me/chat/builds")).toBe(true);
  expect(calls.some((c) => c.url === "/api/me/builds")).toBe(false);
});

test("an answer's selected text and an item's page are saved to a project, without the card's facts", async () => {
  const project = { id: crypto.randomUUID(), name: "Gold", description: null, revision: 1, updatedAt: now() };
  (accounts[ME] = store()).projects.set(project.id, project);
  seedChat(ME, "Where does Linen Cloth drop?", { messages: [msg("user", "Where does Linen Cloth drop?"), msg("assistant", "Humanoids drop it. Farm Defias.", { model: "m", sources: ["https://warcraft.wiki.gg/wiki/Linen_Cloth"], item: { id: 2589 } })] });
  await render();
  await click("Where does Linen Cloth drop?");
  expect(text()).toContain("Linen Cloth");

  const body = Array.from(container.querySelectorAll("div")).find((d) => d.textContent === "Humanoids drop it. Farm Defias.")!;
  const range = document.createRange();
  range.setStart(body.firstChild!, 0);
  range.setEnd(body.firstChild!, 18);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await click("Save to project");
  expect(field("Project").value).toBe(project.id);
  await click("Save");
  expect(posts("/api/me/chat/entries")[0]).toMatchObject({ entry: { kind: "answer", projectId: project.id, title: "Where does Linen Cloth drop?", text: "Humanoids drop it.", sources: ["https://warcraft.wiki.gg/wiki/Linen_Cloth"] } });
  expect(text()).toContain("Saved to Gold.");
  await click("Close");

  await click("Save item to a project");
  await type("Project", "new");
  await type("New project name", "Cloth");
  await click("Save");
  const [, , page] = [...posts("/api/me/chat/projects"), ...posts("/api/me/chat/entries")];
  expect(page).toMatchObject({ entry: { kind: "page", href: "/database/items/2589", title: "/database/items/2589" } });
  expect(JSON.stringify(posts("/api/me/chat/entries"))).not.toContain("Item Level 5");
  expect(button("Cloth")).toBeDefined();
});

test("View all searches titles, filters by project, and renames, pins and moves a chat with its revision", async () => {
  const project = { id: crypto.randomUUID(), name: "Gold", description: null, revision: 1, updatedAt: now() };
  (accounts[ME] = store()).projects.set(project.id, project);
  const a = seedChat(ME, "Linen farming");
  seedChat(ME, "Fury talents");
  await render();
  await click("View all chats");
  expect(window.location.search).toBe("?view=all");
  await type("Search chat titles", "linen");
  await submit("Search chat titles");
  expect(calls.at(-1)!.url).toBe("/api/me/chat/conversations?query=linen");
  expect(container.querySelector('[aria-labelledby="library-account"]')?.textContent).not.toContain("Fury talents");

  await click("Rename Linen farming");
  await type("New title", "Cloth route");
  await click("Save title");
  expect(posts("/api/me/chat/conversations").at(-1)).toMatchObject({ expectedRevision: 1, conversation: { id: a.id, title: "Cloth route" } });
  await click("Pin Cloth route");
  await type("Move Cloth route", project.id);
  expect(mine().conversations.get(a.id)).toMatchObject({ title: "Cloth route", pinned: true, projectId: project.id, revision: 4 });
  expect(field("Pinned").textContent).toContain("Cloth route");
  expect(field("Recent").textContent).not.toContain("Cloth route");

  await type("Project filter", project.id);
  expect(calls.at(-1)!.url).toBe(`/api/me/chat/conversations?query=linen&projectId=${project.id}`);
});

test("a save another device beat becomes a conflict: nothing is overwritten, and the text can be kept as a copy", async () => {
  const c = seedChat(ME, "Fury talents");
  await render();
  await click("Fury talents");
  c.revision = 5; // edited elsewhere
  await ask("And at level 50?");
  expect(text()).toContain("This chat changed on another device. Nothing here was lost.");
  expect(text()).toContain("And at level 50?");
  expect(mine().conversations.get(c.id)!.messages).toHaveLength(2);
  await click("Save mine as a copy");
  const copy = posts("/api/me/chat/conversations").at(-1)!;
  expect(copy).toMatchObject({ expectedRevision: 0, conversation: { title: "Copy of Fury talents" } });
  expect((copy.conversation as { id: string; messages: unknown[] }).messages).toHaveLength(4);
  expect((copy.conversation as { id: string }).id).not.toBe(c.id);
  expect(text()).toContain("Saved");
});

test("a failed save says Not saved, keeps the chat, and Retry saves it without asking the model again", async () => {
  await render();
  failNext = { path: "/api/me/chat/conversations", status: 503, times: 2 };
  await type("Your question", "Plan a level 40 Fury warrior");
  await click("Send");
  expect(text()).toContain("Not saved.");
  const searches = calls.filter((c) => c.url.startsWith("/api/tools/")).length;
  await click("Retry");
  expect(text()).toContain("In your account · Saved");
  expect(calls.filter((c) => c.url.startsWith("/api/tools/")).length).toBe(searches);
  expect([...mine().conversations.values()][0].messages).toHaveLength(2);
});

test("browser chats are imported only on request, into the named account, once, and stay as its backup", async () => {
  localStorage.setItem("everloot.chat.conversations.v1", JSON.stringify([
    { id: "old-1", title: "", updatedAt: "", messages: [msg("user", "Old one")] },
    { id: "old-2", title: "", updatedAt: "", messages: [msg("user", "Old two")] },
  ]));
  await render();
  expect(calls.some((c) => c.url === "/api/me/chat/import")).toBe(false);
  failNext = { path: "/api/me/chat/import", status: 503 };
  await click("Import 2 browser chats");
  expect(text()).toContain("Copy 2 chats from this browser into Jaina#1234?");
  await click("Import");
  expect(text()).toContain("0 of 2 imported. The rest stay in this browser.");
  await click("Import 2 browser chats");
  await click("Import");
  expect(text()).toContain("Imported 2 chats.");
  expect(mine().conversations.size).toBe(2);
  const sources = new Set(posts("/api/me/chat/import").map((b) => b.sourceId));
  expect(sources.size).toBe(1);
  expect(button("Import 2 browser chats")).toBeUndefined();
  expect(JSON.parse(localStorage.getItem("everloot.chat.conversations.v1")!)).toHaveLength(2);

  await click("Remove local copies (2)");
  await click("Remove");
  expect(localStorage.getItem("everloot.chat.conversations.v1")).toBeNull();
});

test("an account switch hides the departing account's chats and drops its late responses", async () => {
  seedChat(ME, "Jaina's secret plan");
  seedChat(OTHER, "Thrall's route");
  await render();
  await click("Jaina's secret plan");
  expect(text()).toContain("Jaina's secret plan");

  // A slow list for the old account, answered only after the switch.
  let release!: () => void;
  hold = { path: "/api/me/chat/conversations", release: () => release(), done: new Promise<void>((r) => { release = r; }) };
  await click("View all chats");
  who = { id: OTHER, name: "Thrall#1" };
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await settle();
  await act(async () => release());
  await settle();
  expect(text()).not.toContain("Jaina's secret plan");
  expect(text()).toContain("Thrall's route");
  expect(text()).not.toContain("Jaina#1234");
});

test("signed in without a key, the model menu shows Everloot search and the way to set a model up; dictation sits in the composer", async () => {
  await render();
  const menu = field("Model") as HTMLSelectElement;
  expect(Array.from(menu.options).map((o) => o.textContent)).toEqual(["Everloot search", "Set up a model…"]);
  expect(container.querySelector('form[aria-label="Ask Everloot"]')?.textContent).toMatch(/Dictat|Speak|microphone/i);
});

test("export and clear live inside the workspace and clear only Chat's records", async () => {
  seedChat(ME, "Fury talents");
  await render();
  await click("View all chats");
  expect(button("Download my chat data")).toBeDefined();
  await click("Delete my chat workspace");
  expect(text()).toContain("Your login, builds and characters stay.");
  await click("Yes, delete everything in Chat");
  expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ url: "/api/me/chat/workspace", body: { expectedAccountId: ME } });
  expect(mine().conversations.size).toBe(0);
});

/** Holds the next request to `path` until the returned function is called. */
function holdNext(path: string) {
  let release!: () => void;
  hold = { path, release: () => release(), done: new Promise<void>((r) => { release = r; }) };
  return async () => { await act(async () => release()); await settle(); };
}

test("a finished answer is saved even when the player starts a new chat while an earlier save is still running", async () => {
  await render();
  const release = holdNext("/api/me/chat/conversations");
  await ask("Plan a level 40 Fury warrior");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "O", ctrlKey: true, shiftKey: true, bubbles: true })); });
  await settle();
  expect(container.querySelector('[role="log"]')).toBeNull();
  await release();
  const [saved] = mine().conversations.values();
  expect(saved.messages).toHaveLength(2);
  expect(saved.revision).toBe(2);
  expect(posts("/api/me/chat/conversations").map((b) => b.expectedRevision)).toEqual([0, 1]);
});

test("a chat whose save failed stays recoverable after leaving it, and Retry saves it from there", async () => {
  await render();
  failNext = { path: "/api/me/chat/conversations", status: 503, times: 2 };
  await ask("Plan a level 40 Fury warrior");
  expect(text()).toContain("Not saved.");
  await click("New chat");
  expect(text()).toContain("Not saved: Plan a level 40 Fury warrior");
  await click("Open unsaved chat Plan a level 40 Fury warrior");
  expect(text()).toContain("Plan a level 40 Fury warrior");
  expect(text()).toContain("Not saved.");
  await click("Retry");
  expect(text()).toContain("In your account · Saved");
  expect([...mine().conversations.values()][0].messages).toHaveLength(2);
  expect(text()).not.toContain("Not saved: Plan");
});

test("removing the open chat's project takes the chat's new revision, so the next turn saves without a conflict", async () => {
  const project = { id: crypto.randomUUID(), name: "Warrior leveling", description: null, revision: 1, updatedAt: now() };
  (accounts[ME] = store()).projects.set(project.id, project);
  const c = seedChat(ME, "Fury talents", { projectId: project.id });
  await render();
  await click("Fury talents");
  await click("Warrior leveling");
  await click("Remove project");
  await click("Yes, remove");
  expect(mine().conversations.get(c.id)).toMatchObject({ projectId: null, revision: 2 });
  await click("Back to chat");
  await ask("And at level 50?");
  expect(text()).not.toContain("changed on another device");
  expect(mine().conversations.get(c.id)).toMatchObject({ projectId: null });
  expect(mine().conversations.get(c.id)!.messages).toHaveLength(4);
  expect(text()).toContain("In your account · Saved");
});

test("pinning the open chat while its turn is still saving waits for that save instead of racing it", async () => {
  const c = seedChat(ME, "Fury talents");
  await render();
  await click("Fury talents");
  const release = holdNext("/api/me/chat/conversations");
  await ask("And at level 50?");
  await click("View all chats");
  await click("Pin Fury talents");
  await release();
  expect(text()).not.toContain("changed on another device");
  expect(mine().conversations.get(c.id)).toMatchObject({ pinned: true, revision: 4 });
  expect(mine().conversations.get(c.id)!.messages).toHaveLength(4);
  expect(posts("/api/me/chat/conversations").map((b) => b.expectedRevision)).toEqual([1, 2, 3]);
});

test("Load the newer version asks first, and a load the account switch overtook writes nothing for the next account", async () => {
  const c = seedChat(ME, "Fury talents");
  seedChat(OTHER, "Thrall's route");
  await render();
  await click("Fury talents");
  c.revision = 5;
  await ask("And at level 50?");
  await click("Load the newer version");
  expect(text()).toContain("not saved here will be gone");
  const release = holdNext(`/api/me/chat/conversations/${c.id}`);
  await click("Replace mine");
  who = { id: OTHER, name: "Thrall#1" };
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await settle();
  await release();
  expect(text()).toContain("Thrall's route");
  expect(text()).not.toContain("Not saved");
  expect(text()).not.toContain("no longer in your account");
  expect(text()).not.toContain("And at level 50?");
});

test("a newer-version read cannot clear a conflict after another question starts", async () => {
  const c = seedChat(ME, "Fury talents");
  await render(); await click("Fury talents");
  c.revision = 5;
  await ask("And at level 50?");
  await click("Load the newer version");
  const releaseRead = holdNext(`/api/me/chat/conversations/${c.id}`);
  await click("Replace mine");
  const releaseAnswer = holdNext("/api/tools/search_knowledge");
  await ask("Keep this new question");
  await releaseRead();
  expect(text()).toContain("changed on another device");
  await releaseAnswer();
  expect(c.revision).toBe(5);
  expect(c.messages).toHaveLength(2);
  expect(text()).toContain("Keep this new question");
});

test("a delayed sidebar chat read cannot change the chat being answered", async () => {
  const c = seedChat(ME, "Fury talents");
  const other = seedChat(ME, "Other plan", { pinned: true });
  await render(); await click("Fury talents");
  const releaseRead = holdNext(`/api/me/chat/conversations/${other.id}`);
  await click("Other plan");
  const releaseAnswer = holdNext("/api/tools/search_knowledge");
  await ask("Keep this new question");
  await releaseRead(); await releaseAnswer();
  expect(mine().conversations.get(c.id)).toMatchObject({ title: "Fury talents", pinned: false });
  expect(mine().conversations.get(c.id)!.messages).toHaveLength(4);
  expect(other.messages).toHaveLength(2);
});

test("a newer-version read that finishes after the answer cannot discard the new turns", async () => {
  const c = seedChat(ME, "Fury talents");
  await render(); await click("Fury talents");
  c.revision = 5;
  await ask("And at level 50?"); await click("Load the newer version");
  const releaseRead = holdNext(`/api/me/chat/conversations/${c.id}`);
  await click("Replace mine");
  const releaseAnswer = holdNext("/api/tools/search_knowledge");
  await ask("Keep this new question");
  await releaseAnswer(); await releaseRead();
  expect(text()).toContain("Keep this new question");
  expect(text()).toContain("changed on another device");
  expect(c.revision).toBe(5);
});

test("an attached note goes to the model with its own question only, never again in later turns' history", async () => {
  sessionStorage.setItem("everloot.chat.providers.v1", JSON.stringify([{ kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: "sk-or-v1-secretsecretsecretsecret1234" }]));
  const project = { id: crypto.randomUUID(), name: "Raid prep", description: null, revision: 1, updatedAt: now() };
  (accounts[ME] = store()).projects.set(project.id, project);
  mine().entries.set("n1", { id: "n1", projectId: project.id, kind: "note", title: "Consumables", buildId: null, href: null, text: "Bring 20 Major Healing Potions.", sources: [], revision: 1, updatedAt: now() });
  window.history.replaceState(null, "", `/chat?project=${project.id}`);
  await render();
  await click("Use in question");
  await ask("What should I bring?");
  await ask("And for the next boss?");
  const turns = calls.filter((c) => c.url === "/api/v1/chat/completions");
  expect(turns.length).toBeGreaterThanOrEqual(2);
  expect(turns.filter((t) => JSON.stringify(t.body).includes("Major Healing Potions"))).toHaveLength(1);
  expect(JSON.stringify(turns[0].body)).toContain("Major Healing Potions");
  expect(JSON.stringify(mine().conversations)).not.toContain("Major Healing Potions");
});

test("when the first sign-in check fails, Chat waits and writes nothing to the browser's shared list until it knows", async () => {
  meFails = 1;
  await render();
  expect(button("Send")).toBeUndefined();
  expect(text()).toContain("Could not check whether you are signed in.");
  expect(localStorage.getItem("everloot.chat.conversations.v1")).toBeNull();
  await click("Try again");
  await ask("Plan a level 40 Fury warrior");
  expect(localStorage.getItem("everloot.chat.conversations.v1")).toBeNull();
  expect([...mine().conversations.values()][0].messages).toHaveLength(2);
});

test("a chat at the 200-message limit says so before asking, instead of failing to save", async () => {
  const many = Array.from({ length: 200 }, (_, i) => msg(i % 2 ? "assistant" : "user", `Turn ${i}`));
  seedChat(ME, "Long one", { messages: many });
  await render();
  await click("Long one");
  await ask("One more?");
  expect(posts("/api/me/chat/conversations")).toEqual([]);
  expect(text()).toContain("This chat is full");
  expect(button("Start a new chat")).toBeDefined();
});

test("deleting a chat in View all asks first", async () => {
  const c = seedChat(ME, "Fury talents");
  await render();
  await click("View all chats");
  await click("Delete Fury talents");
  expect(mine().conversations.has(c.id)).toBe(true);
  await click("Yes, delete");
  expect(mine().conversations.has(c.id)).toBe(false);
});

/** Watches the download: the file's blob, its name, and the link let go. */
function watchDownload() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  const revoked: string[] = [];
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: (b: Blob) => { blobs.push(b); return "blob:everloot/1"; },
    revokeObjectURL: (u: string) => { revoked.push(u); },
  }));
  const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  return { blobs, names, revoked, restore: () => spy.mockRestore() };
}

test("Download my chat data reads every section for this account and hands over one dated JSON file", async () => {
  seedChat(ME, "Fury talents");
  await render();
  await click("View all chats");
  const d = watchDownload();
  await click("Download my chat data");
  d.restore();
  expect(calls.filter((c) => c.url.startsWith("/api/me/chat/export")).map((c) => c.url)).toEqual(expect.arrayContaining([
    "/api/me/chat/export?section=projects", "/api/me/chat/export?section=conversations", "/api/me/chat/export?section=entries",
  ]));
  expect(d.names).toEqual([expect.stringMatching(/^everloot-chat-\d{4}-\d{2}-\d{2}\.json$/)]);
  const data = JSON.parse(await d.blobs[0].text()) as { accountId: string; conversations: { title: string }[] };
  expect(data.accountId).toBe(ME);
  expect(data.conversations.map((c) => c.title)).toEqual(["Fury talents"]);
  expect(d.revoked).toEqual(["blob:everloot/1"]);
  expect(button("Download my chat data")).toBeDefined();
});

test("a failed export downloads nothing and says so", async () => {
  seedChat(ME, "Fury talents");
  exportFails = true;
  await render();
  await click("View all chats");
  const d = watchDownload();
  await click("Download my chat data");
  d.restore();
  expect(d.blobs).toEqual([]);
  expect(d.names).toEqual([]);
  expect(text()).toContain("Nothing was downloaded.");
  expect(button("Download my chat data")).toBeDefined();
});
