import { describe, expect, test, vi } from "vitest";
import { MY_BUILDS_LINE, MY_BUILDS_REFUSAL } from "../saved-builds";
import {
  ACCOUNT_TOOL, answer, answerOrigin, callTool, CHAT_TOOLS, loadTools, MODEL_STOPPED, NO_SOURCED_ANSWER, pagesIn, readOpenAiStream, searchOnly, signedIn,
  SMALL_TALK_REPLY, smallTalk, sourceLink, sourcesIn, SYSTEM, testKey, TOOL_POLICY, UNSOURCED, type ToolDef,
} from "./agent";
import { chatProvider } from "./providers";

const HIT = "[lore_page/lore] Leeroy Jenkins\nLeeroy Jenkins is a valiant human paladin.\nSource: https://warcraft.wiki.gg/wiki/Leeroy_Jenkins (CC-BY-SA-4.0, retrieved 2023-11-13)\n";

/** A text/event-stream body split across reads at awkward places. */
function sse(events: unknown[], named = false): Response {
  const raw = events.map((e) => `${named ? `event: ${(e as { type: string }).type}\n` : ""}data: ${JSON.stringify(e)}\n\n`).join("") + ": keep-alive\n\ndata: [DONE]\n\n";
  const bytes = new TextEncoder().encode(raw);
  const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** This site's /api/tools endpoint, answering every lookup with HIT. */
function site(calls: string[]) {
  return vi.fn(async (url: string) => { calls.push(url); return new Response(JSON.stringify({ text: HIT }), { status: 200 }); }) as unknown as typeof fetch;
}

const TOOLS: ToolDef[] = [{ name: "search_knowledge", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }];

test("sources are the distinct Source lines in order", () => {
  expect(sourcesIn(HIT + HIT)).toEqual(["https://warcraft.wiki.gg/wiki/Leeroy_Jenkins (CC-BY-SA-4.0, retrieved 2023-11-13)"]);
});

test("tools load from the published schema files without their $schema and $id", async () => {
  const send = vi.fn(async (_url: string) => new Response(JSON.stringify({ title: "T", description: "D", inputSchema: { $schema: "x", $id: "y", type: "object", properties: {} } }), { status: 200 }));
  const tools = await loadTools(send as never);
  expect(tools.map((t) => t.name)).toEqual([...CHAT_TOOLS]);
  expect(send.mock.calls[0][0]).toBe("/schema/mcp/search_knowledge.json");
  expect(tools[0]).toEqual({ name: "search_knowledge", description: "T. D", inputSchema: { type: "object", properties: {} } });
});

test("my_builds is offered only for a signed-in visitor, with its one line and a slug argument", async () => {
  const send = vi.fn(async (_url: string) => new Response(JSON.stringify({ title: "T", inputSchema: { type: "object", properties: {} } }), { status: 200 }));
  expect((await loadTools(send as never)).map((t) => t.name)).toEqual([...CHAT_TOOLS]);
  const tools = await loadTools(send as never, true);
  expect(tools.map((t) => t.name)).toEqual([...CHAT_TOOLS, "my_builds"]);
  expect(tools.at(-1)).toEqual(ACCOUNT_TOOL);
  expect(ACCOUNT_TOOL.description).toBe(MY_BUILDS_LINE);
  expect(ACCOUNT_TOOL.inputSchema).toMatchObject({ properties: { slug: { type: "string", pattern: "^[A-Za-z0-9]{8}$" } } });
  // The schema files are fetched for the public tools only; my_builds has none.
  expect(send.mock.calls.map((c) => c[0])).not.toContain("/schema/mcp/my_builds.json");
});

test("signed in means /api/auth/me names a user; anything else is signed out", async () => {
  const me = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as never;
  expect(await signedIn(me({ user: { id: "u", name: "Thrall#1" } }))).toBe(true);
  expect(await signedIn(me({ user: null }))).toBe(false);
  expect(await signedIn(me({ error: "down" }, 503))).toBe(false);
  expect(await signedIn(vi.fn(async () => { throw new TypeError("offline"); }) as never)).toBe(false);
});

describe("tool calls", () => {
  test("my_builds goes to /api/tools like the others; the site answers the refusal when signed out", async () => {
    const calls: string[] = [];
    expect(await callTool("my_builds", { slug: "AbCd1234" }, site(calls))).toBe(HIT);
    expect(calls).toEqual(["/api/tools/my_builds?slug=AbCd1234"]);
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: MY_BUILDS_REFUSAL }), { status: 401 }));
    expect(await callTool("my_builds", {}, refused as never)).toBe(`Tool error: ${MY_BUILDS_REFUSAL}`);
  });

  test("go to /api/tools with plain arguments in the query string", async () => {
    const calls: string[] = [];
    expect(await callTool("item_page", { itemId: 19019, nested: { no: 1 }, empty: null }, site(calls))).toBe(HIT);
    expect(calls).toEqual(["/api/tools/item_page?itemId=19019"]);
  });
  test("an unknown tool or a failing call comes back as text for the model", async () => {
    expect(await callTool("delete_everything", {}, site([]))).toMatch(/no tool named/);
    const bad = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "itemId must be a number" }), { status: 400 }));
    expect(await callTool("item_page", { itemId: "x" }, bad as never)).toBe("Tool error: itemId must be a number");
  });
});

test("without a key the answer is the search hits, or no sourced answer", async () => {
  const r = await searchOnly("Leeroy Jenkins", site([]));
  expect(r).toMatchObject({ model: null, sources: [expect.stringContaining("Leeroy_Jenkins")] });
  const none = vi.fn(async () => new Response(JSON.stringify({ text: "No results." }), { status: 200 }));
  expect((await searchOnly("whos is leroy jenkins", none as never)).text).toBe(NO_SOURCED_ANSWER);
});

test("OpenRouter: the streamed tool call is rebuilt, run on this site, and the answer streams with its sources", async () => {
  const calls: string[] = [];
  const bodies: { stream?: boolean; tools: unknown[]; messages: { role: string }[] }[] = [];
  const headers: Record<string, string>[] = [];
  const send = vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    bodies.push(JSON.parse(init.body)); headers.push(init.headers);
    return bodies.length === 1
      ? sse([
        { model: "deepseek/deepseek-v4.1-flash", choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_knowledge", arguments: "" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"query\":\"Leeroy" } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: " Jenkins\"}" } }] } }] },
      ])
      : sse([{ choices: [{ delta: { content: "A human paladin" } }] }, { choices: [{ delta: { content: " famous for charging in." } }] }]);
  });
  const progress: unknown[] = [];
  const r = await answer({ provider: chatProvider("openrouter")!, model: "deepseek/deepseek-v4.1-flash", key: "sk-or-v1-test", history: [], question: "whos is leroy jenkins", tools: TOOLS, send: send as never, site: site(calls), onProgress: (p) => progress.push(p) });
  expect(send.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(headers[0].authorization).toBe("Bearer sk-or-v1-test");
  expect(bodies[0].stream).toBe(true);
  expect(calls).toEqual(["/api/tools/search_knowledge?query=Leeroy+Jenkins"]);
  expect(bodies[1].messages.slice(-2).map((m) => m.role)).toEqual(["assistant", "tool"]);
  expect(progress).toEqual([{ text: "", tool: "search_knowledge" }, { text: "A human paladin", tool: null }, { text: "A human paladin famous for charging in.", tool: null }]);
  expect(r).toMatchObject({ text: "A human paladin famous for charging in.", model: "deepseek/deepseek-v4.1-flash", steps: [{ tool: "search_knowledge" }] });
  expect(r.sources).toHaveLength(1);
});

test("Anthropic: the browser header is sent, the tool_use input is pieced together, and the reply streams", async () => {
  const calls: string[] = [];
  const bodies: { messages: { role: string; content: unknown }[] }[] = [];
  const headers: Record<string, string>[] = [];
  const send = vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    bodies.push(JSON.parse(init.body)); headers.push(init.headers);
    return bodies.length === 1
      ? sse([
        { type: "message_start", message: { model: "claude-sonnet-5-5" } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "search_knowledge" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\": \"Leeroy" } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: " Jenkins\"}" } },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
      ], true)
      : sse([
        { type: "message_start", message: { model: "claude-sonnet-5-5" } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "A valiant" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " human paladin." } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
      ], true);
  });
  const r = await answer({ provider: chatProvider("anthropic")!, model: "claude-sonnet-5-5", key: "sk-ant-test", history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }], question: "who is leeroy", tools: TOOLS, send: send as never, site: site(calls) });
  expect(send.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
  expect(headers[0]).toMatchObject({ "x-api-key": "sk-ant-test", "anthropic-dangerous-direct-browser-access": "true" });
  expect(calls).toEqual(["/api/tools/search_knowledge?query=Leeroy+Jenkins"]);
  expect(bodies[1].messages.at(-2)).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "search_knowledge", input: { query: "Leeroy Jenkins" } }] });
  expect(bodies[1].messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: HIT }] });
  expect(r).toMatchObject({ text: "A valiant human paladin.", model: "claude-sonnet-5-5", sources: [expect.stringContaining("Leeroy_Jenkins")] });
});

test("provider errors name the provider and the message, in a body or inside the stream", async () => {
  const http = vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }));
  await expect(answer({ provider: chatProvider("anthropic")!, model: "m", key: "k", history: [], question: "q", tools: TOOLS, send: http as never, site: site([]) }))
    .rejects.toThrow("Anthropic: HTTP 401, invalid x-api-key");
  const inStream = vi.fn(async () => sse([{ error: { message: "Rate limit exceeded" } }]));
  await expect(answer({ provider: chatProvider("openrouter")!, model: "m", key: "k", history: [], question: "q", tools: TOOLS, send: inStream as never, site: site([]) }))
    .rejects.toThrow("openrouter.ai: Rate limit exceeded");
});

test("small talk without a key gets the page's own line and no lookup; a real question still searches", async () => {
  const calls: string[] = [];
  for (const q of ["hi", "Hello!", "thank you", "ok cool", "testing"]) {
    expect(smallTalk(q)).toBe(true);
    expect((await searchOnly(q, site(calls))).text).toBe(SMALL_TALK_REPLY);
  }
  expect(calls).toEqual([]);
  for (const q of ["hi where is Leeroy", "Linen Cloth", "what drops the hi-tech supergun"]) expect(smallTalk(q)).toBe(false);
  await searchOnly("Linen Cloth", site(calls));
  expect(calls).toHaveLength(1);
});

test("a provider that fails after the tools answered gives what they found, not nothing", async () => {
  const calls: string[] = [];
  let turns = 0;
  const send = vi.fn(async () => turns++ === 0
    ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "search_knowledge", arguments: "{\"query\":\"Leeroy\"}" } }] } }] }])
    : new Response(JSON.stringify({ error: { message: "upstream relay failed" } }), { status: 502 }));
  const r = await answer({ provider: chatProvider("openrouter")!, model: "m", key: "k", history: [], question: "who is leeroy", tools: TOOLS, send: send as never, site: site(calls) });
  // The 502 was asked once more before it counted, then the tool output came back as the reply.
  expect(send).toHaveBeenCalledTimes(3);
  expect(r.model).toBeNull();
  expect(r.text).toContain(`${MODEL_STOPPED} (openrouter.ai: HTTP 502, upstream relay failed)`);
  expect(r.text).toContain("Leeroy Jenkins is a valiant human paladin.");
  expect(r).toMatchObject({ steps: [{ tool: "search_knowledge" }], sources: [expect.stringContaining("Leeroy_Jenkins")] });
  expect(answerOrigin(r)).toEqual({ everloot: true, model: false });
});

test("a failure before any lookup is still thrown, and a 5xx is retried once only", async () => {
  const http = vi.fn(async () => new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 }));
  await expect(answer({ provider: chatProvider("openrouter")!, model: "m", key: "k", history: [], question: "q", tools: TOOLS, send: http as never, site: site([]) }))
    .rejects.toThrow("openrouter.ai: HTTP 503, overloaded");
  expect(http).toHaveBeenCalledTimes(2);
  const auth = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
  await expect(answer({ provider: chatProvider("openrouter")!, model: "m", key: "k", history: [], question: "q", tools: TOOLS, send: auth as never, site: site([]) }))
    .rejects.toThrow("HTTP 401");
  expect(auth).toHaveBeenCalledTimes(1);
});

test("an Ollama that cannot be reached says how to let the page in", async () => {
  const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
  await expect(answer({ provider: chatProvider("ollama")!, model: "qwen3", key: "", history: [], question: "q", tools: TOOLS, send: down as never, site: site([]) }))
    .rejects.toThrow(/OLLAMA_ORIGINS=https:\/\/everloot\.app/);
});

test("a stream without indexes treats each tool piece as a whole call", async () => {
  const r = await readOpenAiStream(sse([{ choices: [{ delta: { tool_calls: [{ id: "a", function: { name: "get_entity", arguments: "{\"id\":1}" } }] } }] }, { choices: [{ delta: { tool_calls: [{ id: "b", function: { name: "get_entity", arguments: "{\"id\":2}" } }] } }] }]).body!, () => {});
  expect(r.message.tool_calls?.map((c) => c.function.arguments)).toEqual(["{\"id\":1}", "{\"id\":2}"]);
});

describe("Everloot first", () => {
  test("the tool policy covers every tool once, database, wiki and lore, market, then builds, and the model's own knowledge only after", () => {
    expect(TOOL_POLICY.map((g) => g.label)).toEqual(["the database", "the wiki and lore archive", "the market", "builds and talents"]);
    const listed = TOOL_POLICY.flatMap((g) => g.tools);
    expect([...listed].sort()).toEqual([...CHAT_TOOLS, "my_builds"].sort());
    expect(new Set(listed).size).toBe(listed.length);
    // The prompt names the groups in that order, and the own-knowledge fallback comes after all of them.
    const at = TOOL_POLICY.map((g) => SYSTEM.indexOf(g.label));
    expect(at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1]))).toBe(true);
    expect(SYSTEM.indexOf("your own knowledge")).toBeGreaterThan(at.at(-1)!);
    expect(SYSTEM.indexOf("Everloot's data comes first")).toBeLessThan(at[0]);
    expect(SYSTEM).toContain(UNSOURCED);
  });

  test("an answer's Everloot pages come from the tools' More lines; sources lose their licence note", async () => {
    const page = "[item] Linen Cloth\nDropped by humanoids.\nMore: https://everloot.app/database/item/2589\nSource: https://warcraft.wiki.gg/wiki/Linen_Cloth (CC-BY-SA-4.0, retrieved 2023-11-13)\nMore: https://evil.example/x";
    expect(pagesIn(page + "\n" + page)).toEqual(["https://everloot.app/database/item/2589"]);
    expect(sourceLink("https://warcraft.wiki.gg/wiki/Linen_Cloth (CC-BY-SA-4.0, retrieved 2023-11-13)")).toEqual({ href: "https://warcraft.wiki.gg/wiki/Linen_Cloth", label: "warcraft.wiki.gg/wiki/Linen_Cloth" });
    expect(sourceLink("Everloot observations")).toBeNull();
    const one = vi.fn(async () => new Response(JSON.stringify({ text: page }), { status: 200 }));
    expect((await searchOnly("linen", one as never)).pages).toEqual(["https://everloot.app/database/item/2589"]);
  });

  test("labels: From Everloot when the tools backed it, From the model when it answered alone or said so", () => {
    const base = { text: "Tailors make it.", model: "m", sources: [] as string[], pages: [] as string[] };
    expect(answerOrigin({ ...base, pages: ["https://everloot.app/x"] })).toEqual({ everloot: true, model: false });
    expect(answerOrigin({ ...base, sources: ["https://warcraft.wiki.gg/wiki/X"] })).toEqual({ everloot: true, model: false });
    expect(answerOrigin(base)).toEqual({ everloot: false, model: true });
    expect(answerOrigin({ ...base, pages: ["https://everloot.app/x"], text: `Drops in Elwynn. ${UNSOURCED} it is common.` })).toEqual({ everloot: true, model: true });
    expect(answerOrigin({ ...base, text: NO_SOURCED_ANSWER })).toEqual({ everloot: false, model: false });
    expect(answerOrigin({ ...base, model: null, sources: ["s"] })).toEqual({ everloot: true, model: false });
  });
});

describe("testing a key", () => {
  const ok = (body: unknown = {}) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));

  test("each provider is asked with a free request, straight from the browser", async () => {
    const ant = ok({ data: [] });
    expect(await testKey(chatProvider("anthropic")!, "claude-sonnet-5-5", "sk-ant-x", ant as never)).toBe("Anthropic accepted the key.");
    expect(ant.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect(ant.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "sk-ant-x", "anthropic-dangerous-direct-browser-access": "true" });
    const or = ok({ data: {} });
    expect(await testKey(chatProvider("openrouter")!, "m", "sk-or-x", or as never)).toBe("OpenRouter accepted the key.");
    expect(or.mock.calls[0]).toEqual(["https://openrouter.ai/api/v1/key", { headers: { authorization: "Bearer sk-or-x" } }]);
    const ol = ok({ data: [{ id: "qwen3:8b" }] });
    expect(await testKey(chatProvider("ollama")!, "qwen3:8b", "", ol as never)).toBe("Ollama answered and has qwen3:8b.");
    expect(await testKey(chatProvider("ollama")!, "llama4", "", ol as never)).toMatch(/not pulled yet. Run: ollama pull llama4/);
  });

  test("a refused key names the provider and its reason", async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 }));
    await expect(testKey(chatProvider("anthropic")!, "m", "sk-ant-x", bad as never)).rejects.toThrow("Anthropic: HTTP 401, invalid x-api-key");
  });
});
