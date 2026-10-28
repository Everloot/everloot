// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SavedBuild } from "@/lib/saved-builds";
import ProjectView from "./ProjectView";

const ACCOUNT = "11111111-2222-4333-8444-555555555555";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const BUILD: SavedBuild = { id: "33333333-3333-4333-8333-333333333333", slug: "AbCdEf12", name: "Private Arms", notes: null, classSlug: "warrior", characterId: null, code: "EL1-warrior-0-1.60.1.70450-MTE6NQ", code2: null, gameBuild: "1.60.1.70450", shared: false, active: false, link: null, updatedAt: "2026-10-25T00:00:00Z", showName: false };
vi.mock("./PrivateBuildForm", () => ({ default: ({ onSaved }: { onSaved: (b: SavedBuild) => void }) => <button onClick={() => onSaved(BUILD)}>Save fixture build</button> }));
let host: HTMLDivElement;
let root: Root;
let calls: { url: string; body: Record<string, unknown> | null }[];
const controller = new AbortController();
const opts = () => ({ accountId: ACCOUNT, signal: controller.signal });
const failed = (e: unknown) => e instanceof Error ? e.message : "unavailable";
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ url, body });
    if (url === "/api/me/chat/builds") return Response.json({ accountId: ACCOUNT, characters: [], builds: [BUILD] });
    if (url.startsWith("/api/me/chat/conversations?")) return Response.json({ accountId: ACCOUNT, conversations: [], nextCursor: null });
    if (url.startsWith("/api/me/chat/entries?")) return Response.json({ accountId: ACCOUNT, entries: [], nextCursor: null });
    if (url === "/api/me/chat/entries" && body) return Response.json({ accountId: ACCOUNT, entry: { ...(body.entry as object), revision: 1, updatedAt: BUILD.updatedAt } });
    throw new Error(`Unexpected request ${url}`);
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(projectId = PROJECT) {
  await act(async () => root.render(<ProjectView project={{ id: projectId, name: "Leveling", description: null, revision: 1, updatedAt: BUILD.updatedAt }} opts={opts} failed={failed} savedBuilds={false} busy={false} onBack={() => {}} onNewChat={() => {}} onOpenChat={() => {}} onProject={() => {}} onRemoved={() => {}} onAttach={() => {}} />));
  await settle();
}

test("private builds can be picked while the global build feature is off", async () => {
  await render();
  expect(calls.some((c) => c.url === "/api/me/chat/builds")).toBe(true);
  expect(calls.some((c) => c.url === "/api/me/builds")).toBe(false);
  expect(host.querySelector('select[aria-label="Add a build"]')?.textContent).toContain(BUILD.name);
});

test("a newly saved private build is attached by reference and opens in the calculator", async () => {
  await render();
  expect(button("New private build")).toBeTruthy();
  await act(async () => button("New private build").click());
  await act(async () => button("Save fixture build").click()); await settle();
  const write = calls.find((c) => c.url === "/api/me/chat/entries" && c.body);
  expect(write?.body).toMatchObject({ expectedAccountId: ACCOUNT, entry: { kind: "build", buildId: BUILD.id, projectId: PROJECT } });
  const link = host.querySelector<HTMLAnchorElement>('a[href^="/tools/talents/warrior"]');
  expect(link?.getAttribute("href")).toContain(`#plan=${BUILD.code}`);
  expect(host.querySelector('a[href^="/b/"]')).toBeNull();
});


test("project chats keep their cursor and load beyond the first 50 without losing earlier chats", async () => {
  const chats = Array.from({ length: 50 }, (_, i) => ({ id: `chat-${i}`, title: `Plan ${i}`, projectId: PROJECT, pinned: false, revision: 1, updatedAt: BUILD.updatedAt }));
  const original = globalThis.fetch;
  let pages = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/me/chat/conversations?")) {
      expect(new URL(url, "https://everloot.app").searchParams.get("projectId")).toBe(PROJECT);
      pages++;
      if (pages === 1) return Response.json({ accountId: ACCOUNT, conversations: chats, nextCursor: "older-page" });
      expect(new URL(url, "https://everloot.app").searchParams.get("cursor")).toBe("older-page");
      return Response.json({ accountId: ACCOUNT, conversations: [{ ...chats[0], id: "older", title: "Plan 51" }], nextCursor: null });
    }
    return original(input, init);
  }));
  await render();
  expect(button("Plan 0")).toBeTruthy();
  expect(button("Plan 49")).toBeTruthy();
  expect(button("Load more chats")).toBeTruthy();
  await act(async () => button("Load more chats").click()); await settle();
  expect(button("Plan 0")).toBeTruthy();
  expect(button("Plan 51")).toBeTruthy();
  expect(button("Load more chats")).toBeUndefined();
});

test("a failed chat page keeps its cursor and earlier chats for a successful retry", async () => {
  const original = globalThis.fetch;
  let pages = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("/api/me/chat/conversations?")) {
      pages++;
      if (pages === 2) return new Response("", { status: 503 });
      return Response.json({ accountId: ACCOUNT, conversations: [{ id: `chat-${pages}`, title: `Plan ${pages}`, projectId: PROJECT, pinned: false, revision: 1, updatedAt: BUILD.updatedAt }], nextCursor: pages === 1 ? "next" : null });
    }
    return original(input, init);
  }));
  await render();
  expect(button("Load more chats")).toBeTruthy();
  await act(async () => button("Load more chats").click()); await settle();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(button("Plan 1")).toBeTruthy();
  await act(async () => button("Load more chats").click()); await settle();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(button("Plan 3")).toBeTruthy();
});


test("a project switch cancels a pending page and late results cannot enter the next project", async () => {
  const original = globalThis.fetch;
  let release!: (r: Response) => void;
  let pendingSignal: AbortSignal | null | undefined;
  let pageReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://everloot.app");
    if (url.pathname === "/api/me/chat/conversations") {
      if (url.searchParams.has("cursor")) {
        pageReads++; pendingSignal = init?.signal;
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return Response.json({ accountId: ACCOUNT, conversations: [], nextCursor: url.searchParams.get("projectId") === PROJECT ? "next" : null });
    }
    return original(input, init);
  }));
  await render();
  await act(async () => { const b = button("Load more chats"); b.click(); b.click(); });
  expect(pageReads).toBe(1);
  expect(button("Loading chats...")?.disabled).toBe(true);
  await render("another-project");
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => release(Response.json({ accountId: ACCOUNT, conversations: [{ id: "stale", title: "Wrong project", projectId: PROJECT }], nextCursor: "stale" })));
  await settle();
  expect(button("Wrong project")).toBeUndefined();
  expect(button("Load more chats")).toBeUndefined();
});


test("saved-entry pages ignore duplicate clicks and discard a late reply after a project switch", async () => {
  const original = globalThis.fetch;
  let release!: (r: Response) => void;
  let pendingSignal: AbortSignal | null | undefined;
  let pageReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://everloot.app");
    if (url.pathname === "/api/me/chat/entries") {
      if (url.searchParams.has("cursor")) {
        pageReads++; pendingSignal = init?.signal;
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      return Response.json({ accountId: ACCOUNT, entries: [], nextCursor: url.searchParams.get("projectId") === PROJECT ? "next" : null });
    }
    return original(input, init);
  }));
  await render();
  await act(async () => { const b = button("Load more saved items"); b.click(); b.click(); });
  expect(pageReads).toBe(1);
  await render("another-project");
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => release(Response.json({ accountId: ACCOUNT, entries: [{ id: "stale", kind: "note", title: "Wrong project note", text: "stale", sources: [] }], nextCursor: "stale" })));
  await settle();
  expect(host.textContent).not.toContain("Wrong project note");
  expect(button("Load more saved items")).toBeUndefined();
});
