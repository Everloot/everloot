import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { emptySettledList, encodeIds } from "../../kb/src/settled-list";
import * as bridge from "../../companion/src/bridge/engine";
import { FIXTURE_STRUCTURED, FIXTURE_URL } from "../../web/src/lib/chat/market-fixture";
import { ACCOUNT_KEY_FILE, writeKeyOrigin } from "../src/main/account";
import { companionJobs } from "../src/main/jobs";
import { defaultSettings } from "../src/main/settings";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-desktop-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test.each(["https://other.test", "http://everloot.app", "https://everloot.app"])("the ask job scopes the account key to its checked site: %s", async (endpoint) => {
  const d = dir();
  const key = `evl_${"ab".repeat(32)}`;
  writeFileSync(join(d, ACCOUNT_KEY_FILE), key);
  writeKeyOrigin(d, "https://everloot.app");
  const file = join(d, "Everloot.lua");
  // A question that is not about a price, so it reaches the engine (the providers are read only then).
  writeFileSync(file, `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {}, ["asks"] = {{["id"] = "ask:1", ["question"] = "Thrall", ["askedAt"] = "2026-10-27T00:00:00Z"},}}\n`);
  const engine = vi.spyOn(bridge, "mcpEngine").mockReturnValue({ answer: async () => ({ answer: "ok", source: "test" }) });
  try {
    await companionJobs(d, () => ({ ...defaultSettings(), endpoint, gameFolder: d })).deps.ask(file);
    expect(engine.mock.calls[0][0].token).toBe(endpoint === "https://everloot.app" ? key : null);
  } finally { engine.mockRestore(); }
});

describe("a price question in /ask", () => {
  const ask = (id: string, question: string, realm?: string) =>
    `{["id"] = "${id}", ["question"] = "${question}", ["askedAt"] = "2026-10-27T00:00:00Z"${realm ? `, ["realm"] = "${realm}"` : ""}},`;
  const savedVariables = (d: string, asks: string) => {
    const file = join(d, "Everloot.lua");
    writeFileSync(file, `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {}, ["asks"] = {${asks}}}\n`);
    return file;
  };
  const settingsFor = (d: string, realms: string[] = []) => ({ ...defaultSettings(), gameFolder: d, endpoint: "https://everloot.app", market: { realms } });
  const written = (d: string) => readFileSync(join(d, "Interface", "AddOns", "EverlootAnswers", "EverlootAnswers.lua"), "utf8");

  test("is answered from market_value without the search engine or a model, then shown once", async () => {
    const d = dir();
    const file = savedVariables(d, ask("ask:1", "price 2589", "Forever") + ask("ask:2", "Thrall"));
    const search = vi.spyOn(bridge, "mcpEngine").mockReturnValue({ answer: vi.fn(async () => ({ answer: "Warchief.", source: "wiki" })) });
    const market = vi.spyOn(bridge, "mcpMarketValue").mockResolvedValue(FIXTURE_STRUCTURED);
    try {
      const { deps } = companionJobs(join(d, "data"), () => settingsFor(d));
      expect(await deps.ask(file)).toMatch(/^answered 2, failed 0/);
      const lua = written(d);
      expect(lua).toContain(`["ask:1"] = { ["answer"] = "Item 2589 on Forever, all houses: market 3s 10c`);
      expect(lua).toContain(`["source"] = ${JSON.stringify(FIXTURE_URL)}`);
      expect(lua).toContain('["ask:2"] = { ["answer"] = "Warchief."');
      expect(market).toHaveBeenCalledTimes(1);
      expect(market.mock.calls[0].slice(1, 3)).toEqual(["Forever", 2589]);
      expect(await deps.ask(file)).toMatch(/^nothing pending/);
      expect(market).toHaveBeenCalledTimes(1);
    } finally { search.mockRestore(); market.mockRestore(); }
  });

  test("with no realm in the ask or the words, it asks which, offering the followed realms", async () => {
    const d = dir();
    const file = savedVariables(d, ask("ask:3", "price 2589"));
    const search = vi.spyOn(bridge, "mcpEngine").mockReturnValue({ answer: vi.fn() });
    const market = vi.spyOn(bridge, "mcpMarketValue").mockResolvedValue(FIXTURE_STRUCTURED);
    try {
      await companionJobs(join(d, "data"), () => settingsFor(d, ["Nightslayer"])).deps.ask(file);
      expect(written(d)).toMatch(/\["ask:3"\] = \{ \["answer"\] = "Which realm\? .*Realms you follow: Nightslayer\./);
      expect(market).not.toHaveBeenCalled();
    } finally { search.mockRestore(); market.mockRestore(); }
  });
});

test("startup recovery exposes warnings for both damaged state files", () => {
  const d = dir();
  writeFileSync(join(d, "sent.json"), "");
  writeFileSync(join(d, "answers.json"), "{");
  const jobs = companionJobs(d, defaultSettings);
  expect(jobs.notices).toHaveLength(2);
  expect(jobs.notices.join("\n")).toContain("sent.json.corrupt-");
  expect(jobs.notices.join("\n")).toContain("answers.json.corrupt-");
  expect(jobs.answerStore.list()).toEqual([]);
});

const until = (check: () => boolean, ms = 3000) => new Promise<void>((res, rej) => {
  const start = Date.now();
  const tick = () => { if (check()) res(); else if (Date.now() - start > ms) rej(new Error("timed out")); else setTimeout(tick, 25); };
  tick();
});

test("the watcher reports a write to the account file and stops cleanly", async () => {
  const d = dir();
  const file = join(d, "Everloot.lua");
  writeFileSync(file, "EverlootDB = {}\n");
  const { deps } = companionJobs(join(d, "data"), () => defaultSettings());
  let changes = 0;
  const stop = deps.watch(file, () => { changes += 1; });
  // macOS starts delivering events a moment after the watcher is armed, so a single write
  // right away can go unseen; keep writing until the watcher reports one.
  let v = 1;
  await until(() => {
    if (changes === 0) writeFileSync(file, `EverlootDB = { v = ${++v} }\n`);
    return changes > 0;
  });
  stop();
  const seen = changes;
  writeFileSync(file, "EverlootDB = { v = 3 }\n");
  await new Promise((r) => setTimeout(r, 200));
  expect(changes).toBe(seen);
});

test("the watcher still sees writes after the game moves the file aside and writes a new one", async () => {
  const d = dir();
  const file = join(d, "Everloot.lua");
  writeFileSync(file, "EverlootDB = {}\n");
  const { deps } = companionJobs(join(d, "data"), () => defaultSettings());
  let changes = 0;
  const stop = deps.watch(file, () => { changes += 1; });
  let v = 1;
  await until(() => {
    if (changes === 0) writeFileSync(file, `EverlootDB = { v = ${++v} }\n`);
    return changes > 0;
  });
  // What a logout does: the old file becomes .bak and a new file takes its name.
  renameSync(file, `${file}.bak`);
  writeFileSync(file, "EverlootDB = { v = 100 }\n");
  await new Promise((r) => setTimeout(r, 800));
  const seen = changes;
  await until(() => {
    if (changes === seen) writeFileSync(file, `EverlootDB = { v = ${++v} }\n`);
    return changes > seen;
  });
  stop();
});

test("watching a file that is not there does not throw, and stop cancels the retry", () => {
  const d = dir();
  const { deps } = companionJobs(join(d, "data"), () => defaultSettings());
  const stop = deps.watch(join(d, "missing", "Everloot.lua"), () => {});
  expect(stop).not.toThrow();
});

test("the ask job refuses a token file it cannot read or that is empty", async () => {
  const d = dir();
  const empty = join(d, "empty.txt");
  writeFileSync(empty, "");
  const run = (tokenFile: string | null) => companionJobs(join(d, "data"), () => ({ ...defaultSettings(), ask: { enabled: true, mcpUrl: "https://example.test/mcp", tokenFile } })).deps.ask(join(d, "Everloot.lua"));
  await expect(run(join(d, "nope.txt"))).rejects.toThrow(/could not be read/);
  await expect(run(empty)).rejects.toThrow(/is empty/);
});

test("an upload leaves out settled rows, keeps the list in the data folder, and says how many it skipped", async () => {
  const d = dir();
  const build = "1.60.1.70450";
  const row = (n: number, npc: number) => `{["eventId"] = "epoch:${n}", ["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = ${npc}, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}},`;
  const file = join(d, "Everloot.lua");
  writeFileSync(file, `EverlootDB = {
["version"] = "0.2.2",
["clientBuild"] = "${build}",
["installId"] = "abcd-1234-ef56-7890",
["records"] = {
["loot"] = {
${row(1, 42)}
${row(2, 42)}
${row(3, 43)}
},
},
}
`);
  const list = { ...emptySettledList(build), dataAsOf: "2026-10-20T00:00:00.000Z", loot: { npc: encodeIds([42]), obj: [] } };
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/coverage/settled")) return Response.json(list, { headers: { etag: "\"a\"" } });
    const body = JSON.parse(String(init?.body));
    return Response.json({ ok: true, persisted: true, uploadId: "u-1", accepted: body.records.map((r: { kind: string }, index: number) => ({ index, kind: r.kind })), rejected: [] });
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const { deps } = companionJobs(join(d, "data"), () => ({ ...defaultSettings(), endpoint: "https://everloot.app" }));
    expect(await deps.upload(file)).toMatch(/^sent 1 new events in 1 batch\(es\); skipped 2 already settled; kept /);
    expect(existsSync(join(d, "data", `settled-${build}.json`))).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
