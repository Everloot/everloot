/** Blizzard client holiday catalog, pages only, unconfirmed (docs/DATA_POLICY.md).
 * Dates are packed calendar/realm-clock fields, NOT Unix timestamps. No UTC offset is supplied
 * by these tables: preserve the clock fields rather than invent regional UTC instants.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { GAME_DATA_CREDIT } from '@everloot/protocol';
import { readClientMeta, readClientRows, readClientTables } from './client-snapshot.js';
export interface ClientCalendarDate { year?: number; month?: number; day?: number; weekday?: number; hour: number; minute: number }
export interface ClientCalendarEvent {
  id: number; name: string; description: string; category: 'Holidays' | 'Darkmoon' | 'PvP' | 'Fishing';
  region: number; durationHours: number; phaseHours: number[];
  repeat: { kind: 'hours'; hours: number } | { kind: 'yearly' } | { kind: 'weekly' } | null;
  dates: ClientCalendarDate[];
}
/** The packed fields in Holidays.Date: minute:6, hour:5, weekday:3, day:6, month:4, year:5.
 * All-ones fields are unspecified; months/days are zero based, years are relative to 2000.
 */
export function decodeCalendarDate(raw: number): ClientCalendarDate | null {
  if (!Number.isInteger(raw) || raw <= 0 || raw > 0xffffffff) return null;
  const minute = raw & 63, hour = (raw >>> 6) & 31, weekday = (raw >>> 11) & 7;
  const day = (raw >>> 14) & 63, month = (raw >>> 20) & 15, year = (raw >>> 24) & 31;
  if (minute > 59 || hour > 23 || (day !== 63 && day > 30) || (month !== 15 && month > 11)) return null;
  return { ...(year !== 31 ? { year: 2000 + year } : {}), ...(month !== 15 ? { month: month + 1 } : {}), ...(day !== 63 ? { day: day + 1 } : {}), ...(weekday !== 7 ? { weekday } : {}), hour, minute };
}
export function extractCalendar(get: (table: string) => Map<number, Record<string, unknown>> | undefined): ClientCalendarEvent[] {
  const names = get('HolidayNames'), descriptions = get('HolidayDescriptions');
  const out: ClientCalendarEvent[] = [];
  for (const [id, row] of get('Holidays') ?? []) {
    const name = names?.get(Number(row.HolidayNameID))?.Name_lang;
    if (typeof name !== 'string' || !name.trim()) continue;
    const text = descriptions?.get(Number(row.HolidayDescriptionID))?.Description_lang;
    const phaseHours = (Array.isArray(row.Duration) ? row.Duration : []).filter((n): n is number => typeof n === 'number' && n > 0 && Number.isFinite(n));
    const dates = (Array.isArray(row.Date) ? row.Date : []).map(Number).map(decodeCalendarDate).filter((d): d is ClientCalendarDate => d !== null);
    const durationHours = phaseHours[0] ?? 0;
    const repeat: ClientCalendarEvent['repeat'] = Number(row.Looping) === 1 && phaseHours.length > 0 ? { kind: 'hours', hours: phaseHours.reduce((a, b) => a + b, 0) }
      : dates.length === 1 && dates[0].year === undefined && dates[0].month !== undefined && dates[0].day !== undefined ? { kind: 'yearly' }
        : dates.length === 1 && dates[0].year === undefined && dates[0].month === undefined && dates[0].day === undefined && dates[0].weekday !== undefined ? { kind: 'weekly' } : null;
    const category = Number(row.CalendarFilterType) === 1 ? 'Darkmoon' : Number(row.CalendarFilterType) === 2 ? 'PvP' : name.includes('Fishing') ? 'Fishing' : 'Holidays';
    out.push({ id, name: name.trim(), description: typeof text === 'string' ? text : '', category, region: Number(row.Region), durationHours, phaseHours, repeat, dates });
  }
  return out.sort((a, b) => a.id - b.id);
}
export function writeClientCalendar(snapshot: string, path: string) {
  const meta = readClientMeta(snapshot), tables = new Set(readClientTables(snapshot));
  for (const table of ['Holidays', 'HolidayNames', 'HolidayDescriptions']) if (!tables.has(table)) throw new Error(`Calendar snapshot missing ${table}`);
  const { product, buildId, version, buildConfig, definitions, extractedAt } = meta;
  const result = { schema: 'everloot.client-calendar/1', credit: GAME_DATA_CREDIT, label: 'Found in game files, unconfirmed', build: { product, buildId, version, buildConfig, definitions, extractedAt }, note: 'Dates use the client calendar clock. Regional UTC mapping and live Forever schedules are not confirmed.', events: extractCalendar(t => tables.has(t) ? readClientRows(snapshot, t) : undefined) };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
  return result;
}
