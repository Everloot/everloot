import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { armoryCharacter, armoryGuild } from "./armory.fixture";
import { armoryStore, armoryStoreFrom, createCloudArmoryStore, createMemoryArmoryStore } from "./armory-store";

describe("the Supabase store", () => {
  const fake = (answer: unknown) => {
    const query = vi.fn(async (_path: string, _init?: RequestInit) => answer);
    return { query, store: createCloudArmoryStore(query as never) };
  };
  const call = (query: ReturnType<typeof fake>["query"]) => {
    const [path, init] = query.mock.calls[0]!;
    return { path, method: init?.method, body: JSON.parse(String(init?.body)) };
  };

  test("calls each contract function by name with its p_ arguments", async () => {
    const cases: [(s: ReturnType<typeof createCloudArmoryStore>) => Promise<unknown>, string, Record<string, unknown>][] = [
      [(s) => s.character("eu", "velkara-duskmantle"), "armory_character", { p_region: "eu", p_slug: "velkara-duskmantle" }],
      [(s) => s.guild("us", "ember-wardens"), "armory_guild", { p_region: "us", p_slug: "ember-wardens" }],
      [(s) => s.roster("us", "ember-wardens"), "armory_roster", { p_region: "us", p_slug: "ember-wardens" }],
      [(s) => s.search("vel", 25), "armory_search", { p_prefix: "vel", p_limit: 25 }],
      [(s) => s.searchGuilds("emb", 25), "armory_search_guilds", { p_prefix: "emb", p_limit: 25 }],
      [(s) => s.board("gear_score", null, 15, 100), "armory_board", { p_metric: "gear_score", p_region: null, p_ruleset_id: 15, p_limit: 100 }],
      [(s) => s.rank("eu", "velkara-duskmantle"), "armory_rank", { p_region: "eu", p_slug: "velkara-duskmantle" }],
      [(s) => s.counts(), "armory_counts", {}],
      [(s) => s.hide("eu", "velkara-duskmantle"), "armory_hide", { p_region: "eu", p_slug: "velkara-duskmantle" }],
      [(s) => s.enqueue("eu", "character", "velkara-duskmantle", "website"), "armory_enqueue", { p_region: "eu", p_kind: "character", p_slug: "velkara-duskmantle", p_source: "website" }],
    ];
    for (const [run, fn, args] of cases) {
      const { query, store } = fake(fn === "armory_enqueue" ? true : []);
      await run(store);
      expect(call(query)).toEqual({ path: `rpc/${fn}`, method: "POST", body: args });
    }
  });

  const stored = {
      region: "eu", slug: "velkara-duskmantle", character_id: 9001, name: "Velkara", surname: "Duskmantle", level: 60, ruleset_id: 2, ruleset: "Normal",
      race_id: 8, race: "Troll", class_id: 3, class: "Hunter", faction: "Horde", gender: "FEMALE", guild_slug: "ember-wardens", guild_name: "Ember Wardens",
      guild_id: 77, last_login: null, equipped_item_level: 58, average_item_level: 58, item_level: "57.41", gear_score: null, honorable_kills: 12, pvp_rank: 0,
      equipment: [{ slot: "HEAD", item_id: 16846, name: "Giantstalker's Helmet", level: 66, quality: "EPIC", inventory_type: "HEAD" }],
      fetched_at: "2026-11-09T10:00:00+00:00", checked_at: "2026-11-09T10:00:00+00:00",
  };

  test("maps the stored row to the page's shape, a numeric string too", async () => {
    const c = await fake([stored]).store.character("eu", "velkara-duskmantle");
    expect(c).toMatchObject({ itemLevel: 57.41, gearScore: null, pvpRank: 0, lastLogin: null, guildSlug: "ember-wardens" });
    expect(c!.equipment).toEqual([{ slot: "HEAD", itemId: 16846, name: "Giantstalker's Helmet", level: 66, quality: "EPIC", inventoryType: "HEAD" }]);
  });

  test("an answer of another shape is an error, never a page of undefined", async () => {
    const { name: _name, ...noName } = stored;
    for (const bad of [[noName], [{ ...stored, level: "sixty" }], [{ ...stored, equipment: [{ name: "no slot" }] }], [{ ...stored, fetched_at: null }], { rows: [] }, null]) {
      await expect(fake(bad).store.character("eu", "velkara-duskmantle")).rejects.toThrow();
    }
    await expect(fake([{ metric: "dps", rank: 1, of: 2 }]).store.rank("eu", "a-b")).rejects.toThrow();
    await expect(fake([{ rank: 1, region: "eu" }]).store.board("item_level", null, null, 10)).rejects.toThrow();
    await expect(fake([{ character_slug: "a-b", name: "A", surname: "B", level: 1, class_id: 1, race_id: 1, rank: 0, item_level: null, gear_score: null }]).store.roster("eu", "x")).rejects.toThrow();
    await expect(fake("yes").store.enqueue("eu", "character", "a-b", "website")).rejects.toThrow();
  });

  test("a roster member stored without names reads them off its slug; the rest of the roster stands", async () => {
    const roster = await fake([
      { character_slug: "brannoc-tide", name: null, surname: null, level: null, class_id: null, race_id: null, rank: null, item_level: null, gear_score: null, stored: false },
      { character_slug: "velkara-duskmantle", name: "Velkara", surname: null, level: 60, class_id: 3, race_id: 8, rank: 1, item_level: "57.41", gear_score: null, stored: true },
    ]).store.roster("eu", "ember-wardens");
    expect(roster.map((m) => [m.name, m.surname, m.level, m.itemLevel])).toEqual([["Brannoc", "Tide", null, null], ["Velkara", "Duskmantle", 60, 57.41]]);
  });

  test("no row is null, and only a true enqueue answer counts as queued", async () => {
    expect(await fake([]).store.character("eu", "a-b")).toBeNull();
    expect(await fake([]).store.guild("eu", "a-b")).toBeNull();
    expect(await fake(true).store.enqueue("eu", "character", "a-b", "website")).toBe(true);
    expect(await fake(false).store.enqueue("eu", "character", "a-b", "website")).toBe(false);
  });

  test("a refused call throws, for the page to say storage is unreachable", async () => {
    const store = createCloudArmoryStore((async () => { throw new Error("down"); }) as never);
    await expect(store.counts()).rejects.toThrow("down");
  });

  test("picked when Supabase is configured; memory in development; in production without it, every call fails", async () => {
    const missing = armoryStoreFrom({ NODE_ENV: "production" });
    await expect(missing.counts()).rejects.toThrow("not configured");
    await expect(missing.hide("eu", "a-b")).rejects.toThrow("not configured");
    expect(armoryStoreFrom({ NODE_ENV: "development" })).toHaveProperty("putCharacter");
    expect(armoryStoreFrom({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" })).not.toHaveProperty("putCharacter");
  });
});

describe("armoryStore", () => {
  const held = globalThis as { __everlootArmory?: unknown; __everlootArmoryLogged?: boolean };
  const reset = () => { delete held.__everlootArmory; delete held.__everlootArmoryLogged; };
  beforeEach(reset);
  afterEach(() => { reset(); vi.restoreAllMocks(); });

  test("never throws: a builder that throws gives a store whose calls fail, logged once without the error's text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let t = 0;
    const failing = armoryStore(() => { throw new TypeError("https://secret.example key=abc"); }, () => t);
    await expect(failing.counts()).rejects.toThrow("unavailable");
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toBe(
      "armory: storage unavailable: the store could not be built (TypeError). Armory pages show it as unreachable; trying again every 60 s.",
    );
    t = 59_999;
    armoryStore(() => { throw new Error("again"); }, () => t);
    expect(log).toHaveBeenCalledTimes(1);
  });

  test("missing credentials in production log one line naming the variables, never their values, and retry after a minute", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const build = vi.fn(() => armoryStoreFrom({ NODE_ENV: "production", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: " " }));
    let t = 1_000;
    const first = armoryStore(build, () => t);
    await expect(first.counts()).rejects.toThrow("not configured");
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
    expect(line).not.toContain("x.supabase.co");
    // Kept for a minute, then built again; the line is not repeated.
    t = 60_999;
    expect(armoryStore(build, () => t)).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
    t = 61_000;
    armoryStore(build, () => t);
    expect(build).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    // Once the variables are there, the working store is built and kept.
    const memory = createMemoryArmoryStore();
    t = 121_000;
    expect(armoryStore(() => memory, () => t)).toBe(memory);
    t = 10_000_000;
    expect(armoryStore(() => { throw new Error("not called"); }, () => t)).toBe(memory);
  });
});

describe("the memory store", () => {
  const now = () => new Date("2026-11-10T00:00:00Z");
  const filled = () => {
    const s = createMemoryArmoryStore(now);
    s.putCharacter(armoryCharacter());
    s.putCharacter(armoryCharacter({ slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", itemLevel: 60, gearScore: null, honorableKills: 50 }));
    s.putCharacter(armoryCharacter({ slug: "orla-fenwick", name: "Orla", surname: "Fenwick", region: "us", itemLevel: 70 }));
    s.putGuild(armoryGuild(), [
      { characterSlug: "velkara-duskmantle", name: "Velkara", surname: "Duskmantle", level: 60, classId: 3, raceId: 8, rank: 0 },
      { characterSlug: "brannoc-tide", name: "Brannoc", surname: "Tide", level: 41, classId: 1, raceId: 2, rank: 4 },
    ]);
    return s;
  };

  test("boards rank highest first within the filter and leave out a null value", async () => {
    const s = filled();
    expect((await s.board("item_level", null, null, 10)).map((r) => [r.rank, r.slug])).toEqual([[1, "orla-fenwick"], [2, "torvin-ashbrook"], [3, "velkara-duskmantle"]]);
    expect((await s.board("item_level", "eu", 2, 10)).map((r) => r.slug)).toEqual(["torvin-ashbrook", "velkara-duskmantle"]);
    expect((await s.board("gear_score", "eu", null, 10)).map((r) => r.slug)).toEqual(["velkara-duskmantle"]);
    expect(await s.rank("eu", "velkara-duskmantle")).toEqual([
      { metric: "item_level", rank: 2, of: 2 }, { metric: "gear_score", rank: 1, of: 1 }, { metric: "honorable_kills", rank: 1, of: 2 },
    ]);
  });

  test("the roster joins stored characters' numbers", async () => {
    const roster = await filled().roster("eu", "ember-wardens");
    expect(roster.map((m) => [m.characterSlug, m.stored, m.itemLevel])).toEqual([["velkara-duskmantle", true, 57.41], ["brannoc-tide", false, null]]);
  });

  test("a hide deletes the character, its roster row and its queue row, and it is never written or queued again", async () => {
    const s = filled();
    expect(await s.enqueue("eu", "character", "brannoc-tide", "roster")).toBe(true);
    await s.hide("eu", "brannoc-tide");
    await s.hide("eu", "velkara-duskmantle");
    expect(await s.character("eu", "velkara-duskmantle")).toBeNull();
    expect(await s.roster("eu", "ember-wardens")).toEqual([]);
    expect(s.queued()).toEqual([]);
    s.putCharacter(armoryCharacter());
    expect(await s.character("eu", "velkara-duskmantle")).toBeNull();
    expect(await s.enqueue("eu", "character", "velkara-duskmantle", "website")).toBe(false);
  });

  test("enqueue refuses a queued or freshly read character and accepts a stale one", async () => {
    const s = filled();
    expect(await s.enqueue("eu", "character", "velkara-duskmantle", "website")).toBe(false);
    s.putCharacter(armoryCharacter({ checkedAt: "2026-10-01T00:00:00Z" }));
    expect(await s.enqueue("eu", "character", "velkara-duskmantle", "website")).toBe(true);
    expect(await s.enqueue("eu", "character", "velkara-duskmantle", "website")).toBe(false);
    expect(s.queued()).toEqual([{ region: "eu", kind: "character", slug: "velkara-duskmantle", source: "website" }]);
  });

  test("a guild is fresh by checked_at, and a 304 touch counts as a read for both times", async () => {
    const s = filled();
    s.putGuild(armoryGuild({ fetchedAt: "2026-10-12T00:00:00.000Z", checkedAt: "2026-11-09T00:00:00.000Z" }), []);
    expect(await s.enqueue("eu", "guild", "ember-wardens", "seed")).toBe(false);
    s.putGuild(armoryGuild({ slug: "wardens", fetchedAt: "2026-10-12T00:00:00.000Z", checkedAt: "2026-10-12T00:00:00.000Z" }), []);
    expect(s.touch("eu", "guild", ["wardens", "not-stored"])).toBe(1);
    expect(await s.guild("eu", "wardens")).toMatchObject({ fetchedAt: "2026-11-10T00:00:00.000Z", checkedAt: "2026-11-10T00:00:00.000Z" });
    expect(await s.enqueue("eu", "guild", "wardens", "seed")).toBe(false);
    s.putCharacter(armoryCharacter({ slug: "orla-fenwick", region: "us", checkedAt: "2026-10-01T00:00:00Z", fetchedAt: "2026-10-01T00:00:00Z" }));
    expect(s.touch("us", "character", ["orla-fenwick"])).toBe(1);
    expect(await s.character("us", "orla-fenwick")).toMatchObject({ fetchedAt: "2026-11-10T00:00:00.000Z", checkedAt: "2026-11-10T00:00:00.000Z" });
  });

  test("search takes letters of any script", async () => {
    const s = filled();
    s.putCharacter(armoryCharacter({ slug: "élodie-brun", name: "Élodie", surname: "Brun" }));
    s.putGuild(armoryGuild({ slug: "wardens", name: "Wardens" }), []);
    expect((await s.search("él", 25)).map((h) => h.slug)).toEqual(["élodie-brun"]);
    expect((await s.search("É", 25))).toEqual([]);
    expect((await s.searchGuilds("war", 25)).map((g) => g.slug)).toEqual(["wardens"]);
  });

  test("search wants two letters and orders by name; counts group by region and ruleset", async () => {
    const s = filled();
    expect(await s.search("v", 25)).toEqual([]);
    expect((await s.search("VEL", 25)).map((h) => h.slug)).toEqual(["velkara-duskmantle"]);
    expect((await s.searchGuilds("emb", 25)).map((g) => g.slug)).toEqual(["ember-wardens"]);
    expect(await s.counts()).toEqual([
      { region: "eu", rulesetId: 2, ruleset: "Normal", characters: 2, guilds: 1, newest: "2026-11-09T10:00:00.000Z" },
      { region: "us", rulesetId: 2, ruleset: "Normal", characters: 1, guilds: 0, newest: "2026-11-09T10:00:00.000Z" },
    ]);
  });
});
