import { expect, test, vi } from "vitest";
import { armoryCharacter } from "./armory.fixture";
import { createCloudArmoryStore, createMemoryArmoryStore } from "./armory-store";
import { StorageError } from "./supabase/server";
import { playerDirectoryQuery, playerDirectoryHref } from "./armory-directory";

test("directory filters parse repeated values, reject unknown choices and keep paging in the URL", () => {
  const q = playerDirectoryQuery({ q: [" Vel ", "other"], class: "HUNTER", race: "Troll", faction: "Horde", region: "eu", ruleset: "2", min: "40", max: "60", guild: " Ember ", sort: "item-level", page: "2" });
  expect(q).toMatchObject({ prefix: "vel", class: "Hunter", race: "Troll", faction: "Horde", region: "eu", rulesetId: 2, minLevel: 40, maxLevel: 60, guildPrefix: "Ember", sort: "item_level", limit: 25, offset: 25, page: 2 });
  expect(playerDirectoryHref(q, 3)).toContain("page=3");
  expect(playerDirectoryHref(q, 3)).toContain("class=HUNTER");
  expect(playerDirectoryQuery({ class: "bogus", race: "bogus", region: "xx", ruleset: "999", faction: "none", sort: "bad", min: "-1", max: "999", page: "2.5" })).toMatchObject({ class: null, race: null, region: null, rulesetId: null, faction: null, sort: "gear_score", minLevel: null, maxLevel: null, page: 1, offset: 0 });
});

test("memory directory filters, sorts nulls last, pages and excludes hidden characters", async () => {
  const store = createMemoryArmoryStore();
  store.putCharacter(armoryCharacter());
  store.putCharacter(armoryCharacter({ slug: "arla-quill", name: "Arla", surname: "Quill", region: "us", class: "Mage", race: "Human", faction: "Alliance", rulesetId: 1, ruleset: "PvP", level: 40, gearScore: 90, itemLevel: 45, guildName: "Quill Watch" }));
  store.putCharacter(armoryCharacter({ slug: "brin-mire", name: "Brin", surname: "Mire", gearScore: null, itemLevel: null, level: 20 }));
  const all = playerDirectoryQuery({});
  expect((await store.directory(all))?.rows.map((r) => r.name)).toEqual(["Arla", "Velkara", "Brin"]);
  for (const filter of [{ q: "v" }, { class: "HUNTER", min: "50" }, { race: "Troll", max: "60", min: "60" }, { faction: "Horde", region: "eu", ruleset: "2", guild: "ember", min: "30" }]) {
    expect((await store.directory(playerDirectoryQuery(filter)))?.rows.map((r) => r.name)).toEqual(["Velkara"]);
  }
  for (const filter of [{ class: "MAGE" }, { race: "Human" }, { faction: "Alliance" }, { region: "us" }, { ruleset: "1" }, { guild: "quill" }]) {
    expect((await store.directory(playerDirectoryQuery(filter)))?.rows.map((r) => r.name)).toEqual(["Arla"]);
  }
  for (const [sort, names] of [["item-level", ["Velkara", "Arla", "Brin"]], ["level", ["Velkara", "Arla", "Brin"]], ["name", ["Arla", "Brin", "Velkara"]], ["last-read", ["Arla", "Brin", "Velkara"]]] as const) {
    expect((await store.directory(playerDirectoryQuery({ sort })))?.rows.map((r) => r.name)).toEqual(names);
  }
  expect(await store.directory({ ...all, limit: 1, offset: 1 })).toMatchObject({ total: 3, rows: [{ name: "Velkara" }] });
  expect(await store.directory({ ...all, offset: 100 })).toEqual({ total: 3, rows: [] });
  expect(await store.directory(playerDirectoryQuery({ min: "60", max: "20" }))).toEqual({ total: 0, rows: [] });
  await store.hide("eu", "velkara-duskmantle");
  expect((await store.directory(all))?.total).toBe(2);
});

const stored = { region: "eu", slug: "velkara-mire", name: "Velkara", surname: "Mire", level: 60, class: "Hunter", race: "Troll", faction: "Horde", ruleset_id: 2, ruleset: "Normal", guild_name: "Ember Wardens", item_level: "57.41", gear_score: "61.2", fetched_at: "2026-11-09T10:00:00Z", total: "26" };

test("cloud directory sends each filter, validates numeric rows and recovers totals beyond the last page", async () => {
  const query = vi.fn(async (_path: string, _init?: RequestInit): Promise<unknown> => [stored]);
  const store = createCloudArmoryStore(query as never);
  const filter = playerDirectoryQuery({ q: "Vel", class: "HUNTER", race: "Troll", faction: "Horde", region: "eu", ruleset: "2", min: "40", max: "60", guild: "Ember", sort: "item-level", page: "2" });
  expect(await store.directory(filter)).toMatchObject({ total: 26, rows: [{ rulesetId: 2, itemLevel: 57.41, gearScore: 61.2 }] });
  expect(query.mock.calls[0]![0]).toBe("rpc/armory_directory");
  expect(JSON.parse(String(query.mock.calls[0]![1]?.body))).toEqual({ p_prefix: "vel", p_class: "Hunter", p_race: "Troll", p_faction: "Horde", p_region: "eu", p_ruleset_id: 2, p_min_level: 40, p_max_level: 60, p_guild_prefix: "Ember", p_sort: "item_level", p_limit: 25, p_offset: 25 });
  query.mockResolvedValueOnce([]);
  expect(await store.directory({ ...filter, offset: 50 })).toEqual({ total: 26, rows: [] });
  expect(JSON.parse(String(query.mock.calls.at(-1)![1]?.body))).toMatchObject({ p_limit: 1, p_offset: 0 });
  query.mockResolvedValueOnce([{ ...stored, gear_score: "bad" }]);
  await expect(store.directory(filter)).rejects.toThrow();
});

test("cloud directory distinguishes a missing migration from failed storage", async () => {
  const query = vi.fn(async (): Promise<unknown> => { throw new StorageError(404, "PGRST202", "missing function"); });
  const store = createCloudArmoryStore(query as never);
  expect(await store.directory(playerDirectoryQuery({}))).toBeNull();
  query.mockRejectedValueOnce(new StorageError(503, null, "down"));
  await expect(store.directory(playerDirectoryQuery({}))).rejects.toThrow();
});
