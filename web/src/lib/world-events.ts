import type { ClientHoliday, HolidayStart } from "@kb/client-holidays";
import type { ClientPetFamily } from "@kb/client-pet-families";
import { CLIENT_HOLIDAYS } from "@/data/game-data/client-holidays";
import { CLIENT_PET_FAMILIES } from "@/data/game-data/client-pet-families";
import { idSegment } from "./completion-lists";

// The holidays and world events, and the hunter pet families, the game files list. Both are labelled found in game
// files, unconfirmed: no player report confirms either yet.

export const holidayHref = (id: number, name: string) => `/database/holidays/${idSegment(id, name)}`;
export const petFamilyHref = (id: number, name: string) => `/database/pet-families/${idSegment(id, name)}`;

function read<T>(rows: () => T[]): T[] | null {
  try { return rows(); } catch { return null; }
}
/** Every named holiday in id order; null when the file could not be read. */
export const holidayEntries = (): ClientHoliday[] | null => read(() => CLIENT_HOLIDAYS.holidays);
export const petFamilyEntries = (): ClientPetFamily[] | null => read(() => CLIENT_PET_FAMILIES.families);
export const holidaysBuild = (): string | null => read(() => [CLIENT_HOLIDAYS.build.version])?.[0] ?? null;
export const petFamiliesBuild = (): string | null => read(() => [CLIENT_PET_FAMILIES.build.version])?.[0] ?? null;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (s: HolidayStart) => `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;

/** A start as a page says it, in server time: "Every year on 15 December at 06:00", "Every Sunday at 14:00", "6 January 2025 at 04:00". */
export function startLabel(s: HolidayStart): string {
  if (s.weekday !== undefined && s.month === undefined) return `Every ${WEEKDAYS[s.weekday] ?? `weekday ${s.weekday}`} at ${clock(s)}`;
  const date = `${s.day} ${MONTHS[(s.month ?? 1) - 1]}`;
  return s.year === undefined ? `Every year on ${date} at ${clock(s)}` : `${date} ${s.year} at ${clock(s)}`;
}

/** How long it lasts: whole days when the hours divide evenly, else hours. */
export function lastsLabel(hours?: number): string | null {
  if (!hours) return null;
  if (hours % 24 === 0) return `${hours / 24} ${hours === 24 ? "day" : "days"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
