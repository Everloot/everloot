// How a player-reported count is written wherever it is shown: the count, how many installs it rests on and when
// one last reported it. Kept apart from the loaders so the map's client code prints the same words as the pages.
import { PLACEHOLDER } from "./placeholder";
import { utcDay } from "./time";

/** A day from an ISO time in the site's day form, `Oct 20, 2026`, or `[?]` when no report carried one. Display only. */
export const dayLabel = (iso: string | null | undefined): string => utcDay(iso) ?? PLACEHOLDER;

/** "Confirmed by 3 installs, last seen Oct 20, 2026". */
export const confirmedLine = (installs: number, lastSeen: string | null | undefined): string => `Confirmed by ${installs} installs, last seen ${dayLabel(lastSeen)}`;
