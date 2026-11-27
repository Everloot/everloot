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
