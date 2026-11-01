import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { ACCOUNT_KEY_FILE, writeKeyOrigin } from "../src/main/account";
import { answer } from "../src/main/agent";
import { createChat } from "../src/main/chat";
import { defaultSettings } from "../src/main/settings";
import type { Settings } from "../src/shared/types";

vi.mock("../src/main/agent", async (importOriginal) => ({ ...(await importOriginal<object>()), answer: vi.fn() }));
const mockAnswer = vi.mocked(answer);

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-desktop-")); dirs.push(d); return d; };
afterEach(() => { mockAnswer.mockReset(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const reply = (text: string) => ({ text, model: null, sources: [], steps: [] });
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), endpoint: "https://example.test", ...patch });

test.each(["https://other.test", "http://everloot.app", "https://everloot.app:444"])("Chat withholds the account key from a changed site %s", async (endpoint) => {
  const d = dir();
  writeFileSync(join(d, ACCOUNT_KEY_FILE), `evl_${"ab".repeat(32)}`);
  mockAnswer.mockResolvedValueOnce(reply("ok"));
  await createChat(d, () => settings({ endpoint })).send("q");
  expect(mockAnswer.mock.calls[0][0].mcp.token).toBeNull();
  expect(createChat(d, () => settings({ endpoint })).info().withAccountKey).toBe(false);
});

test("Chat sends the account key to the site it was checked against", async () => {
  const d = dir();
  const key = `evl_${"ab".repeat(32)}`;
  writeFileSync(join(d, ACCOUNT_KEY_FILE), key);
  writeKeyOrigin(d, "https://example.test");
  mockAnswer.mockResolvedValueOnce(reply("ok"));
  await createChat(d, () => settings()).send("q");
  expect(mockAnswer.mock.calls[0][0].mcp.token).toBe(key);
  expect(createChat(d, () => settings()).info().withAccountKey).toBe(true);
});

test("Chat gives the agent the site for item names and the followed realms to suggest, nothing it could choose from", async () => {
  mockAnswer.mockResolvedValueOnce(reply("ok"));
  await createChat(dir(), () => settings({ market: { realms: ["Forever", "Nightslayer"], dismissed: [] } })).send("price 2589");
  expect(mockAnswer.mock.calls[0][0]).toMatchObject({ site: "https://example.test", realms: ["Forever", "Nightslayer"] });
});

test("a question and its answer land in chat.json and come back on the next start", async () => {
  const d = dir();
  mockAnswer.mockResolvedValueOnce(reply("Thunderfury drops in Molten Core."));
  const chat = createChat(d, () => settings());
  const info = await chat.send("  where does Thunderfury drop?  ");
  expect(info.messages.map((m) => [m.role, m.text])).toEqual([["user", "where does Thunderfury drop?"], ["assistant", "Thunderfury drops in Molten Core."]]);
  expect(info.error).toBeNull();
  expect(JSON.parse(readFileSync(join(d, "chat.json"), "utf8"))).toHaveLength(2);
  expect(createChat(d, () => settings()).info().messages).toHaveLength(2);
  // The agent saw the history before this question and the question itself.
  expect(mockAnswer.mock.calls[0][0]).toMatchObject({ question: "where does Thunderfury drop?", history: [] });
});

test("an empty question and a question while busy do nothing", async () => {
  const chat = createChat(dir(), () => settings());
  expect((await chat.send("   ")).messages).toEqual([]);
  let release!: (r: ReturnType<typeof reply>) => void;
  mockAnswer.mockReturnValueOnce(new Promise((res) => { release = res; }));
  const first = chat.send("one");
  expect(chat.info().busy).toBe(true);
  expect((await chat.send("two")).messages.map((m) => m.text)).toEqual(["one"]);
  release(reply("answer"));
  expect((await first).messages.map((m) => m.text)).toEqual(["one", "answer"]);
  expect(mockAnswer).toHaveBeenCalledTimes(1);
});

test("a failed answer keeps the question, reports the error and clears it on the next send", async () => {
  const chat = createChat(dir(), () => settings());
  mockAnswer.mockRejectedValueOnce(new Error("MCP unreachable"));
  const failed = await chat.send("hello");
  expect(failed.error).toBe("MCP unreachable");
  expect(failed.busy).toBe(false);
  expect(failed.messages.map((m) => m.role)).toEqual(["user"]);
  mockAnswer.mockResolvedValueOnce(reply("hi"));
  expect((await chat.send("again")).error).toBeNull();
});

test("the transcript keeps the newest hundred messages", async () => {
  const d = dir();
  writeFileSync(join(d, "chat.json"), JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ role: "user", text: `m${i}`, at: "", model: null, sources: [], steps: [] }))));
  const chat = createChat(d, () => settings());
  expect(chat.info().messages).toHaveLength(100);
  expect(chat.info().messages[0].text).toBe("m20");
  mockAnswer.mockResolvedValueOnce(reply("a"));
  const after = await chat.send("q");
  expect(after.messages).toHaveLength(100);
  expect(after.messages.at(-1)?.text).toBe("a");
});

test("the target is the public mount without a token and the token endpoint with one", async () => {
  const d = dir();
  expect(createChat(d, () => settings()).info()).toMatchObject({ mcpUrl: "https://example.test/mcp/public", withToken: false });
  const tokenFile = join(d, "token.txt");
  writeFileSync(tokenFile, "tok-123\n");
  const withToken = createChat(d, () => settings({ ask: { enabled: true, mcpUrl: "https://example.test/mcp", tokenFile } }));
  expect(withToken.info()).toMatchObject({ mcpUrl: "https://example.test/mcp", withToken: true });
  mockAnswer.mockResolvedValueOnce(reply("ok"));
  await withToken.send("q");
  expect(mockAnswer.mock.calls[0][0].mcp).toEqual({ url: "https://example.test/mcp", token: "tok-123" });
  // An empty or missing token file falls back to the public mount.
  writeFileSync(tokenFile, "");
  expect(withToken.info()).toMatchObject({ mcpUrl: "https://example.test/mcp/public", withToken: false });
});

test("signed in, the public mount gets the account key; a token file still wins", async () => {
  const d = dir();
  const key = `evl_${"0f".repeat(32)}`;
  writeFileSync(join(d, ACCOUNT_KEY_FILE), key + "\n");
  writeKeyOrigin(d, "https://example.test");
  const chat = createChat(d, () => settings());
  expect(chat.info()).toMatchObject({ mcpUrl: "https://example.test/mcp/public", withToken: false });
  mockAnswer.mockResolvedValueOnce(reply("ok"));
  await chat.send("q");
  expect(mockAnswer.mock.calls[0][0].mcp).toEqual({ url: "https://example.test/mcp/public", token: key });
  const tokenFile = join(d, "token.txt");
  writeFileSync(tokenFile, "tok-123\n");
  mockAnswer.mockResolvedValueOnce(reply("ok"));
  await createChat(d, () => settings({ ask: { enabled: true, mcpUrl: "https://example.test/mcp", tokenFile } })).send("q");
  expect(mockAnswer.mock.calls[1][0].mcp).toEqual({ url: "https://example.test/mcp", token: "tok-123" });
});

test("the mode names the first provider with its model, and the picker's entry goes in front of hand-written ones", () => {
  const d = dir();
  const chat = createChat(d, () => settings());
  expect(chat.info()).toMatchObject({ mode: "plain search", provider: null });
  writeFileSync(join(d, "config.json"), JSON.stringify({ providers: [{ type: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKeyFile: "k.txt" }] }));
  expect(chat.info()).toMatchObject({ mode: "api.deepseek.com:deepseek-chat with tools", provider: null });
  chat.setProvider({ kind: "anthropic", key: `sk-ant-${"a".repeat(30)}`, model: "claude-haiku-5-5" });
  expect(chat.info()).toMatchObject({ mode: "anthropic:claude-haiku-5-5 with tools", provider: { kind: "anthropic", model: "claude-haiku-5-5", baseUrl: null } });
  // The hand-written provider stays behind the picked one rather than being dropped.
  expect(JSON.parse(readFileSync(join(d, "config.json"), "utf8")).providers.map((p: { type: string }) => p.type)).toEqual(["anthropic", "openai-compatible"]);
  chat.removeProvider();
  expect(chat.info()).toMatchObject({ mode: "api.deepseek.com:deepseek-chat with tools", provider: null });
  // Saved by hand with a byte order mark: still read.
  writeFileSync(join(d, "config.json"), "\uFEFF" + JSON.stringify({ providers: [{ type: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3" }] }));
  expect(chat.info().mode).toBe("localhost:qwen3 with tools");
  writeFileSync(join(d, "config.json"), JSON.stringify({ providers: [{ type: "openai", apiKey: "inline" }] }));
  expect(chat.info().mode).toMatch(/^config.json: providers\[0\]/);
});

test("clear empties the transcript on disk too", async () => {
  const d = dir();
  mockAnswer.mockResolvedValueOnce(reply("a"));
  const chat = createChat(d, () => settings());
  await chat.send("q");
  expect(chat.clear().messages).toEqual([]);
  expect(existsSync(join(d, "chat.json"))).toBe(true);
  expect(JSON.parse(readFileSync(join(d, "chat.json"), "utf8"))).toEqual([]);
});

test("clear waits while an answer is being written, so the question stays with its answer", async () => {
  const chat = createChat(dir(), () => settings());
  let release!: (r: ReturnType<typeof reply>) => void;
  mockAnswer.mockReturnValueOnce(new Promise((res) => { release = res; }));
  const pending = chat.send("q");
  expect(chat.clear().messages.map((m) => m.text)).toEqual(["q"]);
  release(reply("a"));
  expect((await pending).messages.map((m) => [m.role, m.text])).toEqual([["user", "q"], ["assistant", "a"]]);
  expect(chat.clear().messages).toEqual([]);
});

test("Stop keeps the question and the text so far, marked stopped, saved, with no error; the next question works", async () => {
  const d = dir();
  const chat = createChat(d, () => settings());
  // The agent returns what had arrived when its signal aborts, as both provider loops do.
  mockAnswer.mockImplementationOnce((o) => new Promise((res) => { o.signal!.addEventListener("abort", () => res({ ...reply("Baron Ged"), model: "qwen3", stopped: true })); }));
  const pending = chat.send("bindings?");
  expect(chat.info().busy).toBe(true);
  chat.stop();
  const stopped = await pending;
  expect(stopped).toMatchObject({ busy: false, error: null });
  expect(stopped.messages.map((m) => [m.role, m.text, m.stopped])).toEqual([["user", "bindings?", undefined], ["assistant", "Baron Ged", true]]);
  expect(JSON.parse(readFileSync(join(d, "chat.json"), "utf8"))[1]).toMatchObject({ text: "Baron Ged", model: "qwen3", stopped: true });
  mockAnswer.mockResolvedValueOnce(reply("Molten Core."));
  const next = await chat.send("where?");
  expect(next.messages.map((m) => m.text)).toEqual(["bindings?", "Baron Ged", "where?", "Molten Core."]);
  expect(next.messages[3].stopped).toBeUndefined();
  expect(chat.clear().messages).toEqual([]);
});

test("Stop before anything was written is not an error either", async () => {
  const chat = createChat(dir(), () => settings());
  mockAnswer.mockImplementationOnce((o) => new Promise((_res, rej) => { o.signal!.addEventListener("abort", () => rej(new Error("This operation was aborted"))); }));
  const pending = chat.send("q");
  chat.stop();
  const r = await pending;
  expect(r).toMatchObject({ busy: false, error: null });
  expect(r.messages.map((m) => [m.role, m.text, m.stopped])).toEqual([["user", "q", undefined], ["assistant", "", true]]);
});
