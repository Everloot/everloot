import type { Region } from '@/data/realms';
import { nextReset, type CalendarEvent } from './calendar';
// Source: Blizzard, Nethaera's Legion grouping/reset announcement (2016-07-01).
// Original forum retired; Blizzard post archived verbatim:
// https://www.bluetracker.gg/wow/topic/us-en/20745655899-legion-pre-patch-grouping-and-reset-timer-changes/
// US weekly corroboration: https://worldofwarcraft.blizzard.com/en-us/news/20243893/legion-dungeons-and-raids-schedule
// Source: Blizzard, Kaivax (2022-11-01), EU weekly reset at 05:00 CET.
// Derived reference: interpreting CET as fixed UTC+1 gives 04:00 UTC; Wednesday follows 16 Nov 2022.
// https://eu.forums.blizzard.com/en/wow/t/weekly-reset-time-changing-to-0500-cet-on-16-november/398498
// These describe other WoW versions. Forever applicability is NOT confirmed; never promote to verified.
export const RESET_SOURCES = [
  { label: 'Blizzard: Legion reset announcement (2016, archived by Blue Tracker)', url: 'https://www.bluetracker.gg/wow/topic/us-en/20745655899-legion-pre-patch-grouping-and-reset-timer-changes/' },
  { label: 'Blizzard: Legion release schedule (2016)', url: 'https://worldofwarcraft.blizzard.com/en-us/news/20243893/legion-dungeons-and-raids-schedule' },
  { label: 'Blizzard: EU weekly reset change (2022)', url: 'https://eu.forums.blizzard.com/en/wow/t/weekly-reset-time-changing-to-0500-cet-on-16-november/398498' },
];
export const RESET_CLOCK_NOTE = 'The archived Blizzard US post explicitly states daily 15:00 UTC and Tuesday weekly resets. The EU Wednesday 04:00 UTC reference is derived from the announced 16 November 2022 reset at 05:00 CET, interpreting CET as fixed UTC+1 through daylight saving; this interpretation is not a confirmed Forever rule.';
export const RESET_NOTICE = 'Reference timing from other WoW versions. Forever reset times: Not confirmed yet. Check in game before planning a lockout.';
export function resetEvents(region: Region, now: Date): CalendarEvent[] {
  const rules = region === 'us' ? [{ kind: 'Daily', hour: 15, weekday: undefined }, { kind: 'Weekly', hour: 15, weekday: 2 }]
    : region === 'eu' ? [{ kind: 'Weekly', hour: 4, weekday: 3 }] : [];
  return rules.map(rule => {
    const start = nextReset(now, rule).toISOString();
    return { id: `reset-${region}-${rule.kind.toLowerCase()}`, summary: `${region.toUpperCase()} ${rule.kind} reset (Forever unconfirmed)`, start, end: new Date(Date.parse(start) + 1000).toISOString(), repeatHours: rule.weekday === undefined ? 24 : 168, description: 'One-second calendar marker, not a maintenance duration. ' + RESET_NOTICE + ' ' + RESET_CLOCK_NOTE + ' Sources: ' + RESET_SOURCES.map(s => s.url).join(' ') };
  });
}
