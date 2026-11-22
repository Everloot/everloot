import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { sendSync, syncSummary } from "../src/sync-sender";
import { createSentState } from "../src/sent-state";

const KEY = `evl_${"ab".repeat(32)}`;
const SITE = "https://everloot.example";
const INSTALL = "abcd-1234-ef56-7890";
const THRALL = "0a1b2c3d";
const JAINA = "1a2b3c4d";

type Row = Record<string, unknown>;
const lua = (v: unknown): string => {
  if (Array.isArray(v)) return `{${v.map(lua).join(", ")}}`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `["${k}"] = ${lua(x)}`).join(", ")}}`;
  return typeof v === "string" ? JSON.stringify(v) : String(v);
};

const link = (name: string, key: string, at = "2026-11-01T18:00:00Z"): Row => ({
  eventId: `character_link:${name}`, capturedAt: at, code: "EL-AAAA-01", name, realm: "Forever Pioneer", race: "Orc",
  class: "SHAMAN", level: 24, faction: "Horde", guid: "Player-4395-0A1B2C3D", completionKey: key,
});
const gear = (character: string, at: string, itemLevel = 20): Row => ({
  eventId: `gear:${character}:${at}`, capturedAt: at, character, realm: "Forever Pioneer",
  equipped: [{ slot: "HeadSlot", itemId: 1234, itemLevel }],
});
const owned = (key: string, fields: Row): Row => ({ capturedAt: "2026-11-05T10:00:00Z", characterKey: key, class: "SHAMAN", level: 24, ...fields });
const profession = (key: string, rank = 75) => owned(key, { profession: "Mining", skillLine: 186, rank, maxRank: 150 });
const reputation = (key: string) => owned(key, { factionId: 76, reaction: 5, standing: 3000, floor: 3000, ceiling: 9000 });
const achievement = (key: string) => owned(key, { achievementId: 6, completed: true, earnedOn: "2026-11-04", criteriaMet: 1, criteriaTotal: 1 });
const title = (key: string) => owned(key, { titleIds: [1, 2] });
const lockout = (key: string) => owned(key, { instance: "Molten Core", instanceId: 409, difficultyId: 9, bossesKilledCount: 3, bossesTotal: 10, resetAt: "2099-01-01T08:00:00Z" });
const talent: Row = {
  capturedAt: "2026-11-05T10:00:00Z", class: "SHAMAN", level: 24, group: 1, active: true, configId: 7, treeId: 3,
  exportStatus: "unavailable", points: 2, nodes: [{ nodeId: 11, ranks: 2 }],
};
const talentOwned = (key: string, nodeId = 11) => owned(key, { installId: INSTALL, treeId: 3, points: 2, nodes: [{ nodeId, ranks: 2 }] });

/** A save file holding `rows` under their kinds, the way the addon writes it. */
function workspace(rows: Record<string, Row[]>) {
  const dir = mkdtempSync(join(tmpdir(), "everloot-sync-"));
  const file = join(dir, "Everloot.lua");
  const write = (next: Record<string, Row[]>) => writeFileSync(file, `EverlootDB = {\n["version"] = "0.3.14",\n["installId"] = "${INSTALL}",\n["records"] = {\n${
    Object.entries(next).map(([kind, list]) => `["${kind}"] = {\n${list.map((r) => `${lua(r)},`).join("\n")}\n},`).join("\n")
  }\n},\n}\n`);
  write(rows);
  return { file, write, state: createSentState(join(dir, "state", "sent.json")) };
}

const full = (): Record<string, Row[]> => ({
  character_link: [link("Thrallina", THRALL)],
  gear_snapshot: [gear("Thrallina", "2026-11-05T09:00:00Z", 18), gear("Thrallina", "2026-11-05T11:00:00Z", 22), gear("Unlinkedone", "2026-11-05T11:00:00Z")],
  profession_owned: [profession(THRALL), profession("ffffffff")],
  reputation_owned: [reputation(THRALL)],
  achievement_owned: [achievement(THRALL)],
  title_owned: [title(THRALL)],
  lockout_owned: [lockout(THRALL)],
  talent_snapshot: [talent],
  talent_owned: [talentOwned(THRALL), talentOwned("ffffffff")],
  loot: [{ eventId: "epoch:1", capturedAt: "2026-11-01T00:00:00Z", sourceNpcId: 42, sourceEvidence: "loot-api", items: [{ itemId: 5, count: 1 }] }],
});

type Sent = { name: string; realm: string; records: Row[] };
/** A fake site: answers each request with `answer(characters)`, and remembers every request. */
function site(answer: (characters: Sent[]) => Response) {
  const calls: { url: string; init: RequestInit; characters: Sent[] }[] = [];
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const characters = JSON.parse(String(init?.body)).characters as Sent[];
    calls.push({ url: String(url), init: init!, characters });
    return answer(characters);
  });
  return { send: send as unknown as typeof fetch, calls };
}
/** Every character synced, each category it was sent with `outcome`. */
const synced = (outcome = "stored") => (characters: Sent[]) => Response.json({
  characters: characters.map((c, index) => ({
    index, result: "synced",
    categories: Object.fromEntries(c.records.map((r) => [{ lockout_owned: "raids", boss_kill_owned: "boss_kills" }[String(r.kind)] ?? "achievements", outcome])),
  })),
  skipped: 0,
});

describe("sending linked characters", () => {
  test("only the linked character's accepted rows go, to the sync endpoint, with the key", async () => {
    const { file, state } = workspace(full());
    const api = site(synced());
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(1);
    const call = api.calls[0]!;
    expect(call.url).toBe(`${SITE}/api/me/characters/sync`);
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(call.init.redirect).toBe("error");
    expect(call.characters).toHaveLength(1);
    expect(call.characters[0]).toMatchObject({ name: "Thrallina", realm: "Forever Pioneer" });
    const kinds = call.characters[0]!.records.map((x) => x.kind).sort();
    // Raids and titles go. The kinds Blizzard's API supplies, which an older addon wrote into this file, do not;
    // nor do the link, loot and unlinked character's rows.
    expect(kinds).toEqual(["lockout_owned", "title_owned"]);
    expect(r).toMatchObject({ synced: ["Thrallina of Forever Pioneer"], categories: ["raids", "achievements"], waiting: 0, problem: null });
    expect(syncSummary(r)).toBe("synced 1 character");
  });

  // docs/design/specs/2026-11-17-blizzard-api-first.md: the gear, talents, professions, stats, pvp and reputations
  // categories are retired, and the achievements category keeps only titles.
  test("a file holding only the retired kinds sends nothing", async () => {
    const stats = owned(THRALL, { installId: INSTALL, stats: { strength: 1, agility: 5, stamina: 6, intellect: 7, spirit: 8 } });
    const { file, state } = workspace({
      character_link: [link("Thrallina", THRALL)],
      gear_snapshot: [gear("Thrallina", "2026-11-05T11:00:00Z")],
      talent_owned: [talentOwned(THRALL)], stats_owned: [stats], pvp_owned: [owned(THRALL, { installId: INSTALL, honorableKills: 150 })],
      profession_owned: [profession(THRALL)], reputation_owned: [reputation(THRALL)], achievement_owned: [achievement(THRALL)],
      talent_snapshot: [talent],
    });
    const api = site(synced());
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(0);
    expect(syncSummary(r)).toBeNull();
  });

  test("a linked character's lifetime gold goes under gold; an unlinked character's does not", async () => {
    const wealth = (key: string) => owned(key, { installId: INSTALL, stats: { "328": 1150905, "329": 1077 } });
    const { file, state } = workspace({ character_link: [link("Thrallina", THRALL)], wealth_owned: [wealth(THRALL), wealth("ffffffff")] });
    const api = site((characters) => Response.json({
      characters: characters.map((_, index) => ({ index, result: "synced", categories: { gold: "stored" } })), skipped: 0,
    }));
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.characters).toHaveLength(1);
    expect(api.calls[0]!.characters[0]!.records).toEqual([{ kind: "wealth_owned", ...wealth(THRALL) }]);
    expect(r).toMatchObject({ synced: ["Thrallina of Forever Pioneer"], categories: ["gold"], problem: null });
  });

  test("gold left off is not a problem to report, and its changed captures wait hours before asking again", async () => {
    const wealth = (n: number) => owned(THRALL, { installId: INSTALL, capturedAt: `2026-11-05T1${n}:00:00Z`, stats: { "328": 1000 + n } });
    const { file, state, write } = workspace({ character_link: [link("Thrallina", THRALL)], lockout_owned: [lockout(THRALL)], wealth_owned: [wealth(0)] });
    const api = site((characters) => Response.json({
      characters: characters.map((c, index) => ({
        index, result: "synced",
        categories: Object.fromEntries(c.records.map((r) => (r.kind === "wealth_owned" ? ["gold", "no_consent"] : ["raids", "stored"]))),
      })), skipped: 0,
    }));
    let clock = Date.parse("2026-11-05T12:00:00Z");
    const now = () => clock;
    const first = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send, now });
    expect(syncSummary(first)).toBe("synced 1 character");
    // Gold alone, changed after a play session: not sent again within hours, and nothing is said.
    write({ character_link: [link("Thrallina", THRALL)], lockout_owned: [lockout(THRALL)], wealth_owned: [wealth(1)] });
    clock += 60 * 60_000;
    const again = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send, now });
    expect(api.calls).toHaveLength(1);
    expect(syncSummary(again)).toBeNull();
    // Later the same capture is asked about again, in case the player turned gold on; off, it still says nothing.
    clock += 6 * 60 * 60_000;
    const later = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send, now });
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1]!.characters[0]!.records.map((x) => x.kind)).toEqual(["wealth_owned"]);
    expect(syncSummary(later)).toBeNull();
  });

  test("an answered capture is not sent again; a changed one is, alone", async () => {
    const { file, state, write } = workspace(full());
    const api = site(synced());
    await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    const again = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(1);
    expect(syncSummary(again)).toBeNull();
    write({ ...full(), lockout_owned: [{ ...lockout(THRALL), bossesKilledCount: 4 }] });
    await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1]!.characters[0]!.records.map((x) => x.kind)).toEqual(["lockout_owned"]);
  });

  test("two files sharing an install id keep each other's answers", async () => {
    const a = workspace({ character_link: [link("Thrallina", THRALL)], lockout_owned: [lockout(THRALL)] });
    const b = workspace({ character_link: [link("Jainara", JAINA)], lockout_owned: [lockout(JAINA)] });
    const api = site(synced());
    for (let i = 0; i < 2; i++) {
      await sendSync(a.file, { endpoint: SITE, key: KEY, state: a.state, fetch: api.send });
      await sendSync(b.file, { endpoint: SITE, key: KEY, state: a.state, fetch: api.send });
    }
    expect(api.calls.map((c) => c.characters[0]!.name)).toEqual(["Thrallina", "Jainara"]);
  });

  test.each(["duplicate", "older"])("a %s answer counts as answered", async (outcome) => {
    const { file, state } = workspace(full());
    const api = site(synced(outcome));
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(1);
    expect(r.synced).toHaveLength(1);
  });

  // The player can turn a category's sync on at any time; the same capture must reach the site then, not only once
  // the game changes it.
  test("a no_consent answer goes again next run", async () => {
    const { file, state } = workspace(full());
    const api = site(synced("no_consent"));
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(syncSummary(r)).toContain("turn sync on for it on everloot.app");
    await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(2);
  });

  // Linking (or settling a frozen link) can happen after a send; the character goes again until it is linked.
  test("not_linked and retry both go again next run", async () => {
    const { file, state } = workspace({ ...full(), character_link: [link("Thrallina", THRALL), link("Jainara", JAINA)], lockout_owned: [lockout(THRALL), lockout(JAINA)] });
    const api = site(() => Response.json({ characters: [{ index: 0, result: "not_linked" }, { index: 1, result: "retry" }], skipped: 0 }));
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(r).toMatchObject({ notLinked: ["Thrallina of Forever Pioneer"], waiting: 1 });
    expect(syncSummary(r)).toBe("Thrallina of Forever Pioneer not linked to your account; 1 character syncs next time");
    await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls[1]!.characters.map((c) => c.name)).toEqual(["Thrallina", "Jainara"]);
  });

  test("without a key nothing is read or sent", async () => {
    const { file, state } = workspace(full());
    const api = site(synced());
    const r = await sendSync(file, { endpoint: SITE, key: null, state, fetch: api.send });
    expect(api.calls).toHaveLength(0);
    expect(syncSummary(r)).toBeNull();
  });

  test("a file with no link row sends nothing", async () => {
    const { file, state } = workspace({ ...full(), character_link: [] });
    const api = site(synced());
    expect(syncSummary(await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send }))).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  test("404: the switch is off, nothing more goes and nothing is said", async () => {
    const characters = Array.from({ length: 11 }, (_, i) => `Char${String.fromCharCode(97 + i)}`);
    const keys = characters.map((_, i) => (0x10000000 + i).toString(16));
    const { file, state } = workspace({ character_link: characters.map((n, i) => link(n, keys[i]!)), lockout_owned: keys.map((k) => lockout(k)) });
    const api = site(() => Response.json({ error: "Not found" }, { status: 404 }));
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(1);
    expect(syncSummary(r)).toBeNull();
    // Nothing was answered: every capture goes once the switch is on, ten characters to a request.
    const later = site(synced());
    await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: later.send });
    expect(later.calls).toHaveLength(2);
  });

  test("403 says to make a key with Sync my linked characters, in one line", async () => {
    const { file, state } = workspace(full());
    const api = site(() => Response.json({ error: "This key can't sync characters." }, { status: 403 }));
    const line = syncSummary(await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send }));
    expect(line).toBe("sync: make a key with \"Sync my linked characters\" on everloot.app and sign in with it under Settings > Account.");
  });

  test.each([[401, /revoked/], [500, /HTTP 500/]])("a %i keeps every capture for next time", async (status, said) => {
    const { file, state } = workspace(full());
    const api = site(() => Response.json({ error: "no" }, { status }));
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(r).toMatchObject({ synced: [], waiting: 1, problem: expect.stringMatching(said) });
    await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    expect(api.calls).toHaveLength(2);
  });

  test("a network failure keeps the captures", async () => {
    const { file, state } = workspace(full());
    const send = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: send });
    expect(syncSummary(r)).toContain("could not reach everloot.app");
  });

  test("429: nothing goes to that site before Retry-After", async () => {
    const endpoint = "https://wait.everloot.example";
    const { file, state } = workspace(full());
    let clock = Date.parse("2026-11-06T12:00:00Z");
    const api = site(() => new Response(JSON.stringify({ error: "slow down" }), { status: 429, headers: { "retry-after": "120" } }));
    const r = await sendSync(file, { endpoint, key: KEY, state, fetch: api.send, now: () => clock });
    expect(r.problem).toContain("asked to wait");
    clock += 60_000;
    await sendSync(file, { endpoint, key: KEY, state, fetch: api.send, now: () => clock });
    expect(api.calls).toHaveLength(1);
    clock += 61_000;
    const ok = site(synced());
    await sendSync(file, { endpoint, key: KEY, state, fetch: ok.send, now: () => clock });
    expect(ok.calls).toHaveLength(1);
  });

  test("a request holds at most ten characters and 10,000 rows; one character may span two", async () => {
    const names = Array.from({ length: 11 }, (_, i) => `Char${String.fromCharCode(97 + i)}`);
    const keys = names.map((_, i) => (0x10000000 + i).toString(16));
    const { file, state } = workspace({
      character_link: names.map((n, i) => link(n, keys[i]!)),
      lockout_owned: keys.map((k) => lockout(k)),
      title_owned: [
        // Title ids stay inside the schema's range; each row is its own record.
        ...Array.from({ length: 6000 }, (_, i) => owned(keys[0]!, { titleIds: [(i % 1000) + 1] })),
        ...Array.from({ length: 5000 }, (_, i) => owned(keys[1]!, { titleIds: [(i % 1000) + 1] })),
      ],
    });
    const api = site(synced());
    const r = await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
    for (const call of api.calls) {
      expect(call.characters.length).toBeLessThanOrEqual(10);
      expect(call.characters.reduce((n, c) => n + c.records.length, 0)).toBeLessThanOrEqual(10_000);
    }
    expect(api.calls.map((c) => c.characters.map((x) => `${x.name}:${x.records.length}`))).toEqual([
      ["Chara:6001", "Charb:1"],
      ["Charb:5000", ...names.slice(2).map((n) => `${n}:1`)],
    ]);
    expect(r.synced).toHaveLength(11);
  });
});

test("linked boss kills travel only through private sync and updated cumulative counts are sent again", async () => {
  const kill = { characterKey: THRALL, encounterId: 2916, instanceMapId: 48, difficulty: 1,
    firstKillAt: "2026-11-05T10:00:00Z", lastKillAt: "2026-11-05T10:00:00Z", killCount: 1 };
  const data = { character_link: [link("Thrallina", THRALL)], boss_kill_owned: [kill, { ...kill, characterKey: "ffffffff" }] };
  const { file, state, write } = workspace(data);
  const api = site((characters) => Response.json({ characters: characters.map((_, index) => ({ index, result: "synced", categories: { boss_kills: "stored" } })) }));
  await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
  expect(api.calls).toHaveLength(1);
  expect(api.calls[0]!.url).toBe(`${SITE}/api/me/characters/sync`);
  expect(api.calls[0]!.characters[0]!.records).toHaveLength(1);
  expect(api.calls[0]!.characters[0]!.records[0]).toMatchObject({ kind: "boss_kill_owned", killCount: 1 });
  await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
  expect(api.calls).toHaveLength(1);
  write({ ...data, boss_kill_owned: [{ ...kill, lastKillAt: "2026-11-06T10:00:00Z", killCount: 2 }] });
  await sendSync(file, { endpoint: SITE, key: KEY, state, fetch: api.send });
  expect(api.calls).toHaveLength(2);
  expect(api.calls[1]!.characters[0]!.records[0]).toMatchObject({ killCount: 2 });
});
