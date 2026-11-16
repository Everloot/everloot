import { expect, test } from "vitest";
import { suggestRuleset } from "./ruleset-chooser";

test.each([
  [false, false, "Normal"], [true, false, "PvP"],
  [false, true, "Roleplaying"], [true, true, "RP-PvP"],
] as const)("world PvP %s and roleplay %s suggest %s", (pvp, roleplay, name) => {
  for (const friends of [false, true]) {
    const result = suggestRuleset({ pvp, roleplay, friends });
    expect(result.name).toBe(name);
    expect(result.why).toContain(pvp ? "contested" : "opt in");
    expect(result.why).toContain(roleplay ? "stay in character" : "did not ask for roleplay");
    expect(result.friends).toBe(friends ? "Check your friends’ ruleset before creating a character: grouping, dungeons and raids stay within one ruleset." : null);
  }
});
