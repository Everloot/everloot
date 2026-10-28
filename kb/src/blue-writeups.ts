import { postPageId } from "./blue-pages.js";
import { clampText } from "./text-safety.js";

/**
 * Our own write-ups of Blizzard posts, shown on each post's Everloot page next to the short excerpt.
 *
 * One Markdown file per post under kb/curated/blue-writeups/, named by the page id (`us-30553826.md`,
 * `eu-6443686.md`, `bsky-3mydklukhq22f.md`), with front matter:
 *
 *     ---
 *     postId: forum:30553826
 *     reviewed:
 *       by: <maintainer>
 *       on: 2026-10-21
 *     ---
 *     Plain paragraphs and "- " lists, in our own words.
 *
 * A draft waiting for review has `draft: true` in place of the `reviewed` block. It is checked like the others but
 * never bundled, so the post's page shows none of it and stays out of search until a maintainer reviews it.
 *
 * `npm run kb -- blue-writeups` turns the folder into kb/curated/blue-writeups.json, which the site bundles; a
 * test fails when the two disagree. Nothing writes a write-up automatically, and none quotes the post beyond
 * the excerpt the page already shows.
 */

export interface BlueWriteup {
  /** The stored post id, as in kb/changes/blue-posts.json. */
  postId: string;
  reviewed: { by: string; on: string };
  /** Markdown: paragraphs, "- " lists and [links](https://…). No HTML. */
  body: string;
}

/** A write-up waiting for review (`draft: true`). */
export interface DraftWriteup {
  postId: string;
  draft: true;
  body: string;
}

export const MAX_WRITEUP_CHARS = 6000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Why a write-up cannot be shown, or null when it can. */
function problem(w: { postId?: unknown; by?: unknown; on?: unknown; body?: unknown }, draft = false): string | null {
  if (typeof w.postId !== "string" || !postPageId(w.postId)) return "postId is not a stored blue post id";
  if (!draft && !clampText(w.by, 100)) return "reviewed.by is missing";
  if (!draft && !isDay(w.on)) return "reviewed.on is not a YYYY-MM-DD date";
  if (typeof w.body !== "string" || !w.body.trim()) return "the body is empty";
  if (w.body.length > MAX_WRITEUP_CHARS) return `the body is longer than ${MAX_WRITEUP_CHARS} characters`;
  if (/<\/?[a-z!]/i.test(w.body)) return "the body contains HTML";
  return null;
}

/** One stored write-up with every rule applied again, or null; a hand-edited JSON file cannot slip one past. */
export function sanitizeWriteup(raw: unknown): BlueWriteup | null {
  if (!isRecord(raw) || !isRecord(raw.reviewed)) return null;
  const w = { postId: raw.postId, by: raw.reviewed.by, on: raw.reviewed.on, body: raw.body };
  if (problem(w)) return null;
  return { postId: w.postId as string, reviewed: { by: clampText(w.by, 100), on: w.on as string }, body: (w.body as string).trim() };
}

/** The bundled store as a map by post id. */
export function writeupsById(store: unknown): Map<string, BlueWriteup> {
  const list = isRecord(store) && Array.isArray(store.writeups) ? store.writeups : [];
  const out = new Map<string, BlueWriteup>();
  for (const raw of list) {
    const w = sanitizeWriteup(raw);
    if (w) out.set(w.postId, w);
  }
  return out;
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

/** One write-up file. Throws with the reason when the file breaks a rule. */
export function parseWriteupFile(name: string, text: string): BlueWriteup | DraftWriteup {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ""));
  if (!m) throw new Error(`${name}: no front matter`);
  const fields: Record<string, string> = {};
  let parent = "";
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = /^(\s*)([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${name}: cannot read front matter line "${line}"`);
    if (!kv[1]) parent = kv[3] ? "" : kv[2];
    fields[kv[1] && parent ? `${parent}.${kv[2]}` : kv[2]] = unquote(kv[3]);
  }
  const w = { postId: fields.postId, by: fields["reviewed.by"], on: fields["reviewed.on"], body: m[2] };
  const draft = fields.draft === "true";
  if (fields.draft !== undefined && !draft) throw new Error(`${name}: draft is "true" or left out`);
  if (draft && (w.by !== undefined || w.on !== undefined)) throw new Error(`${name}: a draft has no reviewed block`);
  const why = problem(w, draft);
  if (why) throw new Error(`${name}: ${why}`);
  if (name !== `${postPageId(w.postId!)}.md`) throw new Error(`${name}: the file must be named ${postPageId(w.postId!)}.md`);
  if (draft) return { postId: w.postId!, draft: true, body: m[2].trim() };
  return { postId: w.postId!, reviewed: { by: clampText(w.by, 100), on: w.on! }, body: m[2].trim() };
}

/**
 * The folder's files as the bundled list, sorted by post id; drafts are checked and left out. `known` (the stored
 * post ids) rejects a write-up for a post the store does not hold.
 */
export function compileWriteups(files: { name: string; text: string }[], known?: Set<string>): BlueWriteup[] {
  const parsed = files.filter((f) => f.name.endsWith(".md")).map((f) => parseWriteupFile(f.name, f.text));
  if (known) for (const w of parsed) if (!known.has(w.postId)) throw new Error(`${postPageId(w.postId)}.md: no stored post ${w.postId}`);
  const out = parsed.filter((w): w is BlueWriteup => !("draft" in w));
  return out.sort((a, b) => a.postId.localeCompare(b.postId));
}
