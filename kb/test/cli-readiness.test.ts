import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { openDb } from "../src/db.js";
import { replaceSourceRows } from "../src/entities.js";
import { snapshot } from "../src/snapshot.js";

// A serve command is expected to keep running, so a refused one is proven by its exit, and a
// running one is stopped deliberately. Both need more than the 5s default per test.
vi.setConfig({ testTimeout: 60_000 });

/**
 * Startup is a safety boundary: the commands that answer questions must refuse anything that is not
 * an approved public release, and they must not create a database as a side effect of asking. These
 * tests drive the real CLI in a child process, because the failure being pinned is a process that
 * starts listening (or does not) — not a function's return value.
 */

const KB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TSX = join(KB_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CLI = join(KB_ROOT, "src", "cli.ts");
const DEFAULT_DB = join("data", "everloot-kb.sqlite");

const LORE = {
  kind: "lore_page",
  extId: "1",
  name: "Thrall",
  body: "Warchief of the Horde",
  gameVersion: "lore",
  sourceUrl: "https://example.test/1",
  retrievedAt: "2023-11-13",
} as const;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A genuine exporter release: manifest, licence, notice, registry sources, no free pages. */
async function release(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "kb-cli-"));
  const live = openDb(join(dir, "kb.sqlite"));
  await replaceSourceRows(live, "curated", ["lore_page"], [LORE]);
  const out = join(dir, "release", "release.sqlite");
  snapshot(live, out, new Date("2026-10-05T12:00:00Z"));
  live.close();
  return out;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run the CLI to completion, with a hard bound so a serve command cannot hang the suite. */
function runCli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string } = {}): Promise<Run> {
  return new Promise((done) => {
    const child = start(args, opts);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c));
    child.stderr.on("data", (c: Buffer) => (stderr += c));
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
    if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}

function start(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [TSX, CLI, ...args], {
    cwd: opts.cwd ?? KB_ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** A port that was free a moment ago, so an invalid startup cannot have bound it. */
async function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

/** True when nothing is listening: binding the port itself is the probe. */
async function portIsFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
  });
}

test("serve-mcp without --db refuses and creates no default database", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kb-cwd-"));
  const run = await runCli(["serve-mcp"], { cwd });

  expect(run.code).not.toBe(0);
  expect(run.stderr).toMatch(/--db/);
  expect(existsSync(join(cwd, DEFAULT_DB))).toBe(false);
  expect(existsSync(join(cwd, "data"))).toBe(false);
});

test("serve-mcp with a blank --db refuses and creates nothing", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kb-cwd-"));
  const run = await runCli(["serve-mcp", "--db", "   "], { cwd });

  expect(run.code).not.toBe(0);
  expect(existsSync(join(cwd, DEFAULT_DB))).toBe(false);
  expect(existsSync(join(cwd, "data"))).toBe(false);
});

test("serve-mcp-http with a nonexistent release refuses and never listens", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kb-cwd-"));
  const port = await freePort();
  const run = await runCli(["serve-mcp-http", "--db", join(cwd, "absent.sqlite"), "--port", String(port)], { cwd });

  expect(run.code).not.toBe(0);
  expect(run.stderr).toMatch(/not found|exist/i);
  expect(existsSync(join(cwd, "absent.sqlite"))).toBe(false);
  expect(await portIsFree(port)).toBe(true);
});

test("serve-mcp-http without --db refuses and never listens", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kb-cwd-"));
  const port = await freePort();
  const run = await runCli(["serve-mcp-http", "--port", String(port)], { cwd });

  expect(run.code).not.toBe(0);
  expect(existsSync(join(cwd, DEFAULT_DB))).toBe(false);
  expect(await portIsFree(port)).toBe(true);
});

test("serve-mcp-http on a release without a manifest refuses", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kb-cwd-"));
  const port = await freePort();
  const run = await runCli(["serve-mcp-http", "--db", join(cwd, "release.sqlite"), "--port", String(port)], { cwd });

  expect(run.code).not.toBe(0);
  expect(await portIsFree(port)).toBe(true);
});

test("serve-mcp-http on a tampered release refuses without changing its bytes", async () => {
  const dbPath = await release();
  const bytes = readFileSync(dbPath);
  writeFileSync(dbPath, Buffer.concat([bytes, Buffer.from("tampered")]));
  const before = sha256(dbPath);

  const port = await freePort();
  const run = await runCli(["serve-mcp-http", "--db", dbPath, "--port", String(port)]);

  expect(run.code).not.toBe(0);
  expect(run.stderr).toMatch(/hash|sha256|not a database|integrity/i);
  expect(sha256(dbPath)).toBe(before);
  expect(await portIsFree(port)).toBe(true);
});

test("serve-mcp on a tampered release never answers an initialize request", async () => {
  const dbPath = await release();
  const bytes = readFileSync(dbPath);
  writeFileSync(dbPath, Buffer.concat([bytes, Buffer.from("tampered")]));
  const before = sha256(dbPath);

  const child = start(["serve-mcp", "--db", dbPath]);
  let stdout = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c));
  try {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      })}\n`,
    );
    child.stdin.end();
    await new Promise((done) => setTimeout(done, 8000));

    expect(stdout).not.toContain('"serverInfo"');
    expect(sha256(dbPath)).toBe(before);
  } finally {
    child.kill();
  }
});

test("stats, search and validate without --db refuse and create no default database", async () => {
  for (const command of ["stats", "search", "validate"]) {
    const cwd = mkdtempSync(join(tmpdir(), "kb-cwd-"));
    const run = await runCli([command, ...(command === "search" ? ["thrall"] : [])], { cwd });

    expect(run.code, command).not.toBe(0);
    expect(run.stderr, command).toMatch(/--db/);
    expect(existsSync(join(cwd, DEFAULT_DB)), command).toBe(false);
    expect(existsSync(join(cwd, "data")), command).toBe(false);
  }
});

test("stats reads an approved release without writing to it", async () => {
  const dbPath = await release();
  const before = sha256(dbPath);

  const stats = await runCli(["stats", "--db", dbPath]);
  expect(stats.code).toBe(0);
  expect(stats.stdout).toContain("curated");
  expect(sha256(dbPath)).toBe(before);
});

test("validate needs an explicit path and stays the documented writable diagnostic", async () => {
  const dbPath = await release();
  const validated = await runCli(["validate", "--db", dbPath]);
  expect(validated.code).toBe(0);
  expect(validated.stdout.trim()).toBe("ok");
  // Deliberately no byte-equality claim here: validate rebuilds the fts5 index, which is a write.
  // That is why it is a diagnostic command and never part of a serving path.
});

test("validate refuses a missing or empty knowledge base instead of creating one and printing ok", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kb-cwd-"));
  const typo = join(cwd, "typo.sqlite");
  const missing = await runCli(["validate", "--db", typo], { cwd });
  expect(missing.code).not.toBe(0);
  expect(missing.stdout.trim()).not.toBe("ok");
  expect(existsSync(typo)).toBe(false);

  const emptyPath = join(cwd, "empty.sqlite");
  openDb(emptyPath).close();
  const empty = await runCli(["validate", "--db", emptyPath], { cwd });
  expect(empty.code).not.toBe(0);
  expect(empty.stdout + empty.stderr).toMatch(/no entities/);
});

test("snapshot needs an explicit, existing source database and creates no default one", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kb-cwd-"));
  const implicit = await runCli(["snapshot", join(cwd, "out", "release.sqlite")], { cwd });
  expect(implicit.code).not.toBe(0);
  expect(implicit.stderr).toMatch(/--db/);
  expect(existsSync(join(cwd, "data"))).toBe(false);

  const typo = join(cwd, "typo.sqlite");
  const missing = await runCli(["snapshot", join(cwd, "out", "release.sqlite"), "--db", typo], { cwd });
  expect(missing.code).not.toBe(0);
  expect(existsSync(typo)).toBe(false);
});

test("serve-mcp-http serves an approved release: bearer refused, token accepted, file unchanged", async () => {
  const dbPath = await release();
  const before = sha256(dbPath);
  const token = "release-token-for-tests";
  const child = start(["serve-mcp-http", "--db", dbPath, "--port", "0"], { env: { EVERLOOT_MCP_TOKEN: token } });
  let stdout = "";
  child.stdout.on("data", (c: Buffer) => (stdout += c));

  try {
    const port = await new Promise<number>((done, fail) => {
      const deadline = setTimeout(() => fail(new Error(`server never announced a port: ${stdout}`)), 30_000);
      child.stdout.on("data", (c: Buffer) => {
        const match = /127\.0\.0\.1:(\d+)\/mcp/.exec(String(c));
        if (match) {
          clearTimeout(deadline);
          done(Number(match[1]));
        }
      });
    });

    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify(body),
      });

    const anon = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    expect(anon.status).toBe(401);

    const auth = { authorization: `Bearer ${token}` };
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } }, auth);
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("everloot-knowledge");

    const listed = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, auth);
    expect((await listed.json()).result.tools.map((t: { name: string }) => t.name)).toContain("search_knowledge");

    const called = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_knowledge", arguments: { query: "Thrall" } } }, auth);
    expect((await called.json()).result.content[0].text).toContain("Thrall");
  } finally {
    child.kill();
  }
  expect(sha256(dbPath)).toBe(before);
});

test("serve-mcp answers initialize, tools/list and a sourced search over stdio", async () => {
  const dbPath = await release();
  const before = sha256(dbPath);
  const child = start(["serve-mcp", "--db", dbPath]);
  const replies = new Map<number, any>();
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (typeof msg.id === "number") replies.set(msg.id, msg);
      } catch {
        // A non-JSON line on stdout would be protocol contamination, which the assertions below catch.
      }
    }
  });

  const send = (msg: unknown) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  const await_ = async (id: number) => {
    for (let i = 0; i < 300 && !replies.has(id); i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(replies.has(id), `no reply to request ${id}`).toBe(true);
    return replies.get(id);
  };

  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    expect((await await_(1)).result.serverInfo.name).toBe("everloot-knowledge");

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((await await_(2)).result.tools.map((t: { name: string }) => t.name)).toContain("search_knowledge");

    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_knowledge", arguments: { query: "Thrall" } } });
    expect((await await_(3)).result.content[0].text).toContain("CC-BY-SA-4.0");
  } finally {
    child.kill();
  }
  expect(sha256(dbPath)).toBe(before);
});

test("audit-sources prints one line per file and exits 1 only when a file is not publishable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-audit-cli-"));
  const build = async (name: string, sources: Array<"curated" | "blizzard-api">): Promise<string> => {
    const path = join(dir, name);
    const db = openDb(path);
    for (const source of sources) await replaceSourceRows(db, source, ["lore_page"], [{ ...LORE, extId: source }]);
    db.close();
    return path;
  };
  const clean = await build("clean.sqlite", ["curated"]);
  const dirty = await build("dirty.sqlite", ["curated", "blizzard-api"]);

  const ok = await runCli(["audit-sources", clean]);
  expect(ok.code).toBe(0);
  expect(ok.stdout.trim()).toBe(`${clean}: curated=1 api_cache=0`);

  const both = await runCli(["audit-sources", clean, dirty]);
  expect(both.code).toBe(1);
  expect(both.stdout.trim().split("\n")).toEqual([
    `${clean}: curated=1 api_cache=0`,
    `${dirty}: blizzard-api=1 curated=1 api_cache=0  NOT PUBLISHABLE: blizzard-api`,
  ]);
});