import { unstable_cache } from "next/cache";
import { className, PLAYER_SEARCH_TAG } from "@/app/players/player-view";
import { GUILD_SEARCH_TAG, guildPath, guildSearchPrefix, guildsOn, loadGuildSearch } from "./guilds";
import { playerPagesOn, playerPath, searchPrefix } from "./player-pages";
import { playerStore } from "./player-store";

/**
 * Characters and guilds for the site's own search (/search and the header type-ahead), from the same lookups
 * /players and /guilds run. Answered only by /search/people, which no CDN or browser keeps: a hide clears the
 * caches below at once (the hide routes revalidate both tags), and a response kept anywhere else would not be.
 */

/** One search per name prefix is kept five minutes; /players reads the same entries. */
export const searchPlayers = unstable_cache((prefix: string) => playerStore().search(prefix), ["player-search"], { revalidate: 300, tags: [PLAYER_SEARCH_TAG] });

/**
 * One guild search per prefix, kept five minutes. Unreachable storage throws, and so does an answer missing the players
 * table's guilds, so neither is kept (/guilds still shows such an answer, read fresh). A guild hide clears it; so does a
 * character hide, as the members-seen count comes from the players table.
 */
const searchGuildsKept = unstable_cache(async (prefix: string) => {
  const found = await loadGuildSearch(prefix);
  if (found.unreachable) throw new Error("guild storage unreachable");
  if (found.partial) throw new Error("players table unreachable for the guild search");
  return found.results;
}, ["site-guild-search"], { revalidate: 300, tags: [GUILD_SEARCH_TAG, PLAYER_SEARCH_TAG] });

/** A character or guild row: `meta` is the short line under or beside the name. */
export interface PersonResult { type: "character" | "guild"; label: string; href: string; meta: string; exact: boolean }
/**
 * `total` counts what the lookup returned; `capped` says it stopped at its 25 and there may be more (shown "25+",
 * as /players says "The first 25"). `results` holds the first `limit`.
 */
export interface PersonGroup { results: PersonResult[]; total: number; capped: boolean }
export interface PeopleSearch { characters: PersonGroup; guilds: PersonGroup }

const EMPTY: PersonGroup = { results: [], total: 0, capped: false };
export const PEOPLE_LIMIT = 8;
/** The PEOPLE_SEARCH_LIMIT binding in web/wrangler.jsonc: lookups per address per minute on /search/people. */
export const PEOPLE_PER_MINUTE = 60;
/** The most rows either lookup returns: the players store's search limit, and kb's searchGuilds default. */
const LOOKUP_CAP = 25;

/** Exact names first, then the lookup's own order; the first `limit`. */
function group(rows: PersonResult[], limit: number): PersonGroup {
  const sorted = [...rows].sort((a, b) => Number(b.exact) - Number(a.exact));
  return { results: sorted.slice(0, limit), total: rows.length, capped: rows.length >= LOOKUP_CAP };
}

/**
 * Characters whose name starts with the text (switch on, 2 to 12 letters) and guilds whose name does (switch on, 2 to
 * 24 characters). A lookup that fails leaves its group empty; the other still answers.
 */
export async function peopleSearch(raw: string, limit = PEOPLE_LIMIT): Promise<PeopleSearch> {
  const text = raw.trim().slice(0, 40);
  const q = text.toLowerCase();
  const name = playerPagesOn() ? searchPrefix(text) : null;
  const guild = guildsOn() ? guildSearchPrefix(text) : null;
  const [characters, guilds] = await Promise.all([
    name ? orEmpty(async () => (await searchPlayers(name.toLowerCase())).map((p) => ({
      type: "character" as const, label: p.name, href: playerPath(p), meta: `Level ${p.level} ${className(p.class)} · ${p.realm}`, exact: p.name.toLowerCase() === q,
    })), limit) : EMPTY,
    guild ? orEmpty(async () => (await searchGuildsKept(guild.toLowerCase())).map((g) => ({
      type: "guild" as const, label: g.guildName, href: guildPath(g.realm, g.guildName),
      meta: g.membersSeen === null ? g.realm : `${g.realm} · ${g.membersSeen.toLocaleString("en-US")} ${g.membersSeen === 1 ? "member" : "members"} seen`,
      exact: g.guildName.toLowerCase() === q,
    })), limit) : EMPTY,
  ]);
  return { characters, guilds };
}

async function orEmpty(read: () => Promise<PersonResult[]>, limit: number): Promise<PersonGroup> {
  try { return group(await read(), limit); } catch (err) { console.error("site search: character or guild lookup failed", err); return EMPTY; }
}
