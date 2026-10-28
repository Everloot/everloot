// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ChatClient from "./ChatClient";
import ChatKeys from "./ChatKeys";

let root: Root | null = null;
let reads: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  reads = vi.spyOn(Storage.prototype, "getItem");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The document was loaded at `loadedAt` (its CSP came with that page); the app has since moved to `now`. */
function navigated(loadedAt: string, now: string) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((type) => (type === "navigation" ? [{ name: `http://localhost:3000${loadedAt}` } as PerformanceEntry] : []));
  window.history.replaceState(null, "", now);
}

async function mount(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(node));
}

test("chat reads no stored keys in a document that came with a public page's policy", async () => {
  navigated("/", "/chat");
  await mount(<ChatClient />);
  expect(reads).not.toHaveBeenCalled();
});

test("the key settings read no stored keys in a document that came with a public page's policy", async () => {
  navigated("/database/items", "/account");
  await mount(<ChatKeys />);
  expect(reads).not.toHaveBeenCalled();
});

test("in a document loaded at a protected page, both read the stored keys as before", async () => {
  navigated("/chat", "/chat");
  await mount(<ChatClient />);
  expect(reads).toHaveBeenCalled();
  act(() => root?.unmount());
  reads.mockClear();
  navigated("/account", "/account");
  await mount(<ChatKeys />);
  expect(reads).toHaveBeenCalled();
});
