/**
 * The wiki's content model: one Markdown file per page under kb/wiki/, YAML front matter on top, a small token
 * set in the body. Not MDX: a page holds text and references, never code. Pure, with no file access, so the
 * page check, the site and the MCP server read a page the same way.
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const PAGE_TYPES = ["dungeon", "raid", "zone", "npc", "faction", "item-set", "event", "concept", "change", "race", "class"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** The heading that holds what is specific to WoW: Forever. An indexable page needs one with text under it. */
export const FOREVER_SECTION = "In WoW: Forever";

/** The heading of a dungeon or raid page's advice for a group about to go in: Everloot's own words, never game data. */
export const PREP_SECTION = "Before you go";

/**
 * The written sections of each type, in order, as `##` headings. Infoboxes and data blocks are placed by type,
 * not written, so they are not here. `optional` sections may follow the required ones, in that order.
 * A concept page has free sections instead (at most four); `forever` names the section that counts as the
 * Forever section for the index bar.
 */
export interface SectionRule { required: readonly string[]; optional: readonly string[]; forever: string; free?: number }

const STANDARD = (required: string[], optional: string[] = []): SectionRule => ({ required, optional, forever: FOREVER_SECTION });

export const SECTIONS: Record<PageType, SectionRule> = {
  dungeon: STANDARD(["Overview", "Getting there", "History", FOREVER_SECTION], [PREP_SECTION]),
  raid: STANDARD(["Overview", "Getting there", "History", FOREVER_SECTION], [PREP_SECTION]),
  zone: STANDARD(["Overview", "History", FOREVER_SECTION]),
  npc: STANDARD(["Who they are", "Where to find them", FOREVER_SECTION]),
  faction: STANDARD(["Overview", "History", "How players gain standing"], [FOREVER_SECTION]),
  "item-set": STANDARD(["Overview", "Who wears it"], [FOREVER_SECTION]),
  event: STANDARD(["What happens", FOREVER_SECTION]),
  concept: { required: [], optional: [], forever: FOREVER_SECTION, free: 4 },
  change: { required: ["What changed", "What it affects"], optional: [], forever: "What changed" },
  race: STANDARD(["Overview", FOREVER_SECTION]),
  class: STANDARD(["Overview", FOREVER_SECTION]),
};

const id = z.number().int().positive();
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters and digits joined by single hyphens");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const httpsUrl = z.url({ protocol: /^https$/ });

/**
 * What each type binds to. Unknown keys fail, so a typo cannot pass as an unbound page. The keys in
 * BLIZZARD_SOURCED are optional here; the page check requires them unless the page lists a Blizzard post.
 */
export const BINDS: Record<PageType, z.ZodType> = {
  dungeon: z.strictObject({ entrance: slug.optional(), zone: id.optional(), lfgDungeon: id.optional() }),
  raid: z.strictObject({ entrance: slug.optional(), zone: id.optional(), lfgDungeon: id.optional() }),
  zone: z.strictObject({ zone: id }),
  npc: z.strictObject({ npc: id }),
  faction: z.strictObject({ faction: id }),
  "item-set": z.strictObject({ itemSet: id }),
  event: z.strictObject({ holiday: id }),
  concept: z.strictObject({ tool: z.string().regex(/^\/[a-z0-9/-]*$/, "a site path such as /tools/talents").optional() }),
  change: z.strictObject({ changes: z.array(z.string().min(1)).min(1) }),
  race: z.strictObject({ race: id.optional() }),
  class: z.strictObject({ class: id }),
};

/**
 * The binding a page may leave out when it is written from a Blizzard post about something the game files do
 * not have yet, such as a new Forever dungeon or race. Without a Blizzard post in `sources`, it is required.
 */
export const BLIZZARD_SOURCED: Partial<Record<PageType, string>> = { dungeon: "entrance", raid: "entrance", race: "race" };

export const FrontMatter = z.strictObject({
  /** Stable and never reused; the MCP record id is its negative. */
  id,
  slug,
  title: z.string().trim().min(1).max(80),
  type: z.enum(PAGE_TYPES),
  binds: z.record(z.string(), z.unknown()),
  /** Everloot's words, shown on database pages and as the MCP snippet. */
  summary: z.string().trim().min(1).max(300),
  categories: z.array(slug).min(1),
  origin: z.enum(["original", "adapted"]),
  /** The Warcraft Wiki pages an adapted page reuses; they make its credit line. */
  adaptedFrom: z.array(z.strictObject({ title: z.string().trim().min(1), url: httpsUrl, extId: z.string().trim().min(1), revision: z.union([id, z.string().trim().min(1)]) })),
  /** Blizzard posts and other evidence, for review and MCP metadata, not printed on the page. */
  sources: z.array(z.strictObject({ title: z.string().trim().min(1), url: httpsUrl, checkedOn: isoDate })),
  status: z.enum(["draft", "published"]),
  reviewed: z.strictObject({ by: z.string().trim().min(1), on: isoDate }).nullable(),
});
export type FrontMatter = z.infer<typeof FrontMatter>;

export const TOKEN_KINDS = ["item", "npc", "quest", "zone", "faction"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "entity"; entity: TokenKind; id: number }
  | { kind: "link"; slug: string };

export type Block =
  | { type: "heading"; level: number; text: string; line: number }
  | { type: "paragraph" | "quote"; inline: Inline[]; line: number }
  | { type: "list"; items: Inline[][]; line: number };

export interface BadToken { text: string; line: number }

export interface ParsedPage {
  /** Front matter as written, before the schema check. */
  data: unknown;
  /** The line the body starts on in the file, for messages. */
  bodyLine: number;
  blocks: Block[];
  badTokens: BadToken[];
}

const TOKEN = /\{(item|npc|quest|zone|faction):([1-9]\d{0,8})\}|\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/g;
/** Anything that looks like a token or a link but is not one of the valid forms. */
const TOKEN_LIKE = /\{[^{}\n]*\}|\[\[[^\]\n]*\]\]/g;

/** Text split into plain runs, entity tokens (`{item:2589}`) and wiki links (`[[deadmines]]`). */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push(m[1] ? { kind: "entity", entity: m[1] as TokenKind, id: Number(m[2]) } : { kind: "link", slug: m[3] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Braces or double brackets that are not a valid token: `{item:abc}`, `{spell:5}`, `[[Bad Slug]]`. */
export function badTokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN_LIKE)].map((m) => m[0]).filter((t) => !new RegExp(`^(?:${TOKEN.source})$`).test(t));
}

/** The plain text of inline content, with each token standing in as one word. */
export function inlineText(inline: Inline[], tokenWord = "X"): string {
  return inline.map((i) => (i.kind === "text" ? i.text : tokenWord)).join("");
}

/** A Markdown link in a text run that the site draws: `[text](https://…)` or `[text](/path)`. Other forms stay text. */
export const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https:\/\/[^)\s]+|\/[^)\s]*)\)/g;

const WIKI_PAGE_ADDRESS = /^(?:(?:https:)?\/\/(?:www\.)?everloot\.app)?\/wiki\/([^?#]*)/;

/**
 * The wiki page a link's address points at: "deadmines" for `/wiki/deadmines`, also with a trailing slash, a query or a
 * fragment, or written out in full on everloot.app. Null for any other address, the hub included. The rest of the path
 * is kept as written, so an address in any other spelling names no page.
 */
export function wikiLinkTarget(href: string): string | null {
  return WIKI_PAGE_ADDRESS.exec(href)?.[1].replace(/\/+$/, "") || null;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+/;

/** Splits a page file into its front matter (parsed YAML) and body blocks. Throws when the front matter is missing or not YAML. */
export function parsePage(source: string): ParsedPage {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!fm) throw new Error("the page must start with front matter between --- lines");
  const data = parseYaml(fm[1]) as unknown;
  const bodyLine = fm[0].split("\n").length - (fm[0].endsWith("\n") ? 1 : 0) + 1;
  const lines = text.slice(fm[0].length).split("\n");

  const badTokens = lines.flatMap((l, n) => badTokensIn(l).map((t) => ({ text: t, line: bodyLine + n })));
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const at = bodyLine + i;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2], line: at });
      i++;
      continue;
    }
    const group: string[] = [];
    const kind = line.startsWith(">") ? "quote" : LIST_ITEM.test(line) ? "list" : "paragraph";
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s/.test(lines[i])) {
      const next = lines[i];
      if (group.length) {
        // A quote, list or paragraph ends where a line of another kind starts.
        if ((kind === "quote") !== next.startsWith(">")) break;
        if (kind === "paragraph" && LIST_ITEM.test(next)) break;
      }
      group.push(next);
      i++;
    }
    if (kind === "quote") blocks.push({ type: "quote", inline: parseInline(group.map((l) => l.replace(/^>\s?/, "")).join(" ")), line: at });
    else if (kind === "paragraph") blocks.push({ type: "paragraph", inline: parseInline(group.join(" ")), line: at });
    else {
      const items: string[] = [];
      for (const l of group) {
        if (LIST_ITEM.test(l)) items.push(l.replace(LIST_ITEM, ""));
        else items[items.length - 1] += ` ${l.trim()}`;
      }
      blocks.push({ type: "list", items: items.map(parseInline), line: at });
    }
  }
  return { data, bodyLine, blocks, badTokens };
}
