// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import RealmMemory, { REALM_MEMORY_KEY, rememberedChoice, rememberedHref } from "./RealmMemory";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  localStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const saved = (value: unknown) => JSON.stringify(value);
const houses = ["alliance", "horde", "neutral"];

test("a remembered realm is used only when the page lists it, and its house only where the page offers it", () => {
  expect(rememberedChoice(saved({ realm: "forever", name: "Forever", house: "horde" }), ["forever"], houses)).toEqual({ realm: "forever", name: "Forever", house: "horde" });
  expect(rememberedChoice(saved({ realm: "forever", name: "Forever", house: "neutral" }), ["forever"], ["alliance", "horde"])).toEqual({ realm: "forever", name: "Forever", house: null });
  expect(rememberedChoice(saved({ realm: "gone", name: "Gone", house: "horde" }), ["forever"], houses)).toBeNull();
  for (const raw of [null, "", "{", saved(null), saved({ realm: 1, name: "x" }), saved({ realm: "forever" })]) expect(rememberedChoice(raw, ["forever"], houses), String(raw)).toBeNull();
});

test("the redirect keeps the page's parameters and anchor, and never replaces a house the link names", () => {
  const choice = { realm: "forever", name: "Forever", house: "horde" };
  expect(rememberedHref("https://everloot.app/tools/professions/alchemy?sort=-net#ahledger-margins", choice))
    .toBe("https://everloot.app/tools/professions/alchemy?sort=-net&realm=forever&house=horde#ahledger-margins");
  expect(rememberedHref("https://everloot.app/tools/bags?house=alliance", choice)).toBe("https://everloot.app/tools/bags?house=alliance&realm=forever");
  expect(rememberedHref("https://everloot.app/tools/bags", { ...choice, house: null })).toBe("https://everloot.app/tools/bags?realm=forever");
});

test("a page with a listed realm remembers it under the documented key; an unlisted one is not remembered", async () => {
  await act(async () => root.render(<RealmMemory realm="forever" name="Forever" house="horde" known={["forever"]} houses={houses} mode="redirect" />));
  expect(JSON.parse(localStorage.getItem(REALM_MEMORY_KEY)!)).toEqual({ realm: "forever", name: "Forever", house: "horde" });
  await act(async () => root.render(<RealmMemory realm="nowhere" name={null} house={null} known={["forever"]} houses={houses} mode="redirect" />));
  expect(JSON.parse(localStorage.getItem(REALM_MEMORY_KEY)!).realm).toBe("forever");
  expect(container.innerHTML).toBe("");
});

test("the all-realms list offers a link to the remembered realm; a page with its own realm or a save-only page offers nothing", async () => {
  localStorage.setItem(REALM_MEMORY_KEY, saved({ realm: "forever", name: "Forever", house: "horde" }));
  await act(async () => root.render(<RealmMemory realm={null} name={null} house={null} known={["forever"]} houses={houses} mode="link" linkBase="/tools/auctions" />));
  expect(container.querySelector("[data-realm-memory] a")?.getAttribute("href")).toBe("/tools/auctions/forever?house=horde");
  expect(container.textContent).toBe("Your last realm: Forever");
  await act(async () => root.render(<RealmMemory realm={null} name={null} house={null} known={["forever"]} houses={houses} mode="save" />));
  expect(container.innerHTML).toBe("");
});

test("storage the browser refuses leaves the page as it is", async () => {
  const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); });
  try {
    await act(async () => root.render(<RealmMemory realm={null} name={null} house={null} known={["forever"]} houses={houses} mode="link" linkBase="/tools/auctions" />));
    expect(container.innerHTML).toBe("");
  } finally { blocked.mockRestore(); }
});
