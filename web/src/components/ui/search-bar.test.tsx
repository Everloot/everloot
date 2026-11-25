// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, onNavigate: _onNavigate, ...props }: { children: React.ReactNode; onNavigate?: () => void; href: string }) => <a {...props}>{children}</a>,
}));

import SearchBar, { couldBeName, PAUSE_MS, suggestUrl } from "./SearchBar";

// Each test types its own text: the suggestion cache outlives a render.
// The suggestions are asked for 200 ms after the last key. Until they do, the list still shows the rows for what was
// typed before, so a highlight picked on those rows must not outlive the text it was picked for.

let container: HTMLDivElement;
let root: Root;
let answers: Map<string, (rows: unknown[]) => void>;
let people: { status: number; body: unknown; never?: boolean; held?: () => void };
let peopleAsked: { q: string; cache?: RequestCache; signal?: AbortSignal | null }[];

const suggestion = (id: number, label: string) => ({ type: "item", id, label, href: `/database/items/${id}` });

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  answers = new Map();
  people = { status: 200, body: {} };
  peopleAsked = [];
  // Every database request waits until the test answers it, so a slow reply can be staged. Characters and guilds
  // (/search/people) answer at once with what the test set, or never (until the request is aborted).
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const u = new URL(url, "http://localhost");
    const q = u.searchParams.get("q") ?? "";
    if (u.pathname === "/search/people") {
      peopleAsked.push({ q, cache: init?.cache, signal: init?.signal });
      if (people.never) return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      const reply = { ok: people.status === 200, json: async () => people.body };
      // `held` set: the answer waits until the test calls people.held().
      if (people.held) return new Promise((resolve) => { people.held = () => resolve(reply); });
      return Promise.resolve(reply);
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

/** Types the text and lets the 200 ms pause pass. */
async function type(text: string) {
  await key(text);
  await act(async () => { await vi.advanceTimersByTimeAsync(PAUSE_MS); });
}

/** Types the text with no pause after it. */
async function key(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Lets `ms` more pass. */
async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
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
  expect(rows()).toEqual(["false", "false", "false"]);
  await press("ArrowDown");
  expect(rows()).toEqual(["true", "false", "false"]);
});

test("a dungeon row says which it is and its level, and is picked like any other row", async () => {
  await type("deadm");
  await answer("deadm", [{ type: "instance", id: 36, label: "Deadmines", href: "/database/instances/36-deadmines", note: "Dungeon, level 16" }, suggestion(4, "Deadmines Map")]);
  const options = [...container.querySelectorAll("[role=option]")];
  // Items come before zones, dungeons and NPCs.
  expect(options.map((o) => o.textContent)).toEqual(["Deadmines MapItem 4", "DeadminesDungeon, level 16", "All results for “deadm”Search"]);
  await press("ArrowDown");
  await press("ArrowDown");
  const clicks = watchClicks();
  await press("Enter");
  expect(clicks).toEqual(["/database/instances/36-deadmines"]);
});

const person = (type: "character" | "guild", label: string, meta: string, exact = false) =>
  ({ type, label, href: type === "character" ? `/players/forever/pioneer/${label.toLowerCase()}` : `/guilds/pioneer/${label.toLowerCase()}`, meta, exact });
/** The database, character and guild rows, without the closing "All results" row (pinned in its own test). */
const texts = () => [...container.querySelectorAll("[role=option]")].map((o) => o.textContent).filter((t) => !t!.startsWith("All results for"));
const headings = () => [...container.querySelectorAll("[role=listbox] > li > div")].map((h) => h.textContent);

test("characters and guilds lead the list in their own sections, at most 3, and the 8 rows still hold", async () => {
  people.body = {
    characters: { results: [person("character", "Thrallina", "Level 24 Shaman · Pioneer"), person("character", "Thrall", "Level 60 Shaman · Pioneer", true)], total: 2 },
    guilds: { results: [person("guild", "Thrall Fans", "Pioneer · 4 members seen"), person("guild", "Thralls", "Pioneer")], total: 2 },
  };
  people.held = () => {};
  await type("thrall");
  await answer("thrall", Array.from({ length: 8 }, (_, i) => suggestion(10 + i, `Thrall item ${i}`)));
  // Both are asked at once; the database rows show without waiting, the people rows join them when they arrive.
  expect(peopleAsked.map((a) => a.q)).toEqual(["thrall"]);
  expect(texts()).toHaveLength(8);
  await act(async () => people.held!());
  const rows = texts();
  expect(rows).toHaveLength(8);
  // An exact name first, characters before guilds, then the database pages.
  expect(rows.slice(0, 3)).toEqual(["ThrallLevel 60 Shaman · Pioneer", "ThrallinaLevel 24 Shaman · Pioneer", "Thrall FansPioneer · 4 members seen"]);
  expect(rows.slice(3).every((t) => t!.startsWith("Thrall item"))).toBe(true);
  expect(headings()).toEqual(["Characters", "Guilds", "Items"]);
});

test("with no database match the character rows are the list, and they open their own pages", async () => {
  people.body = { characters: { results: [person("character", "Zuljinna", "Level 12 Hunter · Pioneer")], total: 1 }, guilds: { results: [], total: 0 } };
  await type("zulj");
  await answer("zulj", []);
  await wait(160);
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
  await wait(160);
  expect(texts()).toEqual(["HideeLevel 5 Mage · Pioneer"]);
  // The character is hidden; the same text typed again no longer shows it, though its database answer is kept.
  people.body = {};
  await type("");
  await type("hide");
  await wait(160);
  expect(texts()).toEqual([]);
  expect(peopleAsked.map(({ q, cache }) => ({ q, cache }))).toEqual([{ q: "hide", cache: "no-store" }, { q: "hide", cache: "no-store" }]);
});

test("a character lookup that never answers holds nothing back, and is dropped after 800 ms", async () => {
  people.never = true;
  await type("mageweave");
  await answer("mageweave", [suggestion(5, "Mageweave Cloth")]);
  expect(texts()).toEqual(["Mageweave ClothItem 5"]);
  await wait(160);
  expect(peopleAsked).toHaveLength(1);
  expect(peopleAsked[0].signal!.aborted).toBe(false);
  await wait(800);
  expect(peopleAsked[0].signal!.aborted).toBe(true);
  expect(texts()).toEqual(["Mageweave ClothItem 5"]);
});

test("rows added to the list leave the picked row picked", async () => {
  people.body = { characters: { results: [person("character", "Silkie", "Level 9 Rogue · Pioneer")], total: 1 } };
  people.held = () => {};
  await type("silk");
  await answer("silk", [suggestion(6, "Silk Cloth"), suggestion(7, "Silk Thread")]);
  await press("ArrowDown");
  await press("ArrowDown");
  const picked = () => container.querySelector("[aria-selected=true]")?.textContent;
  expect(picked()).toBe("Silk ThreadItem 7");
  await act(async () => people.held!());
  expect(texts()).toEqual(["SilkieLevel 9 Rogue · Pioneer", "Silk ClothItem 6", "Silk ThreadItem 7"]);
  expect(picked()).toBe("Silk ThreadItem 7");
});

test("text that cannot start a character or guild name never asks for them", async () => {
  for (const q of ["6948", "#12", "a", "it's-"]) {
    await type(q);
    await wait(400);
  }
  // An id is never a name here, even though a guild name may be digits; "it's-" could start a guild name.
  expect(peopleAsked.map((a) => a.q)).toEqual(["it's-"]);
});

test("a quick typist asks once, for the text they stopped on; one letter asks nothing", async () => {
  await key("th");
  await wait(150);
  await key("thr");
  await wait(150);
  await key("thra");
  await wait(400);
  expect(peopleAsked.map((a) => a.q)).toEqual(["thra"]);
  expect([...answers.keys()]).toEqual(["thra"]);
  await type("x");
  await wait(400);
  expect([...answers.keys()]).toEqual(["thra"]);
  expect(container.querySelectorAll("[role=option]")).toHaveLength(0);
});

test("a newer text aborts the requests still out for the older one", async () => {
  people.never = true;
  await type("cop");
  const old = vi.mocked(fetch).mock.calls.map(([, init]) => init?.signal);
  expect(old).toHaveLength(2);
  expect(old.every((signal) => signal && !signal.aborted)).toBe(true);
  await key("copp");
  expect(old.every((signal) => signal!.aborted)).toBe(true);
});

test("sections are labelled groups inside the listbox; characters take their class colour and guilds show their faction", async () => {
  people.body = {
    characters: { results: [{ ...person("character", "Ashvane", "Level 40 Mage · Pioneer"), class: "mage" }], total: 1 },
    guilds: { results: [{ ...person("guild", "Ash Wardens", "EU Normal · 12 members"), faction: "Horde" }], total: 1 },
  };
  await type("ash");
  await answer("ash", [{ ...suggestion(8, "Ashwood Bow"), quality: 3 }, { type: "zone", id: 3, label: "Ashenvale", href: "/database/zones/3", note: "Zone" }]);
  expect(headings()).toEqual(["Characters", "Guilds", "Items", "Zones & NPCs"]);
  const groups = [...container.querySelectorAll("[role=listbox] [role=group]")];
  expect(groups.map((g) => container.querySelector(`#${g.getAttribute("aria-labelledby")}`)!.textContent)).toEqual(["Characters", "Guilds", "Items", "Zones & NPCs"]);
  expect(groups.map((g) => g.querySelectorAll("[role=option]").length)).toEqual([1, 1, 1, 1]);
  // Option ids follow the list order, so the arrow keys and aria-activedescendant agree.
  expect([...container.querySelectorAll("[role=option]")].map((o) => o.id)).toEqual(["bar-suggestions-0", "bar-suggestions-1", "bar-suggestions-2", "bar-suggestions-3", "bar-suggestions-4"]);
  await press("ArrowDown");
  await press("ArrowDown");
  expect(field().getAttribute("aria-activedescendant")).toBe("bar-suggestions-1");
  expect(container.querySelector("#bar-suggestions-1")!.textContent).toContain("Ash Wardens");
  const label = (text: string) => [...container.querySelectorAll("[role=option] a span")].find((s) => s.textContent === text)!;
  expect(label("Ashvane").className).toContain("text-class-mage");
  expect(container.querySelector("[role=option] [role=img][aria-label=Horde]")!.className).toContain("bg-faction-horde");
  expect(label("Ashwood Bow").className).not.toContain("text-fg");
});

test("Enter with nothing picked opens the first row named exactly what is typed, and the form still counts the search", async () => {
  const submitted = vi.fn();
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<div onSubmit={(e) => { submitted(); e.preventDefault(); }}><SearchBar action="/search" label="Search Everloot" id="bar" /></div>));
  people.body = { characters: { results: [person("character", "Linen", "Level 3 Mage · Pioneer", true)], total: 1 } };
  await type("linen");
  await answer("linen", [suggestion(2, "Linen Cloth")]);
  const clicks = watchClicks();
  expect((await press("Enter")).defaultPrevented).toBe(true);
  expect(clicks).toEqual(["/players/forever/pioneer/linen"]);
  expect(submitted).toHaveBeenCalledOnce();
  // A database row named exactly what is typed counts too, in any case.
  people.body = {};
  await type("Linen Cloth");
  await answer("linen cloth", [suggestion(2, "Linen Cloth")]);
  const more = watchClicks();
  await press("Enter");
  expect(more).toEqual(["/database/items/2"]);
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

test("a surname or a full Forever name could be a name, so the box asks /search/people for it", () => {
  for (const text of ["Volvik", "Morningstar", "Volvik Morningstar", "Volvik  Morn", "Aeriwen Thistlewhisperingvale"]) expect(couldBeName(text)).toBe(true);
  for (const text of ["6948", "V", "Volvik Morningstar Third2"]) expect(couldBeName(text)).toBe(false);
});

test("any suggestions end with a row for every result on the search page, in the box's scope", async () => {
  await type("  Westfall ");
  await answer("westfall", [{ type: "zone", id: 1436, label: "Westfall", href: "/database/zones/1436-westfall", note: "Zone" }]);
  const options = [...container.querySelectorAll("[role=option]")];
  expect(options.map((o) => o.textContent)).toEqual(["WestfallZone", "All results for “Westfall”Search"]);
  expect(options[1].querySelector("a")!.getAttribute("href")).toBe("/search?q=Westfall");
  await press("ArrowUp");
  const clicks = watchClicks();
  await press("Enter");
  expect(clicks).toEqual(["/search?q=Westfall"]);
  // No suggestion, no row: Enter then submits the form itself.
  await type("zzzz");
  await answer("zzzz", []);
  expect(container.querySelectorAll("[role=option]")).toHaveLength(0);
});

test("the type-ahead asks in lower case, so every casing is one cached request", () => {
  expect(suggestUrl(" Thrall ", "")).toBe("/search/suggest?q=thrall");
  expect(suggestUrl("THRALL", "npc")).toBe("/search/suggest?q=thrall&in=npc");
});
