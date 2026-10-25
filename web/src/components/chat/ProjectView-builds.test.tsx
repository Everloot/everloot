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
async function render() {
  await act(async () => root.render(<ProjectView project={{ id: PROJECT, name: "Leveling", description: null, revision: 1, updatedAt: BUILD.updatedAt }} opts={opts} failed={failed} savedBuilds={false} busy={false} onBack={() => {}} onNewChat={() => {}} onOpenChat={() => {}} onProject={() => {}} onRemoved={() => {}} onAttach={() => {}} />));
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
