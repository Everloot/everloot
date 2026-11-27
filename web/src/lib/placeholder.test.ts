import { expect, test } from "vitest";
import { spokenUnknowns } from "./placeholder";

test("spoken text never reads the [?] mark: the number goes and a short note says the files lack it", () => {
  expect(spokenUnknowns("[?] Armor")).toBe("Armor (amount not in the game files)");
  expect(spokenUnknowns("+[?] Strength")).toBe("Strength (amount not in the game files)");
  expect(spokenUnknowns("Increases damage by [?]%.")).toBe("Increases damage by (amount not in the game files).");
  expect(spokenUnknowns("[?] - [?] Damage")).toBe("Damage (amount not in the game files)");
  expect(spokenUnknowns("([?] damage per second)")).toBe("(damage per second) (amount not in the game files)");
  // One sentence with a mark gets the note; its neighbours stay as they were.
  expect(spokenUnknowns("Lasts 20 sec. Heals [?] health.")).toBe("Lasts 20 sec. Heals health (amount not in the game files).");
  expect(spokenUnknowns("Increases damage by 10%.")).toBe("Increases damage by 10%.");
});

test("a missing count after \"up to\" is worded out (\"several times\"), never \"up to times\"; the real Arcane Blast template", () => {
  // Arcane Blast (spell 400574), the game files' text with its count unresolved, as the talent trees show it.
  const arcaneBlast = "Blasts the target with energy, dealing 30 to 34 Arcane damage. Each time you cast Arcane Blast, you gain 12% of your Intellect as Spell Damage and the mana cost of Arcane Blast is increased by 100%. Effect stacks up to [?] times and lasts 18 sec from time of initial application.";
  const spoken = spokenUnknowns(arcaneBlast);
  expect(spoken).toContain("Effect stacks several times and lasts 18 sec from time of initial application (number not in the game files).");
  expect(spoken).not.toContain("up to times");
  expect(spokenUnknowns("Will affect up to [?] targets.")).toBe("Will affect several targets (number not in the game files).");
  // A count and an amount in one sentence: one note, for the amount.
  expect(spokenUnknowns("Stores up to [?] charges of [?] damage.")).toBe("Stores several charges of damage (amount not in the game files).");
});
