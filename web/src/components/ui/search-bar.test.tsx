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
let people: { status: number; body: unknown };
let peopleAsked: { q: string; cache?: RequestCache }[];

const suggestion = (id: number, label: string) => ({ type: "item", id, label, href: `/database/items/${id}` });

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  answers = new Map();
  people = { status: 200, body: {} };
  peopleAsked = [];
  // Every database request waits until the test answers it, so a slow reply can be staged. Characters and guilds
  // (/search/people) answer at once with what the test set.
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const u = new URL(url, "http://localhost");
    const q = u.searchParams.get("q") ?? "";
    if (u.pathname === "/search/people") {
      peopleAsked.push({ q, cache: init?.cache });
      return Promise.resolve({ ok: people.status === 200, json: async () => people.body });
    }
    return new Promise((resolve) => { answers.set(q, (results) => resolve({ ok: true, json: async () => ({ results }) })); });
  }));
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

test("a dungeon row says which it is and its level, and is picked like any other row", async () => {
  await type("deadm");
  await answer("deadm", [{ type: "instance", id: 36, label: "Deadmines", href: "/database/instances/36-deadmines", note: "Dungeon, level 16" }, suggestion(4, "Deadmines Map")]);
  const options = [...container.querySelectorAll("[role=option]")];
  expect(options.map((o) => o.textContent)).toEqual(["DeadminesDungeon, level 16", "Deadmines MapItem 4"]);
  await press("ArrowDown");
  const clicks = watchClicks();
  await press("Enter");
  expect(clicks).toEqual(["/database/instances/36-deadmines"]);
});

const person = (type: "character" | "guild", label: string, meta: string, exact = false) =>
  ({ type, label, href: type === "character" ? `/players/forever/pioneer/${label.toLowerCase()}` : `/guilds/pioneer/${label.toLowerCase()}`, meta, exact });
const texts = () => [...container.querySelectorAll("[role=option]")].map((o) => o.textContent);

test("characters and guilds come after the database pages, at most 3, and the 8 rows still hold", async () => {
  people.body = {
    characters: { results: [person("character", "Thrallina", "Level 24 Shaman · Pioneer"), person("character", "Thrall", "Level 60 Shaman · Pioneer", true)], total: 2 },
    guilds: { results: [person("guild", "Thrall Fans", "Pioneer · 4 members seen"), person("guild", "Thralls", "Pioneer")], total: 2 },
  };
  await type("thrall");
  await answer("thrall", Array.from({ length: 8 }, (_, i) => suggestion(10 + i, `Thrall item ${i}`)));
  const rows = texts();
  expect(rows).toHaveLength(8);
  expect(rows.slice(0, 5).every((t) => t!.startsWith("Thrall item"))).toBe(true);
  // An exact name first, then characters before guilds; a guild row says it is one.
  expect(rows.slice(5)).toEqual(["ThrallLevel 60 Shaman · Pioneer", "ThrallinaLevel 24 Shaman · Pioneer", "Thrall FansGuild · Pioneer · 4 members seen"]);
});

test("with no database match the character rows are the list, and they open their own pages", async () => {
  people.body = { characters: { results: [person("character", "Zuljinna", "Level 12 Hunter · Pioneer")], total: 1 }, guilds: { results: [], total: 0 } };
  await type("zulj");
  await answer("zulj", []);
  expect(texts()).toEqual(["ZuljinnaLevel 12 Hunter · Pioneer"]);
  await press("ArrowDown");
  const clicks = watchClicks();
  await press("Enter");
  expect(clicks).toEqual(["/players/forever/pioneer/zuljinna"]);
});

test("characters and guilds are asked for every time, uncached, while the database pages are kept", async () => {
  people.body = { characters: { results: [person("character", "Hidee", "Level 5 Mage · Pioneer")], total: 1 } };
  await type("hide");
  await answer("hide", []);
  expect(texts()).toEqual(["HideeLevel 5 Mage · Pioneer"]);
  // The character is hidden; the same text typed again no longer shows it, though its database answer is kept.
  people.body = {};
  await type("");
  await type("hide");
  expect(texts()).toEqual([]);
  expect(peopleAsked).toEqual([{ q: "hide", cache: "no-store" }, { q: "hide", cache: "no-store" }]);
});

test("a failed character lookup leaves the database rows; a scoped box never asks for characters", async () => {
  people.status = 500;
  await type("linen c");
  await answer("linen c", [suggestion(2, "Linen Cloth")]);
  expect(texts()).toEqual(["Linen ClothItem 2"]);
  // A fresh bar scoped to items (the scope is the bar's own state, set when it mounts).
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<SearchBar action="/search" label="Search Everloot" id="bar" scopes defaultScope="item" />));
  peopleAsked = [];
  await type("wool");
  await answer("wool", [suggestion(3, "Wool Cloth")]);
  expect(texts()).toEqual(["Wool ClothItem 3"]);
  expect(peopleAsked).toEqual([]);
});
