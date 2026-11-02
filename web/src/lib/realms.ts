import { REALMS, RULESET_SLUGS, type RealmEntry, type Region, type RulesetSlug } from "../data/realms";

/**
 * The realm map (../data/realms.ts) as the pages read it: which ruleset and region a realm is on. A realm the map
 * does not list answers null here and "forever" from `realmRuleset`, the one view every realm had before launch.
 */

export const DEFAULT_RULESET = "forever";

/** The tab names; "Roleplaying" is "RP" so the five fit a phone. */
export const RULESET_LABEL: Record<RulesetSlug, string> = {
  normal: "Normal", pvp: "PvP", rp: "RP", "rp-pvp": "RP-PvP", hardcore: "Hardcore",
};

/** Rulesets that open after launch; their tab shows only once a realm is mapped to one. */
export const AFTER_LAUNCH: ReadonlySet<RulesetSlug> = new Set(["hardcore"]);

/**
 * The key a realm name is matched on: lower case, apostrophes dropped, spaces and hyphens one space. So "Mal'Ganis",
 * "mal’ganis", "malganis" and the character links' key "mal'ganis" are one realm, as are "Argent Dawn" and "argent-dawn".
 */
export function realmMapKey(name: string): string {
  return name.toLowerCase().replace(/['’]/g, "").replace(/[\s-]+/g, " ").trim();
}

export interface RealmInfo { ruleset: RulesetSlug; region: Region }

export function realmMap(entries: readonly RealmEntry[]): ReadonlyMap<string, RealmInfo> {
  return new Map(entries.map((r) => [realmMapKey(r.name), { ruleset: r.ruleset, region: r.region }]));
}

const MAP = realmMap(REALMS);

/** The realm's ruleset and region, or null while the map does not list it. */
export function realmInfo(realm: string): RealmInfo | null {
  return MAP.get(realmMapKey(realm)) ?? null;
}

/**
 * The ruleset a realm's prices are grouped under: the map's, else "forever". Never a guess. Player, guild and
 * character-link addresses do not read this; they stay on "forever" (player-pages `rulesetOf`) until a migration
 * moves the stored rows, so mapping a realm never splits a player into two rows.
 */
export function realmRuleset(realm: string): string {
  return realmInfo(realm)?.ruleset ?? DEFAULT_RULESET;
}

/** Rulesets with at least one realm mapped to them. */
export function mappedRulesets(): Set<RulesetSlug> {
  return new Set([...MAP.values()].map((r) => r.ruleset));
}

export const isRulesetSlug = (s: string): s is RulesetSlug => (RULESET_SLUGS as readonly string[]).includes(s);

/** `?ruleset=pvp`: the ruleset; absent: null (every realm); anything else: undefined (not a ruleset). */
export function rulesetParam(raw: string | undefined): RulesetSlug | null | undefined {
  if (raw === undefined || raw === "") return null;
  return isRulesetSlug(raw) ? raw : undefined;
}

export { RULESET_SLUGS, type RulesetSlug };
