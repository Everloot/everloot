// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FREE_FALLBACK, FREE_TOOLS } from "@/lib/chat/agent";
import ChatClient from "./ChatClient";

const KEY = "sk-or-v1-secretsecretsecretsecret1234";
const PROVIDERS = "everloot.chat.providers.v1";
const FREE = "/api/chat/free/chat/completions";
const HIT = "[item] Linen Cloth\nDropped by humanoids.\nMore: https://everloot.app/database/item/2589\nSource: https://warcraft.wiki.gg/wiki/Linen_Cloth (CC-BY-SA-4.0, retrieved 2023-11-13)\n";
/** answer_sources' text for the same item, as Everloot search reads it. */
const EVIDENCE = "- [lore (Warcraft Wiki 2023, may differ in WoW: Forever)] Dropped by humanoids.\n  Source: https://warcraft.wiki.gg/wiki/Linen_Cloth (CC-BY-SA-4.0, retrieved 2023-11-13)\n  More: https://everloot.app/database/item/2589";

function sse(events: unknown[]): Response {
  const raw = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new TextEncoder().encode(raw), { status: 200, headers: { "content-type": "text/event-stream" } });
}

let calls: { url: string; init?: RequestInit }[];

/** This site, with the free proxy answering as `proxy` says, and OpenRouter for a player's own key. */
function api(proxy: "ok" | "limit" = "ok") {
  calls = [];
  let turns = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/auth/me") return Response.json({ user: null });
    if (url.startsWith("/schema/mcp/")) return Response.json({ title: "T", inputSchema: { type: "object", properties: {} } });
    if (url.startsWith("/api/tools/answer_sources")) return Response.json({ text: EVIDENCE });
    if (url.startsWith("/api/tools/")) return Response.json({ text: HIT });
    if (url === FREE) {
      if (proxy === "limit") return Response.json({ error: { message: "The free model has reached its limit for now.", code: "free_chat_limit" } }, { status: 429 });
      return turns++ === 0
        ? sse([{ model: "openai/gpt-oss-120b", choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "get_by_name", arguments: "{\"name\":\"Linen Cloth\"}" } }] } }] }])
        : sse([{ choices: [{ delta: { content: "Humanoids drop it." } }] }]);
    }
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [] });
    if (url === "https://openrouter.ai/api/v1/chat/completions") return sse([{ model: "deepseek/deepseek-v4.1-flash", choices: [{ delta: { content: "Own key answer." } }] }]);
    if (url.startsWith("/search/suggest")) return Response.json({ results: [] });
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui: ReactNode) => { await act(async () => root.render(ui)); await settle(); };
const text = () => container.textContent ?? "";
const textarea = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]')!;
const modelMenu = () => container.querySelector<HTMLSelectElement>('select[aria-label="Model"]');

function setValue(el: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function send(question: string) {
  await act(async () => setValue(textarea(), question));
  await act(async () => container.querySelector<HTMLFormElement>('form[aria-label="Ask Everloot"]')!.requestSubmit());
  await settle();
}

describe("Everloot (free) on /chat", () => {
  test("without a key it is the default mode, says what it is and who sees the question, and keeps search selectable", async () => {
    api();
    await render(<ChatClient freeChat={["Groq"]} />);
    const menu = modelMenu();
    expect(menu?.value).toBe("free");
    expect(Array.from(menu!.options).map((o) => o.textContent)).toEqual(["Everloot (free)", "Everloot search", "Assistant setup…"]);
    expect(text()).toContain("a free AI model");
    expect(text()).toMatch(/limited number a day/);
    expect(text()).toContain("Your question and this chat go to Groq");
    expect(text()).not.toContain("Everloot search is ready");
  });

  test("with two free providers the banner names both", async () => {
    api();
    await render(<ChatClient freeChat={["Groq", "Cloudflare"]} />);
    expect(text()).toContain("a free AI model on Groq or Cloudflare");
    expect(text()).toContain("Your question and this chat go to whichever of Groq or Cloudflare answers");
  });

  test("Send runs the model through the proxy with the free tools only, and shows its answer", async () => {
    api();
    await render(<ChatClient freeChat={["Groq"]} />);
    await send("Where does Linen Cloth drop?");
    const proxied = calls.filter((c) => c.url === FREE);
    expect(proxied).toHaveLength(2);
    const body = JSON.parse(String(proxied[0].init!.body)) as { tools: { function: { name: string } }[] };
    expect(body.tools.map((t) => t.function.name)).toEqual([...FREE_TOOLS]);
    expect(calls.filter((c) => c.url.startsWith("/schema/mcp/"))).toHaveLength(FREE_TOOLS.length);
    expect(calls.some((c) => c.url.startsWith("/api/tools/get_by_name"))).toBe(true);
    expect(text()).toContain("Humanoids drop it.");
  });

  test("at the limit the reply is Everloot search, with one line saying so", async () => {
    api("limit");
    await render(<ChatClient freeChat={["Groq"]} />);
    await send("Where does Linen Cloth drop?");
    expect(text()).toContain(FREE_FALLBACK);
    expect(text()).toContain("Dropped by humanoids.");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  test("choosing Everloot search sends no question to the model", async () => {
    api();
    await render(<ChatClient freeChat={["Groq"]} />);
    await act(async () => setValue(modelMenu()!, "search"));
    expect(text()).toContain("Everloot search is ready");
    await send("Where does Linen Cloth drop?");
    expect(calls.some((c) => c.url === FREE)).toBe(false);
    expect(calls.some((c) => c.url.startsWith("/api/tools/answer_sources"))).toBe(true);
  });

  test("a key the player added takes precedence over the free model", async () => {
    api();
    sessionStorage.setItem(PROVIDERS, JSON.stringify([{ kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: KEY }]));
    await render(<ChatClient freeChat={["Groq"]} />);
    await send("Where does Linen Cloth drop?");
    expect(calls.some((c) => c.url === FREE)).toBe(false);
    expect(text()).toContain("Own key answer.");
  });

  test("while the free model is off, the page is as before: search, no mode menu, no proxy", async () => {
    api();
    await render(<ChatClient />);
    expect(modelMenu()).toBeNull();
    expect(text()).toContain("Everloot search is ready");
    await send("Where does Linen Cloth drop?");
    expect(calls.some((c) => c.url === FREE)).toBe(false);
  });
});
