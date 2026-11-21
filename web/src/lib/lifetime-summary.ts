import { PLAY_HISTORY_RANKED, type PlayHistoryRankedKey } from "@kb/armory/details";
import type { ArmoryCharacter } from "./armory-store";

type Counts = Partial<Record<PlayHistoryRankedKey, number>>;
export interface LifetimeRow { name: string; surname: string; region: string; slug: string; values: Counts }
export interface LifetimeSummary {
  rows: LifetimeRow[];
  /** Each count summed over the characters that have it; absent when none does, never 0. */
  totals: Counts;
  /** How many characters each total covers. */
  counted: Record<PlayHistoryRankedKey, number>;
  /** Characters with any play history read. */
  read: number;
}

const KEYS = Object.keys(PLAY_HISTORY_RANKED) as PlayHistoryRankedKey[];

/** The owner's characters in the order given, and the lifetime totals of Blizzard's play history across them. */
export function lifetimeSummary(characters: readonly ArmoryCharacter[]): LifetimeSummary {
  const totals: Counts = {};
  const counted = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<PlayHistoryRankedKey, number>;
  let read = 0;
  const rows = characters.map((c) => {
    const values: Counts = { ...c.details?.playHistory?.ranked };
    if (c.details?.playHistory) read++;
    for (const k of KEYS) {
      const v = values[k];
      if (v === undefined) continue;
      totals[k] = (totals[k] ?? 0) + v;
      counted[k]++;
    }
    return { name: c.name, surname: c.surname, region: c.region, slug: c.slug, values };
  });
  return { rows, totals, counted, read };
}
