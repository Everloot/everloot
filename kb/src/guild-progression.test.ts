import { expect, test } from "vitest";
import { guildProgression, guildProgressionScore, guildThreshold, RAID_SIZES } from "./guild-progression.js";
import { progressionCatalogue, type ProgressionInstance } from "./progression.js";

const instance = (over: Partial<ProgressionInstance> = {}): ProgressionInstance => ({
  id: 33, name: "Invented Keep", group: "Dungeons", typeKnown: true, unconfirmed: false,
  availability: "open", bosses: [{ id: 1, name: "Invented Sentinel" }, { id: 2, name: "Invented Warden" }], ...over,
});
const roster = (n: number, ids = [1], map = 33) => Array.from({ length: n }, () => ({ kills: ids.map((encounterId) => ({ instanceMapId: map, encounterId, lastKillAt: "2026-11-19T01:00:00Z" })) }));

test.each([["Dungeons", 33, 5], ["Raids", 249, 40], ["Raids", 309, 20], ["World bosses", 2789, 40]] as const)("%s requires %i map's %i members for each boss", (group, id, n) => {
  const cat = [instance({ id, group })];
  expect(guildProgression(cat, roster(n - 1, [1], id))[0]).toMatchObject({ threshold: n, killed: 0, state: "none" });
  expect(guildProgression(cat, roster(n, [1], id))[0]).toMatchObject({ killed: 1, state: "partial" });
  expect(guildProgression(cat, roster(n, [1, 2], id))[0]).toMatchObject({ killed: 2, state: "cleared" });
});

test("size table covers every known raid without guessing new or unclassified sizes", () => {
  expect(Object.fromEntries(Object.entries(RAID_SIZES).map(([k, v]) => [k, v.size]))).toEqual({ 249: 40, 309: 20, 409: 40, 469: 40, 509: 20, 531: 40, 533: 40, 2856: null });
  for (const row of Object.values(RAID_SIZES)) expect(row.source.length).toBeGreaterThan(0);
  for (const raid of progressionCatalogue(null).filter((r) => r.group === "Raids")) expect(RAID_SIZES[raid.id]).toBeDefined();
  for (const r of [instance({ id: 999, group: "Raids" }), instance({ typeKnown: false })]) {
    expect(guildThreshold(r)).toBeNull();
    expect(guildProgression([r], roster(80, [1, 2], r.id))[0]).toMatchObject({ killed: 0, state: "none", threshold: null });
    expect(guildProgressionScore([r], roster(80, [1, 2], r.id))).toBe(0);
  }
});

test("repeats, wrong maps, unknown bosses and unreadable members cannot meet the threshold", () => {
  const rows = [...roster(4, [1, 1, 1]), { kills: null }, ...roster(10, [1], 99), ...roster(10, [99])];
  expect(guildProgression([instance()], rows)[0]).toMatchObject({ killed: 0, state: "none" });
  expect(guildProgression([instance({ bosses: [] })], rows)[0]?.state).toBe("none");
});

test("worked score: cleared two-boss dungeon 20 plus one partial 40-player raid boss 40 = 60", () => {
  const cat = [instance(), instance({ id: 249, group: "Raids" })];
  const rows = Array.from({ length: 40 }, (_, i) => ({ kills: [...(i < 5 ? roster(1, [1, 2])[0]!.kills : []), ...roster(1, [1], 249)[0]!.kills] }));
  expect(guildProgressionScore(cat, rows)).toBe(60);
  expect(guildProgressionScore([...cat].reverse(), [...rows].reverse())).toBe(60);
  expect(guildProgressionScore(cat.map((r) => ({ ...r, availability: "not seen open yet" })), rows)).toBe(0);
  expect(guildProgressionScore(cat.map((r) => ({ ...r, availability: "unknown" })), rows)).toBe(0);
  expect(guildProgressionScore([], rows)).toBe(0);
});
