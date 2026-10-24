import { MCP_TOOL_NAMES, type McpToolName } from "@everloot/protocol";

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
/** The guild ladder's two MCP tools: listed and answered only while EVERLOOT_GUILDS is on. */
export const GUILD_TOOL_NAMES: readonly McpToolName[] = ["guild_search", "guild_rankings"];

/**
 * The tools the site's MCP mounts list today, in the protocol's order: the docs, llms.txt and the OpenAPI file name
 * these, so they never advertise a tool the server would refuse. The protocol's table keeps every tool.
 */
export function liveToolNames(env: Record<string, string | undefined> = process.env): McpToolName[] {
  return MCP_TOOL_NAMES.filter((name) => guildsOn(env) || !GUILD_TOOL_NAMES.includes(name));
}
