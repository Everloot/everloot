/**
 * The holidays and world events the game files list (`Holidays`, named through `HolidayNames`, described through
 * `HolidayDescriptions`): the name, the files' own description, how many hours it lasts (`Duration[0]`) and when it
 * starts (`Date`, the client's packed time). A holiday with no name is a server-side helper and is left out.
 *
 * A packed start is minute (6 bits), hour (5), weekday (3), day of month less one (6), month less one (4), year
 * since 2000 (5). A year of 31 means every year; a month and day left at their maximum mean every week on the
 * weekday. Times are the server's.
 *
 * Blizzard's data, labelled "found in game files, unconfirmed", pages only: the descriptions are game text. The build
 * watch regenerates it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { GAME_DATA_CREDIT } from "@everloot/protocol";
import { readClientMeta, readClientRows, readClientTables } from "./client-snapshot.js";
import { isDevelopmentItemName } from "./dev-item-names.js";
import { CLIENT_LABEL } from "./edges.js";

export const HOLIDAYS_SCHEMA = "everloot.client-holidays/1";

/** A start: a dated one carries the year, a yearly one month and day only, a weekly one the weekday (0 Sunday). */
const Start = z.object({
  year: z.number().int().optional(), month: z.number().int().optional(), day: z.number().int().optional(),
  weekday: z.number().int().optional(), hour: z.number().int(), minute: z.number().int(),
});
export type HolidayStart = z.infer<typeof Start>;

const Holiday = z.object({
  id: z.number().int(), name: z.string(), description: z.string().optional(),
  /** Hours it lasts; absent when the files give none. */
  hours: z.number().int().optional(),
  starts: z.array(Start),
});
export type ClientHoliday = z.infer<typeof Holiday>;

export const ClientHolidays = z.object({
  schema: z.literal(HOLIDAYS_SCHEMA),
  label: z.literal(CLIENT_LABEL),
  credit: z.string(),
  build: z.object({
    product: z.string(), buildId: z.number().int(), version: z.string(), buildConfig: z.string(),
    definitions: z.string().nullable(), extractedAt: z.string(),
  }),
  holidays: z.array(Holiday),
});
export type ClientHolidays = z.infer<typeof ClientHolidays>;

/** A packed client date as a start; null for 0 (no date). */
export function packedStart(v: number): HolidayStart | null {
  if (!v) return null;
  const minute = v & 63, hour = (v >> 6) & 31, weekday = (v >> 11) & 7, day = ((v >> 14) & 63) + 1, month = ((v >> 20) & 15) + 1, year = (v >> 24) & 31;
  if (month > 12 || day > 31) return { weekday, hour, minute };
  return { ...(year === 31 ? {} : { year: 2000 + year }), month, day, hour, minute };
}

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "");
const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => Number(x) || 0) : []);

export function buildClientHolidays(snapshotPath: string): ClientHolidays {
  const meta = readClientMeta(snapshotPath);
  const present = new Set(readClientTables(snapshotPath));
  const get = (t: string) => (present.has(t) ? readClientRows(snapshotPath, t) : new Map<number, Record<string, unknown>>());
  const names = get("HolidayNames"), descriptions = get("HolidayDescriptions");
  const holidays: ClientHolidays["holidays"] = [];
  for (const [id, row] of [...get("Holidays")].sort(([a], [b]) => a - b)) {
    const name = text(names.get(Number(row.HolidayNameID))?.Name_lang);
    if (!name || isDevelopmentItemName(name)) continue;
    const description = text(descriptions.get(Number(row.HolidayDescriptionID))?.Description_lang);
    const hours = nums(row.Duration)[0] ?? 0;
    const starts = nums(row.Date).map(packedStart).filter((s): s is HolidayStart => s !== null);
    holidays.push({ id, name, ...(description ? { description } : {}), ...(hours > 0 ? { hours } : {}), starts });
  }
  return ClientHolidays.parse({
    schema: HOLIDAYS_SCHEMA, label: CLIENT_LABEL, credit: GAME_DATA_CREDIT,
    build: { product: meta.product, buildId: meta.buildId, version: meta.version, buildConfig: meta.buildConfig, definitions: meta.definitions, extractedAt: meta.extractedAt },
    holidays,
  });
}

/** One holiday per line, so a new build's file reads as a line diff in review. */
export function serializeClientHolidays(table: ClientHolidays): string {
  const { holidays, ...head } = table;
  const top = JSON.stringify(head, null, 1).replace(/\n}$/, "");
  return `${top},\n "holidays": [\n${holidays.map((h) => `  ${JSON.stringify(h)}`).join(",\n")}\n ]\n}\n`;
}

/** Writes the table to `path` (the site's copy is web/src/data/game-data/client-holidays.json). */
export function writeClientHolidays(snapshotPath: string, path: string): ClientHolidays {
  const table = buildClientHolidays(snapshotPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeClientHolidays(table));
  return table;
}
