/**
 * The licence and credit line for Everloot's own data, in one place. The site's JSON APIs, the MCP
 * answers built on player data, the docs and docs/DATA_POLICY.md all use these words.
 * Game-file data and Blizzard's text are not under this licence and do not get this line.
 */
export const SITE = "https://everloot.app";
export const LICENCE = "CC BY-SA 4.0";
export const LICENCE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
export const CREDIT_LINE = `Data from Everloot (${SITE}), ${LICENCE}.`;
/** Where the rules for reuse are written out for people. */
export const TERMS_URL = `${SITE}/terms#licences`;
/** What game-file facts carry instead of our licence (docs/DATA_POLICY.md, "The client layer"). */
export const GAME_DATA_CREDIT = "Game data © Blizzard Entertainment, Inc., read from the public client; not under Everloot's licence. "
    + "Column names from WoWDBDefs (https://github.com/wowdev/WoWDBDefs), CC BY-SA 4.0.";
/**
 * The licence and credit of the player data the MCP tools answer from, as the methodology resource states
 * it: a plain statement of fact, no instruction. Answers do not end with it; they end with the data's age
 * and link their page (TOOL_OUTPUT in mcp.ts), and the credit travels in the response headers.
 */
export const MCP_CREDIT = `Licence: ${LICENCE}. Credit: Everloot contributors, ${SITE}`;
