/**
 * The guild ladder's switches (docs/design/specs/2026-10-24-guild-board-design.md, section 8), apart from
 * lib/guilds.ts so the layout can read them without loading the guild data.
 */

/** The owner's switch for the guild ladder, the guild pages, the hide form, the guild tools and the guild links elsewhere. */
export function guildsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_GUILDS === "1";
}

/** A second switch: guild pages carry `noindex` until EVERLOOT_GUILDS_INDEX=1, like player pages. */
export function guildIndexingOn(env: Record<string, string | undefined> = process.env): boolean {
  return guildsOn(env) && env.EVERLOOT_GUILDS_INDEX === "1";
}