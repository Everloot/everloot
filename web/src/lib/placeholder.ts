// The mark for a value no report or game file holds. Kept in a file with no imports, so client code that prints it
// (the map's report labels) does not bundle item-names and, through it, the protocol package and zod.
export const PLACEHOLDER = "[?]";

const SPOKEN_NOTE = "(amount not in the game files)";
const COUNT_NOTE = "(number not in the game files)";
// "up to [?] times", "up to [?] targets": a count of a plural noun.
const UP_TO_COUNT = /\bup to \[\?\] ([a-z]+s)\b/gi;
// A range ("[?] - [?]") or one mark, with its sign and percent.
const MARK = /[+-]?\[\?\]%?(?:\s*-\s*[+-]?\[\?\]%?)?/g;

/**
 * Text for a screen reader, which would read the mark as "left bracket question mark": each sentence (or line) that
 * holds one loses the missing number and ends with a short note instead. The drawn text keeps the mark and its footnote.
 */
export function spokenUnknowns(text: string): string {
  return text.split("\n").map((line) => line.split(/(?<=\.)\s+/).map((sentence) => {
    if (!sentence.includes(PLACEHOLDER)) return sentence;
    // A missing count ("stacks up to [?] times") reads "stacks several times", not "stacks up to times".
    const counted = sentence.replace(UP_TO_COUNT, "several $1");
    const note = counted !== sentence && !counted.includes(PLACEHOLDER) ? COUNT_NOTE : SPOKEN_NOTE;
    const bare = counted.replace(MARK, "").replace(/\(\s+/g, "(").replace(/\s+([.,;:)])/g, "$1").replace(/\s{2,}/g, " ").trim();
    const stop = bare.endsWith(".") ? "." : "";
    return `${stop ? bare.slice(0, -1) : bare} ${note}${stop}`;
  }).join(" ")).join("\n");
}

/** An item tooltip's `why` lines in two: the reasons for its placeholders (each opens with the mark) and the evidence lines. */
export function splitWhy(why: string[]): { reasons: string[]; evidence: string[] } {
  const reasons = why.filter((w) => w.startsWith(`${PLACEHOLDER} `));
  return { reasons, evidence: why.filter((w) => !reasons.includes(w)) };
}
