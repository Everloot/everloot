import { describe, expect, test, vi } from "vitest";
import { createCloudPlayerStore, createMemoryPlayerStore, playerHideKey, playerStoreFrom } from "./player-store";
import { optOutPath, playerDateProblem, playerIndexingOn, playerPagesOn, playerPath, playerUpsert, realmSlug, searchPrefix, type PlayerRow } from "./player-pages";

const row = (name: string, extra: object = {}) => ({ name, realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, seen: "2026-10-20", ...extra });

describe("the switches", () => {
  test("both are off unless set to 1, and indexing needs the pages on", () => {
    expect(playerPagesOn({})).toBe(false);
    expect(playerPagesOn({ EVERLOOT_PLAYER_PAGES: "true" })).toBe(false);
    expect(playerPagesOn({ EVERLOOT_PLAYER_PAGES: "1" })).toBe(true);
    expect(playerIndexingOn({ EVERLOOT_PLAYER_PAGES_INDEX: "1" })).toBe(false);
    expect(playerIndexingOn({ EVERLOOT_PLAYER_PAGES: "1" })).toBe(false);
    expect(playerIndexingOn({ EVERLOOT_PLAYER_PAGES: "1", EVERLOOT_PLAYER_PAGES_INDEX: "1" })).toBe(true);
  });
});

describe("what a row becomes", () => {
  const full = { kind: "player_seen", installId: "install-1234", capturedAt: "2026-10-20T21:30:45.000Z", name: "Thrallina", realm: " Forever Pioneer ", race: "Orc", class: "SHAMAN", level: 24, guild: "Night Watch" } as PlayerRow;

  test("the UTC day only, never the time, and never a day after today", () => {
    const now = new Date("2026-10-20T22:00:00Z");
    expect(playerUpsert(full, now)).toEqual({ name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, guild: "Night Watch", seen: "2026-10-20" });
    expect(playerUpsert({ ...full, capturedAt: "2026-10-21T20:00:00.000Z" }, now).seen).toBe("2026-10-20");
  });

  test("the date window is 30 days back and one day ahead", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(playerDateProblem("2026-10-20T00:00:00Z", now)).toBeNull();
    expect(playerDateProblem("2026-09-19T00:00:00Z", now)).toMatch(/30 days/);
    expect(playerDateProblem("2026-10-22T00:00:00Z", now)).toMatch(/1 day ahead/);
  });

  test("addresses are lower case with hyphens, and a search is 2 to 12 letters", () => {
    expect(realmSlug("Forever Pioneer")).toBe("forever-pioneer");
    expect(playerPath({ ruleset: "forever", realm: "Forever Pioneer", name: "Thrallina" })).toBe("/players/forever/forever-pioneer/thrallina");
    expect(optOutPath({ realm: "Forever Pioneer", name: "Thrallina" })).toBe("/players/opt-out?realm=Forever%20Pioneer&name=Thrallina");
    expect(searchPrefix(" Thr ")).toBe("Thr");
    for (const bad of ["T", "", "th%", "a_b", "x1", "abcdefghijklm", undefined, 5]) expect(searchPrefix(bad)).toBeNull();
  });
});

describe("the development store follows the same rules as the table", () => {
  test("one row per character, the newest day wins, and a missing guild keeps the old one", async () => {
    const store = createMemoryPlayerStore();
    await store.upsert([row("Thrallina", { guild: "Night Watch" }), row("thrallina", { realm: "forever pioneer", level: 25, seen: "2026-10-21" })]);
    await store.upsert([row("Thrallina", { level: 3, seen: "2026-10-19" })]);
    const found = await store.get("forever", "forever-pioneer", "THRALLINA");
    expect(found).toMatchObject({ name: "thrallina", level: 25, guild: "Night Watch", lastSeen: "2026-10-21" });
    expect(await store.search("th")).toHaveLength(1);
  });

  test("search is a name prefix, in name order, capped at 25", async () => {
    const store = createMemoryPlayerStore();
    await store.upsert(Array.from({ length: 30 }, (_, i) => row(`Ab${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`)));
    await store.upsert([row("Zed")]);
    const found = await store.search("ab");
    expect(found).toHaveLength(25);
    expect(found.map((p) => p.name)).toEqual([...found.map((p) => p.name)].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    expect(await store.search("ze")).toHaveLength(1);
  });

  test("a hidden character is deleted, and refused if the addon reports it again", async () => {
    const store = createMemoryPlayerStore();
    await store.upsert([row("Thrallina")]);
    await store.suppress("Forever Pioneer", "Thrallina");
    expect(await store.get("forever", "forever-pioneer", "thrallina")).toBeNull();
    await store.upsert([row("Thrallina", { seen: "2026-10-22" })]);
    expect(await store.search("th")).toEqual([]);
  });

  test("rows not seen for 90 days are pruned", async () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const store = createMemoryPlayerStore(() => now);
    await store.upsert([row("Oldtimer", { seen: "2026-07-01" }), row("Newcomer", { seen: "2026-10-19" })]);
    await store.prune();
    expect((await store.search("ol")).length + (await store.search("ne")).length).toBe(1);
  });
});

describe("the Supabase store", () => {
  const call = (body: unknown = []) => {
    const send = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    return { send, store: createCloudPlayerStore("https://db.example/", "service-key", send as unknown as typeof fetch) };
  };

  test("a write is one request for the whole batch, with the service key and no cache", async () => {
    const { send, store } = call(2);
    await store.upsert([row("Aa"), row("Bb")]);
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/rpc/upsert_players");
    expect(JSON.parse(init.body as string)).toEqual({ p_ruleset: "forever", p_rows: [row("Aa"), row("Bb")] });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer service-key");
    expect(init.cache).toBe("no-store");
  });

  test("an empty batch makes no request", async () => {
    const { send, store } = call();
    await store.upsert([]);
    expect(send).not.toHaveBeenCalled();
  });

  test("reads map the table's columns, and a character that is not there is null", async () => {
    const { store } = call([{ name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, guild: null, last_seen: "2026-10-20" }]);
    expect(await store.get("forever", "forever-pioneer", "thrallina")).toEqual({ name: "Thrallina", realm: "Forever Pioneer", ruleset: "forever", race: "Orc", class: "SHAMAN", level: 24, guild: null, lastSeen: "2026-10-20" });
    expect(await call([]).store.get("forever", "x", "yy")).toBeNull();
  });

  test("a failed request throws, so the caller can tell the player to retry", async () => {
    const send = vi.fn(async () => new Response("", { status: 500 }));
    await expect(createCloudPlayerStore("https://db.example", "k", send as unknown as typeof fetch).upsert([row("Aa")])).rejects.toThrow(/unavailable/);
  });

  test("the hidden characters are read from the opt-out table, a thousand rows a page, keyed however the realm was spelled", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ realm: "forever pioneer", character: `name${i}` }));
    const pages = [page, [{ realm: "Forever-Pioneer", character: "Ada" }]];
    const send = vi.fn(async () => new Response(JSON.stringify(pages.shift() ?? []), { status: 200 }));
    const hidden = await createCloudPlayerStore("https://db.example/", "service-key", send as unknown as typeof fetch).hiddenPlayers();
    expect(send).toHaveBeenCalledTimes(2);
    const [url, init] = send.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/character_suppressions?select=realm,character&order=realm,character&limit=1000&offset=1000");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer service-key");
    expect(hidden.size).toBe(1001);
    expect(hidden.has(playerHideKey("Forever Pioneer", "ada"))).toBe(true);
    const failed = vi.fn(async () => new Response("", { status: 503 }));
    await expect(createCloudPlayerStore("https://db.example", "k", failed as unknown as typeof fetch).hiddenPlayers()).rejects.toThrow(/unavailable/);
  });

  test("production without Supabase settings has no store instead of a silent one", () => {
    expect(() => playerStoreFrom({ NODE_ENV: "production" })).toThrow(/not configured/);
    expect(playerStoreFrom({ NODE_ENV: "development" })).toBeTruthy();
  });
});
