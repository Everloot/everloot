import { CENSUS_RACES } from "../../../../../../../kb/src/census";
import { guildSlug, type GuildProgress } from "../../../../../../../kb/src/guilds";
import { memberKey } from "@/lib/guild-alts";
import { guildPath, guildsOn, loadGuildPage, type GuildMember } from "@/lib/guilds";
import type { Player } from "@/lib/player-pages";
import { memberCountLine } from "@/app/guilds/parts";

/**
 * The guild part of a character's page: the guild the addon last saw the character in, as that guild's own page
 * shows it. The guild's agreed kills are the guild's progress, never this character's attendance; the guildmates are
 * player rows, each public on its own page, grouped by the guild the game showed (DATA_POLICY, guild pages). Read
 * only with the guild pages on, and only for a sighting: the owner's showcase names no guild in this version.
 */

/** Under the guild's facts: whose they are, and what they are not. */
export const GUILD_LINE = "The guild as its own page shows it. A kill counts once two members' uploads report it, or when the guild's officers publish it: it is the guild's progress, not a record of this character's attendance.";
/** Under the class links: the same pages for everyone, not read from this character. */
export const PLAN_LINE = "Everloot's pages for this class at this level. They are the same for every character of the class, not read from this one.";

/** How many other characters seen in the guild the page lists; the guild's page lists them all. */
export const GUILDMATES_SHOWN = 8;

/**
 * The officers' facts about this one character: its rank on their roster, the loot they gave it and whether it was at
 * their last raid. Each is public on the guild's page today; gathering them on the character's page is a new place
 * for a name, so it waits on its own switch (off) until the owner accepts the wording for it.
 */
export function characterGuildFactsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_CHARACTER_GUILD_FACTS === "1";
}

export interface Guildmate { name: string; class: string; level: number; lastSeen: string | null; path: string }

export interface OfficerFacts {
  rank: string | null;
  loot: { itemId: number; sourceBoss: string }[];
  /** On the officers' list of who was at their last raid. */
  present: boolean;
}

export interface CharacterGuild {
  guildName: string;
  realm: string;
  path: string;
  /** "42 members", "12 on the officers' roster" or "5 characters seen"; null with none. */
  members: string | null;
  progression: GuildProgress[];
  /** Up to GUILDMATES_SHOWN other characters seen in the guild, newest sighting first. */
  guildmates: Guildmate[];
  /** Every other character the guild's page lists. */
  guildmatesTotal: number;
  /** Null with the switch off, with no officer board, or when the hidden characters could not be read. */
  officer: OfficerFacts | null;
  dataAsOf: string | null;
}

/** The side a race plays on, or null for a race on both (Skyborne) or one the census does not know. */
export function raceFaction(race: string): "Alliance" | "Horde" | null {
  const sides = new Set<string>(CENSUS_RACES.filter((r) => r.token === race).map((r) => r.faction));
  return sides.size === 1 ? ([...sides][0] as "Alliance" | "Horde") : null;
}

const newestFirst = (a: GuildMember, b: GuildMember) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.name.localeCompare(b.name);

/**
 * The sighted character's guild, null when there is none to show (no guild seen, the guild pages off, or the guild
 * hidden or unknown), or "unreachable" when the guild data could not be read. Never a throw.
 */
export async function characterGuild(seen: Player, factsOn: boolean = characterGuildFactsOn()): Promise<CharacterGuild | null | "unreachable"> {
  if (!guildsOn() || !seen.guild) return null;
  let loaded: Awaited<ReturnType<typeof loadGuildPage>>;
  try {
    loaded = await loadGuildPage(guildSlug(seen.realm), guildSlug(seen.guild));
  } catch {
    return "unreachable";
  }
  if (loaded === "unreachable") return "unreachable";
  if (loaded === null) return null;
  const { page, board, members } = loaded;
  const self = memberKey(seen.realm, seen.name);
  const me = members.find((m) => memberKey(m.realm, m.name) === self) ?? null;
  const others = members.filter((m) => memberKey(m.realm, m.name) !== self);
  const lower = seen.name.trim().toLowerCase();
  const officer: OfficerFacts | null = factsOn && board && !loaded.namesWithheld
    ? {
      rank: me?.rank ?? null,
      loot: board.loot.filter((l) => l.recipient.trim().toLowerCase() === lower).map((l) => ({ itemId: l.itemId, sourceBoss: l.sourceBoss })),
      present: board.present.some((n) => n.trim().toLowerCase() === lower),
    }
    : null;
  return {
    guildName: page.summary.guildName,
    realm: page.summary.realm,
    path: guildPath(page.summary.realm, page.summary.guildName),
    members: memberCountLine(board, members.length),
    progression: page.progression,
    guildmates: others
      .filter((m): m is GuildMember & { path: string } => m.path !== null)
      .sort(newestFirst)
      .slice(0, GUILDMATES_SHOWN)
      .map((m) => ({ name: m.name, class: m.class, level: m.level, lastSeen: m.lastSeen, path: m.path })),
    guildmatesTotal: others.length,
    officer,
    dataAsOf: loaded.dataAsOf,
  };
}
