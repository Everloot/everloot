// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import Tabs, { tabFromHash, type TabItem } from "./Tabs";
import { filledTabs } from "./tab-style";

const TABS: TabItem[] = [
  { id: "created-by", label: "Created by", count: 1, panel: <p>Blacksmithing</p> },
  { id: "dropped-by", label: "Dropped by", count: 2, panel: <p>Two sources</p> },
  { id: "sources", label: "Sources", panel: <p>Game files</p> },
];
const EMPTY: TabItem = { id: "sold-by", label: "Sold by", count: 0, panel: <p>No vendor yet</p> };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/database/items/7960");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const tabs = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const selected = () => tabs().find((t) => t.getAttribute("aria-selected") === "true")?.textContent;
const visiblePanel = () => container.querySelector('[role="tabpanel"]:not([hidden])')?.textContent;

test("the server opens the first tab, and the others are hidden panels", () => {
  const html = renderToStaticMarkup(<Tabs label="Item relations" tabs={TABS} />);
  expect(html).toContain('role="tablist" aria-label="Item relations"');
  expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  expect(html.match(/hidden=""/g)).toHaveLength(2);
});

test("a tab with no rows is left out, so the strip starts with, and opens, a tab that has rows", () => {
  const html = renderToStaticMarkup(<Tabs label="Item relations" tabs={[EMPTY, TABS[0], TABS[2]]} />);
  expect(html).not.toContain("Sold by");
  expect(html).not.toContain("No vendor yet");
  expect(html).toMatch(/role="tablist"[^>]*><button[^>]*aria-selected="true"[^>]*>Created by/);
  expect(html.match(/role="tab"/g)).toHaveLength(2);
  expect(filledTabs([{ id: "a", count: 0 }, { id: "b" }, { id: "c", count: 3 }]).map((t) => t.id)).toEqual(["b", "c"]);
});

test("with no tab that has rows there is no strip: the empty line, else the first tab's own line", () => {
  const second = { ...EMPTY, id: "map", label: "Map", panel: <p>No position yet</p> };
  const html = renderToStaticMarkup(<Tabs label="Item relations" tabs={[EMPTY, second]} empty={<p>Nothing agreed yet.</p>} />);
  expect(html).not.toContain('role="tab');
  expect(html).toContain("Nothing agreed yet.");
  expect(html).not.toContain("No vendor yet");
  const fallback = renderToStaticMarkup(<Tabs label="Item relations" tabs={[EMPTY, second]} />);
  expect(fallback).not.toContain('role="tab');
  expect(fallback).toContain("No vendor yet");
  expect(fallback).not.toContain("No position yet");
});

test("a hash naming a left-out tab opens the first tab with rows", async () => {
  window.history.replaceState(null, "", "/database/items/7960#sold-by");
  await act(async () => root.render(<Tabs label="Item relations" tabs={[EMPTY, ...TABS]} />));
  expect(selected()).toBe("Created by (1)");
});

test("a hash in the address opens its tab", async () => {
  window.history.replaceState(null, "", "/database/items/7960#dropped-by");
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  expect(selected()).toBe("Dropped by (2)");
  expect(visiblePanel()).toBe("Two sources");
});

test("an unknown hash leaves the first tab open", async () => {
  window.history.replaceState(null, "", "/database/items/7960#nope");
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  expect(selected()).toBe("Created by (1)");
});

test("a click opens the tab and writes its hash", async () => {
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  await act(async () => tabs()[2].click());
  expect(selected()).toBe("Sources");
  expect(visiblePanel()).toBe("Game files");
  expect(window.location.hash).toBe("#sources");
});

test("arrow keys, Home and End move between tabs and focus follows", async () => {
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  const key = (k: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
  tabs()[0].focus();
  await key("ArrowRight");
  expect(selected()).toBe("Dropped by (2)");
  expect(document.activeElement).toBe(tabs()[1]);
  await key("End");
  expect(selected()).toBe("Sources");
  await key("ArrowRight");
  expect(selected()).toBe("Created by (1)");
  await key("ArrowLeft");
  expect(selected()).toBe("Sources");
  await key("Home");
  expect(selected()).toBe("Created by (1)");
});

test("only the open tab is in the tab order", async () => {
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
});

test("the hash changing later switches the tab", async () => {
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  await act(async () => {
    window.history.replaceState(null, "", "#sources");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(selected()).toBe("Sources");
});

test("tabFromHash", () => {
  expect(tabFromHash("#sources", ["a", "sources"])).toBe("sources");
  expect(tabFromHash("", ["a"])).toBeNull();
  expect(tabFromHash("#x", ["a"])).toBeNull();
});

test("a closed tab has a hover; the strip scrolls without a scrollbar", () => {
  const html = renderToStaticMarkup(<Tabs label="Item relations" tabs={TABS} />);
  const tab = (name: string) => html.match(new RegExp(`<button[^>]*class="([^"]*)"[^>]*>${name}`))![1];
  expect(tab("Sources")).toContain("hover:text-fg");
  expect(html).toContain("[scrollbar-width:none]");
});

test.each(["#%", "#%E0%A4%A"])("a malformed fragment %s on initial mount keeps tabs usable", async (hash) => {
  window.history.replaceState(null, "", hash);
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  expect(selected()).toBe("Created by (1)");
  expect(visiblePanel()).toBe("Blacksmithing");
  await act(async () => tabs()[2].click());
  expect(visiblePanel()).toBe("Game files");
  expect(window.location.hash).toBe("#sources");
  await act(async () => tabs()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(visiblePanel()).toBe("Blacksmithing");
  expect(document.activeElement).toBe(tabs()[0]);
  expect(window.location.hash).toBe("#created-by");
});

test.each(["#%", "#%E0%A4%A"])("a malformed fragment %s on hashchange keeps the current tab usable", async (hash) => {
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  await act(async () => tabs()[2].click());
  await act(async () => {
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(selected()).toBe("Sources");
  expect(visiblePanel()).toBe("Game files");
  await act(async () => tabs()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(visiblePanel()).toBe("Two sources");
  expect(document.activeElement).toBe(tabs()[1]);
  expect(window.location.hash).toBe("#dropped-by");
  await act(async () => tabs()[0].click());
  expect(visiblePanel()).toBe("Blacksmithing");
  expect(window.location.hash).toBe("#created-by");
  await act(async () => {
    window.history.replaceState(null, "", "#%73ources");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(visiblePanel()).toBe("Game files");
});

test("a valid encoded fragment opens its decoded tab", async () => {
  window.history.replaceState(null, "", "#%73ources");
  await act(async () => root.render(<Tabs label="Item relations" tabs={TABS} />));
  expect(selected()).toBe("Sources");
  expect(visiblePanel()).toBe("Game files");
});
