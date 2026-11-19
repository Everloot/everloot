import { allTerms } from "@kb/search";

// The name matchers /search, the search box suggestions and the database lists share: a query against one lowercase
// name, ranked, with the words in any order and, when nothing matches as typed, within a typo or two.

/** 0 exact, 1 starts with, 2 contains, null no match; both sides lowercase. */
export function phraseRank(name: string, q: string): number | null {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  return name.includes(q) ? 2 : null;
}

/** Whether `word` starts a word of `name`: at its start or after a character that is not a letter or digit. */
export function atWordStart(name: string, word: string): boolean {
  for (let i = name.indexOf(word); i !== -1; i = name.indexOf(word, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(name[i - 1]!)) return true;
  return false;
}

/**
 * As `phraseRank`, then the words in any order ("cloth linen"): 3 when each word starts a word of the name, 4 when
 * each is somewhere in it. A one-word query ranks exactly as `phraseRank`.
 */
export function rank(name: string, q: string, words: readonly string[] = q.split(/\s+/)): number | null {
  const r = phraseRank(name, q);
  if (r !== null) return r;
  if (words.length < 2 || !words.every((w) => name.includes(w))) return null;
  return words.every((w) => atWordStart(name, w)) ? 3 : 4;
}

/** How a list asks whether a lowercase name matches: its rank, lowest best, or null. */
export type Match = (name: string) => number | null;
export const byWords = (q: string): Match => { const words = q.split(/\s+/); return (n) => rank(n, q, words); };
export const byPhrase = (q: string): Match => (n) => phraseRank(n, q);

/** Typo tolerance needs this many letters in a word: shorter words must be typed right. */
const TYPO_MIN = 4;
/** The edits a typed word may be from a word of the name: one, two from 8 letters. */
const typoEdits = (word: string) => (word.length < TYPO_MIN ? 0 : word.length >= 8 ? 2 : 1);

/**
 * Edits between two words, a swap of neighbouring letters counting as one (optimal string alignment), or
 * `max + 1` as soon as it is certain to be more than `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let prevLow = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      cur[j] = v;
      if (v < low) low = v;
    }
    // A swap reaches back two rows, so only two rows past `max` in a row rule a match out.
    if (low > max && prevLow > max) return max + 1;
    before = prev;
    prev = cur;
    prevLow = low;
  }
  return Math.min(prev[b.length]!, max + 1);
}

/**
 * The fallback when nothing matches the words as typed ("lnen clth", "hoger"): every typed word is in the name, or
 * within `typoEdits` of one of its words. Ranks 5 plus the edits, so it never ties a match `byWords` finds. A word is
 * only measured when its length is within the allowed edits of the typed one (each edit changes the length by at most
 * one, so this drops no match), and each distinct word once per query. Null when no typed word is long enough.
 */
export function byTypo(q: string): Match | null {
  const typed = q.split(/\s+/);
  if (!typed.some((t) => typoEdits(t) > 0)) return null;
  const seen = typed.map(() => new Map<string, number>());
  return (n) => {
    let edits = 0;
    for (const [i, t] of typed.entries()) {
      if (n.includes(t)) continue;
      const k = typoEdits(t);
      if (!k) return null;
      // The name's words as allTerms splits them, scanned in place: this runs on every name of a list.
      let best = k + 1;
      for (let start = 0, end = 0; start < n.length; start = end + 1) {
        end = start;
        while (end < n.length && wordChar(n.charCodeAt(end))) end++;
        if (Math.abs(end - start - t.length) > k) continue;
        const w = n.slice(start, end);
        let d = seen[i]!.get(w);
        if (d === undefined) seen[i]!.set(w, (d = editDistance(t, w, k)));
        if (d < best) best = d;
      }
      if (best > k) return null;
      edits += best;
    }
    return 5 + edits;
  };
}

/** A letter or digit in a lowercase name: a to z, 0 to 9, or past ASCII (accented letters). */
const wordChar = (c: number) => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c > 127;

/** The query as a name the fallback matched spells it: each mistyped word becomes that name's nearest word. */
export function respelling(q: string, name: string): string {
  const words = allTerms(name).split(" ");
  return q.split(/\s+/).map((t) => {
    if (name.toLowerCase().includes(t)) return t;
    let best = t, edits = typoEdits(t) + 1;
    for (const w of words) { const d = editDistance(t, w, typoEdits(t)); if (d < edits) { best = w; edits = d; } }
    return best;
  }).join(" ");
}


/** One row `matchNames` kept, with its rank (lowest best). */
export interface NameHit<T> { row: T; r: number }

/**
 * The rows whose name matches `q` (trimmed and lowercase), in the rows' own order with each one's rank: the words
 * in any order, or, when none matches that way and a word is long enough, within a typo or two, `respelled` then
 * saying how the query was read. A row with no name never matches. The caller orders the hits; a list keeps its
 * default order within a rank by sorting on the rank alone. `typo: false` (an id was typed too) reads no typo.
 */
export function matchNames<T>(rows: readonly T[], q: string, name: (row: T) => string | null | undefined, { typo: allowTypo = true }: { typo?: boolean } = {}): { hits: NameHit<T>[]; respelled?: string } {
  const run = (match: Match) => {
    const hits: NameHit<T>[] = [];
    for (const row of rows) {
      const n = name(row);
      if (typeof n !== "string") continue;
      const r = match(n.toLowerCase());
      if (r !== null) hits.push({ row, r });
    }
    return hits;
  };
  const hits = run(byWords(q));
  if (hits.length) return { hits };
  const typo = allowTypo ? byTypo(q) : null;
  if (!typo) return { hits };
  const near = run(typo);
  if (!near.length) return { hits: near };
  const best = near.reduce((a, b) => (b.r < a.r ? b : a));
  return { hits: near, respelled: respelling(q, name(best.row) as string) };
}
