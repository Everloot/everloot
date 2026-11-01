/**
 * The news section's content model: one Markdown file per post under kb/news/, YAML front matter on top,
 * the wiki's body syntax (sections, paragraphs, lists, quotes, `{item:N}` tokens and `[[slug]]` wiki links).
 * Pure, with no file access, so the post check and the site read a post the same way.
 */
import { z } from "zod";
import { parsePage, type Block, type ParsedPage } from "../wiki/page.js";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters and digits joined by single hyphens");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const httpsUrl = z.url({ protocol: /^https$/ });

const sitePathOrUrl = z.string().trim().regex(/^(\/[^\s]*|https:\/\/[^\s]+)$/, "a site path starting with / or an https URL");

/** A published post's address is `/news/<slug>`; the file is `<slug>.md`. */
export const PostFrontMatter = z.strictObject({
  slug,
  title: z.string().trim().min(1).max(90),
  /** Everloot's words: the hub's one line under the title, and the search snippet. */
  summary: z.string().trim().min(1).max(300),
  /** Who wrote it, as the page names them. */
  author: z.string().trim().min(1).max(80),
  /** The day the post went out; the page's date and the feed's. */
  published: isoDate,
  /** The day it was last changed after that, when it was. */
  updated: isoDate.optional(),
  /** Short labels under the title; free, lowercase slugs. */
  tags: z.array(slug).max(6).default([]),
  /** Blizzard posts and other evidence, for review and the page's "Sources" list. */
  sources: z.array(z.strictObject({ title: z.string().trim().min(1), url: httpsUrl })).default([]),
  /**
   * The post's top image, optional: a site path (`/news/heroes/<slug>.webp`, under web/public) or an https URL,
   * 16:9, and its alt text. Shown above the body and used as the share image; without it the page keeps the
   * site's default share image and no top image.
   */
  hero: z.strictObject({
    src: sitePathOrUrl,
    alt: z.string().trim().min(1).max(500),
    /** A smaller copy (about 800x450) for the /news cards and related cards; without it the cards use `src`. */
    thumb: sitePathOrUrl.optional(),
    /** The share image (og:image / twitter:image, 1200x675, title baked in); without it shares use `src`. */
    share: sitePathOrUrl.optional(),
  }).optional(),
  /** A draft is read but never built, previews included. */
  status: z.enum(["draft", "published"]),
});
export type PostFrontMatter = z.infer<typeof PostFrontMatter>;

/** A post file split into its front matter (parsed YAML, unchecked) and body blocks. Throws when the front matter is missing. */
export const parsePost = (source: string): ParsedPage => parsePage(source);

/** A figure's image is drawn at this size, so the page holds its space before the file loads; the check reads each file's. */
export const FIGURE_SIZE = { width: 1600, height: 900 } as const;

export interface Figure { src: string; alt: string; caption?: string }

/** Anything written as a Markdown image, `![…](…)`, wherever it stands. */
const IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/;
const FIGURE = /^!\[([^\]\n]*)\]\((\S+?)(?:\s+"([^"\n]*)")?\)$/;
const FIGURE_SRC = /^\/news\/figures\/([a-z0-9]+(?:-[a-z0-9]+)*)\/[a-z0-9][a-z0-9_-]*\.webp$/;

/**
 * The figure a body block draws: a paragraph that is only `![alt](/news/figures/<slug>/<file>.webp "Caption")`, the
 * caption optional. Null for a block without an image. An image the site cannot draw (inside a sentence, a list or a
 * quote, without alt text, or from anywhere but the post's own figures folder) is a problem: the check fails the post
 * and the page draws nothing for the block. Without a slug, any post's figures folder is accepted.
 */
export function postFigure(block: Block, slug?: string): { figure: Figure } | { problem: string } | null {
  if (block.type === "heading") return null;
  const runs = block.type === "list" ? block.items : [block.inline];
  if (!runs.some((r) => r.some((t) => t.kind === "text" && IMAGE.test(t.text)))) return null;
  const folder = `/news/figures/${slug ?? "<slug>"}/`;
  const only = block.type === "paragraph" && block.inline.length === 1 && block.inline[0].kind === "text" ? FIGURE.exec(block.inline[0].text.trim()) : null;
  if (!only) return { problem: `an image must be a paragraph of its own, written ![alt](${folder}<file>.webp "Caption"), with no tokens in it` };
  const [, alt, src, caption] = only;
  if (!alt.trim()) return { problem: `the figure ${src} needs alt text that describes the image` };
  const owner = FIGURE_SRC.exec(src)?.[1];
  if (!owner || (slug !== undefined && owner !== slug)) {
    return { problem: `the figure ${src} must be a .webp file in this post's folder, ${folder} (web/public${folder})` };
  }
  return { figure: { src, alt: alt.trim(), ...(caption?.trim() ? { caption: caption.trim() } : {}) } };
}
