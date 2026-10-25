/**
 * The news section's content model: one Markdown file per post under kb/news/, YAML front matter on top,
 * the wiki's body syntax (sections, paragraphs, lists, quotes, `{item:N}` tokens and `[[slug]]` wiki links).
 * Pure, with no file access, so the post check and the site read a post the same way.
 */
import { z } from "zod";
import { parsePage, type ParsedPage } from "../wiki/page.js";

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
    alt: z.string().trim().min(1).max(200),
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
