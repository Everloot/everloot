export type Game = "retail" | "classic" | "classic1x" | "forever";
export type NsKind = "static" | "dynamic" | "profile";
export type Region = "us" | "eu" | "kr" | "tw";

/**
 * Battle.net namespace for a game version. Checked 2026-09-30 with a working client:
 * retail profile and classic1x static returned 200, including a guild profile's member count.
 * Forever's names returned 403 then; checked again 2026-11-06 with the Everloot client, they answer 200 in US and
 * EU: static-forever (items, classes), dynamic-forever (/data/wow/ruleset/index, auction houses) and
 * profile-forever (characters by name-surname, guilds and rosters). Forever has no realm index: rulesets replace
 * realms.
 */
export function namespace(game: Game, kind: NsKind, region: Region): string {
  switch (game) {
    case "retail":
      return `${kind}-${region}`;
    case "classic":
      return `${kind}-classic-${region}`;
    case "classic1x":
      return `${kind}-classic1x-${region}`;
    case "forever":
      return `${kind}-forever-${region}`;
    default: {
      const check: never = game;
      throw new Error(`unknown game version: ${check}`);
    }
  }
}
