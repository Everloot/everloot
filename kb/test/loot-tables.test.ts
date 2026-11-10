import { expect, test } from "vitest";
import { lootWindowsFromRecords, rollupDrops } from "../src/drop-rollup.js";
import { itemDropSources, lootTablesFromRecords, missingLine, npcLootTable, objectLootRows, shortLine } from "../src/loot-tables.js";
import { pendingForNpc, pendingLootFromRecords } from "../src/pending-loot.js";

const asOf = "2026-10-21T00:00:00.000Z";
let n = 0;
const loot = (installId: unknown, source: { npc?: number; obj?: number }, items: [number, number][], capturedAt = "2026-10-12T10:00:00.000Z") => ({
  kind: "loot",
  sourceEvidence: "loot-api",
  installId,
  eventId: `e${n++}`,
  capturedAt,
  ...(source.npc !== undefined ? { sourceNpcId: source.npc } : {}),
  ...(source.obj !== undefined ? { sourceObjectId: source.obj } : {}),
  items: items.map(([itemId, count]) => ({ itemId, count })),
});
const recorder = (c: string) => `ps-${c.repeat(16)}-${c.repeat(16)}`;

test("an NPC's rows: windows with the item out of the NPC's windows, installs and dates", () => {
  const records = [
    loot("install-a", { npc: 40 }, [[750, 1], [750, 2]], "2026-10-10T08:00:00.000Z"),
    loot("install-b", { npc: 40 }, [[750, 1], [2589, 3]]),
    loot("install-c", { npc: 40 }, [], "2026-10-14T23:59:00.000Z"),
    loot("install-c", { npc: 40 }, [[2589, 1]]),
  ];
  const table = npcLootTable(lootTablesFromRecords(records, asOf), 40);
  expect(table.state).toBe("rated");
  expect(table.span).toEqual({ windows: 4, installs: 3, first: "2026-10-10", last: "2026-10-14" });
  // The denominator is every window on the NPC, the empty one too; stacks in one window count once.
  expect(table.rows).toEqual([
    { sourceNpcId: 40, itemId: 750, withItem: 2, windows: 4, rate: 0.5, installs: 3, first: "2026-10-10", last: "2026-10-14" },
    { sourceNpcId: 40, itemId: 2589, withItem: 2, windows: 4, rate: 0.5, installs: 3, first: "2026-10-10", last: "2026-10-14" },
  ]);
  expect(table.missingInstalls).toBe(0);
});

test("the public rows are rollupDrops' public rates, number for number", () => {
  const records = ["a", "b", "c", "d"].flatMap((id, i) => [
    loot(`install-${id}`, { npc: 7 }, i % 2 ? [[11, 1]] : []),
    loot(`install-${id}`, { obj: 9 }, [[12, 1], [13, 1]]),
  ]);
  const tables = lootTablesFromRecords(records, asOf);
  const ours = [...itemDropSources(tables, 11).rows, ...itemDropSources(tables, 12).rows, ...itemDropSources(tables, 13).rows];
  const theirs = rollupDrops(lootWindowsFromRecords(records)).rates.filter((r) => r.public);
  expect(ours.map((r) => [r.sourceNpcId ?? r.sourceObjectId, r.itemId, r.withItem, r.windows, r.rate, r.installs]).sort())
    .toEqual(theirs.map((r) => [r.sourceNpcId ?? r.sourceObjectId, r.itemId, r.drops, r.kills, r.rate, r.reporters]).sort());
});

test("an object source gets its rows on the item page too", () => {
  const records = ["a", "b", "c"].map((id) => loot(`install-${id}`, { obj: 1731 }, [[2770, 2]]));
  const sources = itemDropSources(lootTablesFromRecords(records, asOf), 2770);
  expect(sources.rows).toEqual([{ sourceObjectId: 1731, itemId: 2770, withItem: 3, windows: 3, rate: 1, installs: 3, first: "2026-10-12", last: "2026-10-12" }]);
  expect(sources.short).toBeNull();
});

test("short of 3 installs: no rate and no item list, only what is missing", () => {
  const records = [loot("install-a", { npc: 40 }, [[750, 1]]), loot("install-a", { npc: 40 }, []), loot("install-b", { npc: 40 }, [[750, 1]])];
  const tables = lootTablesFromRecords(records, asOf);
  const table = npcLootTable(tables, 40);
  expect(table.state).toBe("short");
  expect(table.rows).toEqual([]);
  expect(table.missingInstalls).toBe(1);
  expect(missingLine(table)).toBe("3 loot windows from 2 installs, dated 2026-10-12. A rate needs windows from 3 installs: 1 more.");
  // The item page does not name the source either: one sentence with the windows and installs.
  const item = itemDropSources(tables, 750);
  expect(item.rows).toEqual([]);
  expect(item.short).toEqual({ windows: 2, installs: 2 });
  expect(shortLine(item.short!)).toBe(
    "2 loot windows with this item from 2 installs, on sources fewer than 3 installs have looted. A rate needs windows from 3 installs on the same source.",
  );
});

test("a window with no reporter is left out of every count, and counted as left out", () => {
  const records = [
    loot("install-a", { npc: 40 }, [[750, 1]]),
    loot("install-b", { npc: 40 }, [[750, 1]]),
    loot("", { npc: 40 }, [[750, 1]]),
    loot("   ", { npc: 40 }, [[750, 1]]),
    loot(undefined, { npc: 40 }, [[750, 1]]),
    loot("install-c", {}, [[750, 1]]),
  ];
  const tables = lootTablesFromRecords(records, asOf);
  const table = npcLootTable(tables, 40);
  expect(table.state).toBe("short");
  expect(table.span).toMatchObject({ windows: 2, installs: 2 });
  expect(itemDropSources(tables, 750).short).toEqual({ windows: 2, installs: 2 });
  expect(tables.leftOut).toBe(4);
});

test("Recorder windows stay pending: counted beside the table, never in it", () => {
  const recorderRows = ["1", "2", "3"].map((c) => ({ ...loot(recorder(c), { npc: 61 }, [[2230, 1]]), sourceEvidence: undefined }));
  const records = [...recorderRows, loot("install-a", { npc: 61 }, [])];
  const tables = lootTablesFromRecords(records, asOf);
  const table = npcLootTable(tables, 61);
  expect(table.span).toMatchObject({ windows: 1, installs: 1 });
  expect(itemDropSources(tables, 2230)).toEqual({ rows: [], short: null });
  expect(pendingForNpc(pendingLootFromRecords(records), 61)).toEqual({ windows: 3, reporters: 3 });
});

test("zero windows: no rate, no division, and the state says nothing was looted", () => {
  const tables = lootTablesFromRecords([], asOf);
  const table = npcLootTable(tables, 40);
  expect(table).toEqual({ npcId: 40, state: "none", span: { windows: 0, installs: 0, first: null, last: null }, rows: [], missingInstalls: 3 });
  expect(missingLine(table)).toBe("0 loot windows from 0 installs. A rate needs windows from 3 installs: 3 more.");
  expect(itemDropSources(tables, 750)).toEqual({ rows: [], short: null });
});

test("zero items in windows from 3 installs: a measured zero, not a missing table", () => {
  const records = ["a", "b", "c"].map((id) => loot(`install-${id}`, { npc: 3 }, []));
  const table = npcLootTable(lootTablesFromRecords(records, asOf), 3);
  expect(table.state).toBe("rated");
  expect(table.rows).toEqual([]);
  expect(table.span).toEqual({ windows: 3, installs: 3, first: "2026-10-12", last: "2026-10-12" });
});

test("a capture time after the corpus time, or no capture time, dates nothing but still counts", () => {
  const records = [
    loot("install-a", { npc: 5 }, [[1, 1]], "2026-10-11T00:00:00.000Z"),
    loot("install-b", { npc: 5 }, [[1, 1]], "2027-01-01T00:00:00.000Z"),
    { ...loot("install-c", { npc: 5 }, [[1, 1]]), capturedAt: "not a date" },
  ];
  const table = npcLootTable(lootTablesFromRecords(records, asOf), 5);
  expect(table.span).toEqual({ windows: 3, installs: 3, first: "2026-10-11", last: "2026-10-11" });
});

test("implausible item entries are skipped and the window still counts", () => {
  const records = ["a", "b", "c"].map((id) => ({ ...loot(`install-${id}`, { npc: 8 }, [[20, 1]]), items: [{ itemId: 20, count: 1 }, { itemId: -1, count: 1 }, { itemId: 21, count: 0 }] }));
  const table = npcLootTable(lootTablesFromRecords(records, asOf), 8);
  expect(table.rows.map((r) => r.itemId)).toEqual([20]);
  expect(table.span.windows).toBe(3);
});

test("an object's rows come only once 3 installs looted it, with the same numbers an item page gives", () => {
  const records = [
    loot("install-a", { obj: 9 }, [[12, 1], [13, 1]]),
    loot("install-b", { obj: 9 }, [[12, 1]]),
    loot("install-a", { obj: 5 }, [[14, 1]]),
  ];
  expect(objectLootRows(lootTablesFromRecords(records, asOf), 9)).toEqual([]);
  const rated = lootTablesFromRecords([...records, loot("install-c", { obj: 9 }, [])], asOf);
  const rows = objectLootRows(rated, 9);
  expect(rows.map((r) => [r.sourceObjectId, r.itemId, r.withItem, r.windows, r.installs])).toEqual([[9, 12, 2, 3, 3], [9, 13, 1, 3, 3]]);
  expect(rows[0]).toEqual(itemDropSources(rated, 12).rows[0]);
  expect(objectLootRows(rated, 5)).toEqual([]);
  expect(objectLootRows(rated, 404)).toEqual([]);
});
