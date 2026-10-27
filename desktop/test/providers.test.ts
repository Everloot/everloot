import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { loadProviders } from "../../companion/src/providers/config";
import { modelsFor, ownProvider, ownProviders, removeProvider, setProvider, useModel } from "../src/main/providers";
import { CATALOGUE } from "../../web/src/lib/chat/catalogue";
import { PROVIDER_PRESETS, assistantSource, keptModelPick, manualModelShown, presetFor, removalNotice } from "../src/shared/providers";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-providers-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const ANT = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
const OR = "sk-or-v1-example-example-example-example";
const config = (d: string) => JSON.parse(readFileSync(join(d, "config.json"), "utf8"));

test("an Anthropic key goes into its own file and config.json gets one entry the companion can load", () => {
  const d = dir();
  expect(setProvider(d, { kind: "anthropic", key: `  ${ANT}\n` })).toEqual({ kind: "anthropic", model: "claude-sonnet-5-5", baseUrl: null });
  expect(readFileSync(join(d, "anthropic.key"), "utf8")).toBe(ANT + "\n");
  expect(config(d).providers).toEqual([{ type: "anthropic", apiKeyFile: join(d, "anthropic.key"), model: "claude-sonnet-5-5", source: "everloot-desktop" }]);
  expect(ownProvider(d)).toEqual({ kind: "anthropic", model: "claude-sonnet-5-5", baseUrl: null });
  expect(loadProviders(join(d, "config.json"))).toHaveLength(1);
});

test("OpenRouter and OpenCode Zen become openai-compatible entries on their base URL; Ollama needs no key", () => {
  const d = dir();
  expect(setProvider(d, { kind: "openrouter", key: OR, model: "qwen/qwen3.7-flash" })).toEqual({ kind: "openrouter", model: "qwen/qwen3.7-flash", baseUrl: "https://openrouter.ai/api/v1" });
  expect(config(d).providers[0]).toEqual({ type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "qwen/qwen3.7-flash", apiKeyFile: join(d, "openrouter.key"), source: "everloot-desktop", kind: "openrouter" });
  expect(loadProviders(join(d, "config.json"))[0].name).toBe("openai-compatible:qwen/qwen3.7-flash");

  // A second provider is saved beside the first and goes first; both keys stay.
  setProvider(d, { kind: "opencode", key: "zen-example-key" });
  expect(existsSync(join(d, "openrouter.key"))).toBe(true);
  expect(ownProvider(d)).toEqual({ kind: "opencode", model: "glm-5.3-flash-free", baseUrl: "https://opencode.ai/inference/openai/v1" });

  setProvider(d, { kind: "ollama", model: "qwen3:8b" });
  expect(config(d).providers[0]).toEqual({ type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3:8b", source: "everloot-desktop", kind: "ollama" });
  expect(ownProviders(d).map((p) => p.kind)).toEqual(["ollama", "opencode", "openrouter"]);
  expect(loadProviders(join(d, "config.json"))).toHaveLength(3);
});

test("the model menu switches between saved providers without the key, and remove takes one provider out", () => {
  const d = dir();
  setProvider(d, { kind: "anthropic", key: ANT });
  setProvider(d, { kind: "openrouter", key: OR });
  expect(useModel(d, "anthropic", "claude-haiku-5-5")).toEqual({ kind: "anthropic", model: "claude-haiku-5-5", baseUrl: null });
  expect(config(d).providers.map((p: { model: string }) => p.model)).toEqual(["claude-haiku-5-5", "deepseek/deepseek-v4.1-flash"]);
  expect(config(d).providers[0].apiKeyFile).toBe(join(d, "anthropic.key"));
  // A saved provider changes model in the form without the key being pasted again.
  setProvider(d, { kind: "openrouter", model: "qwen/qwen3.7-flash" });
  expect(readFileSync(join(d, "openrouter.key"), "utf8").trim()).toBe(OR);
  expect(ownProvider(d)).toMatchObject({ kind: "openrouter", model: "qwen/qwen3.7-flash" });
  expect(() => useModel(d, "opencode", "glm-5.3-flash-free")).toThrow(/add it first/);
  expect(() => useModel(d, "anthropic", "not a model")).toThrow(/model id/);
  removeProvider(d, "anthropic");
  expect(existsSync(join(d, "anthropic.key"))).toBe(false);
  expect(existsSync(join(d, "openrouter.key"))).toBe(true);
  expect(ownProviders(d).map((p) => p.kind)).toEqual(["openrouter"]);
});

test("a hand-written first entry means the app's saved provider is not the one in use", () => {
  const d = dir();
  setProvider(d, { kind: "anthropic", key: ANT });
  const c = config(d);
  writeFileSync(join(d, "config.json"), JSON.stringify({ providers: [{ type: "openai-compatible", baseUrl: "http://x", model: "m" }, ...c.providers] }));
  expect(ownProvider(d)).toBeNull();
  expect(ownProviders(d)).toHaveLength(1);
  useModel(d, "anthropic", "claude-sonnet-5-5");
  expect(ownProvider(d)).toMatchObject({ kind: "anthropic" });
});

test("a custom server takes its own address and an optional key", () => {
  const d = dir();
  expect(setProvider(d, { kind: "custom", baseUrl: "https://llm.example.test/v1/", model: "my-model" })).toEqual({ kind: "custom", model: "my-model", baseUrl: "https://llm.example.test/v1" });
  expect(config(d).providers[0].apiKeyFile).toBeUndefined();
  setProvider(d, { kind: "custom", baseUrl: "https://llm.example.test/v1", model: "my-model", key: "abc" });
  expect(readFileSync(join(d, "custom.key"), "utf8")).toBe("abc\n");
  expect(() => setProvider(d, { kind: "custom", baseUrl: "llm.example.test", model: "m" })).toThrow(/http/);
});

test("an existing config keeps its other entries and settings; the picked provider goes first", () => {
  const d = dir();
  writeFileSync(join(d, "config.json"), JSON.stringify({ note: "mine", providers: [{ type: "openai-compatible", baseUrl: "http://x", model: "m" }] }));
  setProvider(d, { kind: "anthropic", key: ANT });
  setProvider(d, { kind: "anthropic", key: ANT + "x", model: "claude-opus-5-5" });
  const c = config(d);
  expect(c.note).toBe("mine");
  expect(c.providers.map((p: { type: string; model: string }) => [p.type, p.model])).toEqual([["anthropic", "claude-opus-5-5"], ["openai-compatible", "m"]]);
  expect(readFileSync(join(d, "anthropic.key"), "utf8").trim()).toBe(ANT + "x");
});

test("remove deletes the picked entry and its key file; hand-written entries are left alone", () => {
  const d = dir();
  setProvider(d, { kind: "anthropic", key: ANT });
  removeProvider(d);
  expect(existsSync(join(d, "anthropic.key"))).toBe(false);
  expect(config(d).providers).toEqual([]);
  expect(ownProvider(d)).toBeNull();
  const e = dir();
  writeFileSync(join(e, "config.json"), JSON.stringify({ providers: [{ type: "anthropic", apiKeyFile: "/elsewhere/key" }] }));
  removeProvider(e);
  expect(config(e).providers).toEqual([{ type: "anthropic", apiKeyFile: "/elsewhere/key" }]);
  expect(ownProvider(e)).toBeNull();
  removeProvider(dir()); // nothing there is not an error
});

test("an anthropic entry from before the marker, on the app's own key file, still counts as the app's", () => {
  const d = dir();
  writeFileSync(join(d, "anthropic.key"), ANT + "\n");
  writeFileSync(join(d, "config.json"), JSON.stringify({ providers: [{ type: "anthropic", apiKeyFile: join(d, "anthropic.key"), model: "claude-haiku-5-5" }] }));
  expect(ownProvider(d)).toEqual({ kind: "anthropic", model: "claude-haiku-5-5", baseUrl: null });
  removeProvider(d);
  expect(existsSync(join(d, "anthropic.key"))).toBe(false);
});

test("a blank Ollama model takes the small recommended one, like every provider's first model", () => {
  expect(setProvider(dir(), { kind: "ollama", model: "" }).model).toBe("qwen3:4b");
});

test("bad pastes are refused before anything is written", () => {
  const d = dir();
  expect(() => setProvider(d, { kind: "anthropic", key: "hunter2" })).toThrow(/sk-ant-/);
  expect(() => setProvider(d, { kind: "openrouter", key: ANT })).toThrow(/sk-or-/);
  expect(() => setProvider(d, { kind: "openrouter", key: "" })).toThrow(/Paste the key first.*sk-or-/);
  expect(() => setProvider(d, { kind: "opencode", key: "" })).toThrow(/Paste the key/);
  expect(() => setProvider(d, { kind: "ollama", model: "not a model id" })).toThrow(/model id/);
  expect(() => setProvider(d, { kind: "nope" as never })).toThrow(/Unknown provider/);
  expect(existsSync(join(d, "config.json"))).toBe(false);
});

test("every preset's first model is a valid id and every OpenCode model listed is zero-retention free", () => {
  for (const p of PROVIDER_PRESETS) {
    for (const m of p.models) expect(m.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
    if (p.kind === "opencode") for (const m of p.models) { expect(m.id).toMatch(/-free$/); expect(m.note).toContain("zero retention"); }
  }
});

test("the picker's models come from the provider with its saved key, to that provider alone; a failure means the catalogue", async () => {
  const d = dir();
  const send = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] }));
  // No key saved yet: nothing is asked.
  expect(await modelsFor(d, "deepseek", send as never)).toBeNull();
  expect(send).not.toHaveBeenCalled();
  setProvider(d, { kind: "deepseek", key: "sk-deepseekdeepseekdeepseek" });
  expect((await modelsFor(d, "deepseek", send as never))?.map((m) => m.id)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  expect(send.mock.calls[0][0]).toBe("https://api.deepseek.com/models");
  expect(send.mock.calls[0][1]?.headers).toEqual({ authorization: "Bearer sk-deepseekdeepseekdeepseek" });
  expect(config(d).providers[0]).toMatchObject({ type: "openai-compatible", baseUrl: "https://api.deepseek.com", kind: "deepseek" });
  expect(await modelsFor(d, "deepseek", (async () => Response.json({}, { status: 401 })) as never)).toBeNull();
  // A custom server is asked at the address the player gave it.
  setProvider(d, { kind: "custom", baseUrl: "http://box:8080/v1", model: "local-1" });
  await modelsFor(d, "custom", send as never);
  expect(send.mock.calls.at(-1)?.[0]).toBe("http://box:8080/v1/models");
});

test("every catalogue provider the website lists is here too, and the Chinese families are offered direct", () => {
  const kinds = PROVIDER_PRESETS.map((p) => p.kind);
  for (const k of ["deepseek", "moonshot", "qwen", "minimax", "siliconflow", "baidu", "xiaomi", "zai", "tencent", "byteplus", "stepfun", "internlm"]) expect(kinds).toContain(k);
  for (const p of PROVIDER_PRESETS) if (p.kind !== "anthropic" && p.kind !== "custom") expect(p.baseUrl).toMatch(/^https?:\/\//);
});

test("every preset carries its catalogue get-key link; a custom server has none to invent", () => {
  for (const c of CATALOGUE) expect(presetFor(c.kind)?.getKey).toEqual(c.getKey);
  expect(presetFor("custom")?.getKey).toBeNull();
  expect(presetFor("ollama")?.getKey?.href).toBe("https://ollama.com/download");
  expect(presetFor("ollama")?.keyFile).toBeNull();
});

test("the manual model box shows only for Another model id or a provider with no list, and a late list keeps that choice", () => {
  const models = [{ id: "a", label: "A", note: "" }, { id: "b", label: "B", note: "" }];
  expect(manualModelShown(models, "a")).toBe(false);
  expect(manualModelShown(models, undefined)).toBe(false);
  expect(manualModelShown(models, "")).toBe(true);
  expect(manualModelShown([], undefined)).toBe(true);
  expect(manualModelShown([], "")).toBe(true);
  expect(keptModelPick(models, "b")).toBe("b");
  expect(keptModelPick(models, "")).toBe("");
  expect(keptModelPick(models, "gone")).toBe("a");
  expect(keptModelPick(models, undefined)).toBe("a");
  expect(keptModelPick([], undefined)).toBe("");
});

test("what answers is read from the actual mode and whether the app wrote the first entry, not from how many providers are saved", () => {
  const own = { kind: "anthropic" as const, model: "claude-sonnet-5-5", baseUrl: null };
  expect(assistantSource({ mode: "plain search", provider: null })).toBe("search");
  expect(assistantSource({ mode: "anthropic:claude-sonnet-5-5 with tools", provider: own })).toBe("app");
  // A hand-written first entry is in use even though the app has saved a provider behind it.
  expect(assistantSource({ mode: "llm.example.test:m with tools", provider: null })).toBe("config");
  expect(assistantSource({ mode: "llm.example.test:m with tools", provider: null })).toBe("config");
});

test("removal says what is actually answering afterwards", () => {
  const own = { kind: "openrouter" as const, model: "qwen/qwen3.7-flash", baseUrl: "https://openrouter.ai/api/v1" };
  expect(removalNotice({ mode: "plain search", provider: null })).toMatch(/search only/);
  expect(removalNotice({ mode: "openrouter.ai:qwen/qwen3.7-flash with tools", provider: own })).toMatch(/Chat now runs openrouter\.ai:qwen\/qwen3\.7-flash.*\/ask/);
  const next = removalNotice({ mode: "llm.example.test:m with tools", provider: null });
  expect(next).toMatch(/config\.json/);
  expect(next).not.toMatch(/search only/);
});
