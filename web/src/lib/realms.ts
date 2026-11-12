import { REALMS, REGIONS, RULESET_SLUGS, type RealmEntry, type Region, type RulesetSlug } from "../data/realms";

/**
 * The realm map (../data/realms.ts) as the pages read it: which ruleset and region a realm is on. A realm the map
 * does not list answers null here and "forever" from `realmRuleset`, the one view every realm had before launch.
 */

export const DEFAULT_RULESET = "forever";

/**
 * The tab names, also the words beside a realm's name: "Roleplaying" is "RP" so the five fit a phone, and Normal
 * is "PvE", as players call it.
 */
export const RULESET_LABEL: Record<RulesetSlug, string> = {
  normal: "PvE", pvp: "PvP", rp: "RP", "rp-pvp": "RP-PvP", hardcore: "Hardcore",
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
 * The last word of a realm's name, as Forever's realm list ends each name ("CAMWOW US1 Realm 4 PvP"). RP-PvP may be
 * one word ("CAMWOW US1 Realm 9 RPPVP" in the list players copied).
 */
const NAME_ENDINGS: readonly [RegExp, RulesetSlug][] = [
  [/[\s-]rp[\s-]?pvp$/i, "rp-pvp"], [/[\s-]pvp$/i, "pvp"], [/[\s-](pve|normal)$/i, "normal"],
  [/[\s-]rp$/i, "rp"], [/[\s-]hardcore$/i, "hardcore"],
];

/**
 * The ruleset a realm's own name ends in, or null. Forever names its realms with their ruleset last, the way the
 * game's realm list splits them.
 */
export function rulesetFromName(realm: string): RulesetSlug | null {
  const name = realm.trim();
  return NAME_ENDINGS.find(([ending]) => ending.test(name))?.[1] ?? null;
}

/**
 * A realm's name split as the pages show it: the name without the ruleset it ends in, and the ruleset (the map's,
 * else the name's), or the whole name and null. "CAMWOW US1 Realm 4 PvP" is "CAMWOW US1 Realm 4" and pvp.
 */
export function realmParts(realm: string): { base: string; ruleset: RulesetSlug | null } {
  const name = realm.trim();
  const ending = NAME_ENDINGS.find(([pattern]) => pattern.test(name))?.[0];
  const base = ending ? name.replace(ending, "") : name;
  return { base, ruleset: realmInfo(name)?.ruleset ?? rulesetFromName(name) };
}

/**
 * The ruleset a realm's prices are grouped under: the map's, else the one its name ends in, else "forever". Never a
 * guess. Player, guild and character-link addresses do not read this; they stay on "forever" (player-pages
 * `rulesetOf`) until a migration moves the stored rows, so filing a realm never splits a player into two rows.
 */
export function realmRuleset(realm: string): string {
  return realmInfo(realm)?.ruleset ?? rulesetFromName(realm) ?? DEFAULT_RULESET;
}

/**
 * The region a realm is in: the map's, else the region code its name carries ("CAMWOW US1 Realm 4 PvP" is us), else
 * null. Never a guess from anything else.
 */
export function realmRegion(realm: string): Region | null {
  const named = /(?:^|\s)(us|eu|kr|tw)\d*(?:\s|$)/i.exec(realm.trim())?.[1]?.toLowerCase();
  return realmInfo(realm)?.region ?? (named as Region | undefined) ?? null;
}

export type RegionFilter = Region | "unknown";
export const REGION_LABEL: Record<RegionFilter, string> = { us: "US", eu: "EU", kr: "KR", tw: "TW", unknown: "Unknown region" };

/** Missing or empty means all regions; unrecognized values are rejected. */
export function regionParam(raw: string | undefined): RegionFilter | null | undefined {
  if (raw === undefined || raw === "") return null;
  return raw === "unknown" || (REGIONS as readonly string[]).includes(raw) ? raw as RegionFilter : undefined;
}

export const inRegion = (realm: string, region: RegionFilter | null | undefined): boolean =>
  !region || (realmRegion(realm) ?? "unknown") === region;

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
