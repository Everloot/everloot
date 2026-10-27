import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { adler32, luaString } from "../src/bridge/lua";
import { readAsks } from "../src/bridge/asks";
import { renderAnswersAddon } from "../src/bridge/answers";
import { answerPending, createAnswerStore } from "../src/bridge/run";
import { answerFromSearch, marketValueFrom, mcpMarketValue, withMarket, type AnswerEngine } from "../src/bridge/engine";
import { FIXTURE_ANSWER, FIXTURE_STRUCTURED, FIXTURE_URL } from "../../web/src/lib/chat/market-fixture";

const FIXTURE = new URL("../../addon/tests/fixtures/EverlootAnswers.lua", import.meta.url);
const HOSTILE = 'x"] = 1 } os.execute("calc") --[[\n]]\\\0\r\t';

test("adler32 matches the published test vector", () => {
  expect(adler32("Wikipedia")).toBe(0x11e60398);
  expect(adler32("")).toBe(1);
});

test("Lua strings escape quotes, backslashes and every control byte", () => {
  expect(luaString('a"b')).toBe('"a\\"b"');
  expect(luaString("a\\b")).toBe('"a\\\\b"');
  expect(luaString("line1\nline2")).toBe('"line1\\nline2"');
  expect(luaString("\0\r\u001b")).toBe('"\\000\\013\\027"');
  // Nothing in the output can end the string early: no raw quote, newline or control byte.
  expect(luaString(HOSTILE).slice(1, -1)).not.toMatch(/(^|[^\\])"|[\u0000-\u001f]/);
});

test("asks are read from SavedVariables, malformed or oversized ones are skipped", () => {
  const lua = `EverlootDB = {
["version"] = "0.2.3",
["installId"] = "abcd-1234-ef56-7890",
["records"] = {},
["asks"] = {
{["id"] = "ask:1", ["question"] = "Where does Thrall live?", ["askedAt"] = "2026-10-09T00:00:00Z"},
{["id"] = "ask:2", ["question"] = "", ["askedAt"] = "2026-10-09T00:00:00Z"},
{["question"] = "no id"},
{["id"] = "ask:3", ["question"] = "${"x".repeat(600)}", ["askedAt"] = "2026-10-09T00:00:00Z"},
},
}`;
  expect(readAsks(lua)).toEqual([{ id: "ask:1", question: "Where does Thrall live?", askedAt: "2026-10-09T00:00:00Z" }]);
  expect(readAsks(`EverlootDB = {["version"] = "0.2.2", ["installId"] = "abcd-1234", ["records"] = {}}`)).toEqual([]);
});

test("the answers addon matches the golden file the Lua 5.1 test loads", () => {
  const { toc, lua } = renderAnswersAddon([
    { id: "ask:1", answer: "Thrall is the Warchief of the Horde.", source: "warcraft.wiki.gg/wiki/Thrall", answeredAt: "2026-10-09T00:00:00Z" },
    { id: "ask:2", answer: HOSTILE, source: "none", answeredAt: "2026-10-09T00:00:01Z" },
  ]);
  expect(toc).toContain("## Title: Everloot Answers");
  expect(toc).toContain("EverlootAnswers.lua");
  // A Windows checkout may hold the fixture with CRLF; the content is what must match.
  expect(lua).toBe(readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n"));
});

test("a search result becomes a short answer with its source line", () => {
  const text = "[lore_page/lore] Thrall\nThrall is a shaman and the Warchief.\nSource: https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, retrieved 2023-11-13)";
  expect(answerFromSearch(text)).toEqual({
    answer: "Thrall is a shaman and the Warchief.",
    source: "https://warcraft.wiki.gg/wiki/Thrall (CC-BY-SA-4.0, retrieved 2023-11-13)",
  });
  expect(answerFromSearch("No results.")).toEqual({ answer: "No sourced answer found.", source: "none" });
});

test("pending asks are answered once and written into the slot addon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-bridge-"));
  const sv = join(dir, "Everloot.lua");
  writeFileSync(sv, `EverlootDB = {["version"] = "0.2.3", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {},
["asks"] = {{["id"] = "ask:1", ["question"] = "Thrall", ["askedAt"] = "2026-10-09T00:00:00Z"}}}`);
  const engine = { answer: vi.fn(async () => ({ answer: "Warchief.", source: "wiki" })) };
  const store = createAnswerStore(join(dir, "state", "answers.json"));
  const addons = join(dir, "AddOns");
  const first = await answerPending({ svFile: sv, addonsDir: addons, engine, store, now: () => new Date("2026-10-09T00:00:05Z") });
  expect(first).toEqual({ answered: 1, failed: 0 });
  const written = readFileSync(join(addons, "EverlootAnswers", "EverlootAnswers.lua"), "utf8");
  expect(written).toContain('["ask:1"]');
  expect(written).toContain(`["sum"] = ${adler32("Warchief.")}`);
  expect(await answerPending({ svFile: sv, addonsDir: addons, engine, store })).toEqual({ answered: 0, failed: 0 });
  expect(engine.answer).toHaveBeenCalledTimes(1);
});

test("an answered question still waiting in game gets its answer rewritten, with no new model call", async () => {
  // The addon keeps a question queued when its checksum fails; rewriting the slot addon heals it.
  const dir = mkdtempSync(join(tmpdir(), "everloot-bridge-"));
  const sv = join(dir, "Everloot.lua");
  writeFileSync(sv, `EverlootDB = {["version"] = "0.2.2", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {},
["asks"] = {{["id"] = "ask:7", ["question"] = "Thrall", ["askedAt"] = "2026-10-09T00:00:00Z"}}}`);
  const engine = { answer: vi.fn(async () => ({ answer: "Warchief.", source: "wiki" })) };
  const store = createAnswerStore(join(dir, "answers.json"));
  const addons = join(dir, "AddOns");
  await answerPending({ svFile: sv, addonsDir: addons, engine, store });
  const file = join(addons, "EverlootAnswers", "EverlootAnswers.lua");
  writeFileSync(file, readFileSync(file, "utf8").replace(`["sum"] = ${adler32("Warchief.")}`, `["sum"] = 1`));
  await answerPending({ svFile: sv, addonsDir: addons, engine, store });
  expect(readFileSync(file, "utf8")).toContain(`["sum"] = ${adler32("Warchief.")}`);
  expect(engine.answer).toHaveBeenCalledTimes(1);
});

test("an engine failure is reported to the player, not hidden", async () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-bridge-"));
  const sv = join(dir, "Everloot.lua");
  writeFileSync(sv, `EverlootDB = {["version"] = "0.2.3", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {},
["asks"] = {{["id"] = "ask:9", ["question"] = "Thrall", ["askedAt"] = "2026-10-09T00:00:00Z"}}}`);
  const engine = { answer: vi.fn(async () => { throw new Error("MCP unavailable"); }) };
  const store = createAnswerStore(join(dir, "answers.json"));
  expect(await answerPending({ svFile: sv, addonsDir: join(dir, "AddOns"), engine, store })).toEqual({ answered: 0, failed: 1 });
  expect(readFileSync(join(dir, "AddOns", "EverlootAnswers", "EverlootAnswers.lua"), "utf8")).toContain("Could not answer: MCP unavailable");
});


const SV = (asks: string) => `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {},
["asks"] = {${asks}}}`;
const askRow = (id: string, question: string, extra = "") => `{["id"] = "${id}", ["question"] = "${question}", ["askedAt"] = "2026-10-27T00:00:00Z"${extra}},`;

test("an ask carries the player's realm when it is a realm name; a bad one is dropped and the ask stays", () => {
  const lua = SV(askRow("ask:1", "price 2589", `, ["realm"] = "Dawn's Reach"`) + askRow("ask:2", "price 2589", `, ["realm"] = "Fore;ver"`)
    + askRow("ask:3", "price 2589", `, ["realm"] = 42`) + askRow("ask:4", "Thrall"));
  expect(readAsks(lua)).toEqual([
    { id: "ask:1", question: "price 2589", askedAt: "2026-10-27T00:00:00Z", realm: "Dawn's Reach" },
    { id: "ask:2", question: "price 2589", askedAt: "2026-10-27T00:00:00Z" },
    { id: "ask:3", question: "price 2589", askedAt: "2026-10-27T00:00:00Z" },
    { id: "ask:4", question: "Thrall", askedAt: "2026-10-27T00:00:00Z" },
  ]);
});

function market(over: { lookup?: (realm: string, id: number) => Promise<unknown>; resolve?: (name: string) => Promise<{ id: number } | { query: string } | null> } = {}) {
  return {
    lookup: vi.fn(over.lookup ?? (async () => FIXTURE_STRUCTURED)),
    resolveItem: vi.fn(over.resolve ?? (async () => ({ id: 2589 }))),
  };
}
const searchEngine = () => ({ answer: vi.fn(async () => ({ answer: "Warchief.", source: "wiki" })) }) satisfies AnswerEngine;

describe("a price question in /ask", () => {
  test("is answered from the market with its page, and the search engine is never asked", async () => {
    const m = market();
    const next = searchEngine();
    const reply = await withMarket(next, m).answer("price of Linen Cloth on Forever");
    expect(reply).toEqual({ answer: FIXTURE_ANSWER, source: FIXTURE_URL });
    expect(m.lookup).toHaveBeenCalledWith("Forever", 2589, undefined);
    expect(next.answer).not.toHaveBeenCalled();
  });

  test("uses the realm the ask carried, and a realm in the question wins", async () => {
    const m = market();
    const engine = withMarket(searchEngine(), m);
    await engine.answer("price 2589", { realm: "Nightslayer" });
    expect(m.lookup).toHaveBeenLastCalledWith("Nightslayer", 2589, undefined);
    await engine.answer("price 2589 on Forever", { realm: "Nightslayer" });
    expect(m.lookup).toHaveBeenLastCalledWith("Forever", 2589, undefined);
  });

  test("an old ask without a realm is asked for one, with no price from any realm", async () => {
    const m = market();
    const reply = await withMarket(searchEngine(), m).answer("price 2589");
    expect(reply.answer).toMatch(/^Which realm\?/);
    expect(reply.source).toBe("none");
    expect(m.lookup).not.toHaveBeenCalled();
  });

  test("a question that is not about a price goes to the search engine, context and all", async () => {
    const m = market();
    const next = searchEngine();
    await withMarket(next, m).answer("Where does Linen Cloth drop?", { realm: "Forever" });
    expect(next.answer).toHaveBeenCalledWith("Where does Linen Cloth drop?", { realm: "Forever" });
    expect(m.lookup).not.toHaveBeenCalled();
    expect(m.resolveItem).not.toHaveBeenCalled();
  });

  test("an unreadable market is an answer in game, never a price or a model's guess", async () => {
    const m = market({ lookup: async () => { throw new Error("offline"); } });
    const next = searchEngine();
    const reply = await withMarket(next, m).answer("price 2589 on Forever");
    expect(reply.answer).toMatch(/unrecorded, not zero/);
    expect(next.answer).not.toHaveBeenCalled();
  });

  test("an answer fits the game's 600 characters, essentials first", async () => {
    const m = market({ lookup: async () => ({ ...FIXTURE_STRUCTURED, page: { ...FIXTURE_STRUCTURED.page, value: { ...FIXTURE_STRUCTURED.page.value, ageDays: 30 } } }) });
    const reply = await withMarket(searchEngine(), m).answer("price of Linen Cloth on Forever");
    expect(reply.answer.length).toBeLessThanOrEqual(600);
    expect(reply.answer.startsWith("Linen Cloth (item 2589) on Forever, all houses: market 3s 10c")).toBe(true);
  });

  test("reaches the game: asked, parsed with its realm, looked up once, answered with a checksum, shown from the store after", async () => {
    const dir = mkdtempSync(join(tmpdir(), "everloot-bridge-"));
    const sv = join(dir, "Everloot.lua");
    writeFileSync(sv, SV(askRow("ask:10", "price of Linen Cloth", `, ["realm"] = "Forever"`) + askRow("ask:11", "Thrall") + askRow("ask:12", "price 2589")));
    const m = market();
    const next = searchEngine();
    const store = createAnswerStore(join(dir, "answers.json"));
    const addons = join(dir, "AddOns");
    const run = () => answerPending({ svFile: sv, addonsDir: addons, engine: withMarket(next, m), store, now: () => new Date("2026-10-27T00:00:05Z") });
    expect(await run()).toEqual({ answered: 3, failed: 0 });
    const written = readFileSync(join(addons, "EverlootAnswers", "EverlootAnswers.lua"), "utf8");
    expect(written).toContain(`["ask:10"] = { ["answer"] = ${JSON.stringify(FIXTURE_ANSWER)}`);
    expect(written).toContain(`["sum"] = ${adler32(FIXTURE_ANSWER)}`);
    expect(written).toContain(`["source"] = ${JSON.stringify(FIXTURE_URL)}`);
    expect(written).toContain('["ask:11"] = { ["answer"] = "Warchief."');
    expect(written).toContain('["ask:12"] = { ["answer"] = "Which realm?');
    // A price answer never carries a model's name or another realm's price.
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(next.answer).toHaveBeenCalledTimes(1);
    // The same file again: nothing is answered twice, and nothing is looked up again.
    expect(await run()).toEqual({ answered: 0, failed: 0 });
    expect(m.lookup).toHaveBeenCalledTimes(1);
    expect(next.answer).toHaveBeenCalledTimes(1);
  });
});

describe("market_value over MCP", () => {
  test("is called with the realm and item id, and its structured answer is the result", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "long text" }], structuredContent: FIXTURE_STRUCTURED }));
    const out = await mcpMarketValue({ url: "https://x/mcp/public", token: null }, "Forever", 2589, undefined, async (_o, run) => run({ callTool } as never));
    expect(callTool).toHaveBeenCalledWith({ name: "market_value", arguments: { realm: "Forever", itemId: 2589 } }, undefined, { signal: undefined });
    expect(out).toEqual(FIXTURE_STRUCTURED);
  });

  test("a tool error or a result without structured content is not a price", () => {
    expect(marketValueFrom({ isError: true, content: [{ type: "text", text: "no" }] })).toBeNull();
    expect(marketValueFrom({ content: [{ type: "text", text: "text only" }] })).toBeNull();
    expect(marketValueFrom({ structuredContent: FIXTURE_STRUCTURED })).toEqual(FIXTURE_STRUCTURED);
  });
});
