import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { findEverlootFiles } from "../src/savedvariables";
import { createSentState } from "../src/sent-state";
import { uploadFile } from "../src/uploader";
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
