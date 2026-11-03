import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import * as svParse from "../../web/src/lib/sv-parse";
import { createSentState } from "../../companion/src/sent-state";
import { uploadFile } from "../../companion/src/uploader";
import { emptySettledList, encodeIds } from "../../kb/src/settled-list";
import { factsFrom, onFacts, peekFacts, readyFacts, saveFacts } from "../src/main/save-facts";
import { readForUpload, useSaveReader } from "../src/main/save-reader";
import { BROKEN, CHARACTERS, NO_INSTALL, UPLOAD_TEXTS, save } from "./save-fixtures";

// Counts the main thread's parses; the worker runs its own bundled copy of the parser, which these do not see.
vi.mock("../../web/src/lib/sv-parse", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../web/src/lib/sv-parse")>();
  return { ...real, parseEverlootTable: vi.fn(real.parseEverlootTable), parseEverlootLua: vi.fn(real.parseEverlootLua) };
});
const table = vi.mocked(svParse.parseEverlootTable), lua = vi.mocked(svParse.parseEverlootLua);

/** dist/parse-worker.cjs as scripts/build.mjs bundles it. */
let code = "";
beforeAll(async () => {
  const out = await build({
    entryPoints: [fileURLToPath(new URL("../src/main/parse-worker.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", target: "node22", write: false,
    alias: { zod: fileURLToPath(new URL("../../web/node_modules/zod", import.meta.url)) },
  });
  code = out.outputFiles[0].text;
});

const lines: string[] = [];
const reader = (setup: { code?: string; timeoutMs?: number } = {}) => useSaveReader({ code: () => setup.code ?? code, log: (t) => { lines.push(t); }, timeoutMs: setup.timeoutMs });
const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-reader-")); dirs.push(d); return d; };
afterEach(() => {
  useSaveReader(null);
  lines.length = 0;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** What a call gives: its value, or the type, message and code of what it throws. */
const outcome = <T>(fn: () => T) => {
  try { return { value: fn() }; } catch (err) { const e = err as Error & { code?: string }; return { lua: e instanceof svParse.LuaParseError, type: e.constructor.name, message: e.message, code: e.code }; }
};
const settle = async <T>(fn: () => Promise<T>) => {
  try { return { value: await fn() }; } catch (err) { const e = err as Error & { code?: string }; return { lua: e instanceof svParse.LuaParseError, type: e.constructor.name, message: e.message, code: e.code }; }
};

const FIXTURES: Record<string, string> = { ...UPLOAD_TEXTS, scans: save("Nightslayer"), characters: CHARACTERS, "no install": NO_INSTALL, broken: BROKEN };

test("the reader's facts are the ones saveFacts reads on the main thread, broken files included", async () => {
  reader();
  const d = dir();
  for (const [name, text] of Object.entries(FIXTURES)) {
    const file = join(d, `${name}.lua`);
    writeFileSync(file, text);
    table.mockClear();
    await readyFacts([file]);
    const got = outcome(() => saveFacts(file));
    expect(table, name).not.toHaveBeenCalled();
    // factsFrom is what saveFacts runs on the main thread for a miss.
    expect(got, name).toEqual(outcome(() => factsFrom(text)));
  }
  expect(lines).toEqual([]);
});

test("the state push's peek never reads the file: it shows the last facts and the reader tells it of the next write", async () => {
  reader();
  const file = join(dir(), "Everloot.lua");
  writeFileSync(file, save("Nightslayer"));
  table.mockClear(); lua.mockClear();
  expect(peekFacts(file)).toBeNull();
  await readyFacts([file]);
  expect(peekFacts(file)?.scans.map((s) => s.realm)).toEqual(["Nightslayer"]);
  const told: string[] = [];
  const stop = onFacts((f) => told.push(f));
  // The next logout: until the reader is done the push shows the write before.
  writeFileSync(file, save("Doomhowl") + "\n");
  expect(peekFacts(file)?.scans.map((s) => s.realm)).toEqual(["Nightslayer"]);
  await readyFacts([file]);
  expect(told).toEqual([file]);
  expect(peekFacts(file)?.scans.map((s) => s.realm)).toEqual(["Doomhowl"]);
  // The same write again is not read again and is not news.
  await readyFacts([file]);
  expect(told).toEqual([file]);
  stop();
  // A file that does not parse peeks as nothing, as the push's scan read always showed it.
  writeFileSync(file, BROKEN);
  await readyFacts([file]);
  expect(peekFacts(file)).toBeNull();
  expect(table).not.toHaveBeenCalled();
  expect(lua).not.toHaveBeenCalled();
});

/** A SavedVariables file in the shape the addon writes (as companion/test/uploader.test.ts builds it). */
function luaFile(rows: { kind: string; lua: string }[], build = "1.60.1.70450"): string {
  const byKind = new Map<string, string[]>();
  for (const { kind, lua: l } of rows) byKind.set(kind, [...(byKind.get(kind) ?? []), l]);
  const records = [...byKind].map(([kind, list]) => `["${kind}"] = {\n${list.map((l) => `{${l}},`).join("\n")}\n},`).join("\n");
  return `EverlootDB = {\n["version"] = "0.2.2",\n["clientBuild"] = "${build}",\n["installId"] = "abcd-1234-ef56-7890",\n["records"] = {\n${records}\n},\n}\n`;
}
const loot = (n: number, npc = 42) => ({ kind: "loot", lua: `["eventId"] = "epoch:${n}", ["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = ${npc}, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}` });
const HELD = [
  { kind: "addon_seen", lua: `["eventId"] = "epoch:700", ["capturedAt"] = "2026-10-09T00:00:00Z", ["name"] = "Questie", ["title"] = "Questie", ["loaded"] = true` },
  { kind: "census_self", lua: `["eventId"] = "census_self:2026-10-18:1", ["capturedAt"] = "2026-10-18T00:00:00Z", ["guid"] = "Player-4242-00AABBCC", ["race"] = "Orc", ["class"] = "WARRIOR", ["level"] = 20, ["faction"] = "Horde", ["realm"] = "Forever"` },
  { kind: "player_seen", lua: `["eventId"] = "player_seen:1", ["capturedAt"] = "2026-10-20T00:00:00Z", ["name"] = "Thrallina", ["realm"] = "Forever", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 20, ["guild"] = "Night Watch"` },
  { kind: "gold_snapshot", lua: `["eventId"] = "epoch:900", ["capturedAt"] = "2026-10-09T00:00:00Z", ["character"] = "Thrall", ["realm"] = "Forever", ["currentCopper"] = 10, ["peakCopper"] = 10` },
  // No eventId: never marked sent, so it is weighed every run.
  { kind: "loot", lua: `["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = 44, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}` },
];

/** A stub intake that accepts every row but the ones from NPC 99, and remembers each batch. */
function intake() {
  const bodies: unknown[] = [];
  const send = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { records: { kind: string; sourceNpcId?: number }[] };
    bodies.push(body);
    const rejected = body.records.flatMap((r, index) => (r.sourceNpcId === 99 ? [{ index, reason: "no" }] : []));
    return Response.json({ ok: true, persisted: true, uploadId: `u-${bodies.length}`, rejected,
      accepted: body.records.flatMap((r, index) => (r.sourceNpcId === 99 ? [] : [{ index, kind: r.kind }])) });
  }) as typeof fetch;
  return { send, bodies };
}

test("an upload through the reader sends, skips, holds and marks sent exactly what the default read does", async () => {
  reader();
  const settled = { ...emptySettledList("1.60.1.70450"), dataAsOf: "2026-10-20T00:00:00.000Z", loot: { npc: encodeIds([43]), obj: [] } };
  const writes = [
    luaFile([loot(1), loot(2), loot(3, 43), loot(4, 99), ...HELD]),
    // The next logout: two more rows, one of them settled; the rest went last time.
    luaFile([loot(1), loot(2), loot(3, 43), loot(4, 99), ...HELD, loot(5), loot(6, 43)]),
    // Nothing new.
    luaFile([loot(1), loot(2), loot(3, 43), loot(4, 99), ...HELD, loot(5), loot(6, 43)]),
  ];
  const runs = { main: dir(), worker: dir() };
  const crossed: number[] = [];
  const results: Record<string, unknown[]> = { main: [], worker: [] };
  const sends = { main: intake(), worker: intake() };
  for (const text of writes) {
    for (const how of ["main", "worker"] as const) {
      const file = join(runs[how], "Everloot.lua");
      writeFileSync(file, text);
      const state = createSentState(join(runs[how], "sent.json"));
      const read = how === "worker" ? async (f: string, sent: (i: string, e: string) => boolean) => { const r = await readForUpload(f, sent); crossed.push(r.records.length); return r; } : undefined;
      lua.mockClear();
      results[how].push(await uploadFile(file, { endpoint: "https://everloot.app", fetch: sends[how].send, state, census: false, players: false, settled, read }));
      expect(lua).toHaveBeenCalledTimes(how === "main" ? 1 : 0);
    }
  }
  expect(results.worker).toEqual(results.main);
  expect(sends.worker.bodies).toEqual(sends.main.bodies);
  expect(readFileSync(join(runs.worker, "sent.json"), "utf8")).toBe(readFileSync(join(runs.main, "sent.json"), "utf8"));
  // Only the unsent rows cross: all 9 the first time; then less the 2 sent and the 1 settled, plus the 2 new; then less
  // those 2. The held rows (the one with no id among them) and the refused one are never marked sent, so they cross each time.
  expect(crossed).toEqual([9, 8, 6]);
  // Every count is in play: 2 sent, 1 settled, 1 refused, and one each held as named, legacy (no id), addon, census, player.
  const held = { heldNamed: 1, heldLegacy: 1, heldAddons: 1, heldCensus: 1, heldPlayers: 1, heldRuns: 0, invalid: 0, rejected: 1, batches: 1 };
  expect(results.main).toEqual([{ sent: 2, skipped: 1, ...held }, { sent: 1, skipped: 1, ...held }, { sent: 0, skipped: 0, ...held }]);
  expect(lines).toEqual([]);
});

test("the upload's read throws what parseEverlootLua(readFileSync(file)) throws", async () => {
  reader();
  const d = dir();
  // A read that succeeds also lists every record's event id, the ones it left out too.
  const onMain = (file: string) => () => Promise.resolve(svParse.parseEverlootLua(readFileSync(file, "utf8")))
    .then((p) => ({ ...p, eventIds: p.records.map((r) => (typeof r.eventId === "string" ? r.eventId : null)) }));
  for (const [name, text] of Object.entries({ ...UPLOAD_TEXTS, "no install": NO_INSTALL })) {
    const file = join(d, `${name}.lua`);
    writeFileSync(file, text);
    expect(await settle(() => readForUpload(file, () => false)), name).toEqual(await settle(onMain(file)));
  }
  const missing = join(d, "missing.lua");
  const gone = await settle(() => readForUpload(missing, () => false));
  expect(gone).toEqual(await settle(onMain(missing)));
  expect(gone).toMatchObject({ code: "ENOENT" });
  expect(lines).toEqual([]);
});

test("a reader that cannot start, dies or stops answering hands every read to the main thread, with one line", async () => {
  const d = dir();
  const file = join(d, "Everloot.lua");
  const cases: Record<string, { code?: string; timeoutMs?: number; why: RegExp }> = {
    "throws at start": { code: `throw new Error("boom")`, why: /boom/ },
    exits: { code: `process.exit(3)`, why: /exited with code 3/ },
    "never answers": { code: `require("node:worker_threads").parentPort.on("message", () => {})`, timeoutMs: 100, why: /no answer in 0 s/ },
  };
  let n = 0;
  for (const [name, setup] of Object.entries(cases)) {
    reader(setup);
    writeFileSync(file, luaFile([loot(++n)]));
    table.mockClear(); lua.mockClear();
    await readyFacts([file]);
    // The facts are read on the main thread instead.
    expect(saveFacts(file).upload.records, name).toBe(1);
    expect(table, name).toHaveBeenCalledTimes(1);
    const got = await readForUpload(file, () => false);
    expect(got.records.map((r) => r.eventId), name).toEqual([`epoch:${n}`]);
    expect(lua, name).toHaveBeenCalledTimes(1);
    expect(lines, name).toHaveLength(1);
    expect(lines[0], name).toMatch(why(setup.why));
    lines.length = 0;
  }
  // A bundle that cannot be read is the same.
  useSaveReader({ code: () => { throw new Error("ENOENT: parse-worker.cjs"); }, log: (t) => { lines.push(t); } });
  writeFileSync(file, luaFile([loot(++n)]));
  await readyFacts([file]);
  expect(saveFacts(file).upload.records).toBe(1);
  await readForUpload(file, () => false);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/could not start: ENOENT: parse-worker\.cjs/);
});

const why = (re: RegExp) => new RegExp(`^The background save reader stopped \\(.*${re.source}.*\\); save files are read on the main thread until the app restarts\\.$`);
