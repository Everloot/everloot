'use client';
import { useEffect, useMemo, useState } from 'react';
import { REGIONS, type Region } from '@/data/realms';
import calendar from '@/data/game-data/client-calendar.json';
import { clientOccurrences } from '@/lib/timers/client-occurrences';
import { buildCalendar, countdown } from '@/lib/timers/calendar';
import { resetEvents, RESET_NOTICE, RESET_CLOCK_NOTE } from '@/lib/timers/schedules';
import { SectionHeading } from '@/components/ui';

const darkmoonId = calendar.events.find(event => event.category === 'Darkmoon')?.id;
const categories = ['All', 'Resets', ...new Set(calendar.events.map(e => e.category))];
const control = 'min-h-11 rounded-control border border-line bg-panel px-3 py-2 text-fg';
const pad = (n: number) => String(n).padStart(2, '0');
function dateLabel(d: { year?: number; month?: number; day?: number; weekday?: number; hour: number; minute: number }) {
  const time = `${pad(d.hour)}:${pad(d.minute)}`;
  if (d.month !== undefined && d.day !== undefined) return `${d.year ?? 'Year not specified'} · ${pad(d.month)}/${pad(d.day)} at ${time} (client clock)`;
  if (d.weekday !== undefined) return `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.weekday]} at ${time} (client clock)`;
  return `Date not fully specified · ${time} (client clock)`;
}
export default function Timers() {
  const [now, setNow] = useState<number | null>(null);
  const [region, setRegion] = useState<Region>('us');
  const [zone, setZone] = useState('UTC');
  const [zones, setZones] = useState(['UTC']);
  const [filter, setFilter] = useState('All');
  useEffect(() => {
    setNow(Date.now());
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let saved = browserZone;
    try { saved = localStorage.getItem('everloot-timers-zone') || browserZone; new Intl.DateTimeFormat('en', { timeZone: saved }); } catch { saved = browserZone; }
    setZone(saved);
    let availableZones: string[] = [];
    try { if (typeof Intl.supportedValuesOf === 'function') availableZones = Intl.supportedValuesOf('timeZone'); } catch { /* Keep browser and UTC choices when enumeration is unavailable. */ }
    setZones([...new Set([browserZone, saved, 'UTC', ...availableZones])]);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const year = now === null ? null : new Date(now).getUTCFullYear();
  const occurrences = useMemo(() => new Map(calendar.events.map(e => [e.id, year === null ? [] : clientOccurrences(e, year)])), [year]);
  const resets = useMemo(() => now === null ? [] : resetEvents(region, new Date(now)), [region, now]);
  const format = useMemo(() => new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'long' }), [zone]);
  function download() {
    if (now === null) return;
    const blob = new Blob([buildCalendar(resets, new Date(now))], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `everloot-${region}-unconfirmed-resets.ics`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="mt-8 space-y-8">
    <div className="flex flex-wrap items-end gap-4">
      <label className="grid gap-2 text-sm">Reset region<select className={control} value={region} onChange={e => setRegion(e.target.value as Region)}>{REGIONS.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}</select></label>
      <label className="grid min-w-0 gap-2 text-sm">Display time zone<select className={`${control} max-w-full`} value={zone} onChange={e => { setZone(e.target.value); try { localStorage.setItem('everloot-timers-zone', e.target.value); } catch { /* Storage may be disabled; keep the current selection. */ } }}>{zones.map(z => <option key={z}>{z}</option>)}</select></label>
      <label className="grid gap-2 text-sm">Show<select className={control} value={filter} onChange={e => setFilter(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
    </div>
    {(filter === 'All' || filter === 'Resets') && <section aria-labelledby="resets" className="space-y-4">
      <SectionHeading id="resets">Reset reference countdowns</SectionHeading>
      <p className="text-sm text-muted">{RESET_NOTICE}</p>
      <p className="text-sm text-muted">{RESET_CLOCK_NOTE}</p>
      <div className="divide-y divide-line border-y border-line">
        {['Daily', 'Weekly'].map(kind => {
          const event = resets.find(e => e.id.endsWith(kind.toLowerCase()));
          return <div key={kind} className="grid gap-2 py-4 sm:grid-cols-2">
            <div><h3 className="font-semibold">{kind} reset · {region.toUpperCase()}</h3><p className="text-sm text-muted">Forever: Not confirmed yet</p></div>
            <div className="min-h-14"><p className="font-mono text-xl tabular-nums" aria-live="off">{event && now !== null ? countdown(Date.parse(event.start), now) : '---d --:--:--'}</p><p className="min-h-5 text-sm text-muted">{event ? format.format(new Date(event.start)) : now === null ? 'Loading reference timing…' : 'No sourced reference timing available'}</p></div>
          </div>;
        })}
      </div>
      <button type="button" className={control} disabled={resets.length === 0} onClick={download}>Download unconfirmed reset reference (.ics)</button>
      <p className="text-sm text-muted">Exports the {region.toUpperCase()} reference resets shown above, repeating in UTC. Each reset is a one-second calendar marker, not a maintenance duration. This is a file download, not a calendar subscription. Event dates are excluded until their regional UTC mapping is confirmed.</p>
    </section>}
    {filter !== 'Resets' && <section aria-labelledby="events" className="space-y-4">
      <SectionHeading id="events">Client event calendar</SectionHeading>
      <p className="text-sm text-muted">Found in game files, unconfirmed · build {calendar.build.version}. Dates below use the client calendar clock. Region codes in the tables are not yet mapped to realm regions. Regional UTC mapping and live Forever availability: Not confirmed yet. The display time zone applies to reset references only; event dates have no confirmed UTC conversion.</p>
      <ul className="divide-y divide-line border-y border-line">{calendar.events.filter(e => filter === 'All' || e.category === filter).map(event => <li key={event.id} id={event.id === darkmoonId ? 'darkmoon' : undefined} className="space-y-2 py-4">
        <h3 className="font-semibold">{event.name} <span className="font-normal text-muted">· {event.category}</span></h3>
        {event.region !== 0 && <p className="text-sm text-muted">Client region {event.region} · realm mapping not confirmed</p>}
        {event.description && <p className="whitespace-pre-line text-sm text-muted">{event.description}</p>}
        <p className="text-sm text-muted">{event.durationHours ? `${event.durationHours} hours` : 'Duration not supplied'}{event.repeat ? event.repeat.kind === 'hours' ? ` · repeats every ${event.repeat.hours} hours by the client loop rule` : ` · ${event.repeat.kind} client rule` : ' · explicit dates only'} · Live start/end countdown: Not confirmed yet</p>
        <details><summary className="cursor-pointer text-sm text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Dates in game files ({event.dates.length})</summary><ul className="mt-2 space-y-1 text-sm text-muted">{event.dates.map((date, i) => <li key={i}>{dateLabel(date)}</li>)}</ul>{!event.dates.length && <p className="text-sm text-muted">No usable dates supplied.</p>}</details>
        <details><summary className="cursor-pointer text-sm text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Client start/end dates for {year ?? 'this year'}</summary><ul className="mt-2 space-y-1 text-sm text-muted">{(occurrences.get(event.id) ?? []).map(row => <li key={row.start}>{row.start.replace('T', ' ')} to {row.end.replace('T', ' ')} (client clock)</li>)}</ul>{!occurrences.get(event.id)?.length && <p className="text-sm text-muted">{event.durationHours ? 'No dated occurrences supplied by the client rules for this year.' : 'No end date supplied. Client start dates are listed above.'}</p>}</details>
      </li>)}</ul>
    </section>}
  </div>;
}
