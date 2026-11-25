import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GuildSummary } from "@kb/guilds";
import { createMemoryArmoryStore, type MemoryArmoryStore, type SitePeople } from "./armory-store";
import { createMemoryPlayerStore, type PlayerStore } from "./player-store";

const held = vi.hoisted(() => ({ store: null as PlayerStore | null, armory: null as MemoryArmoryStore | null, guilds: [] as unknown[] | Error, partial: false, guildAsked: [] as string[], kept: [] as { key: string[]; tags: string[] }[] }));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T, key: string[], options: { tags: string[] }) => { held.kept.push({ key, tags: options.tags }); return fn; },
}));
vi.mock("./player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./player-store")>()), playerStore: () => held.store }));
vi.mock("./armory-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./armory-store")>()), armoryStore: () => held.armory }));
vi.mock("./guilds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guilds")>()),
  loadGuildSearch: async (prefix: string) => {
    held.guildAsked.push(prefix);
    if (held.guilds instanceof Error) return { results: [], unreachable: true, partial: false, dataAsOf: null };
    return { results: held.guilds, unreachable: false, partial: held.partial, dataAsOf: null };
  },
}));

import { armoryCharacterPath, armoryGuildPath } from "./armory";
import { armoryCharacter } from "./armory.fixture";
import { guildPath } from "./guilds";
import { peopleSearch } from "./people-search";
import { playerPath } from "./player-pages";

const guild = (guildName: string, membersSeen: number | null): GuildSummary => ({
  key: guildName.toLowerCase(), guildName, realm: "Forever Pioneer", faction: null, membersSeen, membersPublished: null, kills: 0, latestKillAt: null, lastSeen: null,
} as GuildSummary);

beforeEach(async () => {
  held.store = createMemoryPlayerStore();
  await held.store.upsert([
    { name: "Thrallina", realm: "Forever Pioneer", race: "Orc", class: "SHAMAN", level: 24, guild: "Night Watch", seen: "2026-10-20" },
    { name: "Thrall", realm: "Forever Pioneer", race: "Orc", class: "WARRIOR", level: 60, seen: "2026-10-21" },
  ]);
  held.guilds = [guild("Thrall Fans", 4), guild("Thrall", null)];
  // Invented characters: one name in both regions, one whose surname starts with that name, one hidden below.
  held.armory = createMemoryArmoryStore();
  held.armory.putCharacter(armoryCharacter({ region: "us", slug: "volvik-morningstar", name: "Volvik", surname: "Morningstar", level: 31, class: "Warrior", ruleset: "PvP" }));
  held.armory.putCharacter(armoryCharacter({ region: "eu", slug: "volvik-morningstar", name: "Volvik", surname: "Morningstar", level: 60, class: "Warrior", ruleset: "Normal" }));
  held.armory.putCharacter(armoryCharacter({ region: "us", slug: "orla-volvikson", name: "Orla", surname: "Volvikson", level: 20, class: "Mage", ruleset: "PvP" }));
  held.armory.putCharacter(armoryCharacter({ region: "us", slug: "volvik-hushwood", name: "Volvik", surname: "Hushwood", level: 12, class: "Rogue", ruleset: "Normal" }));
  held.partial = false;
  held.guildAsked = [];
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const on = () => { vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1"); vi.stubEnv("EVERLOOT_GUILDS", "1"); };

test("with both switches off nothing is listed and neither lookup runs", async () => {
  const search = vi.spyOn(held.store!, "search");
  const none = { results: [], total: 0, capped: false };
  expect(await peopleSearch("thrall")).toEqual({ characters: none, guilds: none });
  expect(search).not.toHaveBeenCalled();
  expect(held.guildAsked).toEqual([]);
});

test("each group needs its own switch", async () => {
  vi.stubEnv("EVERLOOT_GUILDS", "1");
  const only = await peopleSearch("thrall");
  expect(only.characters.results).toEqual([]);
  expect(only.guilds.results.map((r) => r.label)).toEqual(["Thrall", "Thrall Fans"]);
  vi.unstubAllEnvs();
  vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
  const players = await peopleSearch("thrall");
  expect(players.characters.results.map((r) => r.label)).toEqual(["Thrall", "Thrallina"]);
  expect(players.guilds.results).toEqual([]);
});

test("rows link through the page helpers, name level, class and realm, and put an exact name first", async () => {
  on();
  const found = await peopleSearch("Thrall");
  expect(found.characters).toEqual({
    total: 2, capped: false,
    results: [
      { type: "character", label: "Thrall", href: playerPath({ ruleset: "forever", realm: "Forever Pioneer", name: "Thrall" }), meta: "Level 60 Warrior · Forever Pioneer", exact: true, class: "warrior" },
      { type: "character", label: "Thrallina", href: playerPath({ ruleset: "forever", realm: "Forever Pioneer", name: "Thrallina" }), meta: "Level 24 Shaman · Forever Pioneer", exact: false, class: "shaman" },
    ],
  });
  expect(found.guilds.results).toEqual([
    { type: "guild", label: "Thrall", href: guildPath("Forever Pioneer", "Thrall"), meta: "Forever Pioneer", exact: true },
    { type: "guild", label: "Thrall Fans", href: guildPath("Forever Pioneer", "Thrall Fans"), meta: "Forever Pioneer · 4 members seen", exact: false },
  ]);
});

test("text that cannot start a name runs no lookup for that kind", async () => {
  on();
  const search = vi.spyOn(held.store!, "search");
  // Digits are never in a character name; one letter is too short for either.
  expect((await peopleSearch("6948")).characters.results).toEqual([]);
  expect((await peopleSearch("t")).guilds.results).toEqual([]);
  // Digits and spaces are fine in a guild name, never in a character's.
  expect((await peopleSearch("thrall fans")).characters.results).toEqual([]);
  expect(search).not.toHaveBeenCalled();
  expect(held.guildAsked).toEqual(["6948", "thrall fans"]);
});

test("a character store that throws leaves the guilds, and unreachable guild storage leaves the characters", async () => {
  on();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(held.store!, "search").mockRejectedValue(new Error("down"));
  const noCharacters = await peopleSearch("thrall");
  expect(noCharacters.characters).toEqual({ results: [], total: 0, capped: false });
  expect(noCharacters.guilds.total).toBe(2);
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  held.guilds = new Error("unreachable");
  const noGuilds = await peopleSearch("thrall");
  expect(noGuilds.guilds).toEqual({ results: [], total: 0, capped: false });
  expect(noGuilds.characters.total).toBe(2);
});

test("a guild answer missing the players table's guilds is not kept in the cache; the next search asks again", async () => {
  on();
  vi.spyOn(console, "error").mockImplementation(() => {});
  held.partial = true;
  // The cached function throws, so the cache keeps nothing and the group is left out this time.
  expect((await peopleSearch("thrall")).guilds.results).toEqual([]);
  held.partial = false;
  expect((await peopleSearch("thrall")).guilds.total).toBe(2);
});

test("a lookup that stopped at 25 says there may be more", async () => {
  on();
  held.guilds = Array.from({ length: 25 }, (_, i) => guild(`Thrall ${i}`, 1));
  expect((await peopleSearch("thrall")).guilds).toMatchObject({ total: 25, capped: true });
  held.guilds = Array.from({ length: 24 }, (_, i) => guild(`Thrall ${i}`, 1));
  expect((await peopleSearch("thrall")).guilds).toMatchObject({ total: 24, capped: false });
});

test("a hidden character is gone from the next search, and the server caches carry the tags the hide routes clear", async () => {
  on();
  expect((await peopleSearch("thrallina")).characters.total).toBe(1);
  await held.store!.suppress("Forever Pioneer", "Thrallina");
  expect((await peopleSearch("thrallina")).characters.total).toBe(0);
  // /players shares the first entry; a guild hide clears "guilds", a character hide "players" (members seen count).
  // Other modules' caches (lib/guilds.ts keeps the realm list) are not this search's, so only its two are checked.
  const ours = held.kept.filter((c) => ["player-search", "site-guild-search"].includes(c.key[0]));
  expect(ours).toEqual([{ key: ["player-search"], tags: ["players"] }, { key: ["site-guild-search"], tags: ["guilds", "players"] }]);
});

describe("armory characters", () => {
  const armoryOn = () => { on(); vi.stubEnv("EVERLOOT_ARMORY", "1"); };
  const us = { type: "character", label: "Volvik Morningstar", href: armoryCharacterPath("us", "volvik-morningstar"), meta: "Level 31 Warrior · US PvP" };

  test.each(["Morningstar", "morning", "Volvik Morningstar", "Volvik", "  volvik   morningSTAR "])("%j finds Volvik Morningstar in both regions", async (text) => {
    armoryOn();
    const labels = (await peopleSearch(text, 25)).characters.results;
    expect(labels).toContainEqual(expect.objectContaining(us));
    expect(labels).toContainEqual(expect.objectContaining({ href: armoryCharacterPath("eu", "volvik-morningstar"), meta: "Level 60 Warrior · EU Normal" }));
  });

  test("the full name is an exact match and comes first; a surname that only starts with the name does not", async () => {
    armoryOn();
    const found = await peopleSearch("Volvik Morningstar");
    expect(found.characters.results[0]).toEqual({ ...us, exact: true, class: "warrior" });
    expect(found.characters.results.map((r) => r.label)).not.toContain("Orla Volvikson");
    expect((await peopleSearch("volvik")).characters.results.map((r) => r.label)).toContain("Orla Volvikson");
  });

  test("a hidden character is not returned", async () => {
    armoryOn();
    expect((await peopleSearch("hushwood")).characters.total).toBe(1);
    await held.armory!.hide("us", "volvik-hushwood");
    expect((await peopleSearch("hushwood")).characters.total).toBe(0);
    expect((await peopleSearch("volvik")).characters.results.map((r) => r.href)).not.toContain(armoryCharacterPath("us", "volvik-hushwood"));
  });

  test("addon and armory rows share the characters group, one row per page, and keep the limit", async () => {
    armoryOn();
    await held.store!.upsert([{ name: "Volvik", realm: "Forever Pioneer", race: "Human", class: "WARRIOR", level: 30, seen: "2026-11-16" }]);
    const found = await peopleSearch("volvik", 3);
    expect(found.characters.total).toBe(5);
    expect(found.characters.results).toHaveLength(3);
    expect(found.characters.capped).toBe(false);
    // The addon row has no surname, so a full name reads the armory only.
    expect((await peopleSearch("volvik morningstar", 25)).characters.results.map((r) => r.label)).toEqual(["Volvik Morningstar", "Volvik Morningstar"]);
    const rows = [...(await peopleSearch("volvik", 25)).characters.results];
    expect(new Set(rows.map((r) => r.href)).size).toBe(rows.length);
  });

  test("an armory that fails leaves the addon rows, and the switch off asks it nothing", async () => {
    on();
    const search = vi.spyOn(held.armory!, "search");
    expect((await peopleSearch("thrall")).characters.total).toBe(2);
    expect(search).not.toHaveBeenCalled();
    vi.stubEnv("EVERLOOT_ARMORY", "1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    search.mockRejectedValue(new Error("down"));
    expect((await peopleSearch("thrall")).characters.total).toBe(2);
  });

  describe("the on-demand lookup", () => {
    const found = { region: "us", slug: "nera-ashcombe", name: "Nera", surname: "Ashcombe", level: 22, class: "Mage", race: "Human", ruleset: "PvP", guildName: null };

    test("a full name nobody stored is looked up once, and its hit is the one row", async () => {
      on();
      vi.stubEnv("EVERLOOT_ARMORY", "1");
      const lookup = vi.fn(async () => found);
      const { characters } = await peopleSearch("  Nera   Ashcombe ", undefined, lookup);
      expect(lookup).toHaveBeenCalledExactlyOnceWith("Nera   Ashcombe");
      expect(characters.results).toEqual([{ type: "character", label: "Nera Ashcombe", href: armoryCharacterPath("us", "nera-ashcombe"), meta: "Level 22 Mage · US PvP", exact: true, class: "mage" }]);
    });

    test("no lookup when the armory has the name, failed, or is switched off; a miss lists nothing", async () => {
      on();
      const lookup = vi.fn(async () => null);
      await peopleSearch("Nera Ashcombe", undefined, lookup);
      vi.stubEnv("EVERLOOT_ARMORY", "1");
      expect((await peopleSearch("Volvik Morningstar", undefined, lookup)).characters.total).toBe(2);
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(held.armory!, "search").mockRejectedValueOnce(new Error("down"));
      await peopleSearch("Nera Ashcombe", undefined, lookup);
      expect(lookup).not.toHaveBeenCalled();
      expect((await peopleSearch("Nera Ashcombe", undefined, lookup)).characters.results).toEqual([]);
      expect(lookup).toHaveBeenCalledOnce();
    });
  });
});

describe("one read for characters and guilds (site_people_search)", () => {
  const allOn = () => { on(); vi.stubEnv("EVERLOOT_ARMORY", "1"); };
  const answer: SitePeople = {
    armory: [{ region: "us", slug: "volvik-morningstar", name: "Volvik", surname: "Morningstar", level: 31, class: "Warrior", faction: "Alliance", ruleset: "PvP" }],
    players: [{ name: "Volvikar", level: 24, class: "SHAMAN", ruleset: "forever", realm: "Forever Pioneer" }],
    guilds: [{ region: "eu", slug: "volvik-guard", name: "Volvik Guard", faction: "Horde", ruleset: "Normal", memberCount: 12 }],
  };

  test("answers both groups from it, with class and faction for the colours, and armory guilds join the guild group", async () => {
    allOn();
    const people = vi.spyOn(held.armory!, "people").mockResolvedValue(answer);
    const players = vi.spyOn(held.store!, "search");
    const armory = vi.spyOn(held.armory!, "search");
    held.guilds = [guild("Volvik Fans", 3)];
    const found = await peopleSearch("Volvik");
    expect(people).toHaveBeenCalledExactlyOnceWith("Volvik", 25);
    expect(players).not.toHaveBeenCalled();
    expect(armory).not.toHaveBeenCalled();
    expect(found.characters.results).toEqual([
      { type: "character", label: "Volvik Morningstar", href: armoryCharacterPath("us", "volvik-morningstar"), meta: "Level 31 Warrior · US PvP", exact: true, class: "warrior", faction: "Alliance" },
      { type: "character", label: "Volvikar", href: playerPath({ ruleset: "forever", realm: "Forever Pioneer", name: "Volvikar" }), meta: "Level 24 Shaman · Forever Pioneer", exact: false, class: "shaman" },
    ]);
    expect(found.guilds.results).toEqual([
      { type: "guild", label: "Volvik Fans", href: guildPath("Forever Pioneer", "Volvik Fans"), meta: "Forever Pioneer · 3 members seen", exact: false },
      { type: "guild", label: "Volvik Guard", href: armoryGuildPath("eu", "volvik-guard"), meta: "EU Normal · 12 members", exact: false, faction: "Horde" },
    ]);
  });

  test("an addon guild the armory has is one row, the armory's; the same name in another region stays its own", async () => {
    allOn();
    vi.spyOn(held.armory!, "people").mockResolvedValue(answer);
    held.guilds = [
      { ...guild("Volvik Guard", 5), realm: "CAMWOW EU1 Realm 2 PvE" },
      { ...guild("Volvik Guard", 2), key: "us volvik guard", realm: "CAMWOW US1 Realm 3 PvE" },
    ];
    const found = await peopleSearch("Volvik");
    expect(found.guilds.results.map((r) => r.href)).toEqual([guildPath("CAMWOW US1 Realm 3 PvE", "Volvik Guard"), armoryGuildPath("eu", "volvik-guard")]);
  });

  test("each kind still needs its switch: armory rows and armory guilds the armory's, addon rows the player pages'", async () => {
    vi.stubEnv("EVERLOOT_PLAYER_PAGES", "1");
    vi.spyOn(held.armory!, "people").mockResolvedValue(answer);
    const found = await peopleSearch("Volvik");
    expect(found.characters.results.map((r) => r.label)).toEqual(["Volvikar"]);
    expect(found.guilds.results).toEqual([]);
    vi.unstubAllEnvs();
    vi.stubEnv("EVERLOOT_ARMORY", "1");
    const armoryOnly = await peopleSearch("Volvik");
    expect(armoryOnly.characters.results.map((r) => r.label)).toEqual(["Volvik Morningstar"]);
    expect(armoryOnly.guilds.results.map((r) => r.label)).toEqual(["Volvik Guard"]);
    expect(held.guildAsked).toEqual([]);
  });

  test("before its migration (null) or when it fails, the separate reads answer as before", async () => {
    allOn();
    const players = vi.spyOn(held.store!, "search");
    vi.spyOn(held.armory!, "people").mockResolvedValueOnce(null);
    expect((await peopleSearch("thrall")).characters.total).toBe(2);
    expect(players).toHaveBeenCalledTimes(1);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(held.armory!, "people").mockRejectedValueOnce(new Error("down"));
    expect((await peopleSearch("thrall")).characters.total).toBe(2);
    expect(players).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
  });

  test("text no kind can match asks nothing, and the on-demand lookup still runs when the armory had nobody", async () => {
    allOn();
    const people = vi.spyOn(held.armory!, "people").mockResolvedValue({ armory: [], players: [], guilds: [] });
    await peopleSearch("t");
    expect(people).not.toHaveBeenCalled();
    const lookup = vi.fn(async () => ({ region: "us", slug: "nera-ashcombe", name: "Nera", surname: "Ashcombe", level: 22, class: "Mage", race: "Human", ruleset: "PvP", guildName: null }));
    const { characters } = await peopleSearch("Nera Ashcombe", undefined, lookup);
    expect(lookup).toHaveBeenCalledOnce();
    expect(characters.results.map((r) => r.label)).toEqual(["Nera Ashcombe"]);
  });
});
