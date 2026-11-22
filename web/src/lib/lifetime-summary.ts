import { PLAY_HISTORY_RANKED, type PlayHistoryRankedKey } from "@kb/armory/details";
import { armoryCharacterPath } from "./armory";
import type { ArmoryCharacter } from "./armory-store";

type Counts = Partial<Record<PlayHistoryRankedKey, number>>;
/** The addon's gold statistics the summary carries, in copper: 328 total gold acquired, 334 most gold ever owned. */
export type GoldStat = "328" | "334";
export type GoldValues = Partial<Record<GoldStat, number>>;
export interface LifetimeRow { name: string; surname: string; region: string; slug: string; values: Counts; gold: GoldValues }
export interface LifetimeSummary {
  rows: LifetimeRow[];
  /** Each count summed over the characters that have it; absent when none does, never 0. */
  totals: Counts;
  /** How many characters each total covers. */
  counted: Record<PlayHistoryRankedKey, number>;
  /** Characters with any play history read. */
  read: number;
  /** 328 summed, 334 the largest of any one character (never a sum); absent when no character reports it. */
  goldTotals: GoldValues;
  /** Characters with a gold fact. */
  goldReported: number;
}

const KEYS = Object.keys(PLAY_HISTORY_RANKED) as PlayHistoryRankedKey[];

/**
 * The owner's characters in the order given, and the lifetime totals of Blizzard's play history across them. `gold` is
 * the addon's synced statistics per character, keyed by the character's armory path; a character missing from it has
 * no gold values. Gold is only shown to its owner here, never ranked.
 */
export function lifetimeSummary(characters: readonly ArmoryCharacter[], gold?: ReadonlyMap<string, Record<string, number>>): LifetimeSummary {
  const totals: Counts = {};
  const counted = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<PlayHistoryRankedKey, number>;
  const goldTotals: GoldValues = {};
  let read = 0;
  let goldReported = 0;
  const rows = characters.map((c) => {
    const values: Counts = { ...c.details?.playHistory?.ranked };
    if (c.details?.playHistory) read++;
    for (const k of KEYS) {
      const v = values[k];
      if (v === undefined) continue;
      totals[k] = (totals[k] ?? 0) + v;
      counted[k]++;
    }
    const stats = gold?.get(armoryCharacterPath(c.region, c.slug));
    if (stats) goldReported++;
    const own: GoldValues = {};
    const acquired = stats?.["328"], most = stats?.["334"];
    if (acquired !== undefined) { own["328"] = acquired; goldTotals["328"] = (goldTotals["328"] ?? 0) + acquired; }
    if (most !== undefined) { own["334"] = most; goldTotals["334"] = Math.max(goldTotals["334"] ?? 0, most); }
    return { name: c.name, surname: c.surname, region: c.region, slug: c.slug, values, gold: own };
  });
  return { rows, totals, counted, read, goldTotals, goldReported };
}
