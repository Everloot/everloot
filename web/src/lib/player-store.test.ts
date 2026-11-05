import { describe, expect, test, vi } from "vitest";
import { createCloudPlayerStore, createMemoryPlayerStore, missingFunction, playerHideKey, playerStoreFrom } from "./player-store";
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

  test("realms count their visible guilds once, and a realm's guilds come most members first, hidden guilds left out", async () => {
    const store = createMemoryPlayerStore();
    await store.upsert([
      row("Aa", { guild: "Night Watch" }), row("Bb", { guild: "night watch", seen: "2026-10-23" }), row("Cc", { guild: "Ember" }),
      row("Dd", { guild: "Quiet" }), row("Ee"), row("Ff", { realm: "Forever Nomad", guild: "Night Watch" }),
    ]);
    await store.suppress("Forever Pioneer", "Dd");
    expect(await store.guildRealms()).toEqual([{ realm: "Forever Nomad", guilds: 1 }, { realm: "Forever Pioneer", guilds: 2 }]);
    const guilds = await store.realmGuilds("forever-pioneer");
    expect(guilds.map((g) => [g.guild, g.members])).toEqual([["Night Watch", 2], ["Ember", 1]]);
    expect(guilds[0]!.lastSeen).toBe("2026-10-23");
    await store.suppressGuild("Forever Pioneer", "Night Watch");
    expect((await store.realmGuilds("Forever Pioneer")).map((g) => g.guild)).toEqual(["Ember"]);
    expect(await store.guildRealms()).toEqual([{ realm: "Forever Nomad", guilds: 1 }, { realm: "Forever Pioneer", guilds: 1 }]);
    expect(await store.realmGuilds("Nowhere")).toEqual([]);
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

  test("the realm reads call their functions with the realm key and a hard limit, and map the counts", async () => {
    const { send, store } = call([{ realm: "Forever Pioneer", guilds: "3" }]);
    expect(await store.guildRealms()).toEqual([{ realm: "Forever Pioneer", guilds: 3 }]);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/rpc/guild_realms");
    expect(JSON.parse(init.body as string)).toEqual({ p_ruleset: "forever" });
    const guilds = call([{ realm: "Forever Pioneer", guild: "Night Watch", members: "2", last_seen: "2026-10-23" }]);
    expect(await guilds.store.realmGuilds("Forever-Pioneer")).toEqual([{ realm: "Forever Pioneer", guild: "Night Watch", members: 2, lastSeen: "2026-10-23" }]);
    const [guildUrl, guildInit] = guilds.send.mock.calls[0] as unknown as [string, RequestInit];
    expect(guildUrl).toBe("https://db.example/rest/v1/rpc/realm_guilds");
    expect(JSON.parse(guildInit.body as string)).toEqual({ p_ruleset: "forever", p_realm_key: "forever pioneer", p_limit: 1000 });
  });

  test("a function the migration has not made yet is told apart from an outage", async () => {
    const answer = (status: number, body: unknown) => {
      const send = vi.fn(async () => new Response(JSON.stringify(body), { status }));
      return createCloudPlayerStore("https://db.example", "k", send as unknown as typeof fetch).guildRealms().catch((err: unknown) => err);
    };
    expect(missingFunction(await answer(404, { code: "PGRST202", message: "Could not find the function public.guild_realms(p_ruleset) in the schema cache" }))).toBe(true);
    expect(missingFunction(await answer(404, { code: "42883", message: "function public.guild_realms(p_ruleset => text) does not exist" }))).toBe(true);
    expect(missingFunction(await answer(500, { code: "PGRST202" }))).toBe(false);
    expect(missingFunction(await answer(503, { message: "down" }))).toBe(false);
    expect(missingFunction(await answer(404, { code: "PGRST205" }))).toBe(false);
    expect(missingFunction(new Error("Player storage unavailable (404)"))).toBe(false);
  });

  test("a failed request throws, so the caller can tell the player to retry", async () => {
    const send = vi.fn(async () => new Response("", { status: 500 }));
    await expect(createCloudPlayerStore("https://db.example", "k", send as unknown as typeof fetch).upsert([row("Aa")])).rejects.toThrow(/unavailable/);
  });

  test("the hidden characters are read from the opt-out table, a thousand rows a page, keyed however the realm was spelled", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ realm: "forever pioneer", character: `name${i}` }));
    const pages = [{ rows: page, range: "0-999/1001" }, { rows: [{ realm: "Forever-Pioneer", character: "Ada" }], range: "1000-1000/1001" }];
    const send = vi.fn(async () => {
      const next = pages.shift()!;
      return new Response(JSON.stringify(next.rows), { status: 206, headers: { "content-range": next.range } });
    });
    const hidden = await createCloudPlayerStore("https://db.example/", "service-key", send as unknown as typeof fetch).hiddenPlayers();
    expect(send).toHaveBeenCalledTimes(2);
    const [url, init] = send.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://db.example/rest/v1/character_suppressions?select=realm,character&order=realm,character&limit=1000&offset=1000");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer service-key");
    expect(new Headers(init.headers).get("prefer")).toBe("count=exact");
    expect(hidden.size).toBe(1001);
    expect(hidden.has(playerHideKey("Forever Pioneer", "ada"))).toBe(true);
    const failed = vi.fn(async () => new Response("", { status: 503 }));
    await expect(createCloudPlayerStore("https://db.example", "k", failed as unknown as typeof fetch).hiddenPlayers()).rejects.toThrow(/unavailable/);
  });

  test("a hide list the pages cannot show to be complete is an error, never a shorter list", async () => {
    const hiddenFrom = (...responses: (() => Response)[]) => {
      const send = vi.fn(async () => responses.shift()!());
      return createCloudPlayerStore("https://db.example", "k", send as unknown as typeof fetch).hiddenPlayers();
    };
    const rows = (n: number, from = 0) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ realm: "forever pioneer", character: `n${from + i}` })));
    const part = (body: string, range: string | null) => () => new Response(body, { status: 206, headers: range ? { "content-range": range } : {} });
    // A short page before the end: the read goes on from the rows it got, not from the next thousand.
    const short = [part(rows(500), "0-499/700"), part(rows(200, 500), "500-699/700")];
    const send = vi.fn(async () => short.shift()!());
    expect((await createCloudPlayerStore("https://db.example", "k", send as unknown as typeof fetch).hiddenPlayers()).size).toBe(700);
    expect((send.mock.calls[1] as unknown as [string])[0]).toMatch(/offset=500$/);
    // One row of two, then nothing: the server stopped short.
    await expect(hiddenFrom(part(rows(1), "0-0/2"), part("[]", "*/2"))).rejects.toThrow(/before their count/);
    // A later page fails.
    await expect(hiddenFrom(part(rows(1000), "0-999/1500"), () => new Response("", { status: 500 }))).rejects.toThrow(/unavailable/);
    // No count, or a count that does not fit the rows.
    await expect(hiddenFrom(part(rows(3), null))).rejects.toThrow(/count missing/);
    await expect(hiddenFrom(part(rows(3), "0-2/*"))).rejects.toThrow(/count missing/);
    await expect(hiddenFrom(part(rows(3), "0-1/3"))).rejects.toThrow(/match their range/);
    // An empty table is complete.
    expect((await hiddenFrom(() => new Response("[]", { status: 200, headers: { "content-range": "*/0" } }))).size).toBe(0);
  });

  test("the whole hide list has one deadline: a read that runs past it fails", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    }));
    await expect(createCloudPlayerStore("https://db.example", "k", hang as unknown as typeof fetch, 20).hiddenPlayers()).rejects.toThrow();
  });

  test("production without Supabase settings has no store instead of a silent one", () => {
    expect(() => playerStoreFrom({ NODE_ENV: "production" })).toThrow(/not configured/);
    expect(playerStoreFrom({ NODE_ENV: "development" })).toBeTruthy();
  });
});
