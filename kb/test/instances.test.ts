import { describe, expect, test } from "vitest";
import { agreedDifficulties, confirmedEntrances, instanceBosses, instanceFactsFromRecords, reportedBosses } from "../src/instances.js";
import { objectSightingRowsFromRecords, objectSpawns } from "../src/object-spawns.js";

// SYNTHETIC records; ids, names and times are made up.
const asOf = new Date("2026-10-21T12:00:00Z");
const entrance = (installId: string, capturedAt: string, extra: object = {}) => ({
  kind: "instance_entrance", installId, capturedAt, instanceMapId: 36, name: "Synthetic Mines", instanceType: "party", mapId: 1436, x: 42, y: 72, ...extra,
});
const encounter = (installId: string, capturedAt: string, success = true, extra: object = {}) => ({
  kind: "encounter", installId, capturedAt, encounterId: 9, name: "Foreman", instanceMapId: 36, success, npcIds: [77], ...extra,
});

describe("when an agreed instance fact was last seen", () => {
  test("an entrance carries its installs and the latest time one zoned in; the place and the count are as before", () => {
    const facts = instanceFactsFromRecords([
      entrance("a", "2026-10-18T10:00:00Z"), entrance("b", "2026-10-20T09:30:00Z"), entrance("c", "2026-10-19T08:00:00Z"),
    ]);
    expect(confirmedEntrances(facts.entrances, asOf)).toEqual([
      { instanceMapId: 36, name: "Synthetic Mines", instanceType: "party", mapId: 1436, x: 42, y: 72, reporters: 3, lastSeen: "2026-10-20T09:30:00.000Z" },
    ]);
  });

  test("a time after the corpus's own is left out, so a clock set ahead cannot move it", () => {
    const facts = instanceFactsFromRecords([
      entrance("a", "2026-10-18T10:00:00Z"), entrance("b", "2026-10-19T09:30:00Z"), entrance("c", "2031-01-01T00:00:00Z"),
    ]);
    const [e] = confirmedEntrances(facts.entrances, asOf);
    expect(e).toMatchObject({ reporters: 3, lastSeen: "2026-10-19T09:30:00.000Z" });
  });

  test("rows without a time still count; the date is then unknown", () => {
    const rows = [entrance("a", "x"), entrance("b", "x"), entrance("c", "x")];
    const [e] = confirmedEntrances(instanceFactsFromRecords(rows).entrances, asOf);
    expect(e).toMatchObject({ reporters: 3, lastSeen: null });
  });

  test("a boss carries its kills, its installs and the latest report, a wipe included", () => {
    const facts = instanceFactsFromRecords([
      encounter("a", "2026-10-18T10:00:00Z"), encounter("a", "2026-10-18T11:00:00Z"), encounter("b", "2026-10-19T10:00:00Z"),
      encounter("c", "2026-10-20T22:00:00Z", false),
    ]);
    expect(instanceBosses(facts.encounters, asOf).get(36)).toEqual([
      { encounterId: 9, name: "Foreman", kills: 3, npcIds: [77], reporters: 3, lastSeen: "2026-10-20T22:00:00.000Z" },
    ]);
  });
});

describe("reportedBosses", () => {
  test("an encounter short of 3 installs is a count of the installs that reported it; one with 3 is left to instanceBosses", () => {
    const facts = instanceFactsFromRecords([
      encounter("a", "2026-10-18T10:00:00Z"), encounter("a", "2026-10-18T11:00:00Z", false), encounter("b", "2026-10-19T10:00:00Z"),
      encounter("a", "2026-10-18T10:00:00Z", true, { encounterId: 10, name: "Other" }),
      ...["a", "b", "c"].map((i) => encounter(i, "2026-10-18T10:00:00Z", true, { encounterId: 11 })),
      encounter("d", "2026-10-18T10:00:00Z", true, { instanceMapId: 409, encounterId: 663 }),
    ]);
    expect([...reportedBosses(facts.encounters)].map(([id, m]) => [id, [...m]])).toEqual([[36, [[9, 2], [10, 1]]], [409, [[663, 1]]]]);
    expect(instanceBosses(facts.encounters, asOf).get(36)!.map((b) => b.encounterId)).toEqual([11]);
  });

  test("a boss agreed before a recheck scope's date counts only the rows after it, as the bar counts them", () => {
    const facts = instanceFactsFromRecords([
      encounter("a", "2026-10-10T10:00:00Z"), encounter("b", "2026-10-11T10:00:00Z"), encounter("c", "2026-10-12T10:00:00Z"),
      encounter("d", "2026-10-20T10:00:00Z"),
    ]);
    const scope = [{ since: "2026-10-15T00:00:00Z", source: "test", ids: [9] }];
    expect(instanceBosses(facts.encounters, asOf, scope).get(36)).toBeUndefined();
    expect(reportedBosses(facts.encounters, scope).get(36)).toEqual(new Map([[9, 1]]));
  });
});

describe("agreedDifficulties", () => {
  test("3 installs agree on an instance's difficulty across entrances and encounters; 2 do not", () => {
    const facts = instanceFactsFromRecords([
      entrance("a", "2026-10-18T10:00:00Z", { difficulty: 1 }), entrance("b", "2026-10-18T10:00:00Z", { difficulty: 1 }),
      encounter("c", "2026-10-18T10:00:00Z", true, { difficulty: 1 }),
      { ...entrance("a", "2026-10-18T10:00:00Z", { difficulty: 9 }), instanceMapId: 409 }, { ...entrance("b", "2026-10-18T10:00:00Z", { difficulty: 9 }), instanceMapId: 409 },
    ]);
    expect([...agreedDifficulties(facts)]).toEqual([[36, 1]]);
  });
});

describe("when a treasure pin was last seen", () => {
  const sighting = (installId: string, capturedAt: string) =>
    ({ kind: "object_sighting", installId, capturedAt, objectId: 500, name: "Synthetic Chest", mapId: 1436, x: 30, y: 40 });

  test("a pin 3 installs agree on carries the latest time among its sightings, leaving out a clock set ahead", () => {
    const rows = objectSightingRowsFromRecords([
      sighting("a", "2026-10-18T10:00:00Z"), sighting("b", "2026-10-20T09:30:00Z"), sighting("c", "2031-01-01T00:00:00Z"),
    ]);
    expect(objectSpawns(rows, [], asOf).pins).toEqual([
      { key: "obj500-1436-30.0_40.0", objectId: 500, mapId: 1436, x: 30, y: 40, reporters: 3, lastSeen: "2026-10-20T09:30:00.000Z" },
    ]);
  });

  test("without the corpus date a pin is as before, and rows with no time give an unknown date", () => {
    const rows = objectSightingRowsFromRecords(["a", "b", "c"].map((i) => sighting(i, "2026-10-18T10:00:00Z")));
    expect(objectSpawns(rows).pins[0]).not.toHaveProperty("lastSeen");
    const untimed = rows.map(({ capturedAt: _, ...r }) => r);
    expect(objectSpawns(untimed, [], asOf).pins[0]).toMatchObject({ reporters: 3, lastSeen: null });
  });
});
