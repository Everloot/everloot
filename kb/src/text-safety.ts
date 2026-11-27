/**
 * Limits that every reader of the blue-post and build data applies, not only the ingester: the site, the
 * feed and the MCP tool all go through these, so a hand-edited JSON file cannot widen them.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Plain text of an HTML-ish fragment: tags dropped, entities decoded, whitespace collapsed. */
export function plainText(html: unknown): string {
  if (typeof html !== "string") return "";
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export const MAX_EXCERPT_CHARS = 300;
export const MAX_EXCERPT_SENTENCES = 2;

/** Words whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "vs", "e.g", "i.e", "approx", "inc", "lvl", "lv"]);

/** Where a sentence ends: end punctuation, then a space, then a letter, digit, quote or bracket. */
const BOUNDARY = /[.!?]+["\u201d\u2019)\]]*\s+(?=[\p{L}\p{N}"\u201c\u2018'(\[])/gu;

function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const match of text.matchAll(BOUNDARY)) {
    const end = match.index! + match[0].length;
    const before = text.slice(start, match.index! + 1);
    const word = /([\p{L}.]+)\.$/u.exec(before)?.[1]?.toLowerCase();
    // "Dr. Smith", "e.g. this", a lone initial ("J. Smith") and a list number ("1. Fix") are not sentence ends.
    if (match[0].startsWith(".") && !/^\.[.!?]/.test(match[0]) && word !== undefined && (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word))) continue;
    if (match[0].startsWith(".") && /^\d{1,2}\.$/.test(before.trim())) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * The first two sentences of a text, never more than 300 characters (cut at a word, with an ellipsis).
 * This is the only part of Blizzard's text we keep. Safe to call again on an excerpt already stored.
 */
export function clampExcerpt(raw: unknown): string {
  const text = plainText(raw);
  if (!text) return "";
  const out = sentencesOf(text).slice(0, MAX_EXCERPT_SENTENCES).join(" ");
  if (out.length <= MAX_EXCERPT_CHARS) return out;
  const cut = out.slice(0, MAX_EXCERPT_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 120 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** A short single-line field: plain text, at most `max` characters. */
export function clampText(raw: unknown, max: number): string {
  const text = plainText(raw);
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The link as a normalised http(s) URL, or null (the link is dropped, never rewritten into something else). */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** An ISO time, or null when the value is not a real date. */
export function isoTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
