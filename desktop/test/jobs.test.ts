import type { CharacterLinkStatus } from "../src/shared/types";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { emptySettledList, encodeIds } from "../../kb/src/settled-list";
import * as bridge from "../../companion/src/bridge/engine";
import { createSentState, receiptKeyForSite } from "../../companion/src/sent-state";
import { FIXTURE_STRUCTURED, FIXTURE_URL } from "../../web/src/lib/chat/market-fixture";
import { ACCOUNT_KEY_FILE, writeKeyOrigin } from "../src/main/account";
import { afterLinks, afterSync, companionJobs } from "../src/main/jobs";
import { readPricesFile } from "../src/main/market";
import { defaultSettings } from "../src/main/settings";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-desktop-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("Market refresh scope", () => {
  function setup() {
    const first = dir(), second = dir();
    let settings = { ...defaultSettings(), gameFolder: first, endpoint: "https://first.test" };
    settings.market.realms = ["Nightslayer"];
    const jobs = companionJobs(dir(), () => settings);
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.host === "second.test" || url.pathname !== "/api/market/prices") return new Response("", { status: 503 });
      const house = url.searchParams.get("house") === "alliance" ? "Alliance" : "Horde";
      return Response.json({ ok: true, house, dataAsOf: "2026-10-18", items: [[2589, 100, 90, 110, 20, "2026-10-18", 3]] });
    });
    const switchFolder = (endpoint = "https://first.test") => { settings = { ...settings, gameFolder: second, endpoint }; };
    const read = (folder: string) => readPricesFile(join(folder, "Interface", "AddOns"))?.realms ?? [];
    return { first, second, jobs, request, switchFolder, read };
  }

  test("an in-flight refresh writes to the installation that started it", async () => {
    const { first, second, jobs, request, switchFolder, read } = setup();
    try {
      const refreshing = jobs.deps.prices([]);
      switchFolder();
      await refreshing;
      expect(read(first)).toMatchObject([
        { realm: "nightslayer", house: "Alliance" }, { realm: "nightslayer", house: "Horde" },
      ]);
      expect(read(second)).toEqual([]);
      expect(jobs.lastMarket()).toEqual([]);
    } finally { request.mockRestore(); }
  });

  test("a failed refresh after a scope change does not display the old receipt", async () => {
    const { second, jobs, request, switchFolder, read } = setup();
    try {
      await jobs.deps.prices([]);
      expect(jobs.lastMarket().map((row) => row.realm)).toEqual(["Nightslayer", "Nightslayer"]);
      switchFolder("https://second.test");
      await expect(jobs.deps.prices([])).rejects.toThrow(/HTTP 503/);
      expect(read(second)).toEqual([]);
      expect(jobs.lastMarket()).toEqual([]);
    } finally { request.mockRestore(); }
  });
});

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

test("an upload keeps the history whole while another account's file has the same install id", async () => {
  const d = dir();
  const account = (name: string, installId: string, eventId: string) => {
    const folder = join(d, "WTF", "Account", name, "SavedVariables");
    mkdirSync(folder, { recursive: true });
    const file = join(folder, "Everloot.lua");
    writeFileSync(file, `EverlootDB = { version = "0.3.14", installId = "${installId}", records = { loot = {
    { eventId = "${eventId}", capturedAt = "2026-10-27T00:00:00Z", sourceNpcId = 42, sourceEvidence = "loot-api", items = { { itemId = 5, count = 1 } } },
  } } }`);
    return file;
  };
  const settings = () => ({ ...defaultSettings(), gameFolder: d });
  const data = join(d, "data");
  const key = receiptKeyForSite("abcd-1234-ef56-7890", settings().endpoint);
  const history = () => JSON.parse(readFileSync(join(data, "sent.json"), "utf8"))[key];
  const a = account("A", "abcd-1234-ef56-7890", "epoch:2");
  // The other account's file is a copy: the same install id, and a row of its own.
  account("B", "abcd-1234-ef56-7890", "epoch:1");
  mkdirSync(data, { recursive: true });
  createSentState(join(data, "sent.json")).add(key, ["epoch:1", "epoch:2"]);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  try {
    // Both rows are sent already, so nothing goes; only the history is in question.
    await companionJobs(data, settings).deps.upload(a).catch(() => undefined);
    expect(history()).toEqual(["epoch:1", "epoch:2"]);
    // Once the other file has its own id, the history is cut to this file's rows.
    account("B", "ffff-0000-ffff-0000", "epoch:1");
    await companionJobs(data, settings).deps.upload(a).catch(() => undefined);
    expect(history()).toEqual(["epoch:2"]);
  } finally { vi.unstubAllGlobals(); }
});

describe("a price question in /ask", () => {
  const ask = (id: string, question: string, realm?: string) =>
    `{["id"] = "${id}", ["question"] = "${question}", ["askedAt"] = "2026-10-27T00:00:00Z"${realm ? `, ["realm"] = "${realm}"` : ""}},`;
  const savedVariables = (d: string, asks: string) => {
    const file = join(d, "Everloot.lua");
    writeFileSync(file, `EverlootDB = {["version"] = "0.3.4", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {}, ["asks"] = {${asks}}}\n`);
    return file;
  };
  const settingsFor = (d: string, realms: string[] = []) => ({ ...defaultSettings(), gameFolder: d, endpoint: "https://everloot.app", market: { realms, dismissed: [] } });
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
      expect(lua).toContain(`["ask:1"] = { ["answer"] = "Item 2589 on Forever, busiest auction house: market 3s 10c`);
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

test("an upload the site turned away says how many rows stay unsent", async () => {
  const d = dir();
  const file = join(d, "Everloot.lua");
  writeFileSync(file, `EverlootDB = {
["version"] = "0.2.2",
["installId"] = "abcd-1234-ef56-7890",
["records"] = {
["loot"] = {
{["eventId"] = "epoch:1", ["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = 42, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}},
},
},
}
`);
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    if (String(input).includes("/api/coverage/settled")) return new Response(null, { status: 404 });
    return Response.json({ ok: false, accepted: [], rejected: [{ index: 0, reason: "Not collected yet." }] }, { status: 422 });
  }));
  try {
    const { deps } = companionJobs(join(d, "data"), () => ({ ...defaultSettings(), endpoint: "https://everloot.app" }));
    expect(await deps.upload(file)).toMatch(/^sent 0 new events in 1 batch\(es\); the site turned away 1 row, which stays unsent and goes again next run; skipped 0 /);
  } finally {
    vi.unstubAllGlobals();
  }
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

describe("character link codes in the upload job", () => {
  const linkFile = (d: string, extra = "") => {
    const file = join(d, "Everloot.lua");
    writeFileSync(file, `EverlootDB = {
["version"] = "0.3.14",
["installId"] = "abcd-1234-ef56-7890",
["records"] = {${extra}
["character_link"] = {
{["eventId"] = "character_link:1", ["capturedAt"] = "2026-11-01T18:00:00Z", ["code"] = "EL-7K3Q-9P", ["name"] = "Thrallina", ["realm"] = "Forever Pioneer", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 24, ["faction"] = "Horde", ["guid"] = "Player-4395-0A1B2C3D", ["completionKey"] = "0a1b2c3d"},
},
["loot"] = {
{["eventId"] = "epoch:1", ["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = 42, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}},
},
},
}
`);
    return file;
  };
  const site = () => {
    const calls: { url: string; auth: string | null; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/coverage/settled")) return new Response(null, { status: 404 });
      calls.push({ url, auth: new Headers(init?.headers).get("authorization"), body: String(init?.body) });
      if (url.endsWith("/api/me/characters/sync")) {
        return Response.json({ characters: [{ index: 0, result: "synced", categories: { raids: "stored" } }], skipped: 0 });
      }
      const records = JSON.parse(String(init?.body)).records as { kind: string }[];
      if (url.endsWith("/api/me/characters/links")) {
        return Response.json({ results: [{ index: 0, status: "linked", name: "Thrallina", realm: "Forever Pioneer", message: "Linked." }] });
      }
      return Response.json({ ok: true, persisted: true, uploadId: "u-1", accepted: records.map((r, index) => ({ index, kind: r.kind })), rejected: [] });
    }));
    return calls;
  };

  test("signed in, the code goes to the link endpoint with the key, and the upload carries neither", async () => {
    const d = dir();
    const data = join(d, "data");
    const key = `evl_${"ab".repeat(32)}`;
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, ACCOUNT_KEY_FILE), key);
    writeKeyOrigin(data, "https://everloot.app");
    const calls = site();
    try {
      const said = await companionJobs(data, () => ({ ...defaultSettings(), endpoint: "https://everloot.app" })).deps.upload(linkFile(d));
      expect(said).toContain("linked Thrallina of Forever Pioneer");
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/intake", "/api/me/characters/links"]);
      expect(calls[0].auth).toBeNull();
      for (const secret of ["character_link", "Player-4395", "EL-7K3Q-9P", key]) expect(calls[0].body).not.toContain(secret);
      expect(calls[1].auth).toBe(`Bearer ${key}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("signed in, a linked character's raid lockouts go to the sync endpoint after the link, never with the upload", async () => {
    const d = dir();
    const data = join(d, "data");
    const key = `evl_${"ab".repeat(32)}`;
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, ACCOUNT_KEY_FILE), key);
    writeKeyOrigin(data, "https://everloot.app");
    const calls = site();
    const lockouts = `
["lockout_owned"] = {
{["capturedAt"] = "2026-11-05T10:00:00Z", ["characterKey"] = "0a1b2c3d", ["class"] = "SHAMAN", ["level"] = 24, ["instance"] = "Molten Core", ["instanceId"] = 409, ["difficultyId"] = 9, ["bossesKilledCount"] = 3, ["bossesTotal"] = 10, ["resetAt"] = "2099-01-01T08:00:00Z"},
},`;
    try {
      const said = await companionJobs(data, () => ({ ...defaultSettings(), endpoint: "https://everloot.app" })).deps.upload(linkFile(d, lockouts));
      expect(said).toContain("linked Thrallina of Forever Pioneer; synced 1 character");
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/intake", "/api/me/characters/links", "/api/me/characters/sync"]);
      expect(calls[0].body).not.toContain("lockout_owned");
      expect(calls[2].auth).toBe(`Bearer ${key}`);
      expect(JSON.parse(calls[2].body)).toEqual({ characters: [{ name: "Thrallina", realm: "Forever Pioneer", records: [expect.objectContaining({ kind: "lockout_owned", instance: "Molten Core" })] }] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("signed out, nothing goes to the link endpoint and the status says how to send it", async () => {
    const d = dir();
    const calls = site();
    try {
      const said = await companionJobs(join(d, "data"), () => ({ ...defaultSettings(), endpoint: "https://everloot.app" })).deps.upload(linkFile(d));
      expect(said).toMatch(/1 link code waits: Sign in/);
      expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/intake"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

test("runs and boss pulls stay unsent across runs, never resent, until a receipt says the site reads them", async () => {
  const d = dir();
  const file = join(d, "Everloot.lua");
  const loot = (n: number) => `{ eventId = "epoch:1${n}", capturedAt = "2026-11-02T12:00:00Z", sourceNpcId = 42, sourceEvidence = "loot-api", items = { { itemId = 5, count = 1 } } }`;
  const write = (loots: number) => writeFileSync(file, `EverlootDB = { version = "0.3.16", installId = "abcd-1234-ef56-7890", records = {
    loot = { ${Array.from({ length: loots }, (_, i) => loot(i)).join(", ")} },
    instance_run = { { eventId = "epoch:2", capturedAt = "2026-11-02T12:40:00Z", runId = "0123456789abcdef", instanceMapId = 36, instanceType = "party",
      enteredAt = "2026-11-02T11:50:00Z", leftAt = "2026-11-02T12:40:00Z", pulls = 1, kills = 1, wipes = 0, endReason = "left" } },
    pull_summary = { { eventId = "epoch:3", capturedAt = "2026-11-02T12:01:00Z", encounterId = 1144, name = "Rhahk'zor", instanceMapId = 36, success = true,
      realm = "Forever", members = { { name = "Thrallina", class = "SHAMAN" } } } },
  } }`);
  write(1);
  // The intake as main answers while the switch is off (unknown kinds), and with runRecords: true once it is on.
  let on = false;
  const sent: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("https://everloot.app/api/intake");
    const records = (JSON.parse(String(init?.body)) as { records: { kind: string }[] }).records;
    sent.push(records.map((r) => r.kind));
    const accepted: { index: number; kind: string }[] = [], rejected: { index: number; reason: string }[] = [];
    records.forEach((r, index) => (on || !["instance_run", "pull_summary"].includes(r.kind) ? accepted.push({ index, kind: r.kind }) : rejected.push({ index, reason: `unknown kind: ${r.kind}` })));
    const flag = on ? { runRecords: true } : {};
    return accepted.length ? Response.json({ ok: true, persisted: true, uploadId: `u-${sent.length}`, accepted, rejected, ...flag })
      : Response.json({ ok: false, accepted, rejected, ...flag }, { status: 422 });
  }));
  vi.useFakeTimers({ now: new Date("2026-11-02T13:00:00Z"), toFake: ["Date"] });
  try {
    const data = join(d, "data");
    // A new app each run, as after a restart: what the site said is read back from the data folder.
    const run = () => companionJobs(data, () => ({ ...defaultSettings(), endpoint: "https://everloot.app" })).deps.upload(file);
    expect(await run()).toMatch(/^sent 1 new events in 1 batch\(es\);.*; kept 2 runs and boss pulls here until the site reads them/);
    // Days of play with the switch off: new loot goes, the held rows never do.
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(Date.now() + 86_400_000);
      expect(await run()).toMatch(/^sent 0 new events in 0 batch\(es\);.*; kept 2 runs and boss pulls here until the site reads them/);
      write(i + 2);
      expect(await run()).toMatch(/^sent 1 new events in 1 batch\(es\);.*; kept 2 runs and boss pulls here until the site reads them/);
    }
    expect(sent).toEqual([["loot"], ["loot"], ["loot"], ["loot"]]);
    // The site switches collection on: the next upload's receipt says so, and the run after it sends the rows.
    on = true;
    write(5);
    expect(await run()).toMatch(/^sent 1 new events in 1 batch\(es\);.*; kept 2 runs and boss pulls here until the site reads them/);
    expect(await run()).toMatch(/^sent 2 new events in 1 batch\(es\); skipped/);
    expect(sent[5]).toEqual(["instance_run", "pull_summary"]);
    expect(await run()).toMatch(/^sent 0 new events in 0 batch\(es\)/);
    expect(sent).toHaveLength(6);
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

describe("the upload's character links and sync", () => {
  const KEY = `evl_${"ab".repeat(32)}`;
  const linkedFile = (d: string) => {
    const file = join(d, "Everloot.lua");
    writeFileSync(file, `EverlootDB = { ["version"] = "0.3.14", ["installId"] = "abcd-1234-ef56-7890", ["records"] = {
  ["character_link"] = { { ["eventId"] = "character_link:1", ["capturedAt"] = "2026-11-01T18:00:00Z", ["code"] = "EL-AAAA-01", ["name"] = "Thrallina", ["realm"] = "Forever Pioneer", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 24, ["faction"] = "Horde", ["guid"] = "Player-4395-0A1B2C3D", ["completionKey"] = "0a1b2c3d" } },
  ["title_owned"] = { { ["capturedAt"] = "2026-11-05T10:00:00Z", ["characterKey"] = "0a1b2c3d", ["class"] = "SHAMAN", ["level"] = 24, ["titleIds"] = { 1, 2 } } },
} }\n`);
    return file;
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  test("keep the link result and a refused sync's message for the Characters page", async () => {
    const d = dir();
    writeFileSync(join(d, ACCOUNT_KEY_FILE), KEY);
    writeKeyOrigin(d, "https://everloot.app");
    const file = linkedFile(d);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/me/characters/links")) return json({ results: [{ index: 0, status: "linked", name: "Thrallina", realm: "Forever Pioneer" }] });
      if (url.endsWith("/api/me/characters/sync")) return json({ characters: [{ index: 0, result: "mismatch" }] });
      return json({ error: "not here" }, 404);
    }));
    try {
      const jobs = companionJobs(d, () => ({ ...defaultSettings(), endpoint: "https://everloot.app", gameFolder: d }));
      expect(jobs.links()).toEqual([]);
      await jobs.deps.upload(file).catch(() => undefined);
      const [status] = jobs.links();
      expect(status).toMatchObject({ file, linked: ["Thrallina of Forever Pioneer"], frozen: [], linkError: null, syncedAt: null, synced: [] });
      expect(status.linkedAt).not.toBeNull();
      expect(status.syncError).toBe("Thrallina of Forever Pioneer not synced: the site did not match it to the link");
    } finally { vi.unstubAllGlobals(); }
  });

  test("a sync the site kept gives its time and categories, and a later run with nothing to answer keeps them", async () => {
    const d = dir();
    writeFileSync(join(d, ACCOUNT_KEY_FILE), KEY);
    writeKeyOrigin(d, "https://everloot.app");
    const file = linkedFile(d);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/me/characters/links")) return json({ results: [{ index: 0, status: "linked", name: "Thrallina", realm: "Forever Pioneer" }] });
      if (url.endsWith("/api/me/characters/sync")) return json({ characters: [{ index: 0, result: "synced", categories: { achievements: "stored" } }] });
      return json({ error: "not here" }, 404);
    }));
    try {
      const jobs = companionJobs(d, () => ({ ...defaultSettings(), endpoint: "https://everloot.app", gameFolder: d }));
      await jobs.deps.upload(file).catch(() => undefined);
      const first = jobs.links()[0];
      expect(first).toMatchObject({ linked: ["Thrallina of Forever Pioneer"], synced: ["Thrallina of Forever Pioneer"], categories: ["achievements"], syncError: null });
      expect(first.syncedAt).not.toBeNull();
      // Both steps are answered now: the next run sends nothing and the results stay.
      await jobs.deps.upload(file).catch(() => undefined);
      expect(jobs.links()[0]).toEqual(first);
    } finally { vi.unstubAllGlobals(); }
  });

  test("results belong to the site and account they were sent with, and to the files the app watches now", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/api/me/characters/links")) return json({ results: [{ index: 0, status: "linked", name: "Thrallina", realm: "Forever Pioneer" }] });
      if (url.endsWith("/api/me/characters/sync")) return json({ characters: [{ index: 0, result: "mismatch" }] });
      return json({ error: "not here" }, 404);
    }));
    // A fresh data folder, signed in, with one upload's results kept.
    const sent = async () => {
      const d = dir();
      writeFileSync(join(d, ACCOUNT_KEY_FILE), KEY);
      writeKeyOrigin(d, "https://everloot.app");
      const file = linkedFile(d);
      const settings = { endpoint: "https://everloot.app" };
      const jobs = companionJobs(d, () => ({ ...defaultSettings(), endpoint: settings.endpoint, gameFolder: d }));
      await jobs.deps.upload(file).catch(() => undefined);
      expect(jobs.links([file])).toHaveLength(1);
      return { d, file, settings, jobs };
    };
    try {
      // Another site: this site's results are not shown, and are dropped.
      const site = await sent();
      site.settings.endpoint = "https://other.test";
      expect(site.jobs.links()).toEqual([]);
      site.settings.endpoint = "https://everloot.app";
      expect(site.jobs.links()).toEqual([]);
      // Signed in to another account: the first account's results are gone, not shown as this one's.
      const account = await sent();
      writeFileSync(join(account.d, ACCOUNT_KEY_FILE), `evl_${"cd".repeat(32)}`);
      expect(account.jobs.links()).toEqual([]);
      // A file the app no longer watches: its results go; the watched one's stay.
      const files = await sent();
      expect(files.jobs.links([files.file])).toHaveLength(1);
      expect(files.jobs.links([join(files.d, "Other.lua")])).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("link and sync answers applied to the page's state", () => {
  const blank: CharacterLinkStatus = { file: "f", linked: [], frozen: [], linkedAt: null, linkError: null, syncedAt: null, synced: [], categories: [], syncError: null };
  const AT = "2026-11-18T08:00:00Z";

  test("a character linked after being frozen is no longer frozen, and one frozen after linking is no longer linked", () => {
    const frozen = afterLinks(blank, { linked: [], frozen: ["A of R"] }, AT, null);
    expect(frozen).toMatchObject({ linked: [], frozen: ["A of R"] });
    const recovered = afterLinks(frozen, { linked: ["A of R"], frozen: [] }, AT, null);
    expect(recovered).toMatchObject({ linked: ["A of R"], frozen: [] });
    expect(afterLinks(recovered, { linked: [], frozen: ["A of R"] }, AT, null)).toMatchObject({ linked: [], frozen: ["A of R"] });
  });

  test("a sync that finds no live link takes the character off the linked list; one it synced clears a freeze", () => {
    const linked = afterLinks(blank, { linked: ["A of R", "B of R"], frozen: [] }, AT, null);
    const lost = afterSync(linked, { synced: ["A of R"], syncOff: [], notLinked: ["B of R"], categories: ["raids"] }, AT, null);
    expect(lost).toMatchObject({ linked: ["A of R"], synced: ["A of R"], categories: ["raids"], syncedAt: AT });
    const frozen = { ...blank, frozen: ["C of R"] };
    expect(afterSync(frozen, { synced: [], syncOff: ["C of R"], notLinked: [], categories: [] }, AT, null)).toMatchObject({ linked: ["C of R"], frozen: [], syncedAt: null });
  });
});
