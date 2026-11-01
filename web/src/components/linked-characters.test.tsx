// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LinkedCharacters, { FROZEN_TEXT, type ListedLink } from "./LinkedCharacters";

let container: HTMLDivElement;
let root: Root;
const LINK: ListedLink = {
  id: "2b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e22", name: "Thrallina", realm: "Forever Pioneer", race: "Scourge", class: "SHAMAN", faction: "Horde",
  level: 24, status: "linked", linked_at: "2026-10-21T18:00:00+00:00", last_upload_at: "2026-10-30T18:00:00+00:00",
};
const FROZEN: ListedLink = { ...LINK, id: "9c0d7e3a-1b2c-4d5e-8f90-a1b2c3d4e5f6", name: "Jainara", race: "NightElf", class: "PRIEST", status: "frozen" };
type Call = { url: string; method: string };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** The link endpoints, mocked: GET answers `lists` in turn (the last one again), POST makes a code, DELETE answers `unlinked`. */
function api(lists: object[], { unlinked = 200, code = 201 }: { unlinked?: number; code?: number } = {}) {
  const calls: Call[] = [];
  let read = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (method === "POST") {
      return code === 201
        ? Response.json({ code: "EL-7K3Q-9P", expiresAt: "2026-11-01T18:15:00.000Z" }, { status: 201 })
        : Response.json({ error: "You made 10 codes in the last day. Try again tomorrow." }, { status: code });
    }
    if (method === "DELETE") return Response.json(unlinked === 200 ? { unlinked: LINK.id } : { error: "No linked character with that id on this account." }, { status: unlinked });
    return Response.json(lists[Math.min(read++, lists.length - 1)]);
  });
  return calls;
}
const buttonNamed = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;
const click = async (label: string) => act(async () => buttonNamed(label).click());
const show = async () => act(async () => root.render(<LinkedCharacters />));

test("it lists the account's links with their status, and a frozen one says why without naming anyone", async () => {
  api([{ links: [LINK, FROZEN] }]);
  await show();
  const text = container.textContent!;
  expect(text).toContain("Thrallina · Level 24 Undead Shaman · Forever Pioneer");
  expect(text).toContain("Jainara · Level 24 Night Elf Priest");
  expect(text).toContain("Linked 2026-10-21, last sent 2026-10-30.");
  expect(text).toContain(FROZEN_TEXT);
  expect(text.match(/Frozen:/g)).toHaveLength(1);
  expect(text.toLowerCase()).not.toContain("verified");
  expect(text).toContain("not checked with Blizzard");
});

test("with the switch off it renders nothing; signed out it offers sign-in; a failure says so", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ error: "Not found" }, { status: 404 }));
  await show();
  expect(container.innerHTML).toBe("");
  vi.stubGlobal("fetch", async () => Response.json({ error: "Sign in" }, { status: 401 }));
  await act(async () => root.render(<LinkedCharacters key="2" />));
  expect(container.querySelector('a[href="/sign-in"]')).not.toBeNull();
  vi.stubGlobal("fetch", async () => Response.json({ error: "Character links are unavailable right now. Try again in a minute." }, { status: 503 }));
  await act(async () => root.render(<LinkedCharacters key="3" />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("unavailable right now");
});

test("Make a link code shows the command to type, once, with how long it works", async () => {
  const calls = api([{ links: [] }]);
  await show();
  expect(container.textContent).toContain("No linked characters yet.");
  await click("Make a link code");
  expect(calls.at(-1)).toEqual({ url: "/api/me/characters/link-codes", method: "POST" });
  expect(container.textContent).toContain("/everloot link EL-7K3Q-9P");
  expect(container.textContent).toContain("15 minutes (until 18:15 UTC)");
  expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Copy the command"))).toBe(true);
});

test("a refused code says why", async () => {
  api([{ links: [] }], { code: 429 });
  await show();
  await click("Make a link code");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("10 codes");
});

test("Unlink asks first, then unlinks that link and reads the list again", async () => {
  const calls = api([{ links: [LINK] }, { links: [] }]);
  await show();
  await click(`Unlink ${LINK.name}`);
  expect(container.textContent).toContain("Unlink Thrallina? Your saved builds stay.");
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await click("Keep it");
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await click(`Unlink ${LINK.name}`);
  await click("Unlink");
  expect(calls.filter((c) => c.method === "DELETE")).toEqual([{ url: `/api/me/characters/links/${LINK.id}`, method: "DELETE" }]);
  expect(container.textContent).toContain("No linked characters yet.");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Unlinked Thrallina.");
});

test("a link already gone (unlinked in another tab) reads the list again instead of failing", async () => {
  api([{ links: [LINK] }, { links: [] }], { unlinked: 404 });
  await show();
  await click(`Unlink ${LINK.name}`);
  await click("Unlink");
  expect(container.textContent).toContain("No linked characters yet.");
});
