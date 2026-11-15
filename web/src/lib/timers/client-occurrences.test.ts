import { expect, test } from 'vitest';
import { clientOccurrences } from './client-occurrences';
const base = { id: 1, name: 'Sample', durationHours: 48, dates: [{ month: 12, day: 31, hour: 12, minute: 0 }], repeat: { kind: 'yearly', hours: 0 } };
test('annual dates carry their end into next year and never acquire a UTC zone', () => {
  expect(clientOccurrences(base, 2026)).toEqual([{ start: '2025-12-31T12:00', end: '2026-01-02T12:00' }, { start: '2026-12-31T12:00', end: '2027-01-02T12:00' }]);
});
test('weekly wildcard dates expand within the selected calendar year', () => {
  const rows = clientOccurrences({ ...base, dates: [{ weekday: 0, hour: 14, minute: 0 }], repeat: { kind: 'weekly', hours: 0 }, durationHours: 2 }, 2026);
  expect(rows).toHaveLength(52);
  expect(rows[0]).toEqual({ start: '2026-01-04T14:00', end: '2026-01-04T16:00' });
});
test('looping phases use the declared interval and explicit dates are not made annual', () => {
  const loop = { ...base, dates: [{ year: 2025, month: 12, day: 28, hour: 0, minute: 0 }], durationHours: 168, repeat: { kind: 'hours', hours: 504 } };
  expect(clientOccurrences(loop, 2026)[0]).toEqual({ start: '2025-12-28T00:00', end: '2026-01-04T00:00' });
  expect(clientOccurrences({ ...loop, repeat: null }, 2027)).toEqual([]);
});
test('invalid calendar dates do not silently roll into another month', () => {
  expect(clientOccurrences({ ...base, dates: [{ month: 2, day: 30, hour: 0, minute: 0 }] }, 2026)).toEqual([]);
});
