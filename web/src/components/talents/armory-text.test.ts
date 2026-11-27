import { expect, test } from "vitest";
import { withoutUnknownAmounts } from "./armory-text";

test("an amount the game files do not give is left out of the sentence, never shown as [?]%", () => {
  // Relentless Strikes, Seal Fate and Remorseless Attacks: their rank values sit behind a curve the files we read lack.
  expect(withoutUnknownAmounts("Your finishing moves have a [?]% chance per Combo Point to restore 25 Energy."))
    .toEqual({ text: "Your finishing moves have a chance per Combo Point to restore 25 Energy.", dropped: true });
  expect(withoutUnknownAmounts("After killing a non-trivial enemy, gives you a [?]% increased critical strike chance on your next Sinister Strike."))
    .toEqual({ text: "After killing a non-trivial enemy, gives you an increased critical strike chance on your next Sinister Strike.", dropped: true });
  // A [?] the sentence cannot lose stays, and a resolved text is untouched.
  expect(withoutUnknownAmounts("Increases damage by [?]%.")).toEqual({ text: "Increases damage by [?]%.", dropped: false });
  expect(withoutUnknownAmounts("Increases damage by 10%.")).toEqual({ text: "Increases damage by 10%.", dropped: false });
});
