import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { armoryCharacter } from "./armory.fixture";
import { createMemoryArmoryStore, type ArmoryStore } from "./armory-store";

const state = vi.hoisted(() => ({ store: null as ArmoryStore | null, user: null as { id: string } | null, query: vi.fn(), facts: vi.fn() }));
vi.mock("./armory-store", async (original) => ({ ...await original<typeof import("./armory-store")>(), armoryStore: () => state.store }));
vi.mock("./supabase/server", () => ({ getUser: async () => state.user, authQuery: state.query }));
vi.mock("./rollup-compute", () => ({ loadInstanceFacts: state.facts }));
import { loadCharacterProgression, loadRosterProgression } from "./progression";

const linkId = "10000000-0000-4000-8000-000000000001";
const c = armoryCharacter();
const kills = [{ instanceMapId: 33, encounterId: 2748, difficulty: 1, firstKillAt: "2026-11-18T01:00:00Z", lastKillAt: "2026-11-18T01:00:00Z", killCount: 1 }];
beforeEach(() => {
  vi.clearAllMocks();
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
