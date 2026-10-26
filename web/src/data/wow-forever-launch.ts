import { LAUNCH_AT } from "./wow-forever";

/**
 * The launch-week facts on /wow-forever and the Blizzard post each one comes from. A post is named by its
 * stored id in kb/changes/blue-posts.json; the page links its page under /changes. wow-forever-launch.test.ts
 * reads that file and checks the title and the words each date rests on, so a fact cannot outlive its source.
 * Anything a post does not say (start times, who is eligible) is not here.
 */

export interface BluePostRef {
  /** The id in kb/changes/blue-posts.json. */
  id: string;
  title: string;
  /** What the stored excerpt must still say for the fact it backs to stand. */
  says: readonly string[];
}

export const POSTS = {
  names: { id: "forum:30553826", title: "Claim Your World of Warcraft: Forever Character Names", says: ["October 27 through November 3", "up to three characters"] },
  raids: { id: "forum:30552119", title: "World of Warcraft: Forever Raid Overview—Locations, Raid Sizes, and Attunement", says: ["Barrow Deeps, Hyjal Summit, and Onyx", "on December 9", "Drakefire Amulet"] },
  betaClosed: { id: "forum:30590866", title: "Thank You For Testing the WoW Forever Beta", says: ["The WoW Forever Beta is now closed"] },
} as const satisfies Record<string, BluePostRef>;

/** Everloot's own explainer of Blizzard's ruleset article; it carries the ruleset facts below. */
export const RULESETS_POST = {
  path: "/news/wow-forever-rulesets-explained-pvp-rp-pvp-hardcore",
  slug: "wow-forever-rulesets-explained-pvp-rp-pvp-hardcore",
  blizzardTitle: "Choose Your Ruleset in World of Warcraft: Forever",
  blizzardUrl: "https://news.blizzard.com/en-us/article/24302070/updated-10-22-choose-your-ruleset-in-world-of-warcraft-forever",
} as const;

/** The dates Blizzard's posts give, as ISO days. */
export const DATES = {
  namesOpen: "2026-10-27",
  namesClose: "2026-11-03",
  betaClosed: "2026-10-23",
  raids: "2026-12-09",
} as const;

export const RULESETS: readonly { name: string; what: string; when: string }[] = [
  { name: "Normal", what: "The baseline game. PvP happens when you opt in.", when: "At launch" },
  { name: "PvP", what: "Contested zones are dangerous. Characters here can be one faction only.", when: "At launch" },
  { name: "Roleplaying", what: "For players who want to stay in character.", when: "At launch" },
  { name: "RP-PvP", what: "Roleplaying and PvP together. Added in Blizzard's October 22 update.", when: "At launch, November 4. Blizzard plans to offer it during name reservations." },
  { name: "Hardcore", what: "Death is permanent, but a dead character can move to another ruleset. Battlegrounds never mix Hardcore with other rulesets.", when: "Sometime after launch" },
];

export type Window = "before" | "open" | "closed";

/** Where `now` sits against a dated window, by calendar day in UTC. */
export function windowAt(now: Date, from: string, to: string): Window {
  const day = now.toISOString().slice(0, 10);
  return day < from ? "before" : day <= to ? "open" : "closed";
}

/** Before the launch instant the checklist is "before launch"; from then on it is launch week. */
export const hasLaunched = (now: Date): boolean => now.getTime() >= Date.parse(LAUNCH_AT);
