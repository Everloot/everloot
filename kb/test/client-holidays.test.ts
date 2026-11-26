import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildClientHolidays, ClientHolidays, packedStart, writeClientHolidays } from "../src/client-holidays.js";
import { writeClientSnapshot, type ClientBuildMeta, type ExtractedTable } from "../src/client-snapshot.js";

const meta: ClientBuildMeta = {
  product: "test", buildConfig: "abcd1234abcd1234", buildId: 70707,
  version: "1.0.0.70707", extractedAt: "2026-11-25T00:00:00.000Z", library: "test", definitions: "abc1234",
};
type Rows = [number, Record<string, unknown>][];
const table = (name: string, rows: Rows): ExtractedTable => ({ table: name, fileDataID: 1, cKey: "c".repeat(32), encryptedBlocks: 0, rows: new Map(rows) });
const zeros = (n: number) => Array.from({ length: n }, () => 0);
const dates = (...d: number[]) => [...d, ...zeros(26 - d.length)];
const durations = (...d: number[]) => [...d, ...zeros(10 - d.length)];

const tables: Record<string, Rows> = {
  HolidayNames: [[14, { Name_lang: "Feast of Winter Veil" }], [1, { Name_lang: "Darkmoon Faire" }], [6, { Name_lang: "Stranglethorn Fishing Extravaganza" }]],
  HolidayDescriptions: [[13, { Description_lang: "Gifts under the tree.\r\n\r\nMerry!" }]],
  Holidays: [
    // Every year on 15 December at 06:00, for 432 hours.
    [141, { HolidayNameID: 14, HolidayDescriptionID: 13, Looping: 0, Duration: durations(432), Date: dates(531872128) }],
    // Two dated starts.
    [263, { HolidayNameID: 1, HolidayDescriptionID: 0, Looping: 0, Duration: durations(168), Date: dates(419526912, 421689600) }],
    // Every Sunday at 14:00.
    [301, { HolidayNameID: 6, Looping: 0, Duration: durations(2), Date: dates(536855424) }],
    // No name: a server-side helper, left out.
    [1, { HolidayNameID: 0, Duration: durations(0), Date: dates(527546368) }],
  ],
};

function snapshot(t: Record<string, Rows>): string {
  const path = join(mkdtempSync(join(tmpdir(), "kb-holidays-")), "client.sqlite");
  writeClientSnapshot(path, meta, Object.entries(t).map(([name, rows]) => table(name, rows)));
  return path;
}

test("a packed date reads as yearly, weekly or a dated start", () => {
  expect(packedStart(531872128)).toEqual({ month: 12, day: 15, hour: 6, minute: 0 });
  expect(packedStart(536855424)).toEqual({ weekday: 0, hour: 14, minute: 0 });
  expect(packedStart(419526912)).toEqual({ year: 2025, month: 1, day: 6, hour: 4, minute: 0 });
  expect(packedStart(0)).toBeNull();
});

test("holidays: named ones with their text, duration and starts, in id order", () => {
  expect(buildClientHolidays(snapshot(tables)).holidays).toEqual([
    { id: 141, name: "Feast of Winter Veil", description: "Gifts under the tree.\n\nMerry!", hours: 432, starts: [{ month: 12, day: 15, hour: 6, minute: 0 }] },
    { id: 263, name: "Darkmoon Faire", hours: 168, starts: [{ year: 2025, month: 1, day: 6, hour: 4, minute: 0 }, { year: 2025, month: 3, day: 10, hour: 4, minute: 0 }] },
    { id: 301, name: "Stranglethorn Fishing Extravaganza", hours: 2, starts: [{ weekday: 0, hour: 14, minute: 0 }] },
  ]);
});

test("the file parses back, one holiday per line", () => {
  const file = join(mkdtempSync(join(tmpdir(), "kb-holidays-out-")), "client-holidays.json");
  const out = writeClientHolidays(snapshot(tables), file);
  expect(out.schema).toBe("everloot.client-holidays/1");
  const text = readFileSync(file, "utf8");
  expect(ClientHolidays.parse(JSON.parse(text))).toEqual(out);
  expect(text).toContain('\n  {"id":141,"name":"Feast of Winter Veil"');
  expect(buildClientHolidays(snapshot({ Other: [[1, { X: 1 }]] })).holidays).toEqual([]);
});
