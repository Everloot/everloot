import { armoryCharacterPath, armoryHidePath, classTokenOfName, regionLabel } from "./armory";
import type { ArmoryHit } from "./armory-store";
import { optOutPath, playerPath, type Player } from "./player-pages";
import { realmRegion } from "./realms";

/**
 * The rows of /players: characters the addon saw (the players table) and characters read from Blizzard's API (the
 * armory), one list. Both lookups are the existing readers; this only joins their answers.
 *
 * The players table holds first names only, so a sighting and an armory character are taken for the same character
 * only when nothing else could be: the same first name, the sighting's realm in the armory row's region, guilds that
 * do not disagree, and exactly one of each on that name and region in this answer. Then the row links the armory page,
 * which carries the addon's last-seen line itself. Anything less certain stays two rows.
 */

export type LookupSource = "addon" | "armory";

export interface LookupRow {
  key: string;
  name: string;
  href: string;
  /** Where the row came from; both when a sighting and an armory character were joined. */
  sources: LookupSource[];
  /** A class token (WARRIOR), as the players table spells it. */
  classToken: string;
  race: string;
  level: number;
  guild: string | null;
  where: string;
  /** The day the addon last saw the character; null for an armory row alone. */
  lastSeen: string | null;
  /** The form that hides this row's character: the armory's for an armory row, the players table's otherwise. */
  hideHref: string;
}

export const SOURCE_LABEL: Record<LookupSource, string> = { addon: "Seen by the addon", armory: "Blizzard profile" };

const fold = (s: string) => s.normalize("NFC").toLowerCase();
const sameGuild = (a: string | null, b: string | null) => a === null || b === null || fold(a) === fold(b);
const joinKey = (name: string, region: string) => `${fold(name)}|${region}`;

function addonRow(p: Player): LookupRow {
  return {
    key: `addon/${p.ruleset}/${p.realm}/${p.name}`, name: p.name, href: playerPath(p), sources: ["addon"], classToken: p.class, race: p.race,
    level: p.level, guild: p.guild, where: p.realm, lastSeen: p.lastSeen, hideHref: optOutPath(p),
  };
}

function armoryRow(h: ArmoryHit, seen: Player | null): LookupRow {
  return {
    key: `armory/${h.region}/${h.slug}`, name: `${h.name} ${h.surname}`, href: armoryCharacterPath(h.region, h.slug),
    sources: seen ? ["addon", "armory"] : ["armory"], classToken: classTokenOfName(h.class), race: h.race, level: h.level,
    guild: h.guildName, where: `${regionLabel(h.region)} ${h.ruleset}`, lastSeen: seen?.lastSeen ?? null, hideHref: armoryHidePath(h),
  };
}

/** The fields the rule reads: a sighting's first name, realm and guild; an armory character's first name, region and guild. */
type Sighting = { name: string; realm: string; guild?: string | null };
type Read = { name: string; region: string; guildName?: string | null };

/**
 * The pairs the rule at the top joins: each sighting that is certainly one armory character, with that character. Both
 * answers must hold every character with the name (an answer cut at its cap decides nothing; the caller checks that).
 * The search, the /players list and the one-page redirect of /characters all read this.
 */
export function sightingPairs<P extends Sighting, H extends Read>(players: readonly P[], hits: readonly H[]): Map<P, H> {
  const count = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const playerKeys = players.map((p) => { const region = realmRegion(p.realm); return region ? joinKey(p.name, region) : null; });
  const playerCount = count(playerKeys.filter((k): k is string => k !== null));
  const hitCount = count(hits.map((h) => joinKey(h.name, h.region)));
  const pairs = new Map<P, H>();
  for (const h of hits) {
    const key = joinKey(h.name, h.region);
    const i = playerKeys.indexOf(key);
    if (i >= 0 && playerCount.get(key) === 1 && hitCount.get(key) === 1 && sameGuild(players[i]!.guild ?? null, h.guildName ?? null)) pairs.set(players[i]!, h);
  }
  return pairs;
}

/** One list from both answers, in name order; a joined pair is one row (see the notes at the top). */
export function mergeLookup(players: readonly Player[], hits: readonly ArmoryHit[]): LookupRow[] {
  const pairs = sightingPairs(players, hits);
  const seenBy = new Map([...pairs].map(([p, h]) => [h, p]));
  const rows = hits.map((h) => armoryRow(h, seenBy.get(h) ?? null));
  rows.push(...players.filter((p) => !pairs.has(p)).map(addonRow));
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.where.localeCompare(b.where));
}
