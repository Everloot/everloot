import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { answer, readProviderEntries, sourcesIn } from "../src/main/agent";
import { FIXTURE_ANSWER, FIXTURE_STRUCTURED, FIXTURE_URL } from "../../web/src/lib/chat/market-fixture";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-agent-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const HIT = "[item] Thunderfury bindings\nDrops from Baron Geddon, 3 of 41 kills.\nSource: Everloot uploads (CC BY-SA 4.0)\n\n[npc] Baron Geddon\nMolten Core.\nSource: Warcraft Wiki 2023 dump (CC BY-SA 4.0)\n";
const fakeSession = (calls: { name: string; args: unknown }[], reply = HIT) =>
  (async (_t: unknown, run: (c: unknown) => Promise<unknown>) => run({
    callTool: async (c: { name: string; arguments: unknown }) => { calls.push({ name: c.name, args: c.arguments }); return { content: [{ type: "text", text: reply }] }; },
    listTools: async () => ({ tools: [{ name: "search_knowledge", description: "search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }] }),
  })) as never;

test("sources are the distinct Source lines in order", () => {
  expect(sourcesIn(HIT)).toEqual(["Everloot uploads (CC BY-SA 4.0)", "Warcraft Wiki 2023 dump (CC BY-SA 4.0)"]);
  expect(sourcesIn("nothing")).toEqual([]);
});

test("config entries come without keys, and an inline key is refused", () => {
  const d = dir();
  const p = join(d, "config.json");
  expect(readProviderEntries(p)).toEqual([]);
  writeFileSync(p, JSON.stringify({ providers: [{ type: "anthropic", apiKeyFile: "k.txt", model: "m" }, { type: "openai-compatible", baseUrl: "http://x", model: "y" }, { nope: 1 }] }));
  expect(readProviderEntries(p)).toEqual([{ type: "anthropic", model: "m", apiKeyFile: "k.txt" }, { type: "openai-compatible", model: "y", baseUrl: "http://x" }]);
  writeFileSync(p, JSON.stringify({ providers: [{ type: "anthropic", apiKey: "sk-no" }] }));
  expect(() => readProviderEntries(p)).toThrow(/apiKeyFile/);
});

test("with no provider the answer is the sourced hits themselves; no source means no answer", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const r = await answer({ mcp: { url: "https://everloot.app/mcp/public", token: null }, entries: [], history: [], question: "what drops bindings", session: fakeSession(calls) });
  expect(calls).toEqual([{ name: "search_knowledge", args: { query: "what drops bindings", limit: 3 } }]);
  expect(r.model).toBeNull();
  expect(r.sources).toHaveLength(2);
  expect(r.text).toContain("Baron Geddon");
  const none = await answer({ mcp: { url: "u", token: null }, entries: [], history: [], question: "q", session: fakeSession([], "nothing here") });
  expect(none.text).toMatch(/No sourced answer/);
  expect(none.sources).toEqual([]);
});

test("an OpenAI-compatible provider runs the same tool loop in that API's shape", async () => {
  const d = dir();
  writeFileSync(join(d, "k.txt"), "sk-or-test\n");
  const calls: { name: string; args: unknown }[] = [];
  const requests: { url: string; headers: Record<string, string>; body: { model: string; messages: { role: string; tool_call_id?: string }[]; tools: { type: string; function: { name: string } }[] } }[] = [];
  const send = vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body);
    requests.push({ url, headers: init.headers, body });
    const reply = requests.length === 1
      ? { model: "deepseek/deepseek-v4.1-flash", choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_knowledge", arguments: "{\"query\":\"bindings\"}" } }] } }] }
      : { model: "deepseek/deepseek-v4.1-flash", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Baron Geddon in Molten Core. Source: Everloot uploads." } }] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  });
  const entry = { type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1/", model: "deepseek/deepseek-v4.1-flash", apiKeyFile: join(d, "k.txt") };
  const r = await answer({ mcp: { url: "u", token: null }, entries: [entry], history: [{ role: "user", text: "hi", at: "", model: null, sources: [], steps: [] }], question: "bindings?", session: fakeSession(calls), send: send as never });
  expect(requests[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(requests[0].headers.authorization).toBe("Bearer sk-or-test");
  expect(requests[0].body.tools).toEqual([{ type: "function", function: { name: "search_knowledge", description: "search", parameters: { type: "object", properties: { query: { type: "string" } } } } }]);
  expect(requests[0].body.messages.map((m) => m.role)).toEqual(["system", "user", "user"]);
  expect(calls).toEqual([{ name: "search_knowledge", args: { query: "bindings" } }]);
  // The second request carries the assistant's tool call and the tool's result.
  expect(requests[1].body.messages.slice(-2).map((m) => [m.role, m.tool_call_id])).toEqual([["assistant", undefined], ["tool", "c1"]]);
  expect(r).toMatchObject({ model: "deepseek/deepseek-v4.1-flash", text: "Baron Geddon in Molten Core. Source: Everloot uploads." });
  expect(r.steps).toEqual([{ tool: "search_knowledge", input: '{"query":"bindings"}', chars: HIT.length }]);
  expect(r.sources).toHaveLength(2);
});

/** A text/event-stream response whose events are split across reads at awkward places. */
const sse = (events: unknown[]) => {
  const raw = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + ": keep-alive\n\ndata: [DONE]\n\n";
  const bytes = new TextEncoder().encode(raw);
  const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};

test("a streamed OpenAI-compatible answer puts tool calls back together and reports the text as it grows", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const bodies: { stream?: boolean }[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1
      ? sse([
        { model: "qwen3", choices: [{ delta: { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_knowledge", arguments: "" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"query\":" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"bindings\"}" } }] } }] },
      ])
      : sse([
        { model: "qwen3", choices: [{ delta: { content: "Baron Geddon" } }] },
        { choices: [{ delta: { content: " in Molten Core." } }] },
      ]);
  });
  const progress: { text: string; tool: string | null }[] = [];
  const entry = { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" };
  const r = await answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "q", session: fakeSession(calls), send: send as never, onProgress: (p) => progress.push(p) });
  expect(bodies[0].stream).toBe(true);
  expect(calls).toEqual([{ name: "search_knowledge", args: { query: "bindings" } }]);
  expect(progress).toEqual([
    { text: "", tool: "search_knowledge" },
    { text: "Baron Geddon", tool: null },
    { text: "Baron Geddon in Molten Core.", tool: null },
  ]);
  expect(r).toMatchObject({ model: "qwen3", text: "Baron Geddon in Molten Core.", sources: ["Everloot uploads (CC BY-SA 4.0)", "Warcraft Wiki 2023 dump (CC BY-SA 4.0)"] });
});

test("an error inside a stream names the server", async () => {
  const send = vi.fn(async () => sse([{ error: { message: "Rate limit exceeded" } }]));
  const entry = { type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "x" };
  await expect(answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "q", session: fakeSession([]), send: send as never }))
    .rejects.toThrow("https://openrouter.ai/api/v1: Rate limit exceeded");
});

test("an OpenAI-compatible error names the server and the message", async () => {
  const send = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 }));
  const entry = { type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "x" };
  await expect(answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "q", session: fakeSession([]), send: send as never }))
    .rejects.toThrow("https://openrouter.ai/api/v1: HTTP 402, Insufficient credits");
});

test("a 200 whose body is an error and no choices is an error, not a blank answer", async () => {
  const send = vi.fn(async () => new Response(JSON.stringify({ error: { message: "No endpoints found that support tool use" } }), { status: 200 }));
  const entry = { type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "x" };
  await expect(answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "q", session: fakeSession([]), send: send as never }))
    .rejects.toThrow("https://openrouter.ai/api/v1: No endpoints found that support tool use");
});

test("tool arguments that are not JSON go back to the model as a tool result; the tool does not run on nothing", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const bodies: { messages: { role: string; content: unknown; tool_call_id?: string }[] }[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    const reply = bodies.length === 1
      ? { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "search_knowledge", arguments: "{\"query\": " } }] } }] }
      : { choices: [{ message: { role: "assistant", content: "Nothing on that." } }] };
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  const entry = { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" };
  const r = await answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "q", session: fakeSession(calls), send: send as never });
  expect(calls).toEqual([]);
  expect(bodies[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1", content: expect.stringMatching(/not valid JSON/) });
  expect(r.text).toBe("Nothing on that.");
});

test("a local tool is offered beside the MCP tools and runs on this computer, its source on the answer", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const bodies: { tools: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    const reply = bodies.length === 1
      ? { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "my_characters", arguments: "{}" } }] } }] }
      : { choices: [{ message: { role: "assistant", content: "You hold 12g on Volvik." } }] };
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  const local = [{ name: "my_characters", description: "the player's characters", inputSchema: { type: "object", properties: {} }, run: () => "Volvik-Nightslayer: 12g 0s\nSource: this computer" }];
  const entry = { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" };
  const r = await answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "my gold?", session: fakeSession(calls), send: send as never, local });
  expect(bodies[0].tools.map((t) => t.function.name)).toEqual(["my_characters", "search_knowledge"]);
  expect(calls).toEqual([]);
  expect(bodies[1].messages.at(-1)).toMatchObject({ role: "tool", content: "Volvik-Nightslayer: 12g 0s\nSource: this computer" });
  expect(r).toMatchObject({ text: "You hold 12g on Volvik.", sources: ["this computer"], steps: [{ tool: "my_characters", input: "{}", chars: 48 }] });
});

test("with Anthropic the model calls the MCP tools itself and the steps and sources are recorded", async () => {
  const d = dir();
  writeFileSync(join(d, "k.txt"), "sk-test\n");
  const calls: { name: string; args: unknown }[] = [];
  let turn = 0;
  const reply = (req: { tools: { name: string }[]; messages: unknown[] }) => {
    expect(req.tools.map((t) => t.name)).toEqual(["search_knowledge"]);
    turn++;
    if (turn === 1) return { model: "claude-sonnet-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "search_knowledge", input: { query: "bindings" } }] };
    expect(req.messages).toHaveLength(3);
    return { model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Baron Geddon in Molten Core. Source: Everloot uploads." }] };
  };
  // A stand-in for the SDK's message stream: the final text arrives in two deltas.
  const client = { messages: { stream: vi.fn((req: { tools: { name: string }[]; messages: unknown[] }) => {
    const res = reply(req);
    let onText: (delta: string) => void = () => {};
    return {
      on(_event: "text", fn: (delta: string) => void) { onText = fn; return this; },
      async finalMessage() {
        const text = (res.content.find((b) => b.type === "text") as { text?: string } | undefined)?.text ?? "";
        if (text) { onText(text.slice(0, 12)); onText(text.slice(12)); }
        return res;
      },
    };
  }) } };
  const progress: { text: string; tool: string | null }[] = [];
  const r = await answer({ mcp: { url: "u", token: null }, entries: [{ type: "anthropic", apiKeyFile: join(d, "k.txt") }], history: [], question: "bindings?", session: fakeSession(calls), anthropicClient: client as never, onProgress: (p) => progress.push(p) });
  expect(progress).toEqual([
    { text: "", tool: "search_knowledge" },
    { text: "Baron Geddon", tool: null },
    { text: "Baron Geddon in Molten Core. Source: Everloot uploads.", tool: null },
  ]);
  expect(calls).toEqual([{ name: "search_knowledge", args: { query: "bindings" } }]);
  expect(r.model).toBe("claude-sonnet-5-5");
  expect(r.steps).toEqual([{ tool: "search_knowledge", input: '{"query":"bindings"}', chars: HIT.length }]);
  expect(r.sources).toHaveLength(2);
  expect(r.text).toContain("Baron Geddon");
});

test("Stop ends an OpenAI-compatible stream mid-answer and keeps the text that had arrived", async () => {
  const stop = new AbortController();
  let request: AbortSignal | undefined;
  // One delta, then the server keeps the stream open until the request is aborted.
  const send = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
    request = init.signal;
    const first = new TextEncoder().encode(`data: ${JSON.stringify({ model: "qwen3", choices: [{ delta: { content: "Baron Geddon" } }] })}\n\n`);
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(first); init.signal.addEventListener("abort", () => c.error(init.signal.reason)); } });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  const entry = { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" };
  const r = await answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "q", session: fakeSession([]), send: send as never, signal: stop.signal, onProgress: () => stop.abort() });
  expect(request?.aborted).toBe(true);
  expect(r).toEqual({ text: "Baron Geddon", model: "qwen3", sources: [], steps: [], stopped: true });
});

test("Stop during a tool call ends the loop: the model is not asked again", async () => {
  const stop = new AbortController();
  const send = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Looking.", tool_calls: [{ id: "c1", type: "function", function: { name: "my_characters", arguments: "{}" } }] } }] }), { status: 200 }));
  const local = [{ name: "my_characters", description: "", inputSchema: { type: "object", properties: {} }, run: () => { stop.abort(); return "Volvik: 12g"; } }];
  const entry = { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" };
  const r = await answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "q", session: fakeSession([]), send: send as never, local, signal: stop.signal });
  expect(send).toHaveBeenCalledTimes(1);
  expect(r).toMatchObject({ stopped: true, steps: [] });
});

test("Stop aborts the Anthropic stream mid-answer and keeps the text that had arrived", async () => {
  const d = dir();
  writeFileSync(join(d, "k.txt"), "sk-test\n");
  const stop = new AbortController();
  let passed: AbortSignal | undefined;
  // A stand-in for the SDK's message stream: one delta, then it rejects when its signal aborts, as the SDK does.
  const client = { messages: { stream: vi.fn((_req: unknown, opts: { signal?: AbortSignal }) => {
    passed = opts.signal;
    let onText: (delta: string) => void = () => {};
    return {
      on(_event: "text", fn: (delta: string) => void) { onText = fn; return this; },
      finalMessage: () => new Promise((_res, rej) => { opts.signal?.addEventListener("abort", () => rej(new Error("Request was aborted."))); onText("Baron Geddon"); }),
    };
  }) } };
  const r = await answer({ mcp: { url: "u", token: null }, entries: [{ type: "anthropic", apiKeyFile: join(d, "k.txt"), model: "claude-sonnet-5-5" }], history: [], question: "q", session: fakeSession([]), anthropicClient: client as never, signal: stop.signal, onProgress: () => stop.abort() });
  expect(passed).toBe(stop.signal);
  expect(r).toEqual({ text: "Baron Geddon", model: "claude-sonnet-5-5", sources: [], steps: [], stopped: true });
});

test("an empty stopped answer in the history is not sent to the model", async () => {
  const bodies: { messages: { role: string; content: unknown }[] }[] = [];
  const send = vi.fn(async (_url: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200 }); });
  const entry = { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" };
  const history = [{ role: "user" as const, text: "first", at: "", model: null, sources: [], steps: [] }, { role: "assistant" as const, text: "", at: "", model: null, sources: [], steps: [], stopped: true }];
  await answer({ mcp: { url: "u", token: null }, entries: [entry], history, question: "again", session: fakeSession([]), send: send as never });
  expect(bodies[0].messages.map((m) => m.content)).toEqual([expect.any(String), "first", "again"]);
});

/** An MCP stand-in that answers market_value with its structured result and records every call. */
const marketSession = (calls: { name: string; args: unknown }[], structured: unknown = FIXTURE_STRUCTURED) =>
  (async (_t: unknown, run: (c: unknown) => Promise<unknown>) => run({
    callTool: async (c: { name: string; arguments: unknown }) => { calls.push({ name: c.name, args: c.arguments }); return { content: [{ type: "text", text: "long tool text" }], structuredContent: structured }; },
    listTools: async () => ({ tools: [] }),
  })) as never;
const LINEN = [{ type: "item", id: 2589, label: "Linen Cloth", href: "/database/items/2589", quality: 1 }];
const site = (urls: string[]) => vi.fn(async (url: string) => { urls.push(url); return Response.json({ results: LINEN }); }) as never;

test("a price question is answered from market_value with no provider and no knowledge search", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const urls: string[] = [];
  const r = await answer({ mcp: { url: "https://everloot.app/mcp/public", token: null }, entries: [], history: [], question: "What is the price of Linen Cloth on Forever?", session: marketSession(calls), send: site(urls), site: "https://everloot.app" });
  expect(r).toEqual({ text: FIXTURE_ANSWER, model: null, sources: [FIXTURE_URL], steps: [{ tool: "market_value", input: JSON.stringify({ realm: "Forever", itemId: 2589 }), chars: FIXTURE_ANSWER.length }] });
  expect(calls).toEqual([{ name: "market_value", args: { realm: "Forever", itemId: 2589 } }]);
  expect(urls).toEqual(["https://everloot.app/search/suggest?q=Linen+Cloth&in=item"]);
});

test("with a provider the price is still the market's: no model request, no my_ tool, no tool list", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const send = vi.fn(async () => new Response("{}", { status: 500 }));
  const mine = { name: "my_characters", description: "d", inputSchema: {}, run: vi.fn(() => "gold") };
  const entry = { type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "m" };
  const r = await answer({ mcp: { url: "u", token: null }, entries: [entry], history: [], question: "price 2589 on Forever", session: marketSession(calls), send: send as never, local: [mine] });
  expect(r.text.startsWith("Item 2589 on Forever, all houses: market 3s 10c")).toBe(true);
  expect(r.model).toBeNull();
  expect(send).not.toHaveBeenCalled();
  expect(mine.run).not.toHaveBeenCalled();
  expect(calls.map((c) => c.name)).toEqual(["market_value"]);
});

test("without a realm it asks, listing the followed realms but choosing none, and opens no connection", async () => {
  const session = vi.fn(async () => { throw new Error("no connection should open"); });
  const r = await answer({ mcp: { url: "u", token: null }, entries: [], history: [], question: "price 2589", session: session as never, realms: ["Forever", "Nightslayer"] });
  expect(r.text).toMatch(/^Which realm\?/);
  expect(r.text).toContain("Realms you follow: Forever, Nightslayer.");
  expect(r.sources).toEqual([]);
  expect(r.steps).toEqual([]);
  expect(session).not.toHaveBeenCalled();
});

test("an unreadable market is said, not searched around or guessed", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const r = await answer({ mcp: { url: "u", token: null }, entries: [], history: [], question: "price 2589 on Forever", session: marketSession(calls, { connected: false, dataAsOf: null, reason: "x" }) });
  expect(r.text).toMatch(/unrecorded, not zero/);
  expect(calls.map((c) => c.name)).toEqual(["market_value"]);
});

test("a stop during the price lookup ends the answer", async () => {
  const stop = new AbortController();
  stop.abort();
  await expect(answer({ mcp: { url: "u", token: null }, entries: [], history: [], question: "price 2589 on Forever", session: marketSession([]), signal: stop.signal })).rejects.toThrow();
});
