/**
 * The race table read from the game files (web/src/data/game-data/races.json, written by
 * `npm run kb -- client-races`): which races can be which class, on which faction, and their racial traits.
 * Blizzard's data, found in game files, unconfirmed, with the build. The class pages join it to RACES, the
 * article's table, by faction and name; race-traits.test.ts fails, naming the pair, if the two ever disagree.
 * The traits shown carry Blizzard's later racial pass on top (kb/src/racial-notes.ts), which the files do not yet.
 */
import racesJson from "@/data/game-data/races.json";
import { CLASSES, type ClassName } from "@/data/wow-forever";
import type { RaceTable } from "../../../kb/src/client-races";
import { RACIAL_NOTES, withRacialNotes, type NotedTrait } from "../../../kb/src/racial-notes";

export const RACE_TABLE = racesJson as RaceTable;
export type RaceTrait = NotedTrait;
export { RACIAL_NOTES };

/** The article calls both Skyborne races "Skyborne"; the files name each faction's own. */
const ARTICLE_NAME: Record<string, string> = { "High Order Skyborne": "Skyborne", "Windshaper Skyborne": "Skyborne" };

export const articleName = (gameName: string): string => ARTICLE_NAME[gameName] ?? gameName;

/** The files' race pairs in the article's shape: faction, then race name, then the classes in CLASSES order. */
export function gamePairs(table: RaceTable = RACE_TABLE): Record<string, Record<string, ClassName[]>> {
  const out: Record<string, Record<string, ClassName[]>> = {};
  for (const r of table.races) {
    const names = r.classes.map((c) => c.name);
    (out[r.faction] ??= {})[articleName(r.name)] = CLASSES.filter((c) => names.includes(c));
  }
  return out;
}

/** The race's traits in the client's order, or [] when the files have no such race on that faction. */
export function traitsFor(faction: string, race: string, table: RaceTable = RACE_TABLE): RaceTrait[] {
  return withRacialNotes(table).races.find((r) => r.faction === faction && articleName(r.name) === race)?.traits ?? [];
}
