import { expect, test } from "vitest";
import { characterProgression, progressionCatalogue } from "@kb/progression";
import { dungeonsAndRaids, instanceClears } from "./dungeon-clears";

const catalogue = progressionCatalogue(null);
// Ragefire Chasm (389): Oggleflint 2732, Taragaman 2733, Jergosh 2734, Bazzalan 2735.
const kill = (encounterId: number, first: string, last: string, killCount?: number, difficulty = 1, instanceMapId = 389) =>
  ({ instanceMapId, encounterId, difficulty, firstKillAt: first, lastKillAt: last, ...(killCount === undefined ? {} : { killCount }) });
const full = [
  kill(2732, "2026-11-10T20:00:00Z", "2026-11-20T20:00:00Z", 3),
  kill(2732, "2026-11-12T20:00:00Z", "2026-11-12T20:00:00Z", 1, 2), // the same boss on another difficulty
  kill(2733, "2026-11-11T20:00:00Z", "2026-11-20T21:00:00Z", 2),
  kill(2734, "2026-11-14T20:00:00Z", "2026-11-20T22:00:00Z", 2),
  kill(2735, "2026-11-13T20:00:00Z", "2026-11-21T01:00:00Z", 2),
];

test("an instance lists every boss with its kills summed across difficulties, first and last kill day", () => {
  const data = dungeonsAndRaids(characterProgression(catalogue, full), full, { 389: "/database/instances/389-ragefire-chasm" });
  expect(data.synced).toBe(true);
  expect(data.instances.map((r) => r.id)).toEqual([389]);
  const rfc = data.instances[0]!;
  expect(rfc).toMatchObject({ name: "Ragefire Chasm", group: "Dungeons", killed: 4, total: 4, cleared: true, href: "/database/instances/389-ragefire-chasm", lastKillDay: "2026-11-21" });
  expect(rfc.bosses[0]).toEqual({ id: 2732, name: "Oggleflint", killed: true, kills: 4, firstKillDay: "2026-11-10", lastKillDay: "2026-11-20" });
  // The first full clear is complete on the day the last boss fell for the first time.
  expect(rfc.firstClearDay).toBe("2026-11-14");
});

test("a partial instance shows which bosses are missing and no clear day", () => {
  const partial = full.filter((k) => k.encounterId !== 2734);
  const rfc = dungeonsAndRaids(characterProgression(catalogue, partial), partial, {}).instances[0]!;
  expect(rfc).toMatchObject({ killed: 3, total: 4, cleared: false, firstClearDay: null });
  expect(rfc.href).toBeUndefined();
  expect(rfc.bosses.find((b) => b.id === 2734)).toEqual({ id: 2734, name: "Jergosh the Invoker", killed: false, kills: null, firstKillDay: null, lastKillDay: null });
});

test("a history without counts or first-kill times leaves them unknown rather than zero", () => {
  const bare = [{ instanceMapId: 389, encounterId: 2732, lastKillAt: "2026-11-20T20:00:00Z" }];
  const boss = dungeonsAndRaids(characterProgression(catalogue, bare), bare, {}).instances[0]!.bosses[0]!;
  expect(boss).toEqual({ id: 2732, name: "Oggleflint", killed: true, kills: null, firstKillDay: null, lastKillDay: "2026-11-20" });
});

test("no synced history is unknown, not an empty record; a synced history with no kills is known empty", () => {
  expect(dungeonsAndRaids(characterProgression(catalogue, null), null, {})).toEqual({ synced: false, summary: null, instances: [] });
  const empty = dungeonsAndRaids(characterProgression(catalogue, []), [], {});
  expect(empty.synced).toBe(true);
  expect(empty.instances).toEqual([]);
  expect(empty.summary?.cleared).toBe(0);
});

test("instance clears: cleared characters newest first, and per-boss characters and kills", () => {
  const rows = [
    { region: "us", slug: "mira-dawn", name: "Mira", surname: "Dawn", kills: full },
    { region: "eu", slug: "tavi-reed", name: "Tavi", surname: "Reed", kills: [kill(2732, "2026-11-22T00:00:00Z", "2026-11-23T00:00:00Z", 5)] },
    { region: "us", slug: "ash-brook", name: "Ash", surname: "Brook", kills: full.map((k) => ({ ...k, lastKillAt: "2026-11-24T00:00:00Z" })) },
  ];
  const result = instanceClears(389, rows)!;
  expect(result.characters).toBe(3);
  expect(result.clears.map((c) => c.slug)).toEqual(["ash-brook", "mira-dawn"]);
  expect(result.clears[1]).toEqual({ region: "us", slug: "mira-dawn", name: "Mira Dawn", firstClearDay: "2026-11-14", lastKillDay: "2026-11-21" });
  expect(result.bosses[0]).toEqual({ id: 2732, name: "Oggleflint", characters: 3, kills: 13 });
  expect(result.bosses[2]).toEqual({ id: 2734, name: "Jergosh the Invoker", characters: 2, kills: 4 });
  expect(instanceClears(999999, rows)).toBeNull();
});
