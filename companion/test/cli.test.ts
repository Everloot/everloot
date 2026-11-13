import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { debounce, defaultStatePath, main, parseArgs, sharesInstallWith, uploadNotice, uploadSummary, type MainDeps } from "../src/cli";
import { loopbackSite } from "./loopback-mcp";
import { RateLimited, uploadFile } from "../src/uploader";
import { createSentState, receiptKeyForSite } from "../src/sent-state";

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
  const r = { sent: 500, batches: 2, skipped: 0, heldNamed: 1, heldLegacy: 0, heldAddons: 0, heldCensus: 0, heldPlayers: 0, heldRuns: 0, invalid: 0, rejected: 2000 };
  expect(uploadSummary("Everloot.lua", r)).toBe("Everloot.lua: sent 500 new events in 2 batch(es); the site turned away 2000 rows, which stay unsent and go again next run; kept 1 named, 0 installed-addon, 0 census, 0 player and 0 legacy rows here.");
  expect(uploadSummary("Everloot.lua", { ...r, rejected: 0 })).toBe("Everloot.lua: sent 500 new events in 2 batch(es); kept 1 named, 0 installed-addon, 0 census, 0 player and 0 legacy rows here.");
  expect(uploadSummary("Everloot.lua", { ...r, rejected: 0, heldRuns: 3 })).toBe("Everloot.lua: sent 500 new events in 2 batch(es); kept 1 named, 0 installed-addon, 0 census, 0 player and 0 legacy rows here. 3 runs and boss pulls wait here until the site reads them.");
});

test("two account files with one install id keep upload history whole; a file that cannot be read does not count", () => {
  const dir = mkdtempSync(join(tmpdir(), "everloot-shares-"));
  try {
    const save = (name: string, installId: string) => {
      const file = join(dir, name);
      writeFileSync(file, `EverlootDB = {\n["version"] = "0.2.2",\n["installId"] = "${installId}",\n["records"] = {},\n}\n`);
      return file;
    };
    const a = save("a.lua", "abcd-1234-ef56-7890"), b = save("b.lua", "abcd-1234-ef56-7890"), c = save("c.lua", "ffff-0000-ffff-0000");
    const broken = join(dir, "broken.lua");
    writeFileSync(broken, "EverlootDB = {");
    expect(sharesInstallWith(a, [a, b, c, broken])("abcd-1234-ef56-7890")).toBe(true);
    expect(sharesInstallWith(c, [a, b, c, broken])("ffff-0000-ffff-0000")).toBe(false);
    expect(sharesInstallWith(a, [a, c, broken, join(dir, "missing.lua")])("abcd-1234-ef56-7890")).toBe(false);
    expect(sharesInstallWith(a, [a])("abcd-1234-ef56-7890")).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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

  const MARKET = "Item 2589 on Forever, busiest auction house: market 3s 10c";
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
    expect(run.lua).toMatch(/\["ask:3"\] = \{ \["answer"\] = "Could not answer yet \(/);
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

describe("the upload, watch and prices loop, with a fake uploader and price writer", () => {
  const dirs: string[] = [];
  afterEach(() => { vi.useRealTimers(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const UPLOAD = { sent: 1, batches: 1, skipped: 0, heldNamed: 0, heldLegacy: 0, heldAddons: 0, heldCensus: 0, heldPlayers: 0, heldRuns: 0, invalid: 0, rejected: 0 };
  /** A game folder with one account file; the state file sits beside it so nothing is written to the user's app data. */
  function game() {
    const d = mkdtempSync(join(tmpdir(), "everloot-loop-"));
    dirs.push(d);
    const file = join(d, "WTF", "Account", "TEST", "SavedVariables", "Everloot.lua");
    mkdirSync(join(d, "WTF", "Account", "TEST", "SavedVariables"), { recursive: true });
    writeFileSync(file, 'EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {}}\n');
    return { d, file, args: ["--game", d, "--endpoint", "http://localhost:1", "--state", join(d, "sent.json")] };
  }
  /** Fakes that record each call in order, plus the watcher's listener so a test can deliver a file event. */
  function fakes(pricesFail = false) {
    const calls: string[] = [];
    const out: string[] = [], errors: string[] = [];
    const listeners = new Map<string, () => void>();
    const deps: MainDeps = {
      uploadFile: async (file) => { calls.push(`upload ${file}`); return UPLOAD; },
      refreshPrices: async () => { calls.push("prices"); if (pricesFail) throw new Error("site unreachable"); return { realms: 1, items: 2 }; },
      watchFile: (file, onChange) => { listeners.set(file, onChange); return () => {}; },
      console: { log: (line: string) => { out.push(line); }, error: (line: string) => { errors.push(line); } },
    };
    return { deps, calls, out, errors, listeners };
  }

  test("watch uploads each file once at start, then refreshes prices, and does both again after a settled write", async () => {
    vi.useFakeTimers();
    const { file, args } = game();
    const f = fakes();
    await main(["watch", ...args], f.deps);
    expect(f.calls).toEqual([`upload ${file}`, "prices"]);
    expect(f.out).toContain(uploadNotice());
    expect(f.out.some((l) => l.startsWith(`${file}: sent 1 new events`))).toBe(true);
    expect(f.out.some((l) => l.startsWith("Prices: 2 items on 1 realm(s) written to "))).toBe(true);
    expect(f.out).toContain("Watching 1 file(s). Leave this running while you play; Ctrl+C stops it.");
    expect([...f.listeners.keys()]).toEqual([file]);
    f.listeners.get(file)!();
    await vi.advanceTimersByTimeAsync(4999);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toEqual([`upload ${file}`, "prices", `upload ${file}`, "prices"]);
    expect(f.errors).toEqual([]);
  });

  test("prices runs the price writer alone, with no upload and no watcher", async () => {
    const { args } = game();
    const f = fakes();
    await main(["prices", ...args], f.deps);
    expect(f.calls).toEqual(["prices"]);
    expect(f.listeners.size).toBe(0);
    expect(f.out).not.toContain(uploadNotice());
    expect(f.errors).toEqual([]);
  });

  test("watch retries a failed logout upload without another file write", async () => {
    vi.useFakeTimers();
    const { d, file, args } = game();
    const f = fakes();
    let requests = 0;
    f.deps.uploadFile = (path, options) => uploadFile(path, { ...options, fetch: async () => {
      requests++;
      if (requests === 1) throw new TypeError("fetch failed");
      return Response.json({ ok: true, persisted: true, uploadId: "u-1", accepted: [{ index: 0, kind: "loot" }], rejected: [] });
    } });
    await main(["watch", ...args], f.deps);
    writeFileSync(file, `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {["loot"] = {{["eventId"] = "epoch:1", ["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = 42, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}}}}}`);
    f.listeners.get(file)!();
    await vi.advanceTimersByTimeAsync(5000);
    const confirmed = () => createSentState(join(d, "sent.json")).has(receiptKeyForSite("abcd-1234-ef56-7890", "http://localhost:1"), "epoch:1");
    expect(confirmed()).toBe(false);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(requests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toBe(2);
    expect(confirmed()).toBe(true);
  });

  test("a 429 postpones every account until Retry-After", async () => {
    vi.useFakeTimers();
    const { d, file, args } = game();
    const other = join(d, "WTF", "Account", "ZOTHER", "SavedVariables", "Everloot.lua");
    mkdirSync(join(d, "WTF", "Account", "ZOTHER", "SavedVariables"), { recursive: true });
    writeFileSync(other, readFileSync(file));
    const f = fakes();
    let limited = true;
    f.deps.uploadFile = async (path) => {
      f.calls.push(`upload ${path}`);
      if (limited) { limited = false; throw new RateLimited("wait", 120_000); }
      return UPLOAD;
    };
    await main(["watch", ...args], f.deps);
    expect(f.calls).toEqual([`upload ${file}`]);
    f.listeners.get(other)!();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(f.calls).toEqual([`upload ${file}`]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls.filter((c) => c.startsWith("upload "))).toContain(`upload ${other}`);
    expect(f.calls.filter((c) => c === `upload ${file}`)).toHaveLength(2);
  });

  test("a save during a pending retry schedules one subsequent upload", async () => {
    vi.useFakeTimers();
    const { file, args } = game();
    const f = fakes();
    let attempts = 0;
    let finish!: () => void;
    let active = 0, peak = 0;
    f.deps.uploadFile = async () => {
      attempts++; active++; peak = Math.max(peak, active);
      try {
        if (attempts === 1) throw new Error("Could not reach http://localhost:1. Keep your file and retry.");
        if (attempts === 2) await new Promise<void>((resolve) => { finish = resolve; });
        return UPLOAD;
      } finally { active--; }
    };
    await main(["watch", ...args], f.deps);
    f.listeners.get(file)!(); f.listeners.get(file)!();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(2);
    f.listeners.get(file)!();
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toBe(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(3);
    expect(peak).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(attempts).toBe(3);
  });

  test("watch bounds transient retries and waits for a new save after permanent errors", async () => {
    vi.useFakeTimers();
    const { file, args } = game();
    const f = fakes();
    let attempts = 0;
    f.deps.uploadFile = async () => { attempts++; throw new Error("server error (HTTP 503)"); };
    await main(["watch", ...args], f.deps);
    await vi.advanceTimersByTimeAsync(60_000 + 300_000 + 900_000);
    expect(attempts).toBe(4);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(attempts).toBe(4);
    f.deps.uploadFile = async () => { attempts++; throw new Error("invalid key (HTTP 401)"); };
    f.listeners.get(file)!();
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toBe(5);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(attempts).toBe(5);
  });

  test("watch serializes accounts and retains a save during the initial upload", async () => {
    vi.useFakeTimers();
    const { d, file, args } = game();
    const other = join(d, "WTF", "Account", "ZOTHER", "SavedVariables", "Everloot.lua");
    mkdirSync(join(d, "WTF", "Account", "ZOTHER", "SavedVariables"), { recursive: true });
    writeFileSync(other, readFileSync(file));
    const f = fakes();
    let finish!: () => void;
    const uploads: string[] = [];
    let active = 0, peak = 0;
    f.deps.uploadFile = async (path) => {
      uploads.push(path); active++; peak = Math.max(peak, active);
      if (uploads.length === 1) await new Promise<void>((resolve) => { finish = resolve; });
      active--;
      return UPLOAD;
    };
    const started = main(["watch", ...args], f.deps);
    f.listeners.get(file)!(); f.listeners.get(other)!();
    await vi.advanceTimersByTimeAsync(5000);
    expect(uploads).toEqual([file]);
    finish();
    await started;
    expect(uploads.filter((path) => path === file)).toHaveLength(2);
    expect(uploads).toContain(other);
    expect(peak).toBe(1);
  });

  test("a save during the last failed retry still gets its own upload", async () => {
    vi.useFakeTimers();
    const { file, args } = game();
    const f = fakes();
    let attempts = 0;
    let finish!: () => void;
    f.deps.uploadFile = async () => {
      attempts++;
      if (attempts === 4) await new Promise<void>((resolve) => { finish = resolve; });
      if (attempts <= 4) throw new Error("server error (HTTP 503)");
      return UPLOAD;
    };
    await main(["watch", ...args], f.deps);
    await vi.advanceTimersByTimeAsync(60_000 + 300_000 + 900_000);
    expect(attempts).toBe(4);
    f.listeners.get(file)!();
    await vi.advanceTimersByTimeAsync(5000);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(5);
  });

  test("watch retries a connection reset while reading an upload receipt", async () => {
    vi.useFakeTimers();
    const { d, file, args } = game();
    writeFileSync(file, `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {["loot"] = {{["eventId"] = "epoch:1", ["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = 42, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}}}}}`);
    const f = fakes();
    let requests = 0;
    f.deps.uploadFile = (path, options) => uploadFile(path, { ...options, fetch: async () => {
      requests++;
      if (requests === 1) return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } }));
      return Response.json({ ok: true, persisted: true, uploadId: "u-1", accepted: [{ index: 0, kind: "loot" }], rejected: [] });
    } });
    await main(["watch", ...args], f.deps);
    const confirmed = () => createSentState(join(d, "sent.json")).has(receiptKeyForSite("abcd-1234-ef56-7890", "http://localhost:1"), "epoch:1");
    expect(confirmed()).toBe(false);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(requests).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toBe(2);
    expect(confirmed()).toBe(true);
  });

  test("a price refresh that throws says the previous ones stay, and the loop keeps running", async () => {
    vi.useFakeTimers();
    const { file, args } = game();
    const f = fakes(true);
    await main(["watch", ...args], f.deps);
    expect(f.errors).toEqual(["Prices not updated (the previous ones stay): site unreachable"]);
    expect(f.out).toContain("Watching 1 file(s). Leave this running while you play; Ctrl+C stops it.");
    f.listeners.get(file)!();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.calls).toEqual([`upload ${file}`, "prices", `upload ${file}`, "prices"]);
    expect(f.errors).toHaveLength(2);
  });

  test("upload sends each file and never calls the price writer or the watcher", async () => {
    const { file, args } = game();
    const f = fakes();
    await main(["upload", ...args], f.deps);
    expect(f.calls).toEqual([`upload ${file}`]);
    expect(f.listeners.size).toBe(0);
    expect(f.out.some((l) => l.startsWith("Watching"))).toBe(false);
    expect(f.errors).toEqual([]);
  });
});
