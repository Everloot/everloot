import { characterLinksOn, linkRealmKey } from "./character-links";
import { characterPath, showcaseOn } from "./character-showcase";

/**
 * Alts on a guild page: the other characters a member's player linked to the same account. A character is an alt
 * only when `character_link` rows prove it (the account typed a code in each character), and only while both
 * EVERLOOT_CHARACTER_LINKS and EVERLOOT_SHOWCASE are on. Off, nothing is read and no alt is shown.
 *
 * No public read groups linked characters by account yet: `public_character` answers one character at a time and
 * never names the account. Until the owner accepts a policy for alts and the database has such a read, `altReader`
 * stays empty and every guild page shows no alts, flags or not.
 */

/** One linked character as an account read returns it. No account id, key or hash is among it. */
export interface LinkedCharacter {
  name: string;
  realm: string;
  ruleset: string;
  class: string;
  level: number;
  status: "linked" | "frozen";
  /** The player's "Public page" switch for this character. */
  pagePublic: boolean;
}

/**
 * What a host lends the guild page: for some characters, the account groups that hold any of them, each as the
 * account's linked characters. A hidden character must already be left out, as `public_character` leaves it out.
 */
export interface AltReader {
  accountsOf(characters: readonly { realm: string; name: string }[]): Promise<LinkedCharacter[][]>;
}

/** The read the guild pages use. Null: there is none yet (see above). */
export const altReader: { current: AltReader | null } = { current: null };

export interface GuildAlt { name: string; realm: string; class: string; level: number; path: string }

export function guildAltsOn(env: Record<string, string | undefined> = process.env): boolean {
  return characterLinksOn(env) && showcaseOn(env);
}

export const memberKey = (realm: string, name: string) => `${linkRealmKey(realm)}\u0000${name.trim().toLowerCase()}`;

/** A character that may stand on a public page: linked, not frozen by a dispute, its page switched on. */
const shown = (c: LinkedCharacter) => c.status === "linked" && c.pagePublic;

/**
 * Each member's alts from the account groups: a member gets alts only when the member is itself a shown character
 * of the group, and only the group's other shown characters are listed.
 */
export function provenAlts(members: readonly { realm: string; name: string }[], accounts: readonly LinkedCharacter[][]): Map<string, GuildAlt[]> {
  const out = new Map<string, GuildAlt[]>();
  for (const m of members) {
    const key = memberKey(m.realm, m.name);
    const group = accounts.find((a) => a.some((c) => shown(c) && memberKey(c.realm, c.name) === key));
    if (!group) continue;
    const alts = group
      .filter((c) => shown(c) && memberKey(c.realm, c.name) !== key)
      .map((c) => ({ name: c.name, realm: c.realm, class: c.class, level: c.level, path: characterPath(c.ruleset, c.realm, c.name) }))
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    if (alts.length) out.set(key, alts);
  }
  return out;
}

/** The members' proven alts, or none: with either switch off, without a reader, or when the read fails. */
export async function loadGuildAlts(
  members: readonly { realm: string; name: string }[], env: Record<string, string | undefined> = process.env,
): Promise<Map<string, GuildAlt[]>> {
  const reader = altReader.current;
  if (!guildAltsOn(env) || !reader || members.length === 0) return new Map();
  try {
    return provenAlts(members, await reader.accountsOf(members));
  } catch {
    return new Map();
  }
}
