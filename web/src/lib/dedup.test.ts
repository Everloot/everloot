import { describe, expect, test } from "vitest";
import { mergeCorpus, publicRecords, eventKey } from "@kb/corpus";
import { parseRecords } from "@everloot/protocol";

function deduplicateRecords(rows: unknown[]) {
  const state = mergeCorpus(undefined, rows);
  return { records: publicRecords(state), conflictTombstones: state.conflicts };
}

const capturedAt = "2026-10-05T00:00:00.000Z";

function lootRecord(over: Record<string, unknown> = {}): unknown {
  return {
    kind: "loot",
    installId: "install-1234",
    capturedAt,
    eventId: "evt-1",
    sourceNpcId: 123,
    items: [{ itemId: 456, count: 1 }],
    ...over,
  };
}

function questRecord(over: Record<string, unknown> = {}): unknown {
  return {
    kind: "quest",
    installId: "install-1234",
    capturedAt,
    eventId: "evt-2",
    questId: 55,
    title: "Road to Westfall",
    level: 12,
    rewardItemIds: [],
    ...over,
  };
}

describe("deduplication", () => {
  test("dedupKey creates stable key from installId and eventId", () => {
    expect(eventKey(parseRecords([lootRecord()]).records[0])).toBe('["install-1234","evt-1"]');
  });

  test("identical file twice -> one record, no tombstones", () => {
    const { records, conflictTombstones } = deduplicateRecords([lootRecord(), lootRecord()]);
    expect(records).toHaveLength(1);
    expect(conflictTombstones).toHaveLength(0);
    expect(records[0].eventId).toBe("evt-1");
  });

  test("old file plus one new event -> both retained, no tombstones", () => {
    const { records, conflictTombstones } = deduplicateRecords([lootRecord(), questRecord()]);
    expect(records).toHaveLength(2);
    expect(conflictTombstones).toHaveLength(0);
  });

  test("two distinct events with identical contents/time -> one record", () => {
    const { records, conflictTombstones } = deduplicateRecords([lootRecord({ eventId: "evt-3" }), lootRecord({ eventId: "evt-3" })]);
    expect(records).toHaveLength(1);
    expect(conflictTombstones).toHaveLength(0);
  });

  test("same eventId with conflicting payloads -> both excluded, tombstone created", () => {
    const conflicting1 = lootRecord({ items: [{ itemId: 456, count: 1 }] });
    const conflicting2 = lootRecord({ items: [{ itemId: 456, count: 2 }] }); // different count
    const { records, conflictTombstones } = deduplicateRecords([conflicting1, conflicting2]);
    expect(records).toHaveLength(0);
    expect(conflictTombstones).toHaveLength(1);
    expect(conflictTombstones[0]).toBe('["install-1234","evt-1"]');
  });

  test("conflict then replay of one version -> still excluded, tombstone persists", () => {
    const conflicting1 = lootRecord({ items: [{ itemId: 456, count: 1 }] });
    const conflicting2 = lootRecord({ items: [{ itemId: 456, count: 2 }] });
    const replay = lootRecord({ items: [{ itemId: 456, count: 1 }] }); // same as first
    const { records, conflictTombstones } = deduplicateRecords([conflicting1, conflicting2, replay]);
    expect(records).toHaveLength(0);
    expect(conflictTombstones).toHaveLength(1);
  });

  test("conflicting records from different installs -> both retained (different dedup keys)", () => {
    const r1 = lootRecord({ installId: "install-a", eventId: "evt-1", items: [{ itemId: 1, count: 1 }] });
    const r2 = lootRecord({ installId: "install-b", eventId: "evt-1", items: [{ itemId: 1, count: 2 }] });
    const { records, conflictTombstones } = deduplicateRecords([r1, r2]);
    expect(records).toHaveLength(2);
    expect(conflictTombstones).toHaveLength(0);
  });

  test("mixed: some conflicts, some unique -> only unique retained", () => {
    const unique = questRecord({ eventId: "evt-unique" });
    const conflict1 = lootRecord({ items: [{ itemId: 1, count: 1 }] });
    const conflict2 = lootRecord({ items: [{ itemId: 1, count: 2 }] });
    const { records, conflictTombstones } = deduplicateRecords([unique, conflict1, conflict2]);
    expect(records).toHaveLength(1);
    expect(records[0].eventId).toBe("evt-unique");
    expect(conflictTombstones).toHaveLength(1);
  });

  test("records with different eventId but same install are both retained", () => {
    const { records } = deduplicateRecords([lootRecord({ eventId: "evt-a" }), lootRecord({ eventId: "evt-b" })]);
    expect(records).toHaveLength(2);
  });

  test("empty input returns empty", () => {
    const { records, conflictTombstones } = deduplicateRecords([]);
    expect(records).toHaveLength(0);
    expect(conflictTombstones).toHaveLength(0);
  });
});
