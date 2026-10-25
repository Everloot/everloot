// The mark for a value no report or game file holds. Kept in a file with no imports, so client code that prints it
// (the map's report labels) does not bundle item-names and, through it, the protocol package and zod.
export const PLACEHOLDER = "[?]";

/** An item tooltip's `why` lines in two: the reasons for its placeholders (each opens with the mark) and the evidence lines. */
export function splitWhy(why: string[]): { reasons: string[]; evidence: string[] } {
  const reasons = why.filter((w) => w.startsWith(`${PLACEHOLDER} `));
  return { reasons, evidence: why.filter((w) => !reasons.includes(w)) };
}
