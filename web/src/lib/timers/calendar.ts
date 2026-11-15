/** Pure browser calendar utilities. UTC schedules stay fixed through local DST changes. */
export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  repeatHours?: number;
  description?: string;
}
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export function nextReset(now: Date, rule: { hour: number; weekday?: number }): Date {
  const next = new Date(now);
  next.setUTCHours(rule.hour, 0, 0, 0);
  if (rule.weekday !== undefined) next.setUTCDate(next.getUTCDate() + (rule.weekday - next.getUTCDay() + 7) % 7);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + (rule.weekday === undefined ? 1 : 7));
  return next;
}
export function expandOccurrences(event: CalendarEvent, from: Date, until: Date): CalendarEvent[] {
  const start = Date.parse(event.start), end = Date.parse(event.end);
  const step = event.repeatHours === undefined ? null : event.repeatHours * HOUR;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (step !== null && (!Number.isFinite(step) || step <= 0))) throw new Error('Invalid event schedule');
  if (until.getTime() <= from.getTime()) return [];
  const first = step ? Math.max(0, Math.floor((from.getTime() - end) / step) + 1) : 0;
  const out: CalendarEvent[] = [];
  for (let i = first; out.length < 500; i++) {
    const offset = step ? i * step : 0;
    if (start + offset >= until.getTime()) break;
    if (end + offset > from.getTime()) out.push({ ...event, start: new Date(start + offset).toISOString(), end: new Date(end + offset).toISOString() });
    if (!step) break;
  }
  return out;
}
const utc = (date: Date): string => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const escapeText = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
/** RFC 5545 §3.1: 75 octets, including the continuation space; never split a code point. */
export function foldLine(line: string): string {
  let out = '', octets = 0;
  const encoder = new TextEncoder();
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > 75) { out += '\r\n '; octets = 1; }
    out += char; octets += size;
  }
  return out;
}
export function buildCalendar(events: CalendarEvent[], now: Date): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Everloot//Timers//EN', 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    if (!/^[a-zA-Z0-9_-]+$/.test(event.id)) throw new Error('Invalid calendar UID');
    if (event.repeatHours !== undefined && (!Number.isInteger(event.repeatHours) || event.repeatHours <= 0)) throw new Error('Invalid calendar repeat');
    const start = new Date(event.start), end = new Date(event.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('Invalid event dates');
    lines.push('BEGIN:VEVENT', `UID:${event.id}@everloot.app`, `DTSTAMP:${utc(now)}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`, `SUMMARY:${escapeText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.repeatHours) {
      const rule = event.repeatHours % 168 === 0 ? `FREQ=WEEKLY;INTERVAL=${event.repeatHours / 168}`
        : event.repeatHours % 24 === 0 ? `FREQ=DAILY;INTERVAL=${event.repeatHours / 24}`
        : `FREQ=HOURLY;INTERVAL=${event.repeatHours}`;
      lines.push(`RRULE:${rule}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
export function countdown(target: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  return `${String(Math.floor(seconds / (DAY / 1000))).padStart(3, '0')}d ${String(Math.floor(seconds / 3600) % 24).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
