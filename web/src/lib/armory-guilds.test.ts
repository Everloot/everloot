import { beforeEach, describe, expect, test, vi } from "vitest";
import { armoryCharacter, armoryGuild } from "./armory.fixture";
import { createCloudArmoryStore, createMemoryArmoryStore, type ArmoryStore, type MemoryArmoryStore } from "./armory-store";
import { guildHideKey } from "./player-store";
import { StorageError } from "./supabase/server";

const holder = vi.hoisted(() => ({ store: null as ArmoryStore | null }));
vi.mock("./armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./armory-store")>()), armoryStore: () => holder.store }));

const {
  armoryGuildHidden, directoryPrefix, GUILD_DIRECTORY_PAGE, guildDirectoryHref, guildDirectoryQuery, loadGuildDirectory, rosterSummary,
} = await import("./armory-guilds");

let mem: MemoryArmoryStore;
beforeEach(() => {
  mem = createMemoryArmoryStore(() => new Date("2026-11-10T00:00:00Z"));
  holder.store = mem;
});

/** Three guilds: Ember Wardens (EU Normal, 3 read), Ash Pact (US PvP, 1 read), Empty Hall (EU Normal, none read). */
function fill() {
  mem.putGuild(armoryGuild(), []);
  mem.putGuild(armoryGuild({ region: "us", slug: "ash-pact", name: "Ash Pact", rulesetId: 1, ruleset: "PvP", memberCount: 12 }), []);
  mem.putGuild(armoryGuild({ slug: "empty-hall", name: "Empty Hall", memberCount: 4, fetchedAt: "2026-11-01T00:00:00.000Z" }), []);
  mem.putCharacter(armoryCharacter({ slug: "velkara-duskmantle", itemLevel: 60, level: 60 }));
  mem.putCharacter(armoryCharacter({ slug: "torvin-ashbrook", name: "Torvin", surname: "Ashbrook", itemLevel: 50, level: 52, fetchedAt: "2026-11-09T12:00:00.000Z" }));
  mem.putCharacter(armoryCharacter({ slug: "nyra-coldwell", name: "Nyra", surname: "Coldwell", itemLevel: null, level: 60 }));
  mem.putCharacter(armoryCharacter({ region: "us", slug: "brask-ironhide", name: "Brask", surname: "Ironhide", guildSlug: "ash-pact", guildName: "Ash Pact", itemLevel: 80, level: 60, rulesetId: 1, ruleset: "PvP" }));
}

describe("the directory's address", () => {
  test("reads q, region, rules, sort and p, and drops what it does not know", () => {
    expect(guildDirectoryQuery({ q: "Emb", region: "EU", rules: "roleplay-pvp", sort: "item-level", p: "3" }))
      .toEqual({ prefix: "emb", region: "eu", ruleset: 15, sort: "item-level", page: 3 });
    expect(guildDirectoryQuery({ q: "e", region: "kr", rules: "4", sort: "dps", p: "-2" }))
      .toEqual({ prefix: null, region: null, ruleset: null, sort: "members", page: 1 });
    expect(guildDirectoryQuery({ p: "1.5" }).page).toBe(1);
  });

  test("the search follows the armory's character search rule", () => {
    expect(directoryPrefix("  Émber ")).toBe("émber");
    expect(directoryPrefix("")).toBeNull();
    for (const bad of ["E", "Em%", "Ember Wardens", "Em1"]) expect(directoryPrefix(bad)).toBe("invalid");
  });

  test("writes only what differs from the defaults, and round-trips", () => {
    expect(guildDirectoryHref({})).toBe("/guilds");
    const q = { prefix: "emb", region: "us" as const, ruleset: 1, sort: "level-60" as const, page: 2 };
    const href = guildDirectoryHref(q);
    expect(href).toBe("/guilds?q=emb&region=us&rules=pvp&sort=level-60&p=2");
    expect(guildDirectoryQuery(Object.fromEntries(new URL(href, "https://everloot.app").searchParams))).toEqual(q);
  });
});

describe("guild hides on armory guilds", () => {
  const hidden = new Set([guildHideKey("CAMWOW US1 Realm 4 PvP", "Ash  Pact")]);
  test("a hide on a realm of a region covers the guild of that name in that region only", () => {
    expect(armoryGuildHidden(hidden, "us", "Ash Pact")).toBe(true);
    expect(armoryGuildHidden(hidden, "us", "ash pact")).toBe(true);
    expect(armoryGuildHidden(hidden, "eu", "Ash Pact")).toBe(false);
    expect(armoryGuildHidden(hidden, "us", "Ash Pactum")).toBe(false);
    expect(armoryGuildHidden(new Set([guildHideKey("Forever Pioneer", "Ash Pact")]), "us", "Ash Pact")).toBe(false);
  });
});

describe("the directory", () => {
  test("sorts by members read by default, with item level and level 60 as the other orders", async () => {
    fill();
    const members = await loadGuildDirectory(guildDirectoryQuery({}), new Set());
    expect(members.state).toBe("ready");
    if (members.state !== "ready") return;
    expect(members.rows.map((r) => r.slug)).toEqual(["ember-wardens", "ash-pact", "empty-hall"]);
    expect(members.total).toBe(3);
    expect(members.rows[0]).toMatchObject({ membersRead: 3, averageItemLevel: 55, level60: 2, fetchedAt: "2026-11-09T12:00:00.000Z" });
    expect(members.rows[2]).toMatchObject({ membersRead: 0, averageItemLevel: null, level60: 0 });

    const il = await loadGuildDirectory(guildDirectoryQuery({ sort: "item-level" }), new Set());
    expect(il.state === "ready" && il.rows.map((r) => r.slug)).toEqual(["ash-pact", "ember-wardens", "empty-hall"]);
    const l60 = await loadGuildDirectory(guildDirectoryQuery({ sort: "level-60" }), new Set());
    expect(l60.state === "ready" && l60.rows.map((r) => r.slug)).toEqual(["ember-wardens", "ash-pact", "empty-hall"]);
  });

  test("filters by search, region and ruleset, and pages", async () => {
    fill();
    const search = await loadGuildDirectory(guildDirectoryQuery({ q: "em" }), new Set());
    expect(search.state === "ready" && search.rows.map((r) => r.slug)).toEqual(["ember-wardens", "empty-hall"]);
    const us = await loadGuildDirectory(guildDirectoryQuery({ region: "us" }), new Set());
    expect(us.state === "ready" && us.rows.map((r) => r.slug)).toEqual(["ash-pact"]);
    const pvp = await loadGuildDirectory(guildDirectoryQuery({ rules: "normal" }), new Set());
    expect(pvp.state === "ready" && pvp.rows.map((r) => r.slug)).toEqual(["ember-wardens", "empty-hall"]);

    for (let i = 0; i < GUILD_DIRECTORY_PAGE + 2; i++) mem.putGuild(armoryGuild({ slug: `zz-${i}`, name: `Zz ${i}` }), []);
    const second = await loadGuildDirectory(guildDirectoryQuery({ p: "2" }), new Set());
    expect(second.state === "ready" && second.rows.length).toBe(5);
    expect(second.state === "ready" && second.total).toBe(GUILD_DIRECTORY_PAGE + 5);
  });

  test("a hidden character is not counted; a hidden guild is not listed; no hide list means nothing listed", async () => {
    fill();
    await mem.hide("eu", "velkara-duskmantle");
    const after = await loadGuildDirectory(guildDirectoryQuery({}), new Set([guildHideKey("EU2 Realm 1 Normal", "Empty Hall")]));
    expect(after.state === "ready" && after.rows.map((r) => [r.slug, r.membersRead, r.level60])).toEqual([["ember-wardens", 2, 1], ["ash-pact", 1, 1]]);
    expect(await loadGuildDirectory(guildDirectoryQuery({}), null)).toEqual({ state: "unreachable" });
  });

  test("before the migration: no list without a search, the name search with one, and storage errors stay errors", async () => {
    const guildRow = { region: "eu", slug: "ember-wardens", name: "Ember Wardens", faction: "Horde", ruleset: "Normal", member_count: 3 };
    const calls: string[] = [];
    holder.store = createCloudArmoryStore((async (path: string) => {
      calls.push(path);
      if (path === "rpc/armory_guild_directory") throw new StorageError(404, "PGRST202", "Could not find the function");
      if (path === "rpc/armory_search_guilds") return [guildRow, { ...guildRow, region: "us", slug: "ember-two", name: "Ember Two", ruleset: "PvP" }];
      return [];
    }) as never);
    expect(await loadGuildDirectory(guildDirectoryQuery({}), new Set())).toEqual({ state: "not-ready", rows: [] });
    const found = await loadGuildDirectory(guildDirectoryQuery({ q: "emb", region: "eu" }), new Set());
    expect(found.state).toBe("not-ready");
    expect(found.state !== "unreachable" && found.rows.map((r) => [r.slug, r.rulesetId, r.memberCount])).toEqual([["ember-wardens", 2, 3]]);
    expect(calls).toContain("rpc/armory_search_guilds");

    holder.store = createCloudArmoryStore((async () => { throw new StorageError(500, null, "down"); }) as never);
    expect(await loadGuildDirectory(guildDirectoryQuery({}), new Set())).toEqual({ state: "unreachable" });
  });

  test("the cloud store reads the function's rows and its total", async () => {
    let body: unknown;
    const store = createCloudArmoryStore((async (_path: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return [{ region: "us", slug: "ash-pact", name: "Ash Pact", faction: "Horde", ruleset_id: 1, ruleset: "PvP", member_count: 12,
        members_read: 1, average_item_level: "80.0", level_60: 1, fetched_at: "2026-11-09T12:00:00+00:00", total: 7 }];
    }) as never);
    const page = await store.guildDirectory({ prefix: null, region: "us", rulesetId: 1, sort: "level_60", limit: 50, offset: 50 });
    expect(body).toEqual({ p_prefix: null, p_region: "us", p_ruleset_id: 1, p_sort: "level_60", p_limit: 50, p_offset: 50 });
    expect(page).toEqual({ total: 7, rows: [expect.objectContaining({ slug: "ash-pact", averageItemLevel: 80, rulesetId: 1, level60: 1 })] });
  });
});

describe("the roster summary", () => {
  test("counts classes most first, bands levels, and averages only the item levels read", () => {
    const m = (over: Partial<Parameters<typeof rosterSummary>[0][number]>) => ({
      characterSlug: "a-b", name: "A", surname: "B", level: 60, classId: 8, raceId: 1, rank: 1, itemLevel: null, gearScore: null, stored: false, ...over,
    });
    const s = rosterSummary([
      m({ classId: 8, level: 60, itemLevel: 70, stored: true }), m({ classId: 8, level: 55, itemLevel: 61, stored: true }),
      m({ classId: 1, level: 12 }), m({ classId: null, level: null }), m({ classId: 99, level: 41 }),
    ]);
    expect(s.classes).toEqual([{ token: "MAGE", count: 2 }, { token: "WARRIOR", count: 1 }]);
    expect(s.levels).toEqual([
      { label: "At 60", count: 1 }, { label: "50–59", count: 1 }, { label: "40–49", count: 1 },
      { label: "30–39", count: 0 }, { label: "20–29", count: 0 }, { label: "10–19", count: 1 }, { label: "1–9", count: 0 },
    ]);
    expect(s.levelUnknown).toBe(1);
    expect(s.averageItemLevel).toBe(65.5);
    expect(s.itemLevelsRead).toBe(2);
    expect(s.itemLevels).toEqual([{ label: "60–69", count: 1 }, { label: "70–79", count: 1 }]);
    expect(rosterSummary([]).averageItemLevel).toBeNull();
  });
});
