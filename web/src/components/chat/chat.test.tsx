// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AccountShell } from "@/lib/account-shell-types";
import ChatClient, { SUGGESTIONS } from "./ChatClient";
import ChatKeys from "./ChatKeys";
import { AssistantMessage } from "./Message";

const ME = "11111111-2222-4333-8444-555555555555";
const MAGE = "33333333-4444-4555-8666-777777777777";
const KEY = "sk-or-v1-secretsecretsecretsecret1234";
const PROVIDERS = "everloot.chat.providers.v1";
const HIT = "[item] Linen Cloth\nDropped by humanoids.\nMore: https://everloot.app/database/item/2589\nSource: https://warcraft.wiki.gg/wiki/Linen_Cloth (CC-BY-SA-4.0, retrieved 2023-11-13)\n";

const shell: AccountShell = {
  userId: ME, name: "Jaina#1234", handle: "jaina", displayName: "Jaina", status: null, publicProfile: false,
  characters: [{ id: MAGE, name: "Jaina", classSlug: "mage", realm: null }], mainCharacterId: MAGE, activeCharacterId: MAGE,
};

function sse(events: unknown[]): Response {
  const raw = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new TextEncoder().encode(raw), { status: 200, headers: { "content-type": "text/event-stream" } });
}

type Call = { url: string; init?: RequestInit };
/** OpenRouter's public model list: two of the catalogue's, one new cheap model, and one too dear to list. */
const ROUTER_MODELS = [
  { id: "deepseek/deepseek-v4.1-flash", pricing: { prompt: "0.00000003", completion: "0.0000004" }, supported_parameters: ["tools"] },
  { id: "qwen/qwen3.7-flash", pricing: { prompt: "0.00000003", completion: "0.00000013" }, supported_parameters: ["tools"] },
  { id: "newlab/cheap-1", name: "NewLab: Cheap 1", pricing: { prompt: "0.0000001", completion: "0.0000002" }, supported_parameters: ["tools"] },
  { id: "dear/model", name: "Dear", pricing: { prompt: "0.00001", completion: "0.00003" }, supported_parameters: ["tools"] },
];
/** The requests other than OpenRouter's public model list, which carries no key. */
const beyondList = () => calls.filter((c) => !c.url.startsWith("https://openrouter.ai/api/v1/models"));
let calls: Call[];
let modelTurns: number;

/** This site and OpenRouter, mocked. The model looks Linen Cloth up once, then answers. */
function api({ signed = true }: { signed?: boolean } = {}) {
  calls = [];
  modelTurns = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/auth/me") return Response.json({ user: signed ? { id: ME, name: "Jaina#1234" } : null });
    if (url === "/api/me/shell") return signed ? Response.json(shell) : Response.json({ error: "Sign in first." }, { status: 401 });
    if (url.startsWith("/schema/mcp/")) return Response.json({ title: "T", inputSchema: { type: "object", properties: {} } });
    if (url.startsWith("/api/tools/")) return Response.json({ text: HIT });
    if (url === "https://openrouter.ai/api/v1/key") return Response.json({ data: {} });
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: ROUTER_MODELS });
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      return modelTurns++ === 0
        ? sse([{ model: "deepseek/deepseek-v4.1-flash", choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "get_by_name", arguments: "{\"name\":\"Linen Cloth\"}" } }] } }] }])
        : sse([{ choices: [{ delta: { content: "Humanoids drop it." } }] }]);
    }
    throw new Error(`Unexpected request ${url}`);
  }));
}

/** Every request that carries the key anywhere (URL, headers or body) goes to the provider, never to Everloot. */
function keyOnlyToProvider() {
  const carrying = calls.filter((c) => `${c.url} ${JSON.stringify(c.init?.headers ?? {})} ${String(c.init?.body ?? "")}`.includes(KEY));
  for (const c of carrying) expect(new URL(c.url).host).toBe("openrouter.ai");
  for (const c of calls.filter((c) => c.url.startsWith("/"))) expect(JSON.stringify(c)).not.toContain(KEY);
  return carrying.length;
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

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (ui: ReactNode) => { await act(async () => root.render(ui)); await settle(); };
const text = () => container.textContent ?? "";
const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => (el as HTMLElement).click()); await settle(); };
const textarea = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your question"]')!;
const saveKey = () => localStorage.setItem(PROVIDERS, JSON.stringify([{ kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: KEY }]));

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("the chat page", () => {
  test("moves old browser-wide credentials into this tab before using them", async () => {
    api();
    saveKey();
    await render(<ChatClient />);
    expect(localStorage.getItem(PROVIDERS)).toBeNull();
    expect(sessionStorage.getItem(PROVIDERS)).toContain(KEY);
    expect(text()).toContain("Keys last only in this tab. Closing it forgets them.");
  });
  test("no key, signed in: search is ready, optional Assistant setup links to /account, the account label and four suggestions", async () => {
    api();
    await render(<ChatClient profiles />);
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    const setup = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Assistant setup");
    expect(setup?.getAttribute("href")).toBe("/account#chat-keys");
    // Search is presented as working and the model as optional, with its cost the player's own account.
    expect(text()).toContain("Everloot search is ready");
    expect(text()).toContain("optional AI model");
    expect(text()).not.toContain("Finish your key setup");
    expect(text()).toContain("Game data through your Everloot account");
    expect(container.querySelector('select[aria-label="Model"]')).toBeNull();
    for (const s of SUGGESTIONS) expect(button(s)).toBeTruthy();
    expect(SUGGESTIONS).toHaveLength(4);
  });

  test("signed out: setup goes through sign-in, and lookups say they use the public limits", async () => {
    api({ signed: false });
    await render(<ChatClient profiles />);
    const setup = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Assistant setup");
    expect(setup?.getAttribute("href")).toBe("/sign-in?returnTo=%2Faccount%23chat-keys");
    expect(text()).toContain("Signed out: lookups use the public limits");
    expect(text()).not.toContain("Game data through your Everloot account");
  });

  test("with profiles off, setup still links to /account, and the page has no key field of its own", async () => {
    api();
    await render(<ChatClient />);
    const setup = Array.from(container.querySelectorAll("a")).find((a) => a.textContent === "Assistant setup");
    expect(setup?.getAttribute("href")).toBe("/account#chat-keys");
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector('input[name="key"]')).toBeNull();
  });

  test("?q= without a key waits in the box with the character as a chip, and nothing is sent", async () => {
    api();
    window.history.replaceState(null, "", `/chat?q=${encodeURIComponent("Best spec?")}&character=${MAGE}`);
    await render(<ChatClient profiles />);
    expect(textarea().value).toBe("Best spec?");
    expect(text()).toContain("Jaina · Mage");
    expect(calls.some((c) => c.url.startsWith("https://") || c.url.startsWith("/api/tools/"))).toBe(false);
    expect(window.location.search).toBe("");
  });

  test("?q= with a key sends at once with the character's context; the answer is labelled From Everloot; the key goes only to the provider", async () => {
    api();
    saveKey();
    window.history.replaceState(null, "", `/chat?q=${encodeURIComponent("Where does Linen Cloth drop?")}&character=${MAGE}`);
    await render(<ChatClient profiles />);
    const turns = calls.filter((c) => c.url === "https://openrouter.ai/api/v1/chat/completions");
    expect(turns).toHaveLength(2);
    const first = JSON.parse(String(turns[0].init!.body)) as { messages: { role: string; content: string }[] };
    expect(first.messages[0].content).toContain("Everloot's data comes first");
    expect(first.messages.at(-1)!.content).toBe("Where does Linen Cloth drop?\n\nI'm playing Jaina, a Mage.");
    expect(calls.map((c) => c.url)).toContain("/api/tools/get_by_name?name=Linen+Cloth");
    expect(text()).toContain("Humanoids drop it.");
    expect(text()).toContain("From Everloot");
    expect(container.querySelector('a[href="https://everloot.app/database/item/2589"]')?.textContent).toBe("/database/item/2589");
    expect(text()).not.toContain("CC-BY-SA");
    expect(container.querySelector('select[aria-label="Model"]')).not.toBeNull();
    expect(keyOnlyToProvider()).toBe(2);
    expect(textarea().value).toBe("");
  });

  test("conversations: listed in the rail, a new chat starts empty, an old one reopens, and delete removes it", async () => {
    api();
    saveKey();
    await render(<ChatClient profiles />);
    await act(async () => setValue(textarea(), "Where does Linen Cloth drop?"));
    await act(async () => textarea().form!.requestSubmit());
    await settle();
    expect(text()).toContain("Humanoids drop it.");
    keyOnlyToProvider();

    await click(button("Chats"));
    const rail = () => container.querySelector('nav[aria-label="Conversations"]')!;
    expect(rail()).not.toBeNull();
    expect(Array.from(rail().querySelectorAll("li button")).map((b) => b.textContent)).toContain("Where does Linen Cloth drop?");

    await click(Array.from(rail().querySelectorAll("button")).find((b) => b.textContent === "New chat"));
    expect(text()).toContain("What do you want to know about WoW: Forever?");
    expect(text()).not.toContain("Humanoids drop it.");

    await click(Array.from(rail().querySelectorAll("li button")).find((b) => b.textContent === "Where does Linen Cloth drop?"));
    expect(text()).toContain("Humanoids drop it.");

    await click(button("Delete Where does Linen Cloth drop?"));
    expect(rail().querySelectorAll("li")).toHaveLength(0);
    expect(localStorage.getItem("everloot.chat.conversations.v1")).toBeNull();
  });

  test("without a key, Send shows Everloot's search results, labelled and without the raw Source lines", async () => {
    api({ signed: false });
    await render(<ChatClient profiles />);
    await click(button("Where does Linen Cloth drop?"));
    expect(calls.map((c) => c.url)).toContain("/api/tools/search_knowledge?query=Where+does+Linen+Cloth+drop%3F&limit=3");
    expect(text()).toContain("Dropped by humanoids.");
    expect(text()).toContain("From Everloot");
    expect(text()).toContain("Everloot search");
    expect(text()).not.toMatch(/Source: |More: /);
  });

  test("an answer the tools did not back is labelled From the model", async () => {
    await render(<AssistantMessage m={{ role: "assistant", text: "Tailors make it.", at: "", model: "m", sources: [], pages: [], steps: [] }} copied={false} onCopy={() => {}} />);
    expect(text()).toContain("From the model");
    expect(text()).not.toContain("From Everloot");
  });

  test("Ctrl+Shift+O starts a new chat", async () => {
    api();
    saveKey();
    await render(<ChatClient profiles />);
    await act(async () => setValue(textarea(), "Where does Linen Cloth drop?"));
    await act(async () => textarea().form!.requestSubmit());
    await settle();
    expect(text()).toContain("Humanoids drop it.");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "O", ctrlKey: true, shiftKey: true })); });
    await settle();
    expect(text()).toContain("What do you want to know about WoW: Forever?");
  });
});

describe("the Chat keys section", () => {
  const card = (name: string) => Array.from(container.querySelectorAll("section")).find((s) => s.querySelector("h3")?.textContent?.startsWith(name))!;
  const inCard = (name: string, label: string) =>
    Array.from(card(name).querySelectorAll("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
  const saved = () => JSON.parse(sessionStorage.getItem(PROVIDERS) ?? "null");

  test("one card per provider Chat supports, each with its status, a link to get a key, and no dropdown of providers", async () => {
    api();
    await render(<ChatKeys />);
    const cards = container.querySelectorAll('ul[aria-label="Chat providers"] > li > section');
    expect(Array.from(cards).map((c) => c.querySelector("h3")?.textContent)).toEqual(["OpenRouter", "Anthropic", "Ollama"]);
    expect(card("OpenRouter").textContent).toContain("Not set");
    expect(card("Ollama").textContent).toContain("Not set up");
    expect(card("OpenRouter").querySelector("a")?.getAttribute("href")).toBe("https://openrouter.ai/keys");
    expect(card("Anthropic").querySelector("a")?.getAttribute("href")).toBe("https://console.anthropic.com/settings/keys");
    expect(card("OpenRouter").querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
    // The keys stay in the browser, said once.
    expect(text().match(/Everloot's servers never receive them/g)).toHaveLength(1);
    expect(text()).not.toContain("Default provider for Chat");
    expect(container.querySelectorAll("select")).toHaveLength(0);
    // Optional AI: search is free, the model's cost is the provider account's, and a consumer subscription is no key.
    expect(text()).toContain("Everloot search is free");
    expect(text()).toContain("pricing and limits apply");
    expect(text()).toContain("not an API key");
    expect(text()).toContain("Desktop App needs its own setup");
  });

  test("a key is added in its card, kept in this tab only, shown masked, tested with its provider alone and removable", async () => {
    api();
    await render(<ChatKeys />);
    await click(inCard("OpenRouter", "Add OpenRouter key"));
    const key = card("OpenRouter").querySelector<HTMLInputElement>('input[name="key"]')!;
    expect(key.type).toBe("password");
    expect(document.activeElement).toBe(key);
    expect(document.getElementById(key.getAttribute("aria-describedby")!)?.textContent).toContain("openrouter.ai/keys");
    key.value = KEY;
    await act(async () => key.form!.requestSubmit());
    await settle();
    // Saving sends the key nowhere; the card reads OpenRouter's public model list, without it.
    expect(beyondList()).toHaveLength(0);
    expect(keyOnlyToProvider()).toBe(0);
    expect(saved()).toEqual([{ kind: "openrouter", model: "deepseek/deepseek-v4.1-flash", key: KEY }]);
    expect(container.innerHTML).not.toContain(KEY);
    expect(card("OpenRouter").textContent).toContain("Set, ending ••••1234");
    expect(card("OpenRouter").textContent).toContain("Default");
    expect(text()).toContain("OpenRouter saved in this tab.");

    await click(inCard("OpenRouter", "Test OpenRouter"));
    expect(beyondList().map((c) => c.url)).toEqual(["https://openrouter.ai/api/v1/key"]);
    expect(keyOnlyToProvider()).toBe(1);
    expect(text()).toContain("OpenRouter accepted the key.");
    expect(saved()[0].check.ok).toBe(true);

    // The model is chosen inside the card, from what OpenRouter serves now at today's price.
    const model = card("OpenRouter").querySelector<HTMLSelectElement>('select[aria-label="OpenRouter model"]')!;
    expect(Array.from(model.options).map((o) => o.textContent)).toEqual([
      "DeepSeek V4.1 Flash · $0.03 / $0.40", "Qwen 3.7 Flash · $0.03 / $0.13", "NewLab: Cheap 1 · $0.10 / $0.20", "Another model id…",
    ]);
    await act(async () => setValue(model, "qwen/qwen3.7-flash"));
    expect(saved()[0].model).toBe("qwen/qwen3.7-flash");

    await click(inCard("OpenRouter", "Remove OpenRouter"));
    expect(localStorage.getItem(PROVIDERS)).toBeNull();
    expect(card("OpenRouter").textContent).toContain("Not set");
  });

  test("a key that fails its test says Invalid last time, until a new key replaces it", async () => {
    api();
    saveKey();
    const ok = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) =>
      String(input) === "https://openrouter.ai/api/v1/key" ? Response.json({ error: { message: "No auth credentials found" } }, { status: 401 }) : ok(input, init)));
    await render(<ChatKeys />);
    await click(inCard("OpenRouter", "Test OpenRouter"));
    expect(card("OpenRouter").textContent).toContain("Invalid last time");
    expect(saved()[0].check.ok).toBe(false);
    await click(inCard("OpenRouter", "Replace OpenRouter key"));
    const key = card("OpenRouter").querySelector<HTMLInputElement>('input[name="key"]')!;
    key.value = "sk-or-v1-anotheranotheranother5678";
    await act(async () => key.form!.requestSubmit());
    await settle();
    expect(card("OpenRouter").textContent).toContain("ending ••••5678");
    expect(card("OpenRouter").textContent).not.toContain("Invalid last time");
    expect(saved()[0]).not.toHaveProperty("check");
  });

  test("a second provider does not take over Chat; the default is a separate, explicit choice", async () => {
    api();
    saveKey();
    await render(<ChatKeys />);
    await click(inCard("Anthropic", "Add Anthropic key"));
    const key = card("Anthropic").querySelector<HTMLInputElement>('input[name="key"]')!;
    key.value = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    await act(async () => key.form!.requestSubmit());
    await settle();
    expect(saved().map((p: { kind: string }) => p.kind)).toEqual(["openrouter", "anthropic"]);
    const group = Array.from(container.querySelectorAll("fieldset")).find((f) => f.querySelector("legend")?.textContent === "Default provider for Chat")!;
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    await click(radios[1]);
    expect(saved()[0].kind).toBe("anthropic");
    expect(card("Anthropic").textContent).toContain("Default");
    expect(text()).toContain("Chat now uses Anthropic");
  });

  test("a bad paste is refused and nothing is stored", async () => {
    api();
    await render(<ChatKeys />);
    await click(inCard("OpenRouter", "Add OpenRouter key"));
    const key = card("OpenRouter").querySelector<HTMLInputElement>('input[name="key"]')!;
    key.value = "hunter2";
    await act(async () => key.form!.requestSubmit());
    expect(text()).toContain("That does not look like the right key");
    expect(localStorage.getItem(PROVIDERS)).toBeNull();
    expect(beyondList()).toHaveLength(0);
  });

  test("Ollama needs no key: Set up offers the small recommended model first", async () => {
    api();
    await render(<ChatKeys />);
    await click(inCard("Ollama", "Set up Ollama"));
    expect(card("Ollama").querySelector('input[name="key"]')).toBeNull();
    const picker = card("Ollama").querySelector<HTMLSelectElement>('select[name="model"]')!;
    expect(picker.value).toBe("qwen3:4b");
    await act(async () => picker.form!.requestSubmit());
    await settle();
    expect(saved()).toEqual([{ kind: "ollama", model: "qwen3:4b", key: "" }]);
    expect(card("Ollama").textContent).toContain("Set up, no key needed");
  });

  test("Ollama: Another model id takes any model the player pulled", async () => {
    api();
    await render(<ChatKeys />);
    await click(inCard("Ollama", "Set up Ollama"));
    const picker = card("Ollama").querySelector<HTMLSelectElement>('select[name="model"]')!;
    await act(async () => { picker.value = picker.options[picker.options.length - 1].value; picker.dispatchEvent(new Event("change", { bubbles: true })); });
    const model = card("Ollama").querySelector<HTMLInputElement>('input[name="modelText"]')!;
    model.value = "qwen3:8b";
    await act(async () => model.form!.requestSubmit());
    await settle();
    expect(saved()).toEqual([{ kind: "ollama", model: "qwen3:8b", key: "" }]);
  });
});
