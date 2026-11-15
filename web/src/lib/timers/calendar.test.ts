import { describe, expect, test } from 'vitest';
import { nextReset, expandOccurrences, buildCalendar, foldLine, type CalendarEvent } from './calendar';

describe('UTC reset boundaries do not follow browser DST', () => {
  for (const [region, hour, day] of [['us', 15, 2], ['eu', 4, 3]] as const) {
    for (const date of ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01']) {
      test(`${region} ${date}`, () => {
        const now = new Date(`${date}T23:59:59Z`);
        const daily = nextReset(now, { hour });
        expect(daily.getUTCHours()).toBe(hour);
        expect(daily.getTime()).toBeGreaterThan(now.getTime());
        expect(daily.getTime() - now.getTime()).toBeLessThanOrEqual(86400000);
        const weekly = nextReset(now, { hour, weekday: day });
        expect(weekly.getUTCDay()).toBe(day);
        expect(weekly.getUTCHours()).toBe(hour);
        expect(weekly.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86400000);
      });
    }
  }
  test('exact boundary moves to the following period', () => {
    const now = new Date('2026-11-17T15:00:00Z');
    expect(nextReset(now, { hour: 15 }).toISOString()).toBe('2026-11-18T15:00:00.000Z');
    expect(nextReset(now, { hour: 15, weekday: 2 }).toISOString()).toBe('2026-11-24T15:00:00.000Z');
  });
});
const event: CalendarEvent = { id: 'sample', summary: 'Test, a;b\\c\nnext', start: '2026-11-01T12:00:00Z', end: '2026-11-01T14:00:00Z', repeatHours: 168 };
test('expansion includes ongoing occurrences, excludes ended and horizon boundary', () => {
  const rows = expandOccurrences(event, new Date('2026-11-08T13:00:00Z'), new Date('2026-11-22T12:00:00Z'));
  expect(rows.map(r => r.start)).toEqual(['2026-11-08T12:00:00.000Z', '2026-11-15T12:00:00.000Z']);
  expect(expandOccurrences({ ...event, repeatHours: undefined }, new Date('2026-11-08'), new Date('2026-12-01'))).toEqual([]);
});
test('ICS uses UTC, CRLF, stable UID, escaped text and repeating rules', () => {
  const out = buildCalendar([event], new Date('2026-11-01T00:00:00Z'));
  expect(out).toContain('UID:sample@everloot.app\r\n');
  expect(out).toContain('DTSTAMP:20261101T000000Z\r\n');
  expect(out).toContain('DTSTART:20261101T120000Z\r\nDTEND:20261101T140000Z');
  expect(out).toContain('SUMMARY:Test\\, a\\;b\\\\c\\nnext\r\n');
  expect(out).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1\r\n');
  expect(out.replaceAll('\r\n', '')).not.toContain('\n');
  expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
});
test('folds at 75 UTF-8 octets without splitting Unicode and counts continuation space', () => {
  const input = 'SUMMARY:' + 'é🐟'.repeat(50);
  const out = foldLine(input);
  expect(out.replaceAll('\r\n ', '')).toBe(input);
  for (const line of out.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(out).not.toContain('�');
});
test('rejects malformed or unbounded repeats', () => {
  expect(() => expandOccurrences({ ...event, repeatHours: 0 }, new Date(), new Date())).toThrow();
});
test('calendar rejects an end at or before the start (RFC 5545 DTEND)', () => {
  expect(() => buildCalendar([{ ...event, end: event.start }], new Date())).toThrow();
});

test('both regional weekly rules roll forward at the exact week boundary', () => {
  expect(nextReset(new Date('2026-11-18T03:59:59Z'), {hour:4,weekday:3}).toISOString()).toBe('2026-11-18T04:00:00.000Z');
  expect(nextReset(new Date('2026-11-18T04:00:00Z'), {hour:4,weekday:3}).toISOString()).toBe('2026-11-25T04:00:00.000Z');
  expect(nextReset(new Date('2026-11-17T14:59:59Z'), {hour:15,weekday:2}).toISOString()).toBe('2026-11-17T15:00:00.000Z');
});

test('daily reset calendars use a daily recurrence rule', () => {
  expect(buildCalendar([{...event,repeatHours:24}],new Date())).toContain('RRULE:FREQ=DAILY;INTERVAL=1');
});
