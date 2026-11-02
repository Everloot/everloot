// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LinkedCharacters, { FROZEN_TEXT, LABEL_TEXT, PAGE_TEXT, type ListedLink } from "./LinkedCharacters";

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

test("without the showcase there is no page switch; with it a linked character's page goes public and private, and a frozen one has none", async () => {
  api([{ links: [LINK] }]);
  await show();
  expect(container.textContent).not.toContain("Public page");
  await act(async () => root.unmount());
  root = createRoot(container);

  const PATH = "/characters/forever/forever-pioneer/thrallina";
  const lists = [
    { links: [{ ...LINK, page: { public: false, path: PATH } }, { ...FROZEN, page: { public: false, path: "/characters/forever/forever-pioneer/jainara" } }] },
    { links: [{ ...LINK, page: { public: true, path: PATH } }] },
  ];
  const sent: Array<{ url: string; body: unknown }> = [];
  let read = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ id: LINK.id, page_public: true });
    }
    return Response.json(lists[Math.min(read++, lists.length - 1)]);
  });
  await show();
  expect(container.textContent).toContain("Public page: off");
  expect(container.textContent).toContain(PAGE_TEXT);
  expect(container.textContent!.match(/Public page:/g)).toHaveLength(1);
  expect(container.querySelector(`a[href="${PATH}"]`)).toBeNull();
  await click("Make it public");
  expect(sent).toEqual([{ url: `/api/me/characters/links/${LINK.id}/visibility`, body: { page_public: true } }]);
  expect(container.textContent).toContain("Public page: on");
  expect(container.querySelector(`a[href="${PATH}"]`)?.textContent).toBe("View the page");
  expect(container.querySelector(`a[href="${PATH}/card-square.png"]`)?.textContent).toBe("Download card");
  // Never a search switch: indexing is not offered yet.
  expect(Array.from(container.querySelectorAll("button, input"), (b) => b.textContent ?? "").join(" ")).not.toMatch(/index|search/i);
  expect(container.textContent!.toLowerCase()).not.toContain("verified");
});

test("planned builds: no picker and no label read unless the list offers it; then only the character's class, never preselected", async () => {
  const PATH = "/characters/forever/forever-pioneer/thrallina";
  const LABELS = [
    { id: "7d1e2f3a-4b5c-4d6e-8f70-8192a3b4c5d6", name: "Raid plans", classSlug: "shaman" },
    // Same name as the character: still not picked for the player.
    { id: "8e2f3a4b-5c6d-4e7f-8a91-92a3b4c5d6e7", name: "Thrallina", classSlug: "shaman" },
    { id: "9f3a4b5c-6d7e-4f80-9ba2-a3b4c5d6e7f8", name: "Frosty", classSlug: "mage" },
  ];
  const urls: string[] = [];
  const sent: Array<{ url: string; body: unknown }> = [];
  let lists: object[] = [{ links: [{ ...LINK, page: { public: true, path: PATH } }] }];
  let read = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (init?.method === "POST") {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ id: LINK.id, label: LABELS[0].id });
    }
    if (url === "/api/me/builds") return Response.json({ characters: LABELS, builds: [] });
    return Response.json(lists[Math.min(read++, lists.length - 1)]);
  });

  // The switch off: the list has no label field, so no picker, and the labels are never read.
  await show();
  expect(container.querySelector("select")).toBeNull();
  expect(container.textContent).not.toContain(LABEL_TEXT);
  expect(urls).not.toContain("/api/me/builds");
  await act(async () => root.unmount());
  root = createRoot(container);

  // On: a picker with None selected and the shaman labels only.
  lists = [
    { links: [{ ...LINK, page: { public: true, path: PATH, label: null } }, { ...FROZEN, page: { public: false, path: "/x", label: null } }] },
    { links: [{ ...LINK, page: { public: true, path: PATH, label: { id: LABELS[0].id, name: "Raid plans" } } }] },
  ];
  read = 0;
  await show();
  expect(container.textContent).toContain(LABEL_TEXT);
  // A frozen link gets no picker.
  expect(container.querySelectorAll("select")).toHaveLength(1);
  const select = container.querySelector("select")!;
  expect(select.value).toBe("");
  expect(Array.from(select.options, (o) => o.textContent)).toEqual(["None", "Raid plans", "Thrallina"]);
  expect(sent).toEqual([]);

  await act(async () => {
    select.value = LABELS[0].id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(sent).toEqual([{ url: `/api/me/characters/links/${LINK.id}/label`, body: { label: LABELS[0].id } }]);
  expect(container.querySelector("select")!.value).toBe(LABELS[0].id);
});
