// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, onNavigate: _onNavigate, prefetch: _prefetch, ...props }: { children: React.ReactNode; onNavigate?: () => void; prefetch?: boolean; href: string }) => <a {...props}>{children}</a>,
}));

import PeopleResults from "./PeopleResults";

let container: HTMLDivElement;
let root: Root;
let reply: { ok: boolean; body: unknown; never?: boolean };
let asked: { url: string; cache?: RequestCache }[];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  reply = { ok: true, body: {} };
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    asked.push({ url, cache: init?.cache });
    if (reply.never) return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    return Promise.resolve({ ok: reply.ok, json: async () => reply.body });
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const show = async (q: string) => { await act(async () => root.render(<PeopleResults q={q} empty={<p>Nothing matches that.</p>} />)); };
const character = (name: string) => ({ type: "character", label: name, href: `/players/forever/pioneer/${name.toLowerCase()}`, meta: "Level 24 Shaman · Pioneer", exact: false });

test("the groups are asked for uncached and list each row with its link and meta line", async () => {
  reply.body = {
    characters: { results: [character("Thrallina")], total: 1 },
    guilds: { results: [{ type: "guild", label: "Thrall Fans", href: "/guilds/pioneer/thrall-fans", meta: "Pioneer · 4 members seen", exact: false }], total: 1 },
  };
  await show("thrall");
  expect(asked).toEqual([{ url: "/search/people?q=thrall", cache: "no-store" }]);
  expect(container.querySelector("#results-character")!.textContent).toContain("Characters (1)");
  expect(container.querySelector('#results-character a[href="/players/forever/pioneer/thrallina"]')!.textContent).toBe("Thrallina");
  expect(container.querySelector("#results-character")!.textContent).toContain("Level 24 Shaman · Pioneer");
  expect(container.querySelector('#results-guild a[href="/guilds/pioneer/thrall-fans"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Nothing matches that.");
});

test("more than the group lists links to the full search on its own page, and a lookup that stopped at 25 says 25+", async () => {
  reply.body = { characters: { results: Array.from({ length: 8 }, (_, i) => character(`Thrall${"abcdefgh"[i]}`)), total: 25, capped: true }, guilds: { results: [], total: 0, capped: false } };
  await show("thrall");
  expect(container.querySelector("#results-character")!.textContent).toContain("Characters (25+)");
  expect(container.querySelector('a[href="/players?q=thrall"]')!.textContent).toBe("More on Find a player");
  expect(container.querySelector("#results-guild")).toBeNull();
});

test("no rows, or a failed request, leaves the fallback", async () => {
  await show("zzz");
  expect(container.textContent).toBe("Nothing matches that.");
  reply = { ok: false, body: null };
  await show("zzzz");
  expect(container.textContent).toBe("Nothing matches that.");
});

test("the slot stays empty until the answer settles, and a slow answer counts as none after 3 seconds", async () => {
  vi.useFakeTimers();
  try {
    reply.never = true;
    await show("slow");
    // Never "Nothing matches" first and then replaced.
    expect(container.textContent).toBe("");
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(container.textContent).toBe("");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(container.textContent).toBe("Nothing matches that.");
  } finally {
    vi.useRealTimers();
  }
});
