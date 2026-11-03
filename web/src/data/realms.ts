/**
 * Which ruleset and region each WoW: Forever realm belongs to. Blizzard has not named the realms yet, so this list
 * is empty until launch (docs/LAUNCH_DAY.md, "Filling the realm map"). Add one line per realm exactly as the game
 * spells it; the pages read the rest from here. A realm not listed stays in the one "forever" view, as before, and
 * is never guessed into a ruleset.
 */

/** The rulesets' URL segments, in the order of `RULESETS` in ./wow-forever-launch.ts. */
export const RULESET_SLUGS = ["normal", "pvp", "rp", "rp-pvp", "hardcore"] as const;
export type RulesetSlug = (typeof RULESET_SLUGS)[number];

export const REGIONS = ["us", "eu", "kr", "tw"] as const;
export type Region = (typeof REGIONS)[number];

export interface RealmEntry {
  /** The realm's name as the game shows it, e.g. "Mal'Ganis". */
  name: string;
  ruleset: RulesetSlug;
  region: Region;
}

export const REALMS: readonly RealmEntry[] = [
  // { name: "Example Realm", ruleset: "pvp", region: "us" },
];
