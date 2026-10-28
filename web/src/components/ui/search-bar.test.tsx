// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, onNavigate: _onNavigate, ...props }: { children: React.ReactNode; onNavigate?: () => void; href: string }) => <a {...props}>{children}</a>,
}));

import SearchBar from "./SearchBar";

// Each test types its own text: the suggestion cache outlives a render.
// The suggestions arrive 120 ms after the last key. Until they do, the list still shows the rows for what was
// typed before, so a highlight picked on those rows must not outlive the text it was picked for.

let container: HTMLDivElement;
let root: Root;
let answers: Map<string, (rows: unknown[]) => void>;

const suggestion = (id: number, label: string) => ({ type: "item", id, label, href: `/database/items/${id}` });

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  answers = new Map();
  // Every request waits until the test answers it, so a slow reply can be staged.
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise((resolve) => {
    const q = new URL(url, "http://localhost").searchParams.get("q") ?? "";
    answers.set(q, (results) => resolve({ ok: true, json: async () => ({ results }) }));
  })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<SearchBar action="/search" label="Search Everloot" id="bar" />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const field = () => container.querySelector<HTMLInputElement>("#bar")!;

async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
}

async function answer(q: string, rows: unknown[]) {
  await act(async () => { answers.get(q)!(rows); });
}

async function press(key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => { field().dispatchEvent(event); });
  return event;
}

/** Counts clicks on the suggestion rows without letting jsdom try to navigate. */
function watchClicks() {
  const clicks: string[] = [];
  for (const a of container.querySelectorAll("a")) a.addEventListener("click", (e) => { e.preventDefault(); clicks.push(a.getAttribute("href")!); });
  return clicks;
}

test("Enter on a row picked with the arrow keys opens it", async () => {
  await type("mag");
  await answer("mag", [suggestion(1, "Magic Dust")]);
  await press("ArrowDown");
  const clicks = watchClicks();
  expect((await press("Enter")).defaultPrevented).toBe(true);
  expect(clicks).toEqual(["/database/items/1"]);
});

test("typing after picking a row drops the pick: Enter before the new suggestions arrive submits what is typed, not the old row", async () => {
  await type("lin");
  await answer("lin", [suggestion(2, "Linen Cloth")]);
  await press("ArrowDown");
  expect(container.querySelector("[role=option]")!.getAttribute("aria-selected")).toBe("true");

  await type("linen");
  // The request for "linen" is still out; the list still shows the "lin" row, but nothing is picked in it.
  expect(container.querySelector("[role=option]")!.getAttribute("aria-selected")).toBe("false");
  expect(field().hasAttribute("aria-activedescendant")).toBe(false);
  const clicks = watchClicks();
  const enter = await press("Enter");
  expect(clicks).toEqual([]);
  // Not prevented: the form submits the typed text to /search.
  expect(enter.defaultPrevented).toBe(false);
});

test("the new suggestions start with nothing picked, and the arrow keys pick from them", async () => {
  await type("hea");
  await answer("hea", [suggestion(2, "Heavy Hide")]);
  await press("ArrowDown");
  await type("heal");
  await answer("heal", [suggestion(3, "Healing Potion"), suggestion(2, "Heavy Hide")]);
  const rows = () => [...container.querySelectorAll("[role=option]")].map((r) => r.getAttribute("aria-selected"));
  expect(rows()).toEqual(["false", "false"]);
  await press("ArrowDown");
  expect(rows()).toEqual(["true", "false"]);
});
