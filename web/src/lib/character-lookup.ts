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

/** One list from both answers, in name order; a joined pair is one row (see the notes at the top). */
export function mergeLookup(players: readonly Player[], hits: readonly ArmoryHit[]): LookupRow[] {
  const count = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const playerKeys = players.map((p) => { const region = realmRegion(p.realm); return region ? joinKey(p.name, region) : null; });
  const playerCount = count(playerKeys.filter((k): k is string => k !== null));
  const hitCount = count(hits.map((h) => joinKey(h.name, h.region)));
  const joined = new Set<Player>();
  const rows = hits.map((h) => {
    const key = joinKey(h.name, h.region);
    const i = playerKeys.indexOf(key);
    const seen = i >= 0 && playerCount.get(key) === 1 && hitCount.get(key) === 1 && sameGuild(players[i]!.guild, h.guildName) ? players[i]! : null;
    if (seen) joined.add(seen);
    return armoryRow(h, seen);
  });
  rows.push(...players.filter((p) => !joined.has(p)).map(addonRow));
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.where.localeCompare(b.where));
}
