import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { findEverlootFiles } from "../src/savedvariables";
import { createSentState } from "../src/sent-state";
import { RateLimited, uploadFile } from "../src/uploader";
import { emptySettledList, encodeIds } from "../../kb/src/settled-list";

/** A SavedVariables file in the exact shape the addon writes. */
function luaFile(rows: { kind: string; lua: string }[]): string {
  const byKind = new Map<string, string[]>();
  for (const { kind, lua } of rows) byKind.set(kind, [...(byKind.get(kind) ?? []), lua]);
  const records = [...byKind].map(([kind, list]) => `["${kind}"] = {\n${list.map((l) => `{${l}},`).join("\n")}\n},`).join("\n");
  return `EverlootDB = {\n["version"] = "0.2.2",\n["installId"] = "abcd-1234-ef56-7890",\n["records"] = {\n${records}\n},\n}\n`;
}
const loot = (n: number) => ({
  kind: "loot",
  lua: `["eventId"] = "epoch:${n}", ["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = 42, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}`,
});
const gold = { kind: "gold_snapshot", lua: `["eventId"] = "epoch:900", ["capturedAt"] = "2026-10-09T00:00:00Z", ["character"] = "Thrall", ["realm"] = "Forever", ["currentCopper"] = 10, ["peakCopper"] = 10` };

function workspace(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "everloot-companion-"));
  const file = join(dir, "Everloot.lua");
  writeFileSync(file, text);
  return { dir, file, state: createSentState(join(dir, "state", "sent.json")) };
}

/** A fake intake that accepts every row and remembers what it was sent. */
function intake(fail?: (call: number) => Response | undefined) {
  const bodies: { records: { eventId: string; kind: string }[] }[] = [];
  const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const failure = fail?.(bodies.length);
    bodies.push(body);
    if (failure) return failure;
    return Response.json({ ok: true, persisted: true, uploadId: `u-${bodies.length}`,
      accepted: body.records.map((r: { kind: string }, index: number) => ({ index, kind: r.kind })), rejected: [] });
  });
  return { send: send as unknown as typeof fetch, bodies, calls: send };
}

describe("finding SavedVariables", () => {
  test("one Everloot.lua per account under WTF, nothing else", () => {
    const root = mkdtempSync(join(tmpdir(), "everloot-wow-"));
    for (const account of ["ACCOUNT1", "ACCOUNT2"]) {
      mkdirSync(join(root, "WTF", "Account", account, "SavedVariables"), { recursive: true });
      writeFileSync(join(root, "WTF", "Account", account, "SavedVariables", "Everloot.lua"), "EverlootDB = {}");
      writeFileSync(join(root, "WTF", "Account", account, "SavedVariables", "Other.lua"), "x");
    }
    mkdirSync(join(root, "WTF", "Account", "SavedVariables"), { recursive: true });
    expect(findEverlootFiles(root).map((f) => relative(root, f)).sort()).toEqual([
      join("WTF", "Account", "ACCOUNT1", "SavedVariables", "Everloot.lua"),
      join("WTF", "Account", "ACCOUNT2", "SavedVariables", "Everloot.lua"),
    ]);
    expect(findEverlootFiles(join(root, "missing"))).toEqual([]);
  });
});

describe("uploading", () => {
  test("only events not yet confirmed are sent, and a second run sends nothing", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2)]));
    const api = intake();
    const first = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state });
    expect(first).toMatchObject({ sent: 2, batches: 1, heldNamed: 0 });
    expect(api.calls.mock.calls[0][0]).toBe("https://everloot.example/api/intake");
    const again = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state });
    expect(again).toMatchObject({ sent: 0, batches: 0 });
    expect(api.bodies).toHaveLength(1);
  });

  test("map positions go through unchanged: interaction sightings with a role, object loot with a place, trainer ids", async () => {
    const at = `["capturedAt"] = "2026-10-21T00:00:00Z"`;
    const { file, state } = workspace(luaFile([
      { kind: "npc_sighting", lua: `["eventId"] = "epoch:1", ${at}, ["npcId"] = 3158, ["name"] = "Duokna", ["mapId"] = 1411, ["x"] = 51.2, ["y"] = 42.8, ["level"] = 15, ["reaction"] = "friendly", ["positionKind"] = "interaction", ["role"] = "repair"` },
      { kind: "loot", lua: `["eventId"] = "epoch:2", ${at}, ["sourceObjectId"] = 1618, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 2447, ["count"] = 2}}, ["mapId"] = 1411, ["x"] = 52.4, ["y"] = 43.1, ["gatherKind"] = "herb", ["sourceObjectName"] = "Peacebloom"` },
      { kind: "trainer_seen", lua: `["eventId"] = "epoch:3", ${at}, ["profession"] = "Alchemy", ["recipe"] = "Elixir of Minor Agility", ["requiredRank"] = 50, ["trainerNpcId"] = 3347` },
    ]));
    const api = intake();
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 3, invalid: 0 });
    const sent = api.bodies[0]!.records as unknown as Record<string, unknown>[];
    expect(sent.find((r) => r.kind === "npc_sighting")).toMatchObject({ positionKind: "interaction", role: "repair", mapId: 1411, x: 51.2, y: 42.8 });
    expect(sent.find((r) => r.kind === "loot")).toMatchObject({ mapId: 1411, x: 52.4, y: 43.1, gatherKind: "herb", sourceObjectName: "Peacebloom" });
    expect(sent.find((r) => r.kind === "trainer_seen")).toMatchObject({ trainerNpcId: 3347 });
  });

  test("a new event after a reload is the only one sent next time", async () => {
    const w = workspace(luaFile([loot(1)]));
    const api = intake();
    await uploadFile(w.file, { endpoint: "https://everloot.example", fetch: api.send, state: w.state });
    writeFileSync(w.file, luaFile([loot(1), loot(2)]));
    await uploadFile(w.file, { endpoint: "https://everloot.example", fetch: api.send, state: w.state });
    expect(api.bodies[1].records.map((r) => r.eventId)).toEqual(["epoch:2"]);
  });

  test("the client build the addon wrote goes with every batch", async () => {
    const text = luaFile([loot(1)]).replace('["version"] = "0.2.2",', '["version"] = "0.2.6",\n["clientBuild"] = "1.60.1.70450",');
    const { file, state } = workspace(text);
    const api = intake();
    await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state });
    expect(api.bodies[0]).toMatchObject({ addonVersion: "0.2.6", clientBuild: "1.60.1.70450" });
  });

  test("the installed addon list never leaves from here: it goes only through the upload page's preview", async () => {
    const addon = { kind: "addon_seen", lua: `["eventId"] = "epoch:700", ["capturedAt"] = "2026-10-09T00:00:00Z", ["name"] = "Questie", ["title"] = "Questie", ["loaded"] = true` };
    const { file, state } = workspace(luaFile([loot(1), addon]));
    const api = intake();
    const result = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state });
    expect(result).toMatchObject({ sent: 1, heldAddons: 1 });
    expect(api.bodies[0].records.map((r) => r.kind)).toEqual(["loot"]);
  });

  test("the census never leaves from here: the upload page counts it first", async () => {
    const seen = { kind: "census_seen", lua: `["eventId"] = "census_seen:2026-10-18:1", ["capturedAt"] = "2026-10-18T00:00:00Z", ["guid"] = "Player-4242-00000001", ["race"] = "Orc", ["class"] = "WARRIOR", ["level"] = 20, ["faction"] = "Horde", ["via"] = "target"` };
    const own = { kind: "census_self", lua: `["eventId"] = "census_self:2026-10-18:1", ["capturedAt"] = "2026-10-18T00:00:00Z", ["guid"] = "Player-4242-00AABBCC", ["race"] = "Orc", ["class"] = "WARRIOR", ["level"] = 20, ["faction"] = "Horde", ["realm"] = "Forever"` };
    const { file, state } = workspace(luaFile([loot(1), seen, own]));
    const api = intake();
    const result = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state });
    expect(result).toMatchObject({ sent: 1, heldCensus: 2, heldAddons: 0, invalid: 0 });
    expect(api.bodies[0].records.map((r) => r.kind)).toEqual(["loot"]);
  });

  test("the census goes with the rest once the player allowed it in the Desktop App", async () => {
    const seen = { kind: "census_seen", lua: `["eventId"] = "census_seen:2026-10-18:1", ["capturedAt"] = "2026-10-18T00:00:00Z", ["guid"] = "Player-4242-00000001", ["race"] = "Orc", ["class"] = "WARRIOR", ["level"] = 20, ["faction"] = "Horde", ["via"] = "target"` };
    const player = { kind: "player_seen", lua: `["eventId"] = "player_seen:1", ["capturedAt"] = "2026-10-20T00:00:00Z", ["name"] = "Thrallina", ["realm"] = "Forever", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 20, ["guild"] = "Night Watch"` };
    const { file, state } = workspace(luaFile([loot(1), seen, player]));
    const api = intake();
    const result = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state, census: true });
    expect(result).toMatchObject({ sent: 2, heldCensus: 0, heldPlayers: 1, invalid: 0 });
    expect(api.bodies[0].records.map((r) => r.kind)).toEqual(["loot", "census_seen"]);
  });

  test("the player pages go with the rest once the player allowed them in the Desktop App", async () => {
    const player = { kind: "player_seen", lua: `["eventId"] = "player_seen:1", ["capturedAt"] = "2026-10-20T00:00:00Z", ["name"] = "Thrallina", ["realm"] = "Forever", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 20, ["guild"] = "Night Watch"` };
    const { file, state } = workspace(luaFile([loot(1), player]));
    const api = intake();
    const result = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state, players: true });
    expect(result).toMatchObject({ sent: 2, heldCensus: 0, heldPlayers: 0, invalid: 0 });
    expect(api.bodies[0].records.map((r) => r.kind)).toEqual(["loot", "player_seen"]);
  });

  test("a player or census row the addon revised under a new event id is sent again; an unchanged row is not", async () => {
    const player = (id: number, level: number, day: string) => ({ kind: "player_seen", lua: `["eventId"] = "player_seen:${id}", ["capturedAt"] = "${day}T00:00:00Z", ["name"] = "Thrallina", ["realm"] = "Forever", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = ${level}` });
    const census = (id: number, level: number) => ({ kind: "census_seen", lua: `["eventId"] = "census_seen:2026-10-18:${id}", ["capturedAt"] = "2026-10-18T00:00:00Z", ["guid"] = "Player-4242-00000001", ["race"] = "Orc", ["class"] = "WARRIOR", ["level"] = ${level}, ["faction"] = "Horde", ["via"] = "target"` });
    const w = workspace(luaFile([player(1, 20, "2026-10-18"), census(1, 20)]));
    const options = { endpoint: "https://everloot.example", state: w.state, players: true, census: true };
    const api = intake();
    expect(await uploadFile(w.file, { ...options, fetch: api.send })).toMatchObject({ sent: 2 });
    // The same file again: nothing changed, so nothing goes.
    expect(await uploadFile(w.file, { ...options, fetch: api.send })).toMatchObject({ sent: 0, batches: 0 });
    // The character reached level 21 and was seen the next day: the addon gave each row a new event id.
    writeFileSync(w.file, luaFile([player(2, 21, "2026-10-19"), census(2, 21)]));
    expect(await uploadFile(w.file, { ...options, fetch: api.send })).toMatchObject({ sent: 2 });
    expect(api.bodies[1].records.map((r) => r.eventId).sort()).toEqual(["census_seen:2026-10-18:2", "player_seen:2"]);
    expect(await uploadFile(w.file, { ...options, fetch: api.send })).toMatchObject({ sent: 0, batches: 0 });
    expect(api.bodies).toHaveLength(2);
  });

  test("player rows never leave from here: the upload page says what they are first", async () => {
    const player = { kind: "player_seen", lua: `["eventId"] = "player_seen:1", ["capturedAt"] = "2026-10-20T00:00:00Z", ["name"] = "Thrallina", ["realm"] = "Forever", ["race"] = "Orc", ["class"] = "SHAMAN", ["level"] = 20, ["guild"] = "Night Watch"` };
    const { file, state } = workspace(luaFile([loot(1), player]));
    const api = intake();
    const result = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state });
    expect(result).toMatchObject({ sent: 1, heldPlayers: 1, heldAddons: 0, heldCensus: 0, invalid: 0 });
    expect(api.bodies[0].records.map((r) => r.kind)).toEqual(["loot"]);
  });

  test("named records stay on this machine unless shared on purpose", async () => {
    const { file, state } = workspace(luaFile([loot(1), gold]));
    const api = intake();
    const result = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state });
    expect(result).toMatchObject({ sent: 1, heldNamed: 1 });
    expect(api.bodies[0].records.map((r) => r.kind)).toEqual(["loot"]);
  });

  test("a failed batch is not marked sent; confirmed earlier batches are", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => loot(i + 1));
    const { file, state, dir } = workspace(luaFile(rows));
    const api = intake((call) => (call === 1 ? new Response("down", { status: 500 }) : undefined));
    await expect(uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).rejects.toThrow();
    const saved = JSON.parse(readFileSync(join(dir, "state", "sent.json"), "utf8"));
    expect(saved["https://everloot.example|abcd-1234-ef56-7890"]).toHaveLength(2000);
    const retry = intake();
    const result = await uploadFile(file, { endpoint: "https://everloot.example", fetch: retry.send, state: createSentState(join(dir, "state", "sent.json")) });
    expect(result.sent).toBe(500);
  });

  test("a rate limit stops the run and says when to retry", async () => {
    const { file, state } = workspace(luaFile([loot(1)]));
    const api = intake(() => Response.json({ ok: false, error: "Upload rate limited. Keep your file and retry later." },
      { status: 429, headers: { "retry-after": "120" } }));
    await expect(uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).rejects.toThrow(/rate limited/i);
  });

  test("a rate limit carries the site's wait as a number, and keeps the batches stored before it", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => loot(i + 1));
    const { file, state } = workspace(luaFile(rows));
    const api = intake((call) => (call === 1 ? Response.json({ ok: false, error: "Upload rate limited. Keep your file and retry later." },
      { status: 429, headers: { "retry-after": "120" } }) : undefined));
    const error = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimited);
    expect(error).toMatchObject({ retryAfterMs: 120_000, message: expect.stringMatching(/2 min/) });
    expect(state.has("https://everloot.example|abcd-1234-ef56-7890", "epoch:1")).toBe(true);
    expect(state.has("https://everloot.example|abcd-1234-ef56-7890", "epoch:2500")).toBe(false);
  });

  test("a Retry-After date is read as the time until it; a wait it cannot use is null, never zero or endless", async () => {
    const limited = async (value?: string) => {
      const { file, state } = workspace(luaFile([loot(1)]));
      const api = intake(() => new Response("{}", { status: 429, headers: value === undefined ? {} : { "retry-after": value } }));
      return uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state }).then(() => null, (e: unknown) => e as RateLimited);
    };
    const dated = await limited(new Date(Date.now() + 90_000).toUTCString());
    expect(dated).toBeInstanceOf(RateLimited);
    expect(dated!.retryAfterMs).toBeGreaterThan(85_000);
    expect(dated!.retryAfterMs).toBeLessThanOrEqual(90_000);
    for (const value of [undefined, "", "0", "-30", "soon", "Infinity", "1e400", new Date(Date.now() - 60_000).toUTCString()]) {
      const e = await limited(value);
      expect(e, String(value)).toBeInstanceOf(RateLimited);
      expect(e!.retryAfterMs, String(value)).toBeNull();
      expect(e!.message, String(value)).not.toMatch(/Try again in/);
    }
  });
});

describe("answers that are not a receipt", () => {
  const SECRET = "sk-live-do-not-echo";
  const html = (status: number, headers: Record<string, string> = {}) =>
    new Response(`<!doctype html><html><body>Bad gateway ${SECRET}</body></html>`, { status, headers: { "content-type": "text/html", ...headers } });
  /** Runs one upload of one row against `answer` and returns the error it failed with, and whether the row was marked sent. */
  async function failure(answer: (signal: AbortSignal | undefined) => Response | Promise<Response>, timeoutMs?: number) {
    const { file, state } = workspace(luaFile([loot(1)]));
    const send = (async (_url: string | URL | Request, init?: RequestInit) => answer(init?.signal ?? undefined)) as typeof fetch;
    const error = await uploadFile(file, { endpoint: "https://everloot.example", fetch: send, state, timeoutMs }).then(() => null, (e: unknown) => e as Error);
    return { error, sent: state.has("https://everloot.example|abcd-1234-ef56-7890", "epoch:1") };
  }
  const plain = (e: Error | null) => {
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).not.toMatch(/JSON|Unexpected token|<|doctype/i);
    expect(e!.message).not.toContain(SECRET);
  };

  test("a request that never answers stops at the time limit, and nothing is marked sent", async () => {
    let aborted = false;
    const r = await failure((signal) => new Promise(() => { signal?.addEventListener("abort", () => { aborted = true; }); }), 50);
    plain(r.error);
    expect(r.error!.message).toMatch(/everloot\.example did not answer/);
    expect(aborted).toBe(true);
    expect(r.sent).toBe(false);
  }, 2000);

  test("an answer whose body never ends stops at the time limit too", async () => {
    let cancelled = false;
    const r = await failure(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 }), 50);
    plain(r.error);
    expect(r.error!.message).toMatch(/did not answer/);
    expect(cancelled).toBe(true);
    expect(r.sent).toBe(false);
  }, 2000);

  test("an HTML error page says the status, not the page", async () => {
    const r = await failure(() => html(502));
    plain(r.error);
    expect(r.error!.message).toMatch(/502/);
    expect(r.error!.message).toMatch(/keep your file/i);
    expect(r.sent).toBe(false);
  });

  test("an HTML 429 still reads as a rate limit and says when to retry", async () => {
    const r = await failure(() => html(429, { "retry-after": "120" }));
    plain(r.error);
    expect(r.error!.message).toMatch(/rate limited/i);
    expect(r.error!.message).toMatch(/2 min/);
    expect(r.sent).toBe(false);
  });

  test("a JSON 429 keeps the site's words and adds the wait", async () => {
    const r = await failure(() => Response.json({ ok: false, error: "Upload rate limited. Keep your file and retry later." }, { status: 429, headers: { "retry-after": "600" } }));
    expect(r.error!.message).toMatch(/^Upload rate limited\. Keep your file and retry later\./);
    expect(r.error!.message).toMatch(/10 min/);
    expect(r.sent).toBe(false);
  });

  test("a JSON refusal gives the site's reason with its status", async () => {
    const r = await failure(() => Response.json({ ok: false, error: "Upload batch exceeds 1 MB. Split the file and retry." }, { status: 413 }));
    expect(r.error!.message).toMatch(/Upload batch exceeds 1 MB\. Split the file and retry\./);
    expect(r.error!.message).toMatch(/413/);
    expect(r.sent).toBe(false);
  });

  test("a 200 that is not a receipt (a captive portal, a proxy page) is a failure, not a parse error", async () => {
    const r = await failure(() => html(200));
    plain(r.error);
    expect(r.error!.message).toMatch(/not an Everloot receipt/);
    expect(r.sent).toBe(false);
  });

  test("a network error says the site could not be reached", async () => {
    const r = await failure(() => { throw new TypeError("fetch failed"); });
    expect(r.error!.message).toMatch(/could not reach everloot\.example/i);
    expect(r.sent).toBe(false);
  });

  test("after a 502 on the second batch, the first stays sent and a retry sends only the rest, once", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => loot(i + 1));
    const { file, dir } = workspace(luaFile(rows));
    const statePath = join(dir, "state", "sent.json");
    const api = intake((call) => (call === 1 ? html(502) : undefined));
    const error = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state: createSentState(statePath) }).then(() => null, (e: Error) => e);
    plain(error);
    expect(error!.message).toMatch(/502/);
    const retry = intake();
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: retry.send, state: createSentState(statePath) })).toMatchObject({ sent: 500, batches: 1 });
    const first = new Set(api.bodies[0].records.map((r) => r.eventId));
    expect(retry.bodies[0].records.some((r) => first.has(r.eventId))).toBe(false);
    // The other site's progress is its own: the same file to another endpoint sends everything.
    const other = intake();
    expect(await uploadFile(file, { endpoint: "https://other.example", fetch: other.send, state: createSentState(statePath) })).toMatchObject({ sent: 2500 });
  });
});

describe("receipts that keep some rows", () => {
  const ID = "https://everloot.example|abcd-1234-ef56-7890";
  /** A fake intake that stores the batch but answers with `receipt` built from its rows. */
  function answering(receipt: (records: { eventId: string; kind: string }[]) => Record<string, unknown>) {
    const bodies: { records: { eventId: string; kind: string }[] }[] = [];
    const send = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return Response.json({ ok: true, persisted: true, uploadId: `u-${bodies.length}`, ...receipt(body.records) });
    }) as typeof fetch;
    return { send, bodies };
  }

  test("a row the site turned away for now is not marked sent, and the next run sends only it", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2)]));
    const api = answering((records) => ({ accepted: [{ index: 0, kind: records[0].kind }], rejected: [{ index: 1, reason: "Census rows are not collected yet." }] }));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 1, batches: 1, rejected: 1 });
    expect(state.has(ID, "epoch:1")).toBe(true);
    expect(state.has(ID, "epoch:2")).toBe(false);
    const retry = intake();
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: retry.send, state })).toMatchObject({ sent: 1, batches: 1 });
    expect(retry.bodies[0].records.map((r) => r.eventId)).toEqual(["epoch:2"]);
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: retry.send, state })).toMatchObject({ sent: 0, batches: 0 });
  });

  test("a stored receipt that kept nothing marks nothing sent", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2)]));
    const api = answering((records) => ({ accepted: [], rejected: records.map((_, index) => ({ index, reason: "Storage unavailable." })) }));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 0, batches: 1 });
    expect(state.has(ID, "epoch:1") || state.has(ID, "epoch:2")).toBe(false);
  });

  test("a row listed as both accepted and rejected remains available for retry", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2), loot(3)]));
    const api = answering(() => ({ accepted: [{ index: 0 }, { index: 1 }], rejected: [{ index: 1, reason: "Try later." }] }));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 1 });
    expect(state.has(ID, "epoch:1")).toBe(true);
    expect(state.has(ID, "epoch:2") || state.has(ID, "epoch:3")).toBe(false);
    const retry = intake();
    await uploadFile(file, { endpoint: "https://everloot.example", fetch: retry.send, state });
    expect(retry.bodies[0].records.map((r) => r.eventId)).toEqual(["epoch:2", "epoch:3"]);
  });

  test("a malformed rejected list gives a recovery message without marking rows sent", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2)]));
    const api = answering(() => ({ accepted: [{ index: 0 }, { index: 1 }], rejected: {} }));
    await expect(uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).rejects.toThrow(/receipt.*keep your file and retry/i);
    expect(state.has(ID, "epoch:1") || state.has(ID, "epoch:2")).toBe(false);
  });

  test("a refusal that stored nothing marks nothing sent", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2)]));
    const send = (async () => Response.json({ ok: false, error: "No records were accepted.", accepted: [], rejected: [{ index: 0, reason: "x" }, { index: 1, reason: "x" }] }, { status: 422 })) as typeof fetch;
    await expect(uploadFile(file, { endpoint: "https://everloot.example", fetch: send, state })).rejects.toThrow(/No records were accepted/);
    expect(state.has(ID, "epoch:1") || state.has(ID, "epoch:2")).toBe(false);
  });

  test("only well-formed, in-range accepted indices count, each once", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2), loot(3), loot(4), loot(5), loot(6)]));
    // Six entries for six rows, so the receipt passes the count check, but only index 2 names a row properly.
    const api = answering(() => ({ accepted: [{ index: 2 }, { index: 2 }, { index: 6 }, { index: -1 }, { index: 1.5 }, { index: "0" }], rejected: [] }));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 1 });
    expect([1, 2, 3, 4, 5, 6].filter((n) => state.has(ID, `epoch:${n}`))).toEqual([3]);
    const retry = intake();
    await uploadFile(file, { endpoint: "https://everloot.example", fetch: retry.send, state });
    expect(retry.bodies[0].records.map((r) => r.eventId)).toEqual(["epoch:1", "epoch:2", "epoch:4", "epoch:5", "epoch:6"]);
  });

  test("an accepted entry that is not an object does not stop the run", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2)]));
    const api = answering(() => ({ accepted: [null, { index: 1 }], rejected: [] }));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 1 });
    expect(state.has(ID, "epoch:1")).toBe(false);
    expect(state.has(ID, "epoch:2")).toBe(true);
  });
});

describe("a batch the site turned away whole", () => {
  const ID = "https://everloot.example|abcd-1234-ef56-7890";
  const many = () => workspace(luaFile(Array.from({ length: 2500 }, (_, i) => loot(i + 1))));
  /** The intake's answer when it read every row and kept none: 422, nothing accepted, each row rejected by its index. */
  const everyRow = (records: unknown[]) => Response.json({ ok: false, accepted: [], rejected: records.map((_, index) => ({ index, reason: "Not collected yet." })) }, { status: 422 });
  /** A fake intake: `answer(call, records)` may replace the stored-everything receipt for one call, or fail it with null. */
  function site(answer: (call: number, records: unknown[]) => Response | null | undefined) {
    const bodies: { records: { eventId: string }[] }[] = [];
    const send = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const replaced = answer(bodies.length - 1, body.records);
      if (replaced) return replaced;
      if (replaced === null) throw new TypeError("fetch failed");
      return Response.json({ ok: true, persisted: true, uploadId: `u-${bodies.length}`, accepted: body.records.map((r: { kind: string }, index: number) => ({ index, kind: r.kind })), rejected: [] });
    }) as typeof fetch;
    return { send, bodies };
  }
  const sentIds = (state: ReturnType<typeof createSentState>, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `epoch:${from + i}`).filter((id) => state.has(ID, id)).length;

  test("the batches after it still go, and the next run offers only its rows", async () => {
    const { file, state } = many();
    const before = readFileSync(file, "utf8");
    const api = site((call, records) => (call === 0 ? everyRow(records) : undefined));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 500, batches: 2, rejected: 2000 });
    expect(api.bodies).toHaveLength(2);
    expect(sentIds(state, 1, 2000)).toBe(0);
    expect(sentIds(state, 2001, 2500)).toBe(500);
    const retry = intake();
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: retry.send, state })).toMatchObject({ sent: 2000, batches: 1, rejected: 0 });
    expect(retry.bodies[0].records.map((r) => r.eventId)).toEqual(Array.from({ length: 2000 }, (_, i) => `epoch:${i + 1}`));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: retry.send, state })).toMatchObject({ sent: 0, batches: 0 });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("a later batch turned away whole leaves the earlier one sent", async () => {
    const { file, state } = many();
    const api = site((call, records) => (call === 1 ? everyRow(records) : undefined));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 2000, batches: 2, rejected: 500 });
    expect(sentIds(state, 1, 2000)).toBe(2000);
    expect(sentIds(state, 2001, 2500)).toBe(0);
  });

  test("a one-batch file turned away whole sends nothing and says so", async () => {
    const { file, state } = workspace(luaFile([loot(1), loot(2)]));
    const api = site((_, records) => everyRow(records));
    expect(await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state })).toMatchObject({ sent: 0, batches: 1, rejected: 2 });
    expect(state.has(ID, "epoch:1") || state.has(ID, "epoch:2")).toBe(false);
  });

  test("a 422 that is not a row-by-row refusal of the whole batch stops the run", async () => {
    const answers: [string, (records: unknown[]) => Response][] = [
      ["an error of its own", (records) => Response.json({ ok: false, error: "every record in one upload must come from the same install", accepted: [], rejected: records.map((_, index) => ({ index, reason: "x" })) }, { status: 422 })],
      ["rows it accepted", (records) => Response.json({ ok: false, accepted: records.map((_, index) => ({ index, kind: "loot" })), rejected: [] }, { status: 422 })],
      ["a refused envelope", () => Response.json({ ok: false, accepted: [], rejected: [{ index: -1, reason: "payload needs addonVersion + records[1..2000]" }] }, { status: 422 })],
      ["a row named twice", (records) => Response.json({ ok: false, accepted: [], rejected: records.map((_, index) => ({ index: index === 1 ? 0 : index, reason: "x" })) }, { status: 422 })],
      ["a row left out", (records) => Response.json({ ok: false, accepted: [], rejected: records.slice(1).map((_, index) => ({ index, reason: "x" })) }, { status: 422 })],
      ["an index past the batch", (records) => Response.json({ ok: false, accepted: [], rejected: records.map((_, index) => ({ index: index + 1, reason: "x" })) }, { status: 422 })],
      ["an index that is not a whole number", (records) => Response.json({ ok: false, accepted: [], rejected: records.map((_, index) => ({ index: index === 0 ? "0" : index, reason: "x" })) }, { status: 422 })],
      ["a claim of storage", (records) => Response.json({ ok: false, persisted: true, uploadId: "u-1", accepted: [], rejected: records.map((_, index) => ({ index, reason: "x" })) }, { status: 422 })],
      ["a page", () => new Response("<html>422</html>", { status: 422, headers: { "content-type": "text/html" } })],
      ["another status", (records) => Response.json({ ok: false, accepted: [], rejected: records.map((_, index) => ({ index, reason: "x" })) }, { status: 400 })],
    ];
    for (const [what, answer] of answers) {
      const { file, state } = many();
      const api = site((call, records) => (call === 0 ? answer(records) : undefined));
      const error = await uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state }).then(() => null, (e: Error) => e);
      expect(error, what).toBeInstanceOf(Error);
      expect(error!.message, what).not.toMatch(/<html/);
      expect(api.bodies, what).toHaveLength(1);
      expect(sentIds(state, 1, 2500), what).toBe(0);
    }
  });

  test("past a batch turned away whole, a network error or a rate limit still stops the run", async () => {
    for (const [what, later, message] of [
      ["network", null, /could not reach/i],
      ["rate limit", Response.json({ ok: false, error: "Upload rate limited. Keep your file and retry later." }, { status: 429, headers: { "retry-after": "120" } }), /rate limited.*2 min/i],
      ["server error", new Response("down", { status: 503 }), /503/],
    ] as const) {
      const { file, state } = many();
      const api = site((call, records) => (call === 0 ? everyRow(records) : later));
      await expect(uploadFile(file, { endpoint: "https://everloot.example", fetch: api.send, state }), what).rejects.toThrow(message);
      expect(api.bodies, what).toHaveLength(2);
      expect(sentIds(state, 1, 2500), what).toBe(0);
    }
  });
});

describe("settled facts", () => {
  const BUILD = "1.60.1.70450";
  const withBuild = (text: string) => text.replace('["installId"]', `["clientBuild"] = "${BUILD}",
["installId"]`);
  const other = { kind: "loot", lua: `["eventId"] = "epoch:77", ["capturedAt"] = "2026-10-09T00:00:00Z", ["sourceNpcId"] = 43, ["sourceEvidence"] = "loot-api", ["items"] = {{["itemId"] = 5, ["count"] = 1}}` };
  const list = { ...emptySettledList(BUILD), dataAsOf: "2026-10-20T00:00:00.000Z", loot: { npc: encodeIds([42]), obj: [] } };

  test("rows of a settled fact are skipped, marked handled, and counted; the rest are sent", async () => {
    const { file, state } = workspace(withBuild(luaFile([loot(1), loot(2), other])));
    const fake = intake();
    const settled = vi.fn(async () => list);
    const r = await uploadFile(file, { endpoint: "https://everloot.app", fetch: fake.send, state, settled });
    expect(settled).toHaveBeenCalledWith(BUILD);
    expect(r).toMatchObject({ sent: 1, skipped: 2 });
    expect(fake.bodies.flatMap((b) => b.records.map((x) => x.eventId))).toEqual(["epoch:77"]);
    for (const id of ["epoch:1", "epoch:2", "epoch:77"]) expect(state.has("abcd-1234-ef56-7890", id)).toBe(true);
    // Weighed once: the next run has nothing left to consider.
    expect(await uploadFile(file, { endpoint: "https://everloot.app", fetch: fake.send, state, settled })).toMatchObject({ sent: 0, skipped: 0, batches: 0 });
  });

  test("nothing is skipped for a file without a build, a list of another build, or no list", async () => {
    for (const [text, given] of [[luaFile([loot(1)]), list], [withBuild(luaFile([loot(1)])), { ...list, build: "1.61.0.71000" }], [withBuild(luaFile([loot(1)])), null]] as const) {
      const { file, state } = workspace(text);
      expect(await uploadFile(file, { endpoint: "https://everloot.app", fetch: intake().send, state, settled: given })).toMatchObject({ sent: 1, skipped: 0 });
    }
  });
});
