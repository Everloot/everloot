import { describe, expect, test } from "vitest";
import { parseRecords, recordSchemas } from "../src/index.js";
import { parseSyncRow, SYNC_CATEGORIES, WEALTH_STATS } from "../src/private-sync.js";

const base = { installId: "install-private-1234", capturedAt: "2026-11-05T10:00:00Z", characterKey: "a".repeat(8), class: "MAGE", level: 60 };
const rows = [
  { ...base, kind: "profession_owned", profession: "Alchemy", rank: 200, maxRank: 300 },
  { ...base, kind: "lockout_owned", instance: "Molten Core", bossesKilledCount: 2, bossesTotal: 10, resetAt: "2026-11-12T10:00:00Z" },
  { ...base, kind: "talent_owned", treeId: 1, points: 1, nodes: [{ nodeId: 1, ranks: 1, choice: 0 }] },
  { ...base, kind: "stats_owned", stats: { strength: 0, spellPower: 42 } },
  { ...base, kind: "pvp_owned", rank: 0, honorableKills: 12 },
  { ...base, kind: "wealth_owned", stats: { "328": 1150905, "329": 1077 } },
];
const wealth = rows[5];

describe("private sync transport", () => {
  test.each(rows)("accepts existing $kind payloads and strips unknown fields", (row) => {
    expect(parseSyncRow({ ...row, unexpected: "discard" })).toEqual(row);
  });

  test.each(rows)("keeps $kind out of public record validation", (row) => {
    expect(Object.hasOwn(recordSchemas, row.kind)).toBe(false);
    const parsed = parseRecords([row]);
    expect(parsed.records).toEqual([]);
    expect(parsed.receipt.accepted).toEqual([]);
    expect(parsed.receipt.rejected).toHaveLength(1);
  });

  test.each(rows)("rejects invalid common fields in $kind", (row) => {
    for (const invalid of [{ installId: "" }, { capturedAt: "yesterday" }, { characterKey: "" }, { class: "123" }, { level: 0 }]) {
      expect(parseSyncRow({ ...row, ...invalid })).toBeNull();
    }
  });

  test("retains category-specific validation", () => {
    const invalid = [
      { ...rows[0], rank: 301 },
      { ...rows[1], bossesKilledCount: 11 },
      { ...rows[2], points: 2 },
      { ...rows[2], points: 2, nodes: [{ nodeId: 1, ranks: 1 }, { nodeId: 1, ranks: 1 }] },
      { ...rows[3], stats: { strength: Infinity } },
      { ...rows[3], stats: { unknown: 5 } },
      { ...base, kind: "pvp_owned", season: 1 },
    ];
    for (const row of invalid) expect(parseSyncRow(row)).toBeNull();
    expect(parseSyncRow({ ...rows[3], stats: { spellPower: 42, futureStat: 1 } })).toEqual({ ...rows[3], stats: { spellPower: 42 } });
  });

  test("wealth keeps known statistic ids and refuses bad amounts", () => {
    expect(parseSyncRow({ ...wealth, stats: { "328": 1150905, "999": 5 } })).toEqual({ ...wealth, stats: { "328": 1150905 } });
    expect(parseSyncRow({ ...wealth, stats: { "334": Number.MAX_SAFE_INTEGER, "1149": 0 } })).toEqual({ ...wealth, stats: { "334": Number.MAX_SAFE_INTEGER, "1149": 0 } });
    for (const stats of [{ "328": -1 }, { "328": 1.5 }, { "328": "5" }, { "328": Number.MAX_SAFE_INTEGER + 1 }, {}, { "999": 5 }]) {
      expect(parseSyncRow({ ...wealth, stats })).toBeNull();
    }
    expect(Object.values(WEALTH_STATS).flat()).toHaveLength(15);
    expect(SYNC_CATEGORIES).toContain("gold");
  });

  test("rejects unknown kinds and missing rows", () => {
    for (const row of [null, undefined, {}, { kind: "constructor" }, { kind: "inventory_owned" }]) {
      expect(parseSyncRow(row)).toBeNull();
    }
  });
});
