import { expect, test } from "vitest";
import { buildDatabaseActivity, recentFacts, type PublicFact } from "./database-activity";
import type { Corpus } from "./upload-store";

test("only agreed anonymous facts enter the bounded view, dated at the third distinct install", () => {
  const records = [1, 2, 3, 3].map((n) => ({ kind: "item_seen", itemId: 42, name: "Cloth & Thread", installId: `private-${n}`, capturedAt: `2026-11-0${n}T00:00:00Z` }));
  const file = buildDatabaseActivity({ records, uploads: 4, dataAsOf: "2026-11-04T00:00:00Z" } as Corpus, new Date("2026-11-04"));
  expect(file.entries).toEqual([expect.objectContaining({ kind: "item", id: 42, name: "Cloth & Thread", installs: 3, publicAt: "2026-11-03T00:00:00.000Z", path: "/database/items/42" })]);
  expect(JSON.stringify(file)).not.toContain("private-");
  expect(buildDatabaseActivity({ records: records.slice(0, 2), uploads: 2 } as Corpus).entries).toEqual([]);
  expect(buildDatabaseActivity({ records, uploads: 4 } as Corpus, new Date("2026-12-10")).entries).toEqual([]);
});

test("the reader window excludes old and future facts and never exceeds 500", () => {
  const row: PublicFact = { kind: "item", id: 1, name: "Test", path: "/database/items/1", installs: 3, publicAt: "2026-11-09T00:00:00Z" };
  const rows = [{ ...row, publicAt: "2026-10-01T00:00:00Z" }, { ...row, publicAt: "2026-12-01T00:00:00Z" }, ...Array.from({ length: 600 }, (_, id) => ({ ...row, id }))];
  const result = recentFacts(rows, new Date("2026-11-10"));
  expect(result).toHaveLength(500);
  expect(result.every((e) => e.publicAt === row.publicAt)).toBe(true);
});

test("a late upload is dated at its first public snapshot and an idle refresh preserves that time", () => {
  const before = { records: [], uploads: 0, dataAsOf: "2026-11-09T00:00:00Z" } as Corpus;
  const previous = buildDatabaseActivity(before, new Date("2026-11-09"));
  const records = [1, 2, 3].map((n) => ({ kind: "item_seen", itemId: 42, name: "Thread", installId: `private-${n}`, capturedAt: "2026-10-01T00:00:00Z" }));
  const corpus = { records, uploads: 3, dataAsOf: "2026-11-10T10:00:00Z" } as Corpus;
  const publicView = buildDatabaseActivity(corpus, new Date("2026-11-10T10:00:00Z"), previous);
  expect(publicView.entries[0]).toMatchObject({ publicAt: "2026-11-10T10:00:00.000Z" });
  expect(publicView.entries[0].estimated).toBeUndefined();
  expect(buildDatabaseActivity(corpus, new Date("2026-11-10T10:10:00Z"), publicView).entries).toEqual(publicView.entries);
  expect(buildDatabaseActivity(corpus, new Date("2026-12-15"), publicView).entries).toEqual([]);
});

test("public pins, givers, loot, entrances and bosses use the existing publication gates", () => {
  const capturedAt = "2026-11-09T12:00:00Z";
  const records = ["a", "b", "c"].flatMap((installId) => [
    { kind: "npc_sighting", installId, npcId: 7, name: "Guard", mapId: 1429, x: 40, y: 60, positionKind: "npc", capturedAt },
    { kind: "quest", installId, questId: 8, title: "A task", level: 10, giverNpcId: 7, rewardItemIds: [], capturedAt },
    { kind: "loot", installId, sourceObjectId: 5, sourceObjectName: "Herb", sourceEvidence: "loot-api", lootType: "gather", gatherKind: "herb", items: [{ itemId: 42, count: 1 }], mapId: 1429, x: 20, y: 30, capturedAt },
    { kind: "instance_entrance", installId, instanceMapId: 36, name: "Dungeon", instanceType: "party", mapId: 1429, x: 20, y: 30, capturedAt },
    { kind: "encounter", installId, instanceMapId: 36, encounterId: 9, name: "Boss", success: true, npcIds: [10], capturedAt },
    { kind: "census_seen", installId, name: "Private Player", capturedAt },
  ]);
  const corpus = { records, uploads: 3, dataAsOf: capturedAt } as Corpus;
  const file = buildDatabaseActivity(corpus, new Date("2026-11-10"));
  expect(file.entries.map((e) => e.kind).sort()).toEqual(["boss", "entrance", "item", "npc", "object", "quest"]);
  expect(file.entries.every((e) => e.installs === 3)).toBe(true);
  expect(file.entries.find((e) => e.kind === "object")?.name).toBe("Herb");
  expect(JSON.stringify(file)).not.toContain("Private Player");
  expect(() => buildDatabaseActivity({ ...corpus, unreachable: true })).toThrow("unreachable");
});

test("an entity is never re-announced after losing and regaining public status", () => {
  const now = new Date("2026-11-10");
  const records = [1, 2, 3].map((n) => ({ kind: "item_seen", itemId: 42, name: "Thread", installId: String(n), capturedAt: now.toISOString() }));
  const corpus = { records, uploads: 3 } as Corpus;
  const first = buildDatabaseActivity(corpus, now);
  const gone = buildDatabaseActivity({ records: [], uploads: 0 } as Corpus, now, first);
  expect(gone.publicKeys).toEqual([]);
  expect(gone.everPublic).toEqual(["item:42"]);
  expect(buildDatabaseActivity(corpus, now, gone).entries).toEqual([]);
});

test("a publication code version change baselines new gates without new entries", () => {
  const now = new Date("2026-11-10");
  const previous = buildDatabaseActivity({ records: [], uploads: 0 } as Corpus, now);
  const records = [1, 2, 3].map((n) => ({ kind: "item_seen", itemId: 42, name: "Thread", installId: String(n), capturedAt: now.toISOString() }));
  const corpus = { records, uploads: 3 } as Corpus;
  expect(buildDatabaseActivity(corpus, now, previous).entries).toHaveLength(1);
  const baseline = buildDatabaseActivity(corpus, now, { ...previous, codeVersion: 0 });
  expect(baseline.publicKeys).toEqual(["item:42"]);
  expect(baseline.entries).toEqual([]);
  expect(buildDatabaseActivity(corpus, now, baseline).entries).toEqual([]);
});
