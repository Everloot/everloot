import { expect, test } from 'vitest';
import { decodeCalendarDate, extractCalendar } from '../src/client-calendar.js';
// Packed dates from the client layout: minute, hour, weekday, day, month, year (since 2000).
const packed = (y: number, m: number, d: number, h = 0, minute = 0) => ((y << 24) | ((m - 1) << 20) | ((d - 1) << 14) | (7 << 11) | (h << 6) | minute) >>> 0;
test('decodes explicit and wildcard dates without guessing a UTC zone', () => {
  expect(decodeCalendarDate(packed(26, 11, 15, 14, 30))).toEqual({ year: 2026, month: 11, day: 15, hour: 14, minute: 30 });
  expect(decodeCalendarDate(packed(31, 12, 16))).toEqual({ month: 12, day: 16, hour: 0, minute: 0 });
  expect(decodeCalendarDate(0)).toBeNull();
});
test('joins names and descriptions, preserves dates and duration phases, derives only explicit looping period', () => {
  const tables = new Map<string, Map<number, Record<string, unknown>>>([
    ['Holidays', new Map([[263, { HolidayNameID: 1, HolidayDescriptionID: 1, Region: 0, Looping: 1, Duration: [168, 336, 0], Date: [packed(26, 3, 6), 0], CalendarFilterType: 1 }]])],
    ['HolidayNames', new Map([[1, { Name_lang: 'Sample Faire' }]])],
    ['HolidayDescriptions', new Map([[1, { Description_lang: 'Description' }]])],
  ]);
  const events = extractCalendar(t => tables.get(t));
  expect(events).toEqual([{ id: 263, name: 'Sample Faire', description: 'Description', category: 'Darkmoon', region: 0, durationHours: 168, phaseHours: [168, 336], repeat: { kind: 'hours', hours: 504 }, dates: [{ year: 2026, month: 3, day: 6, hour: 0, minute: 0 }] }]);
  expect(extractCalendar(() => undefined)).toEqual([]);
});
test('keeps nameless rows out, keeps zero-duration events unscheduled', () => {
  expect(extractCalendar(t => t === 'Holidays' ? new Map([[1, { HolidayNameID: 9 }]]) : undefined)).toEqual([]);
});

test('writes a build-stamped artifact and fails closed on missing required tables', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { writeClientSnapshot } = await import('../src/client-snapshot.js');
  const { writeClientCalendar } = await import('../src/client-calendar.js');
  const dir = mkdtempSync(join(tmpdir(), 'kb-calendar-')), snapshot = join(dir, 'client.sqlite'), output = join(dir, 'calendar.json');
  const meta = { product: 'test', buildId: 1, version: '1.0.0.1', buildConfig: 'test', definitions: 'test', extractedAt: '2026-11-15T00:00:00Z', library: 'test' };
  writeClientSnapshot(snapshot, meta, []);
  expect(() => writeClientCalendar(snapshot, output)).toThrow('Calendar snapshot missing');
  writeClientSnapshot(snapshot, meta, ['Holidays', 'HolidayNames', 'HolidayDescriptions'].map(table => ({ table, fileDataID: 1, cKey: null, encryptedBlocks: 0, rows: new Map([[1, table === 'Holidays' ? { HolidayNameID: 1, Date: [], Duration: [] } : { Name_lang: 'Sample', Description_lang: 'Example' }]]) })));
  writeClientCalendar(snapshot, output);
  const result = JSON.parse(readFileSync(output, 'utf8'));
  expect(result.build.version).toBe('1.0.0.1');
  expect(result.credit).toContain('Blizzard');
  expect(result.events[0].name).toBe('Sample');
  expect(result.note).toContain('not confirmed');
});
