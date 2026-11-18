/**
 * The answer of /search/people, apart from people-search.ts so the browser components that read it import no
 * storage code, and nothing that imports them reaches the armory store.
 */

/** A character or guild row: `meta` is the short line under or beside the name. */
export interface PersonResult { type: "character" | "guild"; label: string; href: string; meta: string; exact: boolean }
/**
 * `total` counts what the lookup returned; `capped` says it stopped at its 25 and there may be more (shown "25+",
 * as /players says "The first 25"). `results` holds the first `limit`.
 */
export interface PersonGroup { results: PersonResult[]; total: number; capped: boolean }
export interface PeopleSearch { characters: PersonGroup; guilds: PersonGroup }
