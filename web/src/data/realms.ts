/**
 * Which ruleset and region each WoW: Forever realm belongs to. Forever's realm names end in their ruleset
 * ("CAMWOW US1 Realm 4 PvP"), and a realm named that way is filed by its name without a line here
 * (../lib/realms.ts `rulesetFromName`). Add a line only for a realm whose name does not say its ruleset, or says it
 * wrongly, exactly as the game spells it (docs/LAUNCH_DAY.md, "Filling the realm map"); a line here wins over the
 * name. A realm neither names nor lists stays in the one "forever" view and is never guessed into a ruleset.
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
