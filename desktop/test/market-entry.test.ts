import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { loopbackSite } from "../../companion/test/loopback-mcp";
import { createChat } from "../src/main/chat";
import { companionJobs } from "../src/main/jobs";
import { defaultSettings } from "../src/main/settings";

/**
 * Where a price question enters: Desktop Chat's send and the Ask job, against a loopback site, with the optional
 * provider settings in every state a player's config.json can be in. A recognized price question and the realm
 * question never depend on those; a question that does need a provider still says what is wrong with them.
 */

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-entry-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

let site: Awaited<ReturnType<typeof loopbackSite>>;
beforeAll(async () => { site = await loopbackSite(); });
afterAll(async () => { await site.stop(); });

const PRICE = "price 2589 on Forever";
const MARKET = "Item 2589 on Forever, all houses: market 3s 10c";
const configs: [string, (d: string) => string | null][] = [
  ["no config", () => null],
  ["malformed JSON", () => "{"],
  ["a null provider entry", () => JSON.stringify({ providers: [null] })],
  ["a provider whose key file is missing", (d) => JSON.stringify({ providers: [{ type: "anthropic", apiKeyFile: join(d, "missing.key") }] })],
];
const BROKEN = configs.slice(1);

/** A data folder with that config, and the settings that point at the loopback site. */
function setup(config: (d: string) => string | null, patch: Partial<ReturnType<typeof defaultSettings>> = {}) {
  const d = dir();
  const text = config(d);
  if (text !== null) writeFileSync(join(d, "config.json"), text);
  return { d, settings: { ...defaultSettings(), endpoint: site.endpoint, gameFolder: d, ...patch } };
}

describe("Desktop Chat send", () => {
  test.each(configs)("answers a price from the recorded market, and keeps both messages, with %s", async (_name, config) => {
    const { d, settings } = setup(config);
    const from = site.seen.length;
    const info = await createChat(d, () => settings).send(PRICE);
    expect(info.error).toBeNull();
    expect(info.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(info.messages[1].text.startsWith(MARKET)).toBe(true);
    expect(info.messages[1].model).toBeNull();
    expect(JSON.parse(readFileSync(join(d, "chat.json"), "utf8"))).toHaveLength(2);
    expect(site.since(from)).toContain("/mcp/public tools/call market_value");
    expect(site.since(from).some((r) => r.includes("search_knowledge"))).toBe(false);
  });

  test.each(configs)("asks which realm, with no request at all, with %s", async (_name, config) => {
    const { d, settings } = setup(config);
    const from = site.seen.length;
    const info = await createChat(d, () => settings).send("price 2589");
    expect(info.error).toBeNull();
    expect(info.messages[1].text).toMatch(/^Which realm\?/);
    expect(site.since(from)).toEqual([]);
  });

  test.each(BROKEN)("still says what is wrong for a question that needs a provider, with %s", async (_name, config) => {
    const { d, settings } = setup(config);
    const from = site.seen.length;
    const info = await createChat(d, () => settings).send("Where does Linen Cloth drop?");
    expect(info.error).toMatch(/\S/);
    expect(info.messages.map((m) => m.role)).toEqual(["user"]);
    expect(site.since(from).some((r) => r.includes("search_knowledge"))).toBe(false);
  });

  test("a malformed config.json is still reported as the JSON error", async () => {
    const { d, settings } = setup(configs[1][1]);
    expect((await createChat(d, () => settings).send("Where does Linen Cloth drop?")).error).toMatch(/JSON/);
  });

  test("a nonprice question with no config is still answered by plain search", async () => {
    const { d, settings } = setup(configs[0][1]);
    const info = await createChat(d, () => settings).send("Where does Linen Cloth drop?");
    expect(info.error).toBeNull();
    expect(info.messages[1].text).toContain("A bolt of cloth.");
  });

  test("a private token still goes with the price request, even with a broken config", async () => {
    const { d, settings } = setup(configs[1][1]);
    const tokenFile = join(d, "token.txt");
    writeFileSync(tokenFile, "private-token\n");
    const from = site.seen.length;
    const info = await createChat(d, () => ({ ...settings, ask: { enabled: true, mcpUrl: `${site.endpoint}/mcp`, tokenFile } })).send(PRICE);
    expect(info.messages[1].text.startsWith(MARKET)).toBe(true);
    const requests = site.seen.slice(from).filter((s) => s.path.startsWith("/mcp"));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((s) => s.path === "/mcp" && s.auth === "Bearer private-token")).toBe(true);
  });

  test("a token file that cannot be read keeps Chat's existing public fallback, with no token sent", async () => {
    const { d, settings } = setup(configs[0][1]);
    const from = site.seen.length;
    const info = await createChat(d, () => ({ ...settings, ask: { enabled: true, mcpUrl: `${site.endpoint}/mcp`, tokenFile: join(d, "gone.txt") } })).send(PRICE);
    expect(info.messages[1].text.startsWith(MARKET)).toBe(true);
    const requests = site.seen.slice(from).filter((s) => s.path.startsWith("/mcp"));
    expect(requests.every((s) => s.path === "/mcp/public" && s.auth === null)).toBe(true);
  });
});

describe("the Ask job", () => {
  const ask = (id: string, question: string) => `{["id"] = "${id}", ["question"] = "${question}", ["askedAt"] = "2026-10-27T00:00:00Z"},`;
  const savedVariables = (d: string, ...asks: string[]) => {
    const file = join(d, "Everloot.lua");
    writeFileSync(file, `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {}, ["asks"] = {${asks.join("")}}}\n`);
    return file;
  };
  const written = (d: string) => readFileSync(join(d, "Interface", "AddOns", "EverlootAnswers", "EverlootAnswers.lua"), "utf8");

  test.each(configs)("answers a price from the recorded market and stores it with %s", async (_name, config) => {
    const { d, settings } = setup(config);
    const file = savedVariables(d, ask("ask:1", PRICE));
    const from = site.seen.length;
    const jobs = companionJobs(d, () => settings);
    expect(await jobs.deps.ask(file)).toMatch(/^answered 1, failed 0/);
    expect(jobs.answerStore.list()[0].answer.startsWith(MARKET)).toBe(true);
    expect(written(d)).toContain(MARKET);
    expect(site.since(from)).toContain("/mcp/public tools/call market_value");
  });

  test.each(configs)("asks which realm, with no request at all, with %s", async (_name, config) => {
    const { d, settings } = setup(config);
    const file = savedVariables(d, ask("ask:2", "price 2589"));
    const from = site.seen.length;
    const jobs = companionJobs(d, () => settings);
    expect(await jobs.deps.ask(file)).toMatch(/^answered 1, failed 0/);
    expect(jobs.answerStore.list()[0].answer).toMatch(/^Which realm\?/);
    expect(site.since(from)).toEqual([]);
  });

  test.each(BROKEN)("names the provider problem in the status and in the answer to a question that needs one, with %s", async (_name, config) => {
    const { d, settings } = setup(config);
    const file = savedVariables(d, ask("ask:3", PRICE), ask("ask:4", "Where does Linen Cloth drop?"));
    const from = site.seen.length;
    const jobs = companionJobs(d, () => settings);
    const status = await jobs.deps.ask(file);
    expect(status).toMatch(/^answered 1, failed 1 \(config\.json: /);
    expect(jobs.answerStore.list().map((a) => a.id)).toEqual(["ask:3"]);
    expect(written(d)).toContain('["ask:4"] = { ["answer"] = "Could not answer yet (');
    expect(site.since(from).some((r) => r.includes("search_knowledge"))).toBe(false);
  });

  test("a private token goes with the price request, even with a broken config", async () => {
    const { d, settings } = setup(configs[1][1]);
    const tokenFile = join(d, "token.txt");
    writeFileSync(tokenFile, "private-token\n");
    const file = savedVariables(d, ask("ask:5", PRICE));
    const from = site.seen.length;
    const jobs = companionJobs(d, () => ({ ...settings, ask: { enabled: true, mcpUrl: `${site.endpoint}/mcp`, tokenFile } }));
    await jobs.deps.ask(file);
    expect(jobs.answerStore.list()[0].answer.startsWith(MARKET)).toBe(true);
    const requests = site.seen.slice(from).filter((s) => s.path.startsWith("/mcp"));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((s) => s.path === "/mcp" && s.auth === "Bearer private-token")).toBe(true);
  });

  test.each(configs)("a token file that cannot be read still errors without any request, with %s", async (_name, config) => {
    const { d, settings } = setup(config);
    const file = savedVariables(d, ask("ask:6", PRICE));
    const from = site.seen.length;
    const jobs = companionJobs(d, () => ({ ...settings, ask: { enabled: true, mcpUrl: `${site.endpoint}/mcp`, tokenFile: join(d, "gone.txt") } }));
    await expect(jobs.deps.ask(file)).rejects.toThrow(/could not be read/);
    expect(site.since(from)).toEqual([]);
    expect(jobs.answerStore.list()).toEqual([]);
  });
});
