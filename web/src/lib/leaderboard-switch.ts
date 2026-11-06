import { characterLinksOn } from "./character-links";
import { showcaseOn } from "./character-showcase";
import { privateSyncOn } from "./private-sync";

/** The gear boards (leaderboards.ts): EVERLOOT_LEADERBOARDS=1, with the character pages and private sync on too. */
export function leaderboardsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_LEADERBOARDS === "1" && characterLinksOn(env) && showcaseOn(env) && privateSyncOn(env);
}
