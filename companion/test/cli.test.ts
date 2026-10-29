import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { debounce, defaultStatePath, parseArgs, uploadNotice, uploadSummary } from "../src/cli";
import { loopbackSite } from "./loopback-mcp";

test("arguments name a command, a file or a game folder, and an endpoint", () => {
  expect(parseArgs(["upload", "--file", "Everloot.lua"])).toEqual({ command: "upload", file: "Everloot.lua", endpoint: "https://everloot.app" });
  expect(parseArgs(["watch", "--game", "C:/Games/WoW", "--endpoint", "http://localhost:3000"]))
    .toEqual({ command: "watch", game: "C:/Games/WoW", endpoint: "http://localhost:3000" });
  expect(parseArgs(["upload", "--file", "x", "--state", "s.json"]).state).toBe("s.json");
  expect(() => parseArgs(["upload"])).toThrow(/--file or --game/);
  expect(() => parseArgs(["dance", "--file", "x"])).toThrow(/upload, watch, bridge or prices/);
  expect(() => parseArgs(["upload", "--file", "x", "--endpoint", "ftp://nope"])).toThrow(/http/);
});

test("sent state lives in the user's app data folder, never the addon folder", () => {
  expect(defaultStatePath({ platform: "win32", env: { APPDATA: "C:\\Users\\p\\AppData\\Roaming" }, home: "C:\\Users\\p" }))
    .toMatch(/AppData[\\/]Roaming[\\/]Everloot[\\/]sent\.json$/);
  expect(defaultStatePath({ platform: "darwin", env: {}, home: "/Users/p" })).toBe("/Users/p/Library/Application Support/Everloot/sent.json");
  expect(defaultStatePath({ platform: "linux", env: {}, home: "/home/p" })).toBe("/home/p/.config/everloot/sent.json");
});

test("a burst of file events during a save runs the upload once, after it settles", () => {
  vi.useFakeTimers();
  try {
    const run = vi.fn();
    const trigger = debounce(run, 5000);
    trigger(); trigger(); vi.advanceTimersByTime(4000); trigger();
    vi.advanceTimersByTime(4999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

test("bridge needs the game folder, an MCP URL and a token file", () => {
  expect(parseArgs(["bridge", "--game", "C:/WoW", "--mcp", "https://everloot.app/mcp", "--token-file", "t.txt"]))
    .toEqual({ command: "bridge", game: "C:/WoW", endpoint: "https://everloot.app", mcp: "https://everloot.app/mcp", tokenFile: "t.txt" });
  expect(() => parseArgs(["bridge", "--file", "x.lua", "--mcp", "https://e/mcp", "--token-file", "t"])).toThrow(/--game/);
  expect(() => parseArgs(["bridge", "--game", "C:/WoW", "--token-file", "t"])).toThrow(/--mcp/);
  expect(() => parseArgs(["bridge", "--game", "C:/WoW", "--mcp", "https://e/mcp"])).toThrow(/--token-file/);
});

test("before sending, the companion says how uploads are licensed and where the source is", () => {
  const notice = uploadNotice();
  expect(notice).toContain("Uploaded observations are published under CC BY-SA 4.0, credited to Everloot contributors.");
  expect(notice).toContain("Source: https://github.com/Everloot/everloot");
});

test("an upload's line says how many rows the site turned away, and only when it turned some away", () => {
  const r = { sent: 500, batches: 2, skipped: 0, heldNamed: 1, heldLegacy: 0, heldAddons: 0, heldCensus: 0, heldPlayers: 0, invalid: 0, rejected: 2000 };
  expect(uploadSummary("Everloot.lua", r)).toBe("Everloot.lua: sent 500 new events in 2 batch(es); the site turned away 2000 rows, which stay unsent and go again next run; kept 1 named, 0 installed-addon, 0 census, 0 player and 0 legacy rows here.");
  expect(uploadSummary("Everloot.lua", { ...r, rejected: 0 })).toBe("Everloot.lua: sent 500 new events in 2 batch(es); kept 1 named, 0 installed-addon, 0 census, 0 player and 0 legacy rows here.");
});

test("prices needs the game folder, because it writes the slot addon there", () => {
  expect(parseArgs(["prices", "--game", "C:/WoW"])).toEqual({ command: "prices", game: "C:/WoW", endpoint: "https://everloot.app" });
  expect(() => parseArgs(["prices", "--file", "x.lua"])).toThrow(/prices needs --game/);
});

describe("the bridge command, started as a real process", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
  let site: Awaited<ReturnType<typeof loopbackSite>>;
  beforeAll(async () => { site = await loopbackSite(); });
  afterAll(async () => { await site.stop(); });

  const MARKET = "Item 2589 on Forever, all houses: market 3s 10c";
  const configs: [string, ((d: string) => string) | null][] = [
    ["no config", null],
    ["malformed JSON", () => "{"],
    ["a null provider entry", () => JSON.stringify({ providers: [null] })],
    ["a provider whose key file is missing", (d) => JSON.stringify({ providers: [{ type: "anthropic", apiKeyFile: join(d, "missing.key") }] })],
  ];

  const ask = (id: string, question: string) => `{["id"] = "${id}", ["question"] = "${question}", ["askedAt"] = "2026-10-27T00:00:00Z"},`;
  /** A game folder with three queued asks (a price, a price with no realm, a question needing a provider) and the config beside the state file. */
  function game(config: ((d: string) => string) | null) {
    const d = mkdtempSync(join(tmpdir(), "everloot-cli-"));
    dirs.push(d);
    if (config) writeFileSync(join(d, "config.json"), config(d));
    mkdirSync(join(d, "WTF", "Account", "TEST", "SavedVariables"), { recursive: true });
    writeFileSync(join(d, "WTF", "Account", "TEST", "SavedVariables", "Everloot.lua"),
      `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {}, ["asks"] = {${ask("ask:1", "price 2589 on Forever")}${ask("ask:2", "price 2589")}${ask("ask:3", "Where does Linen Cloth drop?")}}}\n`);
    return d;
  }
  /** Runs `bridge` until the slot addon holds all three answers (or it exits), then stops it; returns what it said and wrote. */
  async function bridge(d: string, token: string) {
    const out = { stdout: "", stderr: "", code: null as number | null };
    let didExit = false;
    const child = spawn(process.execPath, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "src", "cli.ts"), "bridge", "--game", d, "--mcp", `${site.endpoint}/mcp`, "--token-file", token, "--endpoint", site.endpoint, "--state", join(d, "sent.json")], { cwd: root });
    child.stdout.on("data", (b) => { out.stdout += b; });
    child.stderr.on("data", (b) => { out.stderr += b; });
    const exited = new Promise<void>((resolve) => child.on("exit", (code) => { didExit = true; out.code = code; resolve(); }));
    const answers = join(d, "Interface", "AddOns", "EverlootAnswers", "EverlootAnswers.lua");
    const deadline = Date.now() + 40_000;
    while (!didExit && Date.now() < deadline && !(existsSync(answers) && readFileSync(answers, "utf8").includes('["ask:3"]'))) await new Promise((r) => setTimeout(r, 100));
    // Capture liveness before our own cleanup: tsx reports SIGTERM differently across operating systems.
    const running = !didExit;
    if (running) { child.kill(); await exited; }
    return { ...out, running, lua: existsSync(answers) ? readFileSync(answers, "utf8") : "" };
  }
  const tokenIn = (d: string) => { const t = join(d, "token.txt"); writeFileSync(t, "private-token\n"); return t; };

  test.each(configs)("answers a price and asks which realm, whatever the provider settings are: %s", async (_name, config) => {
    const d = game(config);
    const from = site.seen.length;
    const run = await bridge(d, tokenIn(d));
    expect(run.lua).toContain(MARKET);
    expect(run.lua).toMatch(/\["ask:2"\] = \{ \["answer"\] = "Which realm\? /);
    expect(run.lua).toContain('["ask:3"]');
    expect(site.since(from)).toContain("/mcp tools/call market_value");
    // The price is the market's alone, and it carries the private token the bridge was started with.
    expect(site.seen.slice(from).filter((s) => s.path === "/mcp").every((s) => s.auth === "Bearer private-token")).toBe(true);
    expect(run.running).toBe(true);
  }, 60_000);

  test.each(configs.slice(1))("still names the provider problem, and does not search, for a question that needs a provider: %s", async (_name, config) => {
    const d = game(config);
    const from = site.seen.length;
    const run = await bridge(d, tokenIn(d));
    expect(run.stdout).toMatch(/config\.json/);
    expect(run.stdout).toMatch(/Price questions are answered from the recorded market, without a model\./);
    expect(run.lua).toMatch(/\["ask:3"\] = \{ \["answer"\] = "Could not answer: /);
    expect(site.since(from).some((r) => r.includes("answer_sources"))).toBe(false);
  }, 60_000);

  test("a token file that cannot be read still stops the bridge before any request", async () => {
    const d = game(null);
    const from = site.seen.length;
    const run = await bridge(d, join(d, "gone.txt"));
    expect(run.running).toBe(false);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/ENOENT|gone\.txt/);
    expect(site.since(from)).toEqual([]);
  }, 60_000);
});
