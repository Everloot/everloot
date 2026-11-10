// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

// public/tooltips.js is what other sites load. It is plain browser JavaScript, so the tests run the file itself in jsdom.
const SOURCE = readFileSync(join(process.cwd(), "public", "tooltips.js"), "utf8");

const card = (over: Record<string, unknown> = {}) => ({
  ok: true, type: "item", id: 1, title: "Thunderfury", color: "#ff8000", icon: null, lines: ["Binds when picked up"], partial: false,
  url: "https://everloot.app/database/items/1", attribution: {}, gameData: null, ...over,
});
const fetchMock = vi.fn();
let next: unknown = card();

const link = (href: string, attrs: Record<string, string> = {}) => {
  const a = document.createElement("a");
  a.href = href;
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.textContent = "link";
  document.body.appendChild(a);
  return a;
};
const fire = (target: Element, type: string, props: Record<string, unknown> = {}) => {
  const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  target.dispatchEvent(e);
  return e;
};
const hover = async (a: Element) => { fire(a, "pointerover", { pointerType: "mouse" }); await vi.advanceTimersByTimeAsync(300); };
const shadow = () => document.getElementById("everloot-tooltip")?.shadowRoot ?? null;
const box = () => shadow()?.querySelector(".b") as HTMLElement | null;
const shown = () => box()?.style.display === "block";
const escape = async () => { fire(document.body, "keydown", { key: "Escape" }); await vi.advanceTimersByTimeAsync(300); };

beforeAll(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  (0, eval)(SOURCE);
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await escape();
  document.querySelectorAll("a").forEach((a) => a.remove());
  fetchMock.mockReset().mockImplementation(async () => ({ ok: true, json: async () => next }));
  next = card();
});

test("it is small, and says nothing about cookies or tracking beyond the code that does none", () => {
  expect(SOURCE.length).toBeLessThan(8192);
  expect(gzipSync(SOURCE).length).toBeLessThan(4_500);
  expect(SOURCE).not.toMatch(/document\.cookie|localStorage|sessionStorage|sendBeacon|innerHTML|insertAdjacentHTML|outerHTML|\beval\b/);
});

test("it matches links to item, NPC, quest and object pages on everloot.app, with or without a slug", async () => {
  const ok = [
    ["https://everloot.app/database/items/101", "item/101"],
    ["https://everloot.app/database/items/102-thunderfury", "item/102"],
    ["https://www.everloot.app/database/npcs/103/", "npc/103"],
    ["https://everloot.app/database/quests/104?ref=blog#top", "quest/104"],
    ["https://everloot.app/database/objects/105", "object/105"],
  ];
  for (const [href, key] of ok) {
    await hover(link(href));
    expect(fetchMock, href).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://everloot.app/api/tooltip/${key}`);
    fetchMock.mockClear();
    await escape();
  }
});

test("it leaves every other link alone", async () => {
  const skip = [
    "https://evil.example/database/items/1",
    "https://everloot.app.evil.example/database/items/1",
    "https://notever.loot/database/items/1",
    "https://everloot.app/database/items",
    "https://everloot.app/database/items/weapons",
    "https://everloot.app/database/items/0",
    "https://everloot.app/database/items/12345678901",
    "https://everloot.app/database/items/1/extra",
    "https://everloot.app/database/vendors/5",
    "https://everloot.app/lore/thrall",
    "http://everloot.app/database/items/1",
    "javascript:alert(1)",
    "mailto:hello@everloot.app",
  ];
  for (const href of skip) await hover(link(href));
  await hover(link("https://everloot.app/database/items/9", { "data-everloot-tooltip": "off" }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(shown()).toBe(false);
});

test("it asks only the script's own site, with no cookies and no referrer", async () => {
  await hover(link("https://everloot.app/database/items/201"));
  expect(fetchMock).toHaveBeenCalledWith("https://everloot.app/api/tooltip/item/201", { credentials: "omit", referrerPolicy: "no-referrer" });
});

test("everything the server sends is text: markup, bad colours, bad icons and bad links do nothing", async () => {
  next = card({
    title: "<img src=x onerror=alert(1)>", lines: ["<script>alert(2)</script>", '"<b>quote</b>"'], color: "red;background:url(//evil.example/x)",
    icon: "javascript:alert(3)", url: "javascript:alert(4)", gameData: { label: "<i>label</i>", build: "<u>1</u>", credit: "<s>credit</s>" },
  });
  await hover(link("https://everloot.app/database/items/301"));
  expect(shown()).toBe(true);
  const root = shadow()!;
  expect(root.querySelector("img, script, b, i, u, s")).toBeNull();
  expect(root.querySelector("a")).toBeNull();
  expect(root.querySelector(".t")!.textContent).toBe("<img src=x onerror=alert(1)>");
  expect((root.querySelector(".t") as HTMLElement).style.color).toBe("");
  expect(root.textContent).toContain("<script>alert(2)</script>");
  expect(root.textContent).toContain("<i>label</i> · build <u>1</u>");
});

test("an icon from https and a link back to everloot.app are drawn; a link back to another site is not", async () => {
  next = card({ icon: "https://assets.everloot.app/b/icons/1.webp", url: "https://everloot.app/database/items/401" });
  await hover(link("https://everloot.app/database/items/401"));
  expect(shadow()!.querySelector("img")!.getAttribute("src")).toBe("https://assets.everloot.app/b/icons/1.webp");
  // The icon's border takes the name's quality colour (card(): #ff8000).
  expect((shadow()!.querySelector("img") as HTMLElement).style.borderColor).toBe("rgb(255, 128, 0)");
  const back = shadow()!.querySelector("a")!;
  expect(back.getAttribute("href")).toBe("https://everloot.app/database/items/401");
  expect(back.getAttribute("rel")).toBe("noopener");
  await escape();
  next = card({ icon: "http://evil.example/x.png", url: "https://evil.example/database/items/402" });
  await hover(link("https://everloot.app/database/items/402"));
  expect(shadow()!.querySelector("img")).toBeNull();
  expect(shadow()!.querySelector("a")).toBeNull();
});

test("a 404, a failed request or a bad answer shows nothing", async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false }) });
  await hover(link("https://everloot.app/database/items/501"));
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  await hover(link("https://everloot.app/database/items/502"));
  next = { ok: false };
  await hover(link("https://everloot.app/database/items/503"));
  expect(shown()).toBe(false);
});

test("keyboard focus shows the card, describes the link, and Escape closes it", async () => {
  const a = link("https://everloot.app/database/items/601", { "aria-describedby": "note" });
  a.focus();
  fire(a, "focusin");
  await vi.advanceTimersByTimeAsync(50);
  expect(shown()).toBe(true);
  expect(a.getAttribute("aria-describedby")).toBe("note everloot-tooltip");
  expect(document.getElementById("everloot-tooltip")!.getAttribute("role")).toBe("tooltip");
  fire(a, "keydown", { key: "Escape" });
  expect(shown()).toBe(false);
  expect(a.getAttribute("aria-describedby")).toBe("note");
});

test("moving off the link closes the card after a moment; moving onto the card keeps it", async () => {
  const a = link("https://everloot.app/database/items/701");
  await hover(a);
  fire(a, "pointerout", { pointerType: "mouse" });
  fire(document.getElementById("everloot-tooltip")!, "pointerover", { pointerType: "mouse" });
  await vi.advanceTimersByTimeAsync(400);
  expect(shown()).toBe(true);
  fire(document.getElementById("everloot-tooltip")!, "pointerout", { pointerType: "mouse" });
  await vi.advanceTimersByTimeAsync(400);
  expect(shown()).toBe(false);
});

test("on touch, the first tap shows the card and the second follows the link", async () => {
  const a = link("https://everloot.app/database/items/801");
  fire(a, "pointerdown", { pointerType: "touch" });
  const first = fire(a, "click", { button: 0 });
  await vi.advanceTimersByTimeAsync(50);
  expect(first.defaultPrevented).toBe(true);
  expect(shown()).toBe(true);
  fire(a, "pointerdown", { pointerType: "touch" });
  expect(fire(a, "click", { button: 0 }).defaultPrevented).toBe(false);
  // A tap elsewhere closes it, and a mouse click always follows.
  fire(document.body, "pointerdown", { pointerType: "touch" });
  fire(document.body, "click", { button: 0 });
  expect(shown()).toBe(false);
  fire(a, "pointerdown", { pointerType: "mouse" });
  expect(fire(a, "click", { button: 0 }).defaultPrevented).toBe(false);
});

test("a touch tap on a link with no card follows it at once", async () => {
  next = { ok: false };
  const a = link("https://everloot.app/database/items/901");
  await hover(a);
  fire(a, "pointerdown", { pointerType: "touch" });
  expect(fire(a, "click", { button: 0 }).defaultPrevented).toBe(false);
});

test("the card's own styles live in its shadow root and respect reduced motion", async () => {
  await hover(link("https://everloot.app/database/items/1001"));
  const root = shadow()!;
  // A constructable sheet where the browser has them (no <style> for a strict host CSP to refuse), a <style> in the root otherwise.
  expect(root.adoptedStyleSheets.length + root.querySelectorAll("style").length).toBe(1);
  expect(SOURCE).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\.b\{animation:none\}\}/);
  expect(SOURCE).toContain(".b{all:initial;");
  expect(document.head.querySelector("style")).toBeNull();
  expect(document.body.querySelector("style")).toBeNull();
});
