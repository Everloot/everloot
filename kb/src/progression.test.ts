import { expect, test } from "vitest";
import encounters from "../../web/src/data/game-data/client-encounters.json";
import { characterProgression, dungeonProgress, progressionCatalogue, rosterProgression, trackedDungeons, type ProgressionKill } from "./progression.js";

const empty = { entrances: [], encounters: [] };
const catalogue = () => progressionCatalogue(empty);
const kill = (instanceMapId: number, encounterId: number, lastKillAt = "2026-11-18T22:00:00Z"): ProgressionKill => ({ instanceMapId, encounterId, lastKillAt });

test("the tracked dungeon summary excludes partial catalogs, and distinguishes missing history from no clears", () => {
  const tracked = trackedDungeons();
  const keep = tracked.find((row) => row.id === 33)!;
  expect(keep).toBeDefined();
  expect(tracked.some((row) => row.id === 36 || row.id === 2998 || row.id === 2789)).toBe(false);
  expect(dungeonProgress(null)).toBeNull();
  expect(dungeonProgress([])).toEqual({ cleared: 0, total: tracked.length });
  const kills = keep.bosses.map((boss) => kill(33, boss.id));
  expect(dungeonProgress(kills.slice(1))).toEqual({ cleared: 0, total: tracked.length });
  expect(dungeonProgress([...kills, ...kills, kill(36, kills[0]!.encounterId)])).toEqual({ cleared: 1, total: tracked.length });
});

test("every client instance and unique boss survives, grouped then in file order", () => {
  const rows = catalogue();
  expect(rows).toHaveLength(Object.keys(encounters.instances).length);
  expect(new Set(rows.map((r) => r.id))).toEqual(new Set(Object.keys(encounters.instances).map(Number)));
  expect([...new Set(rows.map((r) => r.group))]).toEqual(["Dungeons", "Raids", "World bosses"]);
  for (const group of ["Dungeons", "Raids", "World bosses"]) {
    const ids = rows.filter((r) => r.group === group).map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  }
  for (const r of rows) expect(r.bosses.map((b) => b.id)).toEqual([...new Set(encounters.instances[String(r.id) as keyof typeof encounters.instances].map((b) => b.id))]);
  expect(rows.find((r) => r.id === 2789)).toMatchObject({ group: "World bosses", unconfirmed: true });
});

test("an entrance or successful encounter from any upload is evidence of open, never a wipe", () => {
  const rows = progressionCatalogue({
    entrances: [{ installId: "made-up-a", instanceMapId: 33, name: "Keep", instanceType: "party", mapId: 1, x: 20, y: 30 }],
    encounters: [
      { installId: "made-up-b", instanceMapId: 36, encounterId: 2741, name: "Boss", success: true, npcIds: [] },
      { installId: "made-up-b", instanceMapId: 43, encounterId: 585, name: "Boss", success: false, npcIds: [] },
    ],
  });
  expect(rows.find((r) => r.id === 33)?.availability).toBe("open");
  expect(rows.find((r) => r.id === 36)?.availability).toBe("open");
  expect(rows.find((r) => r.id === 43)?.availability).toBe("not seen open yet");
  expect(progressionCatalogue(null).every((r) => r.availability === "unknown")).toBe(true);
});

test("missing history is no data; known empty history is none; duplicate difficulties count once", () => {
  const c = catalogue();
  const instance = c.find((r) => r.id === 33)!;
  expect(characterProgression(c, null).every((r) => r.state === "no data" && r.killed === null)).toBe(true);
  expect(characterProgression(c, []).every((r) => r.state === "none" && r.killed === 0)).toBe(true);
  const partial = characterProgression(c, [kill(33, instance.bosses[0]!.id), kill(33, instance.bosses[0]!.id, "2026-11-19T01:00:00+02:00"), kill(36, instance.bosses[1]!.id), kill(33, 999999)]).find((r) => r.id === 33)!;
  expect(partial).toMatchObject({ state: "partial", killed: 1, total: instance.bosses.length, newestKillDay: "2026-11-18" });
  const cleared = characterProgression(c, instance.bosses.map((b) => kill(33, b.id))).find((r) => r.id === 33)!;
  expect(cleared.state).toBe("cleared");
});

test("roster states list each member, retaining unknown histories in the denominator", () => {
  const c = catalogue();
  const instance = c.find((r) => r.id === 33)!;
  const rows = rosterProgression(c, [
    { member: "Ember", kills: instance.bosses.map((b) => kill(33, b.id)) },
    { member: "Moss", kills: [kill(33, instance.bosses[0]!.id)] },
    { member: "Tide", kills: [] }, { member: "Ash", kills: null },
  ]);
  expect(rows.find((r) => r.id === 33)).toMatchObject({ cleared: 1, partial: 1, members: { cleared: ["Ember"], partial: ["Moss"], none: ["Tide"], "no data": ["Ash"] } });
  expect(rosterProgression(c, []).every((r) => r.cleared === 0 && r.partial === 0)).toBe(true);
});
