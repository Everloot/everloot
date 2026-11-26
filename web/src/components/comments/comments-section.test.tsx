// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/database/items/19019" }));

import CommentsSection from "./CommentsSection";
import type { CommentsView, PageComment } from "@/lib/comments-shared";

const ME = "11111111-2222-4333-8444-555555555555";
const base: PageComment = {
  id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e11", author: "thrall", body: "Drops from **Ragnaros**", status: "visible",
  createdAt: "2026-11-25T10:00:00.000Z", editedAt: null, mine: false, editable: false, reported: false,
};
const MINE: PageComment = { ...base, id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e12", author: "jaina", body: "My note", mine: true, editable: true };
const HIDDEN: PageComment = { ...base, id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e13", author: null, body: "", status: "hidden" };
const DELETED: PageComment = { ...base, id: "0b6f1c1e-3f43-4a4e-9a51-3d2a1f0c9e14", author: null, body: "", status: "deleted" };

let container: HTMLDivElement;
let root: Root;
let views: CommentsView[];
let sent: Array<{ url: string; method: string; body: Record<string, unknown> | null; owner: string | null }>;
let answers: Array<{ status: number; body: object }>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  sent = [];
  answers = [];
  views = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    sent.push({ url: String(url), method, body: init.body ? JSON.parse(String(init.body)) : null, owner: new Headers(init.headers).get("x-everloot-expected-owner") });
    if (method === "GET") return Response.json(views.length > 1 ? views.shift() : views[0]);
    const answer = answers.shift() ?? { status: 200, body: {} };
    return Response.json(answer.body, { status: answer.status });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(view: CommentsView) {
  views = [view];
  await act(async () => root.render(<CommentsSection type="item" id={19019} />));
  await act(async () => {});
}
const text = () => container.textContent ?? "";
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
async function click(el: Element) { await act(async () => (el as HTMLElement).click()); await act(async () => {}); }
async function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("loads the page's comments from /comments in the browser, not from the page's HTML", async () => {
  await render({ viewer: null, comments: [base, HIDDEN, DELETED] });
  expect(sent[0]).toMatchObject({ url: "/comments?type=item&id=19019", method: "GET" });
  expect(text()).toContain("@thrall");
  expect(container.querySelector("strong")?.textContent).toBe("Ragnaros");
  expect(text()).toContain("This comment was hidden by a moderator.");
  expect(text()).toContain("This comment was deleted by its author.");
});

test("signed out, it offers sign-in back to this page and no form or buttons", async () => {
  await render({ viewer: null, comments: [base] });
  const link = container.querySelector<HTMLAnchorElement>('a[href^="/sign-in"]')!;
  expect(link.getAttribute("href")).toBe("/sign-in?returnTo=%2Fdatabase%2Fitems%2F19019%23comments");
  expect(container.querySelector("textarea")).toBeNull();
  expect(button("Report")).toBeUndefined();
});

test("signed in without a handle, it sends the player to choose one", async () => {
  await render({ viewer: { id: ME, handle: null }, comments: [] });
  expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
  expect(container.querySelector("textarea")).toBeNull();
  expect(text()).toContain("No comments yet.");
});

test("posts as the page's account, then reloads the list", async () => {
  await render({ viewer: { id: ME, handle: "jaina" }, comments: [] });
  views = [{ viewer: { id: ME, handle: "jaina" }, comments: [MINE] }];
  answers = [{ status: 201, body: { commentId: MINE.id } }];
  await type(container.querySelector("textarea")!, "My note");
  await act(async () => container.querySelector("form")!.requestSubmit());
  await act(async () => {});
  expect(sent[1]).toEqual({ url: "/comments", method: "POST", owner: ME, body: { action: "post", type: "item", id: 19019, body: "My note" } });
  expect(sent[2].method).toBe("GET");
  expect(text()).toContain("My note");
  expect(container.querySelector("textarea")!.value).toBe("");
});

test("shows the server's refusal and keeps the words", async () => {
  await render({ viewer: { id: ME, handle: "jaina" }, comments: [] });
  answers = [{ status: 422, body: { error: "Links can go to everloot.app or a page on this site." } }];
  await type(container.querySelector("textarea")!, "see https://evil.example");
  await act(async () => container.querySelector("form")!.requestSubmit());
  await act(async () => {});
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Links can go to");
  expect(container.querySelector("textarea")!.value).toBe("see https://evil.example");
});

test("the author edits within the window and deletes after confirming; others only report", async () => {
  await render({ viewer: { id: ME, handle: "jaina" }, comments: [base, MINE] });
  const [theirs, mine] = [...container.querySelectorAll("li")];
  expect(theirs.textContent).toContain("Report");
  expect(theirs.textContent).not.toContain("Edit");
  expect(theirs.textContent).not.toContain("Delete");
  expect(mine.textContent).not.toContain("Report");

  await click([...mine.querySelectorAll("button")].find((b) => b.textContent === "Edit")!);
  const box = mine.querySelector("textarea")!;
  expect(box.value).toBe("My note");
  await type(box, "My better note");
  await click([...mine.querySelectorAll("button")].find((b) => b.textContent === "Save")!);
  expect(sent.find((s) => s.body?.action === "edit")).toMatchObject({ owner: ME, body: { action: "edit", commentId: MINE.id, body: "My better note" } });

  await click([...container.querySelectorAll("li")][1].querySelectorAll("button")[1]);
  expect(sent.some((s) => s.body?.action === "delete")).toBe(false);
  await click(button("Delete comment"));
  expect(sent.find((s) => s.body?.action === "delete")).toMatchObject({ owner: ME, body: { action: "delete", commentId: MINE.id } });
});

test("reporting sends a reason and an optional note", async () => {
  await render({ viewer: { id: ME, handle: "jaina" }, comments: [base] });
  await click(button("Report"));
  const reason = container.querySelector("select")!;
  await act(async () => { reason.value = "spoiler"; reason.dispatchEvent(new Event("change", { bubbles: true })); });
  await type(container.querySelector<HTMLInputElement>('input[name="note"]')!, "names the boss");
  await click(button("Send report"));
  expect(sent.find((s) => s.body?.action === "report")).toMatchObject({
    owner: ME, body: { action: "report", commentId: base.id, reason: "spoiler", note: "names the boss" },
  });
});

test("a comment the viewer reported says so instead of offering the button again", async () => {
  await render({ viewer: { id: ME, handle: "jaina" }, comments: [{ ...base, reported: true }] });
  expect(button("Report")).toBeUndefined();
  expect(text()).toContain("Reported");
});
