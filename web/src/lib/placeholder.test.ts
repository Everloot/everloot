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
