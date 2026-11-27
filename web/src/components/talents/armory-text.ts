/** The tooltip's note when an amount was left out, and the screen-reader text's shorter one. */
export const AMOUNT_NOTE = "This rank's amount is not in the game files we read, so the text leaves it out.";
export const SPOKEN_AMOUNT_NOTE = "This rank's amount is not in the game files we read.";

const UNKNOWN_AMOUNT = /\b([Aa])n? \[\?\]%? (\w)/g;

/**
 * A talent text with "a [?]% chance" / "a [?]% increased ..." written without the missing number ("a chance", "an
 * increased ..."), so the armory never prints a placeholder where the sentence reads fine without it. `dropped` says
 * an amount was left out, for the tooltip's note. Any other `[?]` stays, with the usual note.
 */
export function withoutUnknownAmounts(text: string): { text: string; dropped: boolean } {
  let dropped = false;
  const out = text.replace(UNKNOWN_AMOUNT, (_, a: string, next: string) => {
    dropped = true;
    return `${/[aeiou]/i.test(next) ? `${a}n` : a} ${next}`;
  });
  return { text: out, dropped };
}
