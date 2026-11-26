import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PublicGuildHistory, PublicHistory } from "./progression-store";
const state = vi.hoisted(() => ({ query: vi.fn(), facts: vi.fn(), caches: [] as unknown[][] }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown, ...args: unknown[]) => { state.caches.push(args); return fn; } }));
vi.mock("./supabase/server", () => ({ authQuery: state.query, getUser: () => { throw new Error("Public progression must not read sessions"); } }));
vi.mock("./rollup-compute", () => ({ loadInstanceFacts: state.facts }));
import { loadGuildProgression, loadGuildProgressionRanking, loadCharacterProgression, loadInstanceClears, loadRosterProgression } from "./progression";
import { createCloudProgressionStore, progressionStore } from "./progression-store";

const kills = [{ instanceMapId: 33, encounterId: 2748, lastKillAt: "2026-11-18T01:00:00Z" }];
const slugs = ["mira-dawn", "tavi-reed", "moss-vale", "fern-stone", "ash-brook"];
const rows: PublicHistory[] = slugs.map((slug) => ({ region: "us", slug, kills }));
const members = slugs.map((characterSlug) => ({ region: "us", characterSlug, name: "Invented", surname: "Member", level: 60, classId: 3, raceId: 8, rank: 1, itemLevel: 50, gearScore: 50, stored: true }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://example.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  state.facts.mockResolvedValue({ entrances: [{ installId: "invented-observer", instanceMapId: 33, name: "Invented Dungeon", instanceType: "party", mapId: 1, x: 20, y: 30 }], encounters: [], unreachable: false });
  state.query.mockImplementation(async (path: string) => path === "rpc/public_boss_kills" ? rows : rows.map((r) => ({ ...r, guild_slug: "star-watch", guild_name: "Star Watch" })));
});
afterEach(() => vi.unstubAllEnvs());

test("signed-out viewers read public history without a session or sync feature gate", async () => {
  vi.stubEnv("EVERLOOT_BOSS_KILL_SYNC", "");
  const result = await loadCharacterProgression("us", slugs[0]);
  expect(result.instances.find((r) => r.id === 33)).toMatchObject({ killed: 1, state: "partial", newestKillDay: "2026-11-18" });
  expect(result.links[3002]).toBeUndefined();
  expect(JSON.parse(state.query.mock.calls[0][1].body)).toEqual({ p_characters: [{ region: "us", slug: slugs[0] }] });
});
test.each(["missing", "malformed", "storage down"])("%s histories show no data", async (why) => {
  if (why === "missing") state.query.mockResolvedValue([]);
  if (why === "malformed") state.query.mockResolvedValue([{ region: "us", slug: slugs[0], kills: [{}] }]);
  if (why === "storage down") state.query.mockRejectedValue(new Error("down"));
  expect((await loadCharacterProgression("us", slugs[0])).instances.every((r) => r.state === "no data")).toBe(true);
  expect((await loadGuildProgression(members)).score).toBe(0);
  expect(await loadGuildProgressionRanking(null)).toEqual([]);
});
test("invalid addresses never query storage", async () => {
  await loadCharacterProgression("elsewhere", "bad/slug");
  expect(state.query).not.toHaveBeenCalled();
});
test("roster includes every synced member and lists missing members separately in one batch", async () => {
  state.query.mockResolvedValue(rows.slice(0, 2));
  const result = await loadRosterProgression(members);
  const row = result.instances.find((r) => r.id === 33)!;
  expect(row.members.partial).toEqual(members.slice(0, 2));
  expect(row.members["no data"]).toEqual(members.slice(2));
  expect(state.query).toHaveBeenCalledTimes(1);
});
test("five distinct roster members count a dungeon boss, duplicates and missing members do not", async () => {
  expect((await loadGuildProgression([...members, members[0]])).score).toBe(5);
  state.query.mockResolvedValue(rows.slice(1)); // RPC excludes hidden, suppressed and frozen characters.
  expect((await loadGuildProgression(members)).score).toBe(0);
});
test("ranking groups the regional armory roster, never reads guilds per character and returns top 100", async () => {
  const regional: PublicGuildHistory[] = Array.from({ length: 105 }, (_, i) => rows.map((r) => ({ ...r, guild_slug: `invented-${i.toString().padStart(3, "0")}`, guild_name: `Invented Guild ${i}` }))).flat();
  state.query.mockResolvedValue([...regional, regional[0]]);
  const result = await loadGuildProgressionRanking("us");
  expect(result).toHaveLength(100);
  expect(result[0]).toEqual({ region: "us", slug: "invented-000", name: "Invented Guild 0", score: 5 });
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(JSON.parse(state.query.mock.calls[0][1].body)).toEqual({ p_region: "us" });
});
test("only observed-open instances score", async () => {
  state.facts.mockResolvedValue({ entrances: [], encounters: [], unreachable: false });
  expect(await loadGuildProgressionRanking(null)).toEqual([]);
});
test("unavailable facts are unknown availability", async () => {
  state.facts.mockRejectedValue(new Error("down"));
  expect((await loadCharacterProgression("us", slugs[0])).instances.every((r) => r.availability === "unknown")).toBe(true);
});
test("public reads use five-minute caches invalidated by character and guild hides", () => {
  expect(state.caches).toEqual([
    [["public-boss-kills"], { revalidate: 300, tags: ["players", "guilds"] }],
    [["public-boss-kill-region"], { revalidate: 300, tags: ["players", "guilds"] }],
    [["public-instance-clears"], { revalidate: 300, tags: ["players", "guilds"] }],
    [["public-guild-progression-ranking"], { revalidate: 300, tags: ["players", "guilds"] }],
  ]);
});
test("unconfigured storage is unavailable and the cloud adapter rejects malformed reads", async () => {
  await expect(progressionStore({}).region(null)).rejects.toThrow("unavailable");
  state.query.mockResolvedValue({ kills });
  await expect(createCloudProgressionStore(state.query).characters([])).rejects.toThrow();
});
test("a character's dungeons and raids keep the history's kill counts and first kills", async () => {
  state.query.mockResolvedValue([{ region: "us", slug: slugs[0], kills: [{ ...kills[0], difficulty: 1, firstKillAt: "2026-11-17T01:00:00Z", killCount: 4 }] }]);
  const { dungeons } = await loadCharacterProgression("us", slugs[0]);
  expect(dungeons.synced).toBe(true);
  expect(dungeons.instances.map((r) => r.id)).toEqual([33]);
  expect(dungeons.instances[0]!.bosses[0]).toMatchObject({ id: 2748, killed: true, kills: 4, firstKillDay: "2026-11-17", lastKillDay: "2026-11-18" });
  state.query.mockRejectedValue(new Error("down"));
  expect((await loadCharacterProgression("us", slugs[0])).dungeons).toEqual({ synced: false, summary: null, instances: [] });
});
test("instance clears stay dark until their switch is on, then read one instance's public histories", async () => {
  const clears = [{ region: "us", slug: "mira-dawn", name: "Mira", surname: "Dawn", kills: [{ ...kills[0], difficulty: 1, firstKillAt: "2026-11-17T01:00:00Z", killCount: 2 }] }];
  state.query.mockResolvedValue(clears);
  vi.stubEnv("EVERLOOT_INSTANCE_CLEARS", "");
  expect(await loadInstanceClears(33)).toBeNull();
  expect(state.query).not.toHaveBeenCalled();
  vi.stubEnv("EVERLOOT_INSTANCE_CLEARS", "1");
  vi.stubEnv("EVERLOOT_ARMORY", "1"); // the clears link armory pages
  expect((await loadInstanceClears(33))?.bosses[0]).toEqual({ id: 2748, name: "Rethilgore", characters: 1, kills: 2 });
  expect(state.query.mock.calls[0][0]).toBe("rpc/public_instance_clears");
  expect(JSON.parse(state.query.mock.calls[0][1].body)).toEqual({ p_map: 33 });
  state.query.mockRejectedValue(new Error("migration not applied"));
  expect(await loadInstanceClears(33)).toBeNull();
});
