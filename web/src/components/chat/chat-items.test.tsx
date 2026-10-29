// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ChatClient from "./ChatClient";

const KEY = "sk-or-v1-secretsecretsecretsecret1234";
const CONVERSATIONS = "everloot.chat.conversations.v1";
const CARD = { type: "item", id: 2589, title: "Linen Cloth", quality: 1, color: null, icon: null, lines: ["Item Level 5", "Sell Price 13c"], foot: "Name from Warcraft Wiki" };
const LINEN = [
  { type: "item", id: 2572, label: "Red Linen Robe", href: "/database/items/2572", quality: 2 },
  { type: "item", id: 2589, label: "Linen Cloth", href: "/database/items/2589", quality: 1 },
  { type: "item", id: 2996, label: "Bolt of Linen Cloth", href: "/database/items/2996", quality: 1 },
];
const LORE = "[item] Red Linen Robe\nA robe.\nSource: https://warcraft.wiki.gg/wiki/Red_Linen_Robe (CC-BY-SA-4.0, retrieved 2023-11-13)\n";

function sse(events: unknown[]): Response {
  const raw = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new TextEncoder().encode(raw), { status: 200, headers: { "content-type": "text/event-stream" } });
}

let calls: { url: string; init?: RequestInit }[];
let turns: number;
function api() {
  calls = [];
  turns = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/auth/me") return Response.json({ user: null });
    if (url.startsWith("/schema/mcp/")) return Response.json({ title: "T", inputSchema: { type: "object", properties: {} } });
    if (url.startsWith("/search/suggest?")) {
      const q = new URL(url, "http://x").searchParams.get("q")!.toLowerCase();
      return Response.json({ results: LINEN.filter((r) => r.label.toLowerCase().includes(q)) });
    }
    if (url === "/database/card/item/2589") return Response.json({ ok: true, card: CARD });
    if (url.startsWith("/api/tools/item_page?")) {
      return Response.json({ answer: { connected: true, dataAsOf: "2026-10-22T01:30:27.923Z", page: { itemId: 2589, name: null, drops: [], pins: [], reported: { shown: [], contested: [] } } }, text: "unknown stats" });
    }
    if (url.startsWith("/api/tools/")) return Response.json({ text: LORE });
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [] });
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      return turns++ === 0
        ? sse([{ model: "deepseek/deepseek-v4.1-flash", choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_knowledge", arguments: "{\"query\":\"Linen Cloth\"}" } }] } }] }])
        : sse([{ choices: [{ delta: { content: "Humanoids drop it." } }] }]);
    }
    throw new Error(`Unexpected request ${url}`);
  }));
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/chat");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui: ReactNode) => { await act(async () => root.render(ui)); await settle(); };
const text = () => container.textContent ?? "";
const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label);
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); await settle(); };
const stored = () => localStorage.getItem(CONVERSATIONS) ?? "";

test("no key: Linen Cloth opens its own card and drop state, not a similar item's lore", async () => {
  await render(<ChatClient />);
  await click(button("Where does Linen Cloth drop?"));
  expect(calls.map((c) => c.url)).toContain("/search/suggest?q=Linen+Cloth&in=item");
  expect(calls.some((c) => c.url.startsWith("/api/tools/answer_sources"))).toBe(false);
  expect(text()).not.toContain("Red Linen Robe");
  expect(text()).toContain("Sell Price 13c");
  expect(text()).toContain("No drops recorded yet");
  expect(text()).toContain("From Everloot");
  expect(container.querySelector('a[href="/database/items/2589"]')).not.toBeNull();
  expect(stored()).toContain("\"item\":{\"id\":2589}");
  expect(stored()).not.toContain("Sell Price");
  expect(stored()).not.toContain("Warcraft Wiki");
});

test("with a key: the model answers as before and the card sits beside it, its facts kept from the model", async () => {
  sessionStorage.setItem("everloot.chat.providers.v1", JSON.stringify([{ kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: KEY }]));
  await render(<ChatClient />);
  await click(button("Where does Linen Cloth drop?"));
  expect(text()).toContain("Humanoids drop it.");
  expect(text()).toContain("Sell Price 13c");
  const sent = calls.filter((c) => c.url.startsWith("https://openrouter.ai/api/v1/chat/completions")).map((c) => String(c.init?.body));
  expect(sent.length).toBeGreaterThan(0);
  for (const body of sent) {
    expect(body).not.toContain("Sell Price");
    expect(body).not.toContain("Warcraft Wiki");
    expect(body).not.toContain("2589");
  }
  expect(stored()).not.toContain("Sell Price");
});

test("a partial name offers choices in Chat; the chosen item is kept by id and opens its card", async () => {
  await render(<ChatClient />);
  const box = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Where does Linen drop?");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => box.form!.requestSubmit());
  await settle();
  expect(text()).toContain("Which item did you mean?");
  expect(stored()).toContain("\"item\":{\"query\":\"Linen\"}");
  expect(calls.some((c) => c.url.startsWith("/database/card/"))).toBe(false);
  await click(button("Linen Cloth"));
  expect(text()).toContain("Sell Price 13c");
  expect(text()).not.toContain("A robe.");
  expect(text()).toContain("Here is the item in Everloot's database.");
  expect(stored()).toContain("\"item\":{\"id\":2589}");
});

test("ordinary questions do not look an item up", async () => {
  await render(<ChatClient />);
  await click(button("What changed in the last build?"));
  expect(calls.some((c) => c.url.startsWith("/search/suggest"))).toBe(false);
  expect(calls.some((c) => c.url.startsWith("/api/tools/answer_sources"))).toBe(true);
});

test("an older conversation without item references still opens", async () => {
  const at = "2026-10-01T00:00:00.000Z";
  localStorage.setItem(CONVERSATIONS, JSON.stringify([{ id: "old", title: "", updatedAt: at, messages: [
    { role: "user", text: "Where does Linen Cloth drop?", at, model: null, sources: [], steps: [] },
    { role: "assistant", text: LORE, at, model: null, sources: ["https://warcraft.wiki.gg/wiki/Red_Linen_Robe"], steps: [] },
  ] }]));
  await render(<ChatClient />);
  if (!container.querySelector('nav[aria-label="Conversations"]')) await click(button("Chats"));
  await click(Array.from(container.querySelectorAll('nav[aria-label="Conversations"] li button')).find((b) => b.textContent === "Where does Linen Cloth drop?"));
  expect(text()).toContain("A robe.");
  expect(calls.some((c) => c.url.startsWith("/database/card/"))).toBe(false);
});

test("stopping while the item is looked up writes no answer", async () => {
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => String(input).startsWith("/search/suggest")
    ? new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))
    : base(input, init)));
  await render(<ChatClient />);
  await act(async () => { button("Where does Linen Cloth drop?")!.click(); });
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  await settle();
  expect(text()).toContain("Stopped.");
  expect(stored()).not.toContain("\"role\":\"assistant\"");
  expect(calls.some((c) => c.url.startsWith("/api/tools/"))).toBe(false);
});
