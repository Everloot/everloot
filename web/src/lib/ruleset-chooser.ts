export interface RulesetAnswers { pvp: boolean; roleplay: boolean; friends: boolean }

/** Preferences, not a claim about population or balance. Facts follow wow-forever-launch.ts and its Blizzard source. */
export function suggestRuleset({ pvp, roleplay, friends }: RulesetAnswers) {
  return {
    name: roleplay ? (pvp ? "Roleplay PvP" : "Roleplay") : (pvp ? "PvP" : "Normal"),
    why: `${pvp ? "You want the danger of world PvP in contested zones" : "You want PvP to happen when you opt in"}, and ${roleplay ? "you want to stay in character" : "you did not ask for roleplay"}.`,
    friends: friends ? "Check your friends’ ruleset before creating a character: grouping, dungeons and raids stay within one ruleset." : null,
  };
}
