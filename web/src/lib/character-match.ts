import { armoryOn } from "./armory";
import { armoryStore, type ArmoryCharacter, type ArmoryHit } from "./armory-store";
import { sightingPairs } from "./character-lookup";
import { playerPagesOn, type Player } from "./player-pages";
import { playerStore } from "./player-store";

/**
 * One page per character: a sighting (the players table, first names only) and an armory character are one character
 * under the rule in ./character-lookup.ts (the same first name, the sighting's realm in the armory region, guilds that do
 * not disagree, exactly one of each). Then /characters/<ruleset>/<realm>/<name> redirects to the armory page, and the
 * armory page shows what the addon saw. Hidden rows never reach either read, so a hide on one side ends the match.
 */

/** The armory search's ask, its own cap; the players search returns 25 at most. A full answer decides nothing. */
const ARMORY_ASK = 100;
const PLAYERS_CAP = 25;

/** Everyone with the name on both sides, or null when an answer reached its cap (a namesake may be missing). */
async function namesakes(name: string): Promise<{ players: Player[]; hits: ArmoryHit[] } | null> {
  const [players, hits] = await Promise.all([playerStore().search(name.toLowerCase()), armoryStore().search(name, ARMORY_ASK)]);
  return players.length >= PLAYERS_CAP || hits.length >= ARMORY_ASK ? null : { players, hits };
}

const same = (a: string, b: string) => a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();

/** The armory character a sighting certainly is, or null (armory off, unsure, or storage out of reach). */
export async function armoryMatch(seen: Player): Promise<ArmoryHit | null> {
  if (!armoryOn()) return null;
  try {
    const found = await namesakes(seen.name);
    const mine = found?.players.find((p) => p.realm === seen.realm && same(p.name, seen.name));
    return found && mine ? sightingPairs(found.players, found.hits).get(mine) ?? null : null;
  } catch {
    return null;
  }
}

/** The sighting an armory character certainly is, or null (player pages off, unsure, or storage out of reach). */
export async function addonSighting(c: Pick<ArmoryCharacter, "region" | "slug" | "name">): Promise<Player | null> {
  if (!playerPagesOn()) return null;
  try {
    const found = await namesakes(c.name);
    if (!found) return null;
    for (const [p, h] of sightingPairs(found.players, found.hits)) if (h.region === c.region && h.slug === c.slug) return p;
    return null;
  } catch {
    return null;
  }
}
