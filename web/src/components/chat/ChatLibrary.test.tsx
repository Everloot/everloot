// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ChatLibrary from "./ChatLibrary";
import type { WorkspaceConversationSummary } from "@/lib/chat/workspace-types";

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/chat/workspace-api", async (original) => ({ ...await original<object>(), listConversations: list }));
let host: HTMLDivElement;
let root: Root;
const scope = { accountId: "11111111-2222-4333-8444-555555555555", signal: new AbortController().signal };
const opts = () => scope;
const failed = () => "Connection failed. Try again.";
const row = (title: string): WorkspaceConversationSummary => ({ id: title, title, projectId: null, pinned: false, revision: 1, updatedAt: "2026-10-25T00:00:00.000Z" });
const page = (title: string, nextCursor: string | null = null) => ({ items: [row(title)], nextCursor });
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const props = { projects: [], local: [], opts, failed, busy: false, onBack: vi.fn(), onOpen: vi.fn(), onOpenLocal: vi.fn(), onPatch: vi.fn(), onDeleted: vi.fn(), onCleared: vi.fn() };
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
async function search(value: string) {
  const input = host.querySelector('input[type="search"]') ?? host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); list.mockReset(); props.onPatch.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

test("a slow earlier search cannot replace the current results", async () => {
  const old = pending<ReturnType<typeof page>>();
  list.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page("Current result"));
  await act(async () => root.render(<ChatLibrary {...props} />));
  await search("current");
  expect(host.textContent).toContain("Current result");
  await act(async () => old.resolve(page("Old result")));
  expect(host.textContent).toContain("Current result");
  expect(host.textContent).not.toContain("Old result");
});

test("a pending older page cannot append to a new search", async () => {
  const old = pending<ReturnType<typeof page>>();
  list.mockResolvedValueOnce(page("First result", "next")).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page("New search"));
  await act(async () => root.render(<ChatLibrary {...props} />));
  await click("Load more");
  await search("new");
  await act(async () => old.resolve(page("Wrong page")));
  expect(host.textContent).toContain("New search");
  expect(host.textContent).not.toContain("Wrong page");
});

test("a failed rename keeps the editable title for retry", async () => {
  list.mockResolvedValue(page("My plan"));
  props.onPatch.mockRejectedValue(new Error("down"));
  await act(async () => root.render(<ChatLibrary {...props} />));
  await click("Rename");
  await act(async () => host.querySelector('input[aria-label="New title"]')!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.querySelector('input[aria-label="New title"]')).not.toBeNull();
  expect(host.textContent).toContain("Connection failed");
});

test("a successful next-page retry clears its earlier error", async () => {
  list.mockResolvedValueOnce(page("First result", "next")).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(page("Next result"));
  await act(async () => root.render(<ChatLibrary {...props} />));
  await click("Load more");
  expect(host.textContent).toContain("Connection failed");
  await click("Load more");
  expect(host.textContent).toContain("Next result");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});


test("a delayed rename cannot close the editor opened for another chat", async () => {
  const saving = pending<WorkspaceConversationSummary>();
  list.mockResolvedValue({ items: [row("Plan A"), row("Plan B")], nextCursor: null });
  props.onPatch.mockReturnValue(saving.promise);
  await act(async () => root.render(<ChatLibrary {...props} />));
  const rowButton = (title: string) => [...host.querySelectorAll("li")].find((li) => li.textContent?.includes(title))!.querySelectorAll("button");
  await act(async () => [...rowButton("Plan A")].find((b) => b.textContent === "Rename")!.click());
  await act(async () => host.querySelector('input[aria-label="New title"]')!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => [...rowButton("Plan B")].find((b) => b.textContent === "Rename")!.click());
  const input = host.querySelector<HTMLInputElement>('input[aria-label="New title"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Keep B draft");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => saving.resolve({ ...row("Plan A"), title: "Saved A" }));
  expect(host.querySelector<HTMLInputElement>('input[aria-label="New title"]')?.value).toBe("Keep B draft");
  expect(host.textContent).toContain("Saved A");
});

test("two immediate library page clicks request the cursor only once", async () => {
  const next = pending<ReturnType<typeof page>>();
  list.mockResolvedValueOnce(page("First", "next")).mockReturnValue(next.promise);
  await act(async () => root.render(<ChatLibrary {...props} />));
  await act(async () => { const b = button("Load more"); b.click(); b.click(); });
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => next.resolve(page("Second")));
  expect(host.textContent?.match(/Second/g)).toHaveLength(1);
});
