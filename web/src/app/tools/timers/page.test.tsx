// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Timers from './Timers';
import { metadata } from './page';
import { resetEvents } from '@/lib/timers/schedules';
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T14:59:59Z')); host = document.createElement('div'); document.body.append(host); root = createRoot(host); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });
test('metadata points at the route and its OG image', () => { expect(metadata.alternates?.canonical).toBe('/tools/timers'); expect(JSON.stringify(metadata.openGraph)).toContain('/tools/timers/opengraph-image'); });
test('ticks, crosses a boundary, labels reference schedules and cleans up its interval', () => {
  act(() => root.render(<Timers />));
  expect(host.textContent).toContain('000d 00:00:01');
  act(() => vi.advanceTimersByTime(1000));
  expect(host.textContent).toContain('001d 00:00:00');
  expect(host.textContent).toContain('Forever: Not confirmed yet');
  expect(host.querySelector('[aria-live="polite"]')).toBeNull();
  expect(host.querySelectorAll('option').length).toBeGreaterThan(4);
});
test('blocked storage still permits zone selection', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  act(() => root.render(<Timers />));
  const select = host.querySelectorAll('select')[1];
  act(() => { select.value = 'UTC'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(select.value).toBe('UTC');
});
test('saved zones restore and filters hide unrelated events', () => {
  localStorage.setItem('everloot-timers-zone', 'America/Phoenix');
  act(() => root.render(<Timers />));
  expect(host.querySelectorAll('select')[1].value).toBe('America/Phoenix');
  const filter = host.querySelectorAll('select')[2];
  act(() => { filter.value = 'Darkmoon'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('Darkmoon Faire');
  expect(host.textContent).not.toContain('Reset reference countdowns');
  expect(host.textContent).not.toContain('Fishing Extravaganza');
});
test('unknown regional timing is not guessed into a calendar', () => {
  const now = new Date('2026-11-15');
  expect(resetEvents('kr', now)).toEqual([]); expect(resetEvents('tw', now)).toEqual([]);
  expect(resetEvents('eu', now).map(e => e.id)).toEqual(['reset-eu-weekly']);
});
test('downloads only sourced regional reference events with their warning labels', () => {
  const create = vi.fn((_blob: Blob) => 'blob:calendar'), revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { });
  act(() => root.render(<Timers />));
  act(() => host.querySelector('button')!.click());
  expect(click).toHaveBeenCalledOnce();
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(create.mock.calls[0][0].type).toBe('text/calendar;charset=utf-8');
  act(() => vi.advanceTimersByTime(1000)); expect(revoke).toHaveBeenCalledWith('blob:calendar');
});
test('invalid saved zone falls back to the browser zone', () => {
  localStorage.setItem('everloot-timers-zone', 'not/a/zone');
  act(() => root.render(<Timers />));
  expect(host.querySelectorAll('select')[1].value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
});
test('missing zone enumeration does not stop the ticking clock', () => {
  vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => { throw new Error('unsupported'); });
  act(() => root.render(<Timers />));
  expect(host.textContent).toContain('000d 00:00:01');
  act(() => vi.advanceTimersByTime(1000));
  expect(host.textContent).toContain('001d 00:00:00');
});
test('a dated event without a duration keeps its start dates without claiming no dates', () => {
  act(() => root.render(<Timers />));
  const row = [...host.querySelectorAll('li')].find(li => li.querySelector('h3')?.textContent?.includes('Noblegarden'))!;
  expect(row.textContent).toContain('2026');
  expect(row.textContent).toContain('No end date supplied');
  expect(row.textContent).not.toContain('No dated occurrences');
});
