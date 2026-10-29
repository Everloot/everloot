import Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createAnthropicProvider } from "../src/providers/anthropic";
import { createOpenAICompatibleProvider } from "../src/providers/openai-compatible";
import { completeWithFallback, ProviderError, type Provider } from "../src/providers/chain";
import { loadProviders } from "../src/providers/config";
import { llmEngine } from "../src/bridge/llm-engine";

const SOURCED = {
  text: "- [lore (Warcraft Wiki 2023, may differ in WoW: Forever)] Thrall is a shaman and the Warchief of the Horde.\n  Source: https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, as of 2023-11-13)",
  evidence: [{ claim: "Thrall is a shaman and the Warchief of the Horde.", kind: "lore", source: { url: "https://warcraft.wiki.gg/wiki/Thrall" }, url: "https://everloot.app/lore/481380-thrall" }],
};

function fakeAnthropic(reply: () => Promise<unknown>) {
  const create = vi.fn(reply);
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

test("Anthropic: short grounded answer on the default model, low effort, server-side fallback on", async () => {
  const { client, create } = fakeAnthropic(async () => ({
    model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Thrall leads the Horde." }],
  }));
  const provider = createAnthropicProvider({ apiKey: "unused", client });
  expect(await provider.complete("system rules", "question")).toEqual({ text: "Thrall leads the Horde.", model: "claude-opus-5-5" });
  expect((create.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({
    model: "claude-opus-5-5", system: "system rules", output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    messages: [{ role: "user", content: "question" }],
  });
});

test("Anthropic: failures that another provider might survive fall through; a bad request and a refusal do not", async () => {
  const cases: [number, boolean][] = [[401, true], [402, true], [403, true], [429, true], [500, true], [529, true], [400, false]];
  for (const [status, fallthrough] of cases) {
    const { client } = fakeAnthropic(async () => { throw Anthropic.APIError.generate(status, { error: { type: "x" } }, "failed", new Headers()); });
    const error = await createAnthropicProvider({ apiKey: "unused", client }).complete("s", "q").catch((e) => e);
    expect(error, String(status)).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).fallthrough, String(status)).toBe(fallthrough);
  }
  const { client } = fakeAnthropic(async () => ({ model: "claude-opus-5-5", stop_reason: "refusal", content: [] }));
  const refused = await createAnthropicProvider({ apiKey: "unused", client }).complete("s", "q").catch((e) => e);
  expect(refused).toMatchObject({ fallthrough: false });
});

test("OpenAI-compatible (DeepSeek, OpenRouter, Ollama): chat completions with an optional key", async () => {
  const fetch = vi.fn(async () => Response.json({ model: "llama3.1:8b", choices: [{ message: { content: "Thrall leads the Horde." } }] }));
  const provider = createOpenAICompatibleProvider({ baseUrl: "http://localhost:11434/v1", model: "llama3.1:8b", fetch: fetch as unknown as typeof globalThis.fetch });
  expect(await provider.complete("s", "q")).toEqual({ text: "Thrall leads the Horde.", model: "llama3.1:8b" });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://localhost:11434/v1/chat/completions");
  expect(new Headers(init.headers).has("authorization")).toBe(false);
  expect(JSON.parse(String(init.body)).messages).toEqual([{ role: "system", content: "s" }, { role: "user", content: "q" }]);
  // Found with a real local gemma4:12b: reasoning used a small cap and the answer came back empty.
  const capped = createOpenAICompatibleProvider({ baseUrl: "http://x/v1", model: "m",
    fetch: (async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "" } }] })) as typeof globalThis.fetch });
  await expect(capped.complete("s", "q")).rejects.toMatchObject({ fallthrough: true, message: expect.stringMatching(/token limit/) });
  expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)).max_tokens).toBeGreaterThanOrEqual(2000);
  for (const [status, fallthrough] of [[429, true], [503, true], [401, true], [400, false]] as const) {
    const failing = createOpenAICompatibleProvider({ baseUrl: "https://api.example/v1", model: "m", apiKey: "k",
      fetch: (async () => new Response("no", { status })) as typeof globalThis.fetch });
    expect(await failing.complete("s", "q").catch((e) => (e as ProviderError).fallthrough), String(status)).toBe(fallthrough);
  }
});

test("the chain tries enabled providers in order and falls through only on provider failure", async () => {
  const down: Provider = { name: "first", complete: async () => { throw new ProviderError("first", "rate limited", true); } };
  const up: Provider = { name: "second", complete: async () => ({ text: "ok", model: "m2" }) };
  const bad: Provider = { name: "bad", complete: async () => { throw new ProviderError("bad", "bad request", false); } };
  expect(await completeWithFallback([down, up], "s", "q")).toEqual({ text: "ok", model: "m2" });
  await expect(completeWithFallback([bad, up], "s", "q")).rejects.toThrow(/bad request/);
  await expect(completeWithFallback([down], "s", "q")).rejects.toThrow(/first: rate limited/);
  await expect(completeWithFallback([], "s", "q")).rejects.toThrow(/No provider/);
});

test("the LLM engine answers only from sources, names the model, and never calls a model without a source", async () => {
  const complete = vi.fn(async () => ({ text: "Thrall is the Warchief of the Horde.", model: "claude-opus-5-5" }));
  const engine = llmEngine({ sources: async () => SOURCED, providers: [{ name: "anthropic", complete }] });
  expect(await engine.answer("Who is Thrall?")).toEqual({
    answer: "Thrall is the Warchief of the Horde. (answered by claude-opus-5-5)",
    source: "https://everloot.app/lore/481380-thrall",
  });
  const [system, user] = complete.mock.calls[0] as unknown as [string, string];
  expect(system).toMatch(/only the sources/i);
  expect(user).toContain("Who is Thrall?");
  // The model reads answer_sources' own text, labels included.
  expect(user).toContain("Warchief of the Horde");
  expect(user).toContain("may differ in WoW: Forever");
  const fancy = llmEngine({ sources: async () => SOURCED, providers: [{ name: "x", complete: async () => ({ text: "Thrall leads the *Horde* in **World of Warcraft**.\n`ok`", model: "m" }) }] });
  expect((await fancy.answer("Who is Thrall?")).answer).toBe("Thrall leads the Horde in World of Warcraft. ok (answered by m)");
  const unsure = llmEngine({ sources: async () => SOURCED, providers: [{ name: "x", complete: async () => ({ text: "Not in the sources.", model: "m" }) }] });
  expect(await unsure.answer("Who is Thrall's cat?")).toEqual({ answer: "No sourced answer found.", source: "none" });
  complete.mockClear();
  const empty = llmEngine({ sources: async () => ({ text: "No evidence found for that question.", evidence: [] }), providers: [{ name: "anthropic", complete }] });
  expect(await empty.answer("Who is Nobody?")).toEqual({ answer: "No sourced answer found.", source: "none" });
  expect(complete).not.toHaveBeenCalled();
});

test("provider config reads keys from files only and rejects inline keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-providers-"));
  writeFileSync(join(dir, "anthropic.key"), "sk-test\n");
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ providers: [
    { type: "anthropic", apiKeyFile: join(dir, "anthropic.key") },
    { type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "llama3.1:8b" },
  ] }));
  expect(loadProviders(config).map((p) => p.name)).toEqual(["anthropic:claude-opus-5-5", "openai-compatible:llama3.1:8b"]);
  writeFileSync(config, JSON.stringify({ providers: [{ type: "anthropic", apiKey: "sk-inline" }] }));
  expect(() => loadProviders(config)).toThrow(/apiKeyFile/);
  expect(loadProviders(join(dir, "missing.json"))).toEqual([]);
});
