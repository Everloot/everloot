import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GuildSummary } from "../../../kb/src/guilds";
import { createMemoryPlayerStore, type PlayerStore } from "./player-store";

const held = vi.hoisted(() => ({ store: null as PlayerStore | null, guilds: [] as unknown[] | Error, partial: false, guildAsked: [] as string[], kept: [] as { key: string[]; tags: string[] }[] }));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T, key: string[], options: { tags: string[] }) => { held.kept.push({ key, tags: options.tags }); return fn; },
}));
vi.mock("./player-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./player-store")>()), playerStore: () => held.store }));
vi.mock("./guilds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guilds")>()),
  loadGuildSearch: async (prefix: string) => {
    held.guildAsked.push(prefix);
    if (held.guilds instanceof Error) return { results: [], unreachable: true, partial: false, dataAsOf: null };
    return { results: held.guilds, unreachable: false, partial: held.partial, dataAsOf: null };
  },
}));

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
      { type: "character", label: "Thrall", href: playerPath({ ruleset: "forever", realm: "Forever Pioneer", name: "Thrall" }), meta: "Level 60 Warrior · Forever Pioneer", exact: true },
      { type: "character", label: "Thrallina", href: playerPath({ ruleset: "forever", realm: "Forever Pioneer", name: "Thrallina" }), meta: "Level 24 Shaman · Forever Pioneer", exact: false },
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
  expect(held.kept).toEqual([{ key: ["player-search"], tags: ["players"] }, { key: ["site-guild-search"], tags: ["guilds", "players"] }]);
});
