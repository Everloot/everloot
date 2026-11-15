import { RULESETS } from "@/data/wow-forever-launch";

export interface RulesetAnswers { pvp: boolean; roleplay: boolean; friends: boolean }

/** Preferences, not a claim about population or balance. Facts follow wow-forever-launch.ts and its Blizzard source. */
export function suggestRuleset({ pvp, roleplay, friends }: RulesetAnswers) {
  return {
    name: RULESETS[roleplay ? (pvp ? 3 : 2) : (pvp ? 1 : 0)].name,
    why: `${pvp ? "You want the danger of world PvP in contested zones" : "You want PvP to happen when you opt in"}, and ${roleplay ? "you want to stay in character" : "you did not ask for roleplay"}.`,
    friends: friends ? "Check your friends’ ruleset before creating a character: grouping, dungeons and raids stay within one ruleset." : null,
  };
}
