import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clampText } from "../../../kb/src/text-safety";
import { parsePost, PostFrontMatter } from "../../../kb/src/news/post";
import { inlineText, type Block } from "../../../kb/src/wiki/page";

/**
 * The news posts under kb/news, read from disk once per server instance (they change only with a deploy;
 * next.config.js traces the folder into the /news functions). Pure apart from the read, so tests point
 * NEWS_DIR at fixture posts. Drafts are read but never shown: every lookup the pages use skips them.
 */
export function newsDir(): string {
  return process.env.NEWS_DIR?.trim() || join(process.cwd(), "..", "kb", "news");
}

export interface NewsPost extends PostFrontMatter { blocks: Block[] }

function readPost(source: string): NewsPost | null {
  try {
    const parsed = parsePost(source);
    const fm = PostFrontMatter.safeParse(parsed.data);
    return fm.success ? { ...fm.data, blocks: parsed.blocks } : null;
  } catch {
    return null;
  }
}

const loaded = new Map<string, Map<string, NewsPost>>();

/** Every post that parses, drafts included, by slug. A post that does not parse is left out; `npm run kb -- news-check` fails it in CI. */
export function loadNews(dir = newsDir()): Map<string, NewsPost> {
  const known = loaded.get(dir);
  if (known) return known;
  const posts = new Map<string, NewsPost>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
    const post = readPost(readFileSync(join(dir, file), "utf8"));
    if (post && `${post.slug}.md` === file && !posts.has(post.slug)) posts.set(post.slug, post);
  }
  loaded.set(dir, posts);
  return posts;
}

/** The published posts, newest first (ties by title), the only ones the site builds. A draft answers 404 everywhere. */
export const publishedPosts = (news: Map<string, NewsPost>): NewsPost[] =>
  [...news.values()].filter((p) => p.status === "published").sort((a, b) => b.published.localeCompare(a.published) || a.title.localeCompare(b.title));

export function publishedPost(news: Map<string, NewsPost>, slug: string): NewsPost | null {
  const post = news.get(slug);
  return post && post.status === "published" ? post : null;
}

export const newsHref = (slug: string) => `/news/${slug}`;

/** The day a post last changed: its update when it has one, else its publication. */
export const lastChanged = (post: Pick<NewsPost, "published" | "updated">): string => post.updated ?? post.published;

/** The hub is indexed once it lists a post; an empty hub stays out of search. */
export const hubIndexable = (news: Map<string, NewsPost>): boolean => publishedPosts(news).length > 0;

/** The search snippet: the summary, cut to the length a result shows. */
export const postDescription = (post: Pick<NewsPost, "summary">): string => clampText(post.summary, 160);

/** The post's own prose as plain text, each token standing in as one word; the feed's description reads its opening. */
export function postText(blocks: Block[]): string {
  return blocks.flatMap((b) => (b.type === "paragraph" ? [inlineText(b.inline)] : b.type === "list" ? b.items.map((i) => inlineText(i)) : [])).join(" ");
}

/** The sitemap's news entries: the hub once it is indexed, then each post dated by the day it last changed. */
export function newsSitemapPaths(news: Map<string, NewsPost> = loadNews()): { path: string; lastModified?: Date }[] {
  const posts = publishedPosts(news);
  if (!posts.length) return [];
  return [{ path: "/news", lastModified: new Date(lastChanged(posts[0])) }, ...posts.map((p) => ({ path: newsHref(p.slug), lastModified: new Date(lastChanged(p)) }))];
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** RSS 2.0 of the published posts, newest first. A post's link is its page; its description is the summary. */
export function renderNewsFeed(posts: NewsPost[], site: { baseUrl: string; now: Date; limit?: number }): string {
  const base = site.baseUrl.replace(/\/$/, "");
  const items = posts.slice(0, site.limit ?? 50).map((p) => [
    "    <item>",
    `      <title>${xml(p.title)}</title>`,
    `      <link>${xml(`${base}${newsHref(p.slug)}`)}</link>`,
    `      <guid isPermaLink="true">${xml(`${base}${newsHref(p.slug)}`)}</guid>`,
    `      <pubDate>${new Date(p.published).toUTCString()}</pubDate>`,
    ...p.tags.map((t) => `      <category>${xml(t)}</category>`),
    `      <description>${xml(p.summary)}</description>`,
    "    </item>",
  ].join("\n"));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>Everloot news</title>",
    `    <link>${xml(`${base}/news`)}</link>`,
    `    <atom:link href="${xml(`${base}/news/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    "    <description>What is new on Everloot and what it means for WoW: Forever players, in Everloot's own words.</description>",
    "    <language>en-us</language>",
    `    <lastBuildDate>${(posts[0] ? new Date(lastChanged(posts[0])) : site.now).toUTCString()}</lastBuildDate>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** Reading time in whole minutes (at least one), at 220 words a minute over the post's prose. */
export const readingMinutes = (blocks: Block[]): number => Math.max(1, Math.round(postText(blocks).split(/\s+/).filter(Boolean).length / 220));

/** The publishers a post cites, from its sources' titles ("Blizzard: …" → "Blizzard"), in order, once each. */
export function sourceNames(post: Pick<NewsPost, "sources">): string[] {
  const names = post.sources.map((s) => (s.title.includes(":") ? s.title.slice(0, s.title.indexOf(":")) : new URL(s.url).hostname.replace(/^www\./, "")).trim());
  return [...new Set(names.filter(Boolean))];
}

const TRAILING = /^(sources|related|related posts|related news|more news|read more)$/i;

/**
 * The body without the closing link lists the page draws itself: a "Sources" section (when the front matter
 * has sources, the page lists them once) and any "Related" or "More news" section (the page shows one related
 * list). A section runs from its heading to the next heading of the same or a higher level. Also returns the
 * /news/<slug> links those related sections named, so the page can list them first.
 */
export function bodyForPage(post: Pick<NewsPost, "blocks" | "sources">): { blocks: Block[]; relatedSlugs: string[] } {
  const blocks: Block[] = [];
  const relatedSlugs: string[] = [];
  let skipping: { level: number; related: boolean } | null = null;
  for (const b of post.blocks) {
    if (b.type === "heading") {
      if (skipping && b.level <= skipping.level) skipping = null;
      const name = b.text.trim().replace(/:$/, "");
      if (!skipping && TRAILING.test(name) && (!/^sources$/i.test(name) || post.sources.length > 0)) {
        skipping = { level: b.level, related: !/^sources$/i.test(name) };
        continue;
      }
    }
    if (!skipping) { blocks.push(b); continue; }
    if (skipping.related) {
      // A related section's link list goes; a call to action under it (a paragraph) stays in the body.
      if (b.type !== "list") { blocks.push(b); continue; }
      const runs = b.items.flat();
      for (const r of runs) if (r.kind === "text") for (const m of r.text.matchAll(/\]\(\/news\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g)) relatedSlugs.push(m[1]);
    }
  }
  return { blocks, relatedSlugs: [...new Set(relatedSlugs)] };
}

/** Up to `count` other published posts: the ones the post itself named first, then the newest. */
export function relatedPosts(news: Map<string, NewsPost>, post: Pick<NewsPost, "slug">, named: string[], count = 3): NewsPost[] {
  const picked: NewsPost[] = [];
  for (const slug of named) {
    const p = publishedPost(news, slug);
    if (p && p.slug !== post.slug && !picked.includes(p)) picked.push(p);
  }
  for (const p of publishedPosts(news)) if (p.slug !== post.slug && !picked.includes(p)) picked.push(p);
  return picked.slice(0, count);
}
