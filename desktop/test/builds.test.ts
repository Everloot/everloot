import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { readKeyOrigin } from "../src/main/account";
import { BUILDS_EVERY_MS, createBuildsSync, fetchBuilds, gameBuilds, keySiteOrigin, renderBuildsAddon, writeBuildsAddon, type GameBuild } from "../src/main/builds";

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "everloot-builds-")); dirs.push(d); return d; };
afterEach(() => { vi.useRealTimers(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const KEY = `evl_${"ab".repeat(32)}`;
const CODE = "EL1-mage-1482-1.60.1.70450-OTAwMDE6Miw5MDAwMjoxOjEsOTAwMDQ6Mg";
const CODE2 = "EL1-mage-0-1.60.1.70450-MToxLDI6MQ";
const PRIEST = "EL1-priest-0-1.60.1.70450-MToxLDI6MQ";
/** Text a player can type into a build name: quotes, a backslash, a newline, a long-bracket close, a comment opener, a control byte. */
const TRICKY = 'Fire "burst" |T \\ v2\n]] --[[ end\r\x01';

const row = (id: string, over: Record<string, unknown>) => ({ id, slug: `${id}xxxxxx`, name: id, notes: null, classSlug: "mage", characterId: null, code: CODE, code2: null, gameBuild: "1.60.1.70450", shared: true, active: false, link: null, updatedAt: "2026-10-18T00:00:00.000Z", ...over });
/** The site's answer, as GET /api/me/builds sends it. */
const answer = {
  characters: [
    { id: "c1", name: "Ærîn", classSlug: "mage", realm: "Nightslayer", note: null },
    { id: "c2", name: 'Quote"Bank', classSlug: "priest", realm: null, note: "alt" },
  ],
  builds: [
    row("b1", { name: "Leveling", notes: "first", characterId: "c1", link: "https://everloot.app/b/b1xxxxxx", updatedAt: "2026-10-20T10:00:00.000Z" }),
    row("b2", { name: TRICKY, notes: "never in the file", characterId: "c1", code2: CODE2, shared: false, active: true, updatedAt: "2026-10-20T12:00:00.000Z" }),
    row("b3", { name: "No label", code2: "not a code", updatedAt: "2026-10-19T08:00:00.000Z" }),
    row("b4", { name: "Priest", classSlug: "priest", characterId: "c2", code: PRIEST, code2: CODE2, updatedAt: "2026-10-19T07:00:00.000Z" }),
    // Each of these fails one check and is left out.
    row("bad-code", { code: "EL1-mage-0-1.60.1-%%%", updatedAt: "2026-10-21T08:00:00.000Z" }),
    row("bad-class", { classSlug: "Mage", updatedAt: "2026-10-21T08:00:00.000Z" }),
    row("class-differs", { classSlug: "priest", updatedAt: "2026-10-21T08:00:00.000Z" }),
    row("bad-build", { gameBuild: "1.60.1-beta", updatedAt: "2026-10-21T08:00:00.000Z" }),
    row("one-group", { gameBuild: "1", updatedAt: "2026-10-21T08:00:00.000Z" }),
    row("long-build", { gameBuild: `1.${"1".repeat(31)}`, updatedAt: "2026-10-21T08:00:00.000Z" }),
  ],
};

test("builds are joined with their labels' name and realm, newest first; a build the addon could not load is left out", () => {
  const builds = gameBuilds(answer);
  expect(builds.map((b) => b.name)).toEqual([TRICKY, "Leveling", "No label", "Priest"]);
  expect(builds[0]).toEqual({ name: TRICKY, character: "Ærîn", realm: "Nightslayer", class: "mage", code: CODE, code2: CODE2, order: null, order2: null, active: true, gameBuild: "1.60.1.70450" });
  expect(builds[2]).toMatchObject({ character: null, realm: null, code2: null });
  // A second set for another class is dropped, the build stays.
  expect(builds[3]).toMatchObject({ character: 'Quote"Bank', realm: null, class: "priest", code: PRIEST, code2: null });
  expect(JSON.stringify(builds)).not.toContain("never in the file");
  expect(() => gameBuilds({ characters: [] })).toThrow(/without builds/);
});

/** The golden file the addon's plan test loads in Lua 5.1 (addon/tests/plan_contract.py). */
const FIXTURE = new URL("../../addon/tests/fixtures/EverlootBuilds.lua", import.meta.url);
/** The collector addon's interface number: the slot's TOC has to match it, or the client marks one "out of date". */
const ADDON_INTERFACE = /^## Interface: *(\d+)\r?$/m.exec(readFileSync(new URL("../../addon/Everloot.toc", import.meta.url), "utf8"))![1];
test("account response to Lua carries each set's own order and only game fields", async () => {
  const builds = await fetchBuilds("https://everloot.app", KEY, (async () => json(200, {
    accountId: "private-owner", email: "private-email", transferKey: "private-transfer",
    characters: answer.characters,
    builds: [row("b", { characterId: "c1", code2: CODE2, order: "O1p-ABACC", order2: "O1g-BA", notes: "private-notes", transferKey: "private-transfer" })],
  })) as typeof fetch);
  expect(builds[0]).toMatchObject({ code: CODE, code2: CODE2, order: "O1p-ABACC", order2: "O1g-BA" });
  const { lua } = renderBuildsAddon(builds, "2026-10-20T12:00:00.000Z");
  expect(lua).toContain('order = "O1p-ABACC", order2 = "O1g-BA"');
  expect(lua).not.toContain("private-");
  expect(Object.keys(builds[0]).sort()).toEqual(["active", "character", "class", "code", "code2", "gameBuild", "name", "order", "order2", "realm"]);
});

test("bad, missing and newer metadata never drops ranks or borrows another set's order", () => {
  for (const order of [undefined, null, 42, "O1p-AB", "O2p-ABACC", "O1p-" + "A".repeat(65), 'O1p-ABACC\" --']) {
    const [build] = gameBuilds({ builds: [row("b", { code2: CODE2, order, order2: "O1g-BA" })] });
    expect(build).toMatchObject({ code: CODE, code2: CODE2, order: null, order2: "O1g-BA" });
  }
  expect(gameBuilds({ builds: [row("b", { code2: "broken", order: "O1p-ABACC", order2: "O1g-BA" })] })[0])
    .toMatchObject({ code: CODE, code2: null, order: "O1p-ABACC", order2: null });
});

test("slot size caps count whole characters and tokens never extend the rank code", () => {
  const builds = gameBuilds({
    characters: [{ id: "c", name: "\u{1f409}".repeat(25), realm: "\u{1f409}".repeat(33) }],
    builds: Array.from({ length: 201 }, (_, i) => row(String(i), {
      name: "\u{1f409}".repeat(61), characterId: "c", code2: CODE2, order: "O1p-ABACC", order2: "O1g-BA",
    })),
  });
  expect(builds).toHaveLength(200);
  expect(builds[0]).toMatchObject({ name: "\u{1f409}".repeat(60), character: "\u{1f409}".repeat(24), realm: "\u{1f409}".repeat(32),
    code: CODE, code2: CODE2, order: "O1p-ABACC", order2: "O1g-BA" });
  const over = "EL1-mage-0-1.60-" + "A".repeat(400);
  expect(gameBuilds({ builds: [row("b", { code: over, order: "O1p-A" })] })).toEqual([]);
  expect(gameBuilds({ builds: [row("b", { code2: over, order2: "O1p-A" })] })[0]).toMatchObject({ code: CODE, code2: null, order2: null });
});

test("Desktop order adapter agrees with the language-neutral decode vectors", () => {
  const vectors = JSON.parse(readFileSync(new URL("../../docs/fixtures/talent-order-v1.json", import.meta.url), "utf8"));
  for (const v of vectors.decode) {
    const payload = v.ranks.filter(([, rank]: number[]) => rank > 0)
      .map(([id, rank, choice]: number[]) => `${id}:${rank}${choice === undefined ? "" : `:${choice}`}`).join(",");
    const code = `EL1-mage-0-1.60.1-${Buffer.from(payload).toString("base64url")}`;
    // Empty plans and codes over 400 characters cannot be represented by this slot's rank contract.
    if (!payload || code.length > 400) continue;
    const [build] = gameBuilds({ builds: [row("b", { code, order: v.token })] });
    expect(build.order, v.name).toBe(v.error ? null : v.token.trim());
    expect(build.code, v.name).toBe(code);
  }
});
const FIXTURE_BUILDS: GameBuild[] = [
  { name: "Frost AoE", character: null, realm: null, class: "mage", code: "EL1-mage-1482-1.59.0.69000-OTAwMDE6MQ", code2: null, active: false, gameBuild: "1.59.0.69000" },
  { name: "Arcane leveling", character: "Aerin", realm: "nightslayer", class: "mage", code: CODE, code2: null, active: false, gameBuild: "1.60.1.70450" },
  { name: TRICKY, character: "aERIN", realm: null, class: "mage", code: CODE, code2: CODE2, order: "O1p-ABACC", order2: "O1g-BA", active: true, gameBuild: "1.60.1.70450" },
  { name: "Healer", character: "Aerin", realm: null, class: "priest", code: PRIEST, code2: null, active: false, gameBuild: "1.60.1.70450" },
  { name: "Alt's build", character: "Ærîn", realm: "Doomhowl", class: "mage", code: CODE, code2: null, active: false, gameBuild: "1.60.1.70450" },
];

test("the slot addon: a TOC like the other two and one data file, every string escaped", () => {
  const { toc, lua } = renderBuildsAddon(FIXTURE_BUILDS, "2026-10-20T12:00:00.000Z");
  expect(toc).toContain(`## Interface: ${ADDON_INTERFACE}\n`);
  expect(toc).toContain("## Title: Everloot Builds\n");
  expect(toc.trimEnd().endsWith("\ndata.lua")).toBe(true);
  expect(lua).toContain('EverlootBuildsData = {\n  version = 1,\n  syncedAt = "2026-10-20T12:00:00.000Z",');
  // The name stays one Lua string: the quote and backslash are escaped, the newline is \n, the control bytes are \ddd.
  expect(lua).toContain('name = "Fire \\"burst\\" |T \\\\ v2\\n]] --[[ end\\013\\001"');
  expect(lua).toContain('character = "Ærîn", realm = "Doomhowl"');
  // No label means no character or realm field, and the second set only when there is one.
  expect(lua).toContain('{ name = "Frost AoE", class = "mage", code = ');
  expect(lua.match(/code2 = /g)).toHaveLength(1);
  expect(lua.match(/realm = /g)).toHaveLength(2);
  if (process.env.EVERLOOT_WRITE_FIXTURES === "1") writeFileSync(FIXTURE, lua);
  expect(readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n")).toBe(lua);
});

test("written through a temp file, and not written again when the builds are the same", () => {
  const addons = dir();
  const folder = join(addons, "EverlootBuilds");
  expect(writeBuildsAddon(addons, renderBuildsAddon(FIXTURE_BUILDS, "2026-10-20T12:00:00.000Z"))).toBe(true);
  expect(readdirSync(folder).sort()).toEqual(["EverlootBuilds.toc", "data.lua"]);
  expect(readFileSync(join(folder, "EverlootBuilds.toc"), "utf8")).toContain(`## Interface: ${ADDON_INTERFACE}\n`);
  const before = statSync(join(folder, "data.lua")).mtimeMs;
  writeFileSync(join(folder, "data.lua.tmp"), "stale");
  // A later sync with the same builds: nothing is written, the sync time in the file stays the earlier one.
  expect(writeBuildsAddon(addons, renderBuildsAddon(FIXTURE_BUILDS, "2026-10-20T12:15:00.000Z"))).toBe(false);
  expect(statSync(join(folder, "data.lua")).mtimeMs).toBe(before);
  expect(readFileSync(join(folder, "data.lua"), "utf8")).toContain("12:00:00.000Z");
  // A change rewrites it, and the rename takes the temp file's place.
  expect(writeBuildsAddon(addons, renderBuildsAddon(FIXTURE_BUILDS.filter((b) => b.name !== "Arcane leveling"), "2026-10-20T12:30:00.000Z"))).toBe(true);
  expect(readFileSync(join(folder, "data.lua"), "utf8")).not.toContain("Arcane leveling");
  expect(readdirSync(folder).sort()).toEqual(["EverlootBuilds.toc", "data.lua"]);
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("the key goes only over https (or to this computer), as a bearer token, without following redirects", async () => {
  expect(keySiteOrigin("https://everloot.app/")).toBe("https://everloot.app");
  expect(keySiteOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  expect(keySiteOrigin("http://127.0.0.1:3000/x")).toBe("http://127.0.0.1:3000");
  expect(keySiteOrigin("http://everloot.app")).toBeNull();
  expect(keySiteOrigin("not a url")).toBeNull();

  const send = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(200, answer));
  expect(await fetchBuilds("https://everloot.app/", KEY, send as unknown as typeof fetch)).toHaveLength(4);
  expect(String(send.mock.calls[0][0])).toBe("https://everloot.app/api/me/builds");
  expect((send.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
  expect(send.mock.calls[0][1]?.redirect).toBe("error");
  await expect(fetchBuilds("http://everloot.app", KEY, send as unknown as typeof fetch)).rejects.toThrow(/https/);
  expect(send).toHaveBeenCalledTimes(1);
});

test("each refusal says why", async () => {
  const refused = async (res: Response | Error) => {
    const s = vi.fn(async () => { if (res instanceof Error) throw res; return res; });
    return fetchBuilds("https://everloot.app", KEY, s as unknown as typeof fetch).then(() => null, (e: unknown) => e);
  };
  expect(await refused(json(401, { error: "API key is not valid or was revoked" }))).toMatchObject({ kind: "error", revoked: true, message: expect.stringMatching(/does not know your key/) });
  expect(await refused(json(403, { error: "This key can't read your saved builds" }))).toMatchObject({ kind: "forbidden", message: "This key can't read your saved builds." });
  expect(await refused(json(404, { error: "Not found" }))).toMatchObject({ kind: "unavailable", message: "Saved builds aren't available yet." });
  expect(await refused(json(429, { error: "slow down" }, { "retry-after": "600" }))).toMatchObject({ kind: "error", retryAfterMs: 600_000, message: expect.stringMatching(/10 min/) });
  expect(await refused(new TypeError("fetch failed"))).toMatchObject({ kind: "error", message: expect.stringMatching(/Could not reach/) });
  expect(await refused(json(500, {}))).toMatchObject({ kind: "error", message: expect.stringMatching(/\(500\)/) });
});

type Reply = Response | Error | Promise<Response>;
function setup(options: { key?: boolean; gameFolder?: boolean; responses?: Reply[]; endpoint?: string } = {}) {
  const data = dir(), addons = join(dir(), "Interface", "AddOns");
  if (options.key !== false) { mkdirSync(data, { recursive: true }); writeFileSync(join(data, "everloot-key.txt"), `${KEY}\n`); }
  const queue = [...(options.responses ?? [])];
  const send = vi.fn(async (_url: string) => { const r = await (queue.shift() ?? json(200, answer)); if (r instanceof Error) throw r; return r; });
  const logs: string[] = [];
  let clock = new Date("2026-10-20T12:00:00.000Z");
  const site = { endpoint: options.endpoint ?? "https://everloot.app" };
  const sync = createBuildsSync({
    dataFolder: data, endpoint: () => site.endpoint, addonsDir: () => (options.gameFolder === false ? null : addons),
    ready: () => true, paused: () => false, onChange: () => {}, log: (level, text) => logs.push(`${level} ${text}`),
    send: send as unknown as typeof fetch, now: () => clock,
  });
  const file = join(addons, "EverlootBuilds", "data.lua");
  return { sync, send, logs, addons, data, site, file, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}

test("a sync writes the slot addon and says when; without a key or a game folder nothing is asked", async () => {
  const t = setup();
  const status = await t.sync.sync();
  expect(status).toMatchObject({ state: "ok", syncedAt: "2026-10-20T12:00:00.000Z", builds: 4, message: "4 build(s) written" });
  expect(readFileSync(t.file, "utf8")).toContain('name = "Leveling", character = "Ærîn", realm = "Nightslayer"');
  expect(t.logs).toEqual(["info builds: 4 saved build(s) written; /reload in game to see them"]);
  t.advance(BUILDS_EVERY_MS);
  expect(await t.sync.tick()).toMatchObject({ state: "ok", message: "4 build(s), no change" });

  const none = setup({ key: false });
  expect(await none.sync.sync()).toMatchObject({ state: "off" });
  expect(none.send).not.toHaveBeenCalled();
  const noFolder = setup({ gameFolder: false });
  expect(await noFolder.sync.sync()).toMatchObject({ state: "error", message: "Pick the game folder first." });
  expect(noFolder.send).not.toHaveBeenCalled();
});

test("a key without read:own is shown each time, logged once, and stops the timer until Sync builds", async () => {
  const t = setup({ responses: [json(403, {}), json(403, {}), json(200, answer)] });
  expect(await t.sync.sync()).toMatchObject({ state: "forbidden", syncedAt: null });
  expect(t.sync.tick()).toBeNull();
  expect(t.send).toHaveBeenCalledTimes(1);
  expect(await t.sync.sync()).toMatchObject({ state: "forbidden" });
  expect(t.logs).toEqual(["info builds: This key can't read your saved builds."]);
  expect(existsSync(join(t.addons, "EverlootBuilds"))).toBe(false);
  // A new key starts over: the timer runs again.
  t.sync.signedOut();
  writeFileSync(join(t.data, "everloot-key.txt"), `${KEY}\n`);
  expect(await t.sync.signedIn()).toMatchObject({ state: "ok" });

  // The site's switch off: quiet, logged once, and the timer keeps trying.
  const off = setup({ responses: [json(404, {}), json(404, {})] });
  expect(await off.sync.sync()).toMatchObject({ state: "unavailable" });
  expect(await off.sync.tick()).toMatchObject({ state: "unavailable" });
  expect(off.logs).toEqual(["info builds: Saved builds aren't available yet."]);
});

test("a revoked key takes the builds out of the game and stops the timer; so does signing out", async () => {
  const t = setup({ responses: [json(200, answer), json(401, {})] });
  await t.sync.sync();
  expect(readFileSync(t.file, "utf8")).toContain("Leveling");
  expect(await t.sync.tick()).toMatchObject({ state: "error", message: expect.stringMatching(/revoked/) });
  expect(readFileSync(t.file, "utf8")).toMatch(/builds = \{\n {2}\},/);
  expect(t.sync.tick()).toBeNull();
  expect(t.logs.filter((l) => l.startsWith("error"))).toEqual([]);

  const out = setup();
  await out.sync.sync();
  out.sync.signedOut();
  expect(out.sync.status()).toMatchObject({ state: "off", syncedAt: null });
  expect(readFileSync(out.file, "utf8")).not.toContain("Leveling");
  expect(readdirSync(join(out.addons, "EverlootBuilds")).sort()).toEqual(["EverlootBuilds.toc", "data.lua"]);
  // Nothing was there: nothing is created.
  const never = setup();
  never.sync.signedOut();
  expect(existsSync(join(never.addons, "EverlootBuilds"))).toBe(false);
});

test("a 429 retries once at Retry-After, and a sign-out cancels the retry", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const t = setup({ responses: [json(429, {}, { "retry-after": "1800" })] });
  expect(await t.sync.sync()).toMatchObject({ state: "error", message: expect.stringMatching(/30 min/) });
  t.advance(BUILDS_EVERY_MS);
  expect(t.sync.tick()).toBeNull();
  t.advance(BUILDS_EVERY_MS);
  await vi.advanceTimersByTimeAsync(1_800_000);
  expect(t.send).toHaveBeenCalledTimes(2);
  expect(t.sync.status()).toMatchObject({ state: "ok" });

  const c = setup({ responses: [json(429, {}, { "retry-after": "60" })] });
  await c.sync.sync();
  c.sync.signedOut();
  c.advance(60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(c.send).toHaveBeenCalledTimes(1);
});

test("the timer sends the key only to the site it was signed in on; Sync builds moves it, never to plain http", async () => {
  const t = setup();
  expect(readKeyOrigin(t.data)).toBe("https://everloot.app");
  t.site.endpoint = "https://staging.example";
  expect(await t.sync.tick()).toMatchObject({ state: "error", message: expect.stringMatching(/site address changed/) });
  expect(await t.sync.tick()).toMatchObject({ state: "error" });
  expect(t.send).not.toHaveBeenCalled();
  expect(t.logs).toHaveLength(1);
  expect(await t.sync.sync()).toMatchObject({ state: "ok" });
  expect(t.send.mock.calls[0][0]).toBe("https://staging.example/api/me/builds");
  expect(readKeyOrigin(t.data)).toBe("https://staging.example");

  t.site.endpoint = "http://evil.example";
  expect(await t.sync.sync()).toMatchObject({ state: "error", message: expect.stringMatching(/https/) });
  expect(t.send).toHaveBeenCalledTimes(1);
  t.site.endpoint = "http://localhost:3000";
  expect(await t.sync.sync()).toMatchObject({ state: "ok" });
  expect(t.send.mock.calls[1][0]).toBe("http://localhost:3000/api/me/builds");
});

test("a sync from before a sign-out or sign-in writes nothing; the new key's sync runs after it settles", async () => {
  let release!: (r: Response) => void;
  const t = setup({ responses: [new Promise<Response>((r) => { release = r; })] });
  const old = t.sync.sync();
  expect(t.sync.sync()).toBe(old);
  await vi.waitFor(() => expect(t.send).toHaveBeenCalledTimes(1));
  t.sync.signedOut();
  release(json(200, answer));
  await old;
  expect(existsSync(t.file)).toBe(false);
  expect(t.sync.status()).toMatchObject({ state: "off", syncedAt: null });

  let late!: (r: Response) => void;
  const u = setup({ responses: [new Promise<Response>((r) => { late = r; }), json(200, { characters: [], builds: [answer.builds[0]] })] });
  const first = u.sync.sync();
  await vi.waitFor(() => expect(u.send).toHaveBeenCalledTimes(1));
  const second = u.sync.signedIn();
  expect(second).not.toBe(first);
  await new Promise((r) => setTimeout(r, 10));
  expect(u.send).toHaveBeenCalledTimes(1);
  late(json(200, answer));
  expect(await second).toMatchObject({ state: "ok", builds: 1 });
  expect(u.send).toHaveBeenCalledTimes(2);
  expect(readFileSync(u.file, "utf8")).not.toContain("No label");
});

test("a failed sync keeps the file the last one wrote", async () => {
  const t = setup({ responses: [json(200, answer), new TypeError("offline"), new TypeError("offline")] });
  await t.sync.sync();
  const before = readFileSync(t.file, "utf8");
  expect(await t.sync.sync()).toMatchObject({ state: "error", syncedAt: "2026-10-20T12:00:00.000Z" });
  expect(await t.sync.sync()).toMatchObject({ state: "error" });
  expect(readFileSync(t.file, "utf8")).toBe(before);
  expect(t.logs.filter((l) => l.startsWith("error"))).toHaveLength(1);
});
