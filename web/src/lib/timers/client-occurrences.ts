import { expandOccurrences } from './calendar';
interface ClientDate { year?: number; month?: number; day?: number; weekday?: number; hour: number; minute: number }
interface ClientEvent { id: number; name: string; durationHours: number; dates: ClientDate[]; repeat: { kind: string; hours?: number } | null }
/** Calendar-clock arithmetic only: using UTC methods avoids the browser's DST rules, but the returned
 * strings intentionally have NO zone. These are not instants and must never enter an ICS download.
 */
export function clientOccurrences(event: ClientEvent, year: number): { start: string; end: string }[] {
  if (!event.durationHours || year < 2000 || year > 2100) return [];
  // Include an annual occurrence that began in the prior year and is still active on January 1.
  if (event.repeat?.kind === 'yearly') return clientOccurrences({
    ...event, repeat: null,
    dates: event.dates.flatMap(date => date.year === undefined ? [{...date, year:year-1}, {...date, year}] : [date]),
  }, year);
  const from = new Date(Date.UTC(year, 0, 1)), until = new Date(Date.UTC(year + 1, 0, 1));
  const out: { start: string; end: string }[] = [];
  for (const date of event.dates) {
    let start: Date;
    let repeatHours: number | undefined;
    if (date.month !== undefined && date.day !== undefined && (date.year !== undefined || event.repeat?.kind === 'yearly')) {
      start = new Date(Date.UTC(date.year ?? year, date.month - 1, date.day, date.hour, date.minute));
      if (start.getUTCMonth() !== date.month - 1 || start.getUTCDate() !== date.day) continue;
      if (event.repeat?.kind === 'hours') repeatHours = event.repeat.hours;
    } else if (event.repeat?.kind === 'weekly' && date.weekday !== undefined) {
      start = new Date(Date.UTC(year, 0, 1, date.hour, date.minute));
      start.setUTCDate(1 + (date.weekday - start.getUTCDay() + 7) % 7);
      repeatHours = 168;
    } else continue;
    const rows = expandOccurrences({ id: `client-${event.id}`, summary: event.name, start: start.toISOString(), end: new Date(start.getTime() + event.durationHours * 3_600_000).toISOString(), repeatHours }, from, until);
    out.push(...rows.map(row => ({ start: row.start.slice(0, 16), end: row.end.slice(0, 16) })));
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
