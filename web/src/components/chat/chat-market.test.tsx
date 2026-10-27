// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FIXTURE_ANSWER, FIXTURE_STRUCTURED } from "@/lib/chat/market-fixture";
import ChatClient from "./ChatClient";

const KEY = "sk-or-v1-secretsecretsecretsecret1234";
const CONVERSATIONS = "everloot.chat.conversations.v1";
const LINEN = [
  { type: "item", id: 2572, label: "Red Linen Robe", href: "/database/items/2572", quality: 2 },
  { type: "item", id: 2589, label: "Linen Cloth", href: "/database/items/2589", quality: 1 },
  { type: "item", id: 2996, label: "Bolt of Linen Cloth", href: "/database/items/2996", quality: 1 },
];
const LORE = "[item] Red Linen Robe\nA robe.\nSource: https://warcraft.wiki.gg/wiki/Red_Linen_Robe (CC-BY-SA-4.0, retrieved 2023-11-13)\n";

let calls: { url: string; init?: RequestInit }[];
let marketTool: () => Promise<Response>;
function api() {
  calls = [];
  marketTool = async () => Response.json({ answer: FIXTURE_STRUCTURED, text: "ignored" });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/auth/me") return Response.json({ user: null });
    if (url.startsWith("/schema/mcp/")) return Response.json({ title: "T", inputSchema: { type: "object", properties: {} } });
    if (url.startsWith("/search/suggest?")) {
      const q = new URL(url, "http://x").searchParams.get("q")!.toLowerCase();
      return Response.json({ results: LINEN.filter((r) => r.label.toLowerCase().includes(q)) });
    }
    if (url.startsWith("/api/tools/market_value?")) return marketTool();
    if (url.startsWith("/api/tools/")) return Response.json({ text: LORE });
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [] });
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
const stored = () => localStorage.getItem(CONVERSATIONS) ?? "";
async function say(question: string) {
  const box = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, question);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => box.form!.requestSubmit());
  await settle();
}
const urls = () => calls.map((c) => c.url);

test("no key: a price question gets the recorded price, its page and no knowledge search", async () => {
  await render(<ChatClient />);
  await say("What is the price of Linen Cloth on Forever?");
  expect(text()).toContain(FIXTURE_ANSWER);
  expect(urls()).toContain("/api/tools/market_value?realm=Forever&itemId=2589");
  expect(urls().some((u) => u.startsWith("/api/tools/search_knowledge"))).toBe(false);
  expect(urls().some((u) => u.startsWith("/database/card/"))).toBe(false);
  expect(text()).toContain("From Everloot");
  expect(container.querySelector('a[href="https://everloot.app/tools/auctions?realm=Forever&item=2589"]')).not.toBeNull();
  expect(stored()).toContain("\"role\":\"assistant\"");
});

test("with a key the price still comes from the market, and the provider is never called", async () => {
  sessionStorage.setItem("everloot.chat.providers.v1", JSON.stringify([{ kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: KEY }]));
  await render(<ChatClient />);
  await say("price 2589 on Forever");
  expect(text()).toContain("Item 2589 on Forever, all houses: market 3s 10c");
  expect(urls().some((u) => u.startsWith("https://openrouter.ai/api/v1/chat/completions"))).toBe(false);
  expect(urls().some((u) => u.startsWith("/schema/mcp/"))).toBe(false);
});

test("a missing realm asks for one and fetches no price", async () => {
  await render(<ChatClient />);
  await say("price of Linen Cloth");
  expect(text()).toMatch(/Which realm\?/);
  expect(urls().some((u) => u.startsWith("/api/tools/"))).toBe(false);
  expect(urls().some((u) => u.startsWith("/search/suggest"))).toBe(false);
});

test("a name that matches several items asks which, and fetches no price", async () => {
  await render(<ChatClient />);
  await say("price of Linen on Forever");
  expect(text()).toMatch(/Several items match "Linen"/);
  expect(urls().some((u) => u.startsWith("/api/tools/"))).toBe(false);
});

test("an unreadable market says so and does not fall back to search or the model", async () => {
  marketTool = async () => Response.json({ ok: false, error: "Knowledge release unavailable." }, { status: 503 });
  await render(<ChatClient />);
  await say("price 2589 on Forever");
  expect(text()).toContain("unrecorded, not zero");
  expect(urls().some((u) => u.startsWith("/api/tools/search_knowledge"))).toBe(false);
});

test("a question that is not about a price keeps its usual search", async () => {
  await render(<ChatClient />);
  await say("Who is Leeroy Jenkins?");
  expect(urls().some((u) => u.startsWith("/api/tools/search_knowledge"))).toBe(true);
  expect(urls().some((u) => u.startsWith("/api/tools/market_value"))).toBe(false);
});

test("stopping during the price lookup writes no answer", async () => {
  marketTool = () => new Promise(() => {});
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => String(input).startsWith("/api/tools/market_value")
    ? new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))
    : base(input, init)));
  await render(<ChatClient />);
  await say("price 2589 on Forever");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  await settle();
  expect(text()).toContain("Stopped.");
  expect(stored()).not.toContain("\"role\":\"assistant\"");
});
