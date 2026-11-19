import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { armoryGuildHidden } from "./armory-guilds";
import { armoryCharacter, armoryGuild } from "./armory.fixture";
import { createMemoryArmoryStore, type ArmoryStore } from "./armory-store";

const hidden = vi.hoisted(() => ({ guilds: new Set<string>() }));
vi.mock("./player-store", () => ({ playerStore: () => ({ hiddenGuilds: async () => hidden.guilds }) }));
const state = vi.hoisted(() => ({ store: null as ArmoryStore | null, user: null as { id: string } | null, query: vi.fn(), facts: vi.fn() }));
vi.mock("./armory-store", async (original) => ({ ...await original<typeof import("./armory-store")>(), armoryStore: () => state.store }));
vi.mock("./supabase/server", () => ({ getUser: async () => state.user, authQuery: state.query }));
vi.mock("./rollup-compute", () => ({ loadInstanceFacts: state.facts }));
import { loadGuildProgression, loadGuildProgressionRanking, loadCharacterProgression, loadRosterProgression } from "./progression";

const linkId = "10000000-0000-4000-8000-000000000001";
const c = armoryCharacter();
const kills = [{ instanceMapId: 33, encounterId: 2748, difficulty: 1, firstKillAt: "2026-11-18T01:00:00Z", lastKillAt: "2026-11-18T01:00:00Z", killCount: 1 }];
beforeEach(() => {
  vi.clearAllMocks();
  hidden.guilds = new Set();
  const mem = createMemoryArmoryStore(); mem.putCharacter(c); state.store = mem;
  state.user = { id: "made-up-owner" };
  for (const key of ["EVERLOOT_CHARACTER_LINKS", "EVERLOOT_PRIVATE_SYNC", "EVERLOOT_BOSS_KILL_SYNC"]) vi.stubEnv(key, "1");
  state.facts.mockResolvedValue({ entrances: [], encounters: [], unreachable: false });
  state.query.mockImplementation(async (path: string) => path === "rpc/armory_own_links"
    ? [{ link_id: linkId, region: c.region, slug: c.slug }]
    : { sync: true, capturedAt: "2026-11-18T01:00:00Z", kills });
});
afterEach(() => vi.unstubAllEnvs());

test("a linked and consented owner reads their own history and only existing instance links", async () => {
  const result = await loadCharacterProgression(c.region, c.slug);
  expect(result.instances.find((r) => r.id === 33)).toMatchObject({ killed: 1, state: "partial", newestKillDay: "2026-11-18" });
  expect(result.links[33]).toBe("/database/instances/33-shadowfang-keep");
  expect(result.links[3002]).toBeUndefined();
  expect(JSON.parse(state.query.mock.calls.find((c) => c[0] === "rpc/own_boss_kills")![1].body)).toEqual({ p_user_id: "made-up-owner", p_link_id: linkId });
});

test.each(["anonymous", "other owner", "no consent", "frozen", "off", "hidden", "malformed", "storage down"])("%s never discloses kills", async (why) => {
  if (why === "anonymous") state.user = null;
  if (why === "other owner") state.query.mockResolvedValue([]);
  if (why === "no consent") state.query.mockImplementation(async (p) => p === "rpc/armory_own_links" ? [{ link_id: linkId, region: c.region, slug: c.slug }] : { sync: false, capturedAt: "2026-11-18T01:00:00Z", kills });
  if (why === "frozen") state.query.mockImplementation(async (p) => p === "rpc/armory_own_links" ? [{ link_id: linkId, region: c.region, slug: c.slug }] : { sync: true, capturedAt: null, kills: null });
  if (why === "off") vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "");
  if (why === "hidden") await state.store!.hide(c.region, c.slug);
  if (why === "malformed") state.query.mockResolvedValue({ kills });
  if (why === "storage down") state.query.mockRejectedValue(new Error("down"));
  const result = await loadCharacterProgression(c.region, c.slug);
  expect(result.instances.length).toBe(41);
  expect(result.instances.every((r) => r.state === "no data" && r.killed === null && r.newestKillDay === null)).toBe(true);
  if (["anonymous", "off"].includes(why)) expect(state.query).not.toHaveBeenCalled();
  if (why === "hidden") expect(state.query.mock.calls.some((c) => c[0] === "rpc/own_boss_kills")).toBe(false);
});

test("unavailable public facts are unknown availability, not an assertion that nothing opened", async () => {
  state.facts.mockResolvedValue({ entrances: [], encounters: [], unreachable: true });
  expect((await loadCharacterProgression(c.region, c.slug)).instances.every((r) => r.availability === "unknown")).toBe(true);
});

test("roster loader uses the same privacy rule, reads account links once and lists unknown members", async () => {
  const members = [c, armoryCharacter({ slug: "moss-vale", name: "Moss", surname: "Vale" })].map((r) => ({ region: r.region, characterSlug: r.slug, name: r.name, surname: r.surname, level: 60, classId: 3, raceId: 8, rank: 1, itemLevel: 50, gearScore: 50, stored: true }));
  (state.store as ReturnType<typeof createMemoryArmoryStore>).putCharacter(armoryCharacter({ slug: "moss-vale", name: "Moss", surname: "Vale" }));
  const read = vi.spyOn(state.store!, "character");
  const result = await loadRosterProgression(members);
  const row = result.instances.find((r) => r.id === 33)!;
  expect(row.partial).toBe(1);
  expect(row.members.partial).toEqual([members[0]]);
  expect(row.members["no data"]).toEqual([members[1]]);
  expect(state.query.mock.calls.filter((c) => c[0] === "rpc/armory_own_links")).toHaveLength(1);
  expect(read).toHaveBeenCalledTimes(1);
});

async function guildRoster() {
  const mem = state.store as ReturnType<typeof createMemoryArmoryStore>;
  const members = Array.from({ length: 5 }, (_, i) => {
    const character = armoryCharacter({ slug: `moss-${["vale", "brook", "field", "stone", "wood"][i]}`, name: "Moss", surname: `Vale${i}` });
    mem.putCharacter(character);
    return { region: character.region, characterSlug: character.slug, name: character.name, surname: character.surname, level: 60, classId: 3, raceId: 8, rank: 1, itemLevel: 50, gearScore: 50, stored: true };
  });
  mem.putGuild(armoryGuild(), members);
  state.facts.mockResolvedValue({ entrances: [{ installId: "made-up-observer", instanceMapId: 33, name: "Shadowfang Keep", instanceType: "party", mapId: 1, x: 20, y: 30 }], encounters: [], unreachable: false });
  state.query.mockImplementation(async (path: string) => path === "rpc/armory_own_links" ? members.map((m, i) => ({ link_id: `10000000-0000-4000-8000-00000000000${i}`, region: m.region, slug: m.characterSlug })) : { sync: true, capturedAt: "2026-11-18T01:00:00Z", kills });
  return members;
}

test("guild counts permitted unique roster characters; changing viewers and consent is never cached", async () => {
  const members = await guildRoster();
  const first = await loadGuildProgression([...members, members[0]!]);
  expect(first.score).toBe(5);
  expect(first.instances.find((r) => r.id === 33)).toMatchObject({ killed: 1, threshold: 5, state: "partial" });
  expect(state.query.mock.calls.filter((c) => c[0] === "rpc/armory_own_links")).toHaveLength(1);
  state.user = null;
  expect((await loadGuildProgression(members)).score).toBe(0);
  state.user = { id: "made-up-other" };
  state.query.mockResolvedValue([]);
  expect((await loadGuildProgression(members)).score).toBe(0);
});

test("private ranking rechecks region, guild hides, roster and permitted kills", async () => {
  const members = await guildRoster();
  expect(await loadGuildProgressionRanking("eu")).toEqual([{ region: "eu", slug: "ember-wardens", name: "Ember Wardens", score: 5 }]);
  expect(await loadGuildProgressionRanking("us")).toEqual([]);
  await state.store!.hide("eu", members[0]!.characterSlug);
  expect(await loadGuildProgressionRanking(null)).toEqual([]);
  state.store = createMemoryArmoryStore();
  await guildRoster();
  hidden.guilds = new Set(["eu1\u0000ember wardens"]);
  // Use the same hide-key contract as the guild directory.
  expect(armoryGuildHidden(hidden.guilds, "eu", "Ember Wardens")).toBe(true);
  expect(await loadGuildProgressionRanking(null)).toEqual([]);
  state.user = null;
  expect(await loadGuildProgressionRanking(null)).toEqual([]);
});

test.each(["no consent", "frozen", "hidden", "off", "unavailable history", "storage failure"])("guild and ranking do not count %s", async (why) => {
  const members = await guildRoster();
  const query = state.query.getMockImplementation()!;
  if (why === "no consent" || why === "frozen" || why === "unavailable history") state.query.mockImplementation(async (path, ...args) => path === "rpc/armory_own_links" ? query(path, ...args) : { sync: why !== "no consent", capturedAt: why === "frozen" ? null : "2026-11-18T01:00:00Z", kills: why === "unavailable history" ? null : kills });
  if (why === "hidden") await state.store!.hide("eu", members[0]!.characterSlug);
  if (why === "off") vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "");
  if (why === "storage failure") state.query.mockRejectedValue(new Error("down"));
  expect((await loadGuildProgression(members)).score).toBe(0);
  expect(await loadGuildProgressionRanking(null)).toEqual([]);
});
