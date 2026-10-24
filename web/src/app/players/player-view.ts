import type { Metadata } from "next";
import { CENSUS_CLASSES, CENSUS_RACES } from "../../../../kb/src/census";
import { CLASSES } from "@/design/tokens";
import { playerIndexingOn, type Player } from "@/lib/player-pages";

/** The cache tag the search results carry; recording an opt-out clears it. */
export const PLAYER_SEARCH_TAG = "players";

const CLASS_NAME = new Map<string, string>(CENSUS_CLASSES.map((c) => [c.token, c.name]));
const RACE_NAME = new Map<string, string>(CENSUS_RACES.map((r) => [r.token, r.name]));

export const className = (token: string) => CLASS_NAME.get(token) ?? token;
export const raceName = (token: string) => RACE_NAME.get(token) ?? token;

/** The class colour for a store token such as "HUNTER"; plain text for a class the tokens do not know. */
export function classText(token: string): string {
  const slug = token.toLowerCase();
  return (CLASSES as readonly string[]).includes(slug) ? `text-class-${slug}` : "text-fg";
}

/** What a player page tells about a character, said once wherever the pages are offered. */
export const PLAYER_PAGE_SHOWS = "Race, class, level, guild and the day the addon last saw them. Nothing else.";

/** The sentence a player page shows when the store cannot answer. */
export const PLAYER_STORAGE_UNAVAILABLE = "Player storage is unreachable right now. The character may still be there; try again in a moment.";

/** "Level 24 Orc Shaman". */
export const describePlayer = (p: Pick<Player, "level" | "race" | "class">) => `Level ${p.level} ${raceName(p.race)} ${className(p.class)}`;

/** Player pages stay out of search engines until EVERLOOT_PLAYER_PAGES_INDEX=1; a search result page always does. */
export function playerRobots(alwaysNoindex = false): Metadata["robots"] {
  return alwaysNoindex || !playerIndexingOn() ? { index: false, follow: false } : { index: true, follow: true };
}
