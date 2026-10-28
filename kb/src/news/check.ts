/**
 * The post check (`npm run kb -- news-check`): every rule a news post must pass before it merges. Pure: the
 * caller passes the files and the published wiki slugs, so tests can use small fixtures.
 */
import { inlineText, type Block, type Inline, type ParsedPage } from "../wiki/page.js";
import { parsePost, PostFrontMatter } from "./post.js";

export interface NewsCheckContext {
  /** Slugs of the wiki pages a `[[slug]]` may link to; a published post links only to published pages. */
  wikiPages: ReadonlySet<string>;
  /** The repository's private path pattern, read from its CI guard so the two cannot drift apart. */
  privatePaths: RegExp;
  /** Today, so a published post is never dated after it. */
  today: string;
}

export interface NewsFile { path: string; source: string }
export interface Problem { file: string; line?: number; message: string }
export interface CheckedPost { file: string; fm: PostFrontMatter; post: ParsedPage }
export interface NewsCheckResult { posts: CheckedPost[]; problems: Problem[] }

/** A published post says something: at least this many words of its own prose. */
export const MIN_POST_WORDS = 80;

const AI_CREDIT = new RegExp(
  String.raw`\b(?:generated|written|drafted|created|produced|authored)\s+(?:with|by|using)\s+(?:the\s+help\s+of\s+)?(?:an?\s+)?(?:ai|llm|claude|anthropic|chatgpt|gpt|openai|copilot|gemini|grok|codex|cursor|devin)\b` +
    String.raw`|co-authored-by:|\bai[- ]generated\b|\bas an ai\b|\bwith the help of (?:an? )?ai\b`,
  "i",
);

const prose = (b: Block): Inline[][] => (b.type === "paragraph" ? [b.inline] : b.type === "list" ? b.items : []);
const inlines = (b: Block): Inline[][] => (b.type === "quote" ? [b.inline] : prose(b));

/** Words of the post's own prose: paragraphs and lists, not headings or quotes. A token counts as one word. */
export function postWords(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) for (const i of prose(b)) n += (inlineText(i).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return n;
}

const slugOf = (path: string) => path.replace(/\\/g, "/").split("/").pop()!.replace(/\.md$/, "");

export function checkNews(files: NewsFile[], ctx: NewsCheckContext): NewsCheckResult {
  const problems: Problem[] = [];
  const posts: CheckedPost[] = [];

  for (const f of files) {
    const report = (message: string, line?: number) => problems.push({ file: f.path, ...(line ? { line } : {}), message });
    f.source.replace(/\r\n?/g, "\n").split("\n").forEach((text, n) => {
      if (ctx.privatePaths.test(text)) report("names a private path or internal workspace name; use generic wording", n + 1);
      if (AI_CREDIT.test(text)) report("credits an AI tool; posts name people only", n + 1);
    });

    let post: ParsedPage;
    try {
      post = parsePost(f.source);
    } catch (e) {
      report((e as Error).message);
      continue;
    }
    for (const t of post.badTokens) report(`"${t.text}" is not a token; use {item:N}, {npc:N}, {quest:N}, {zone:N}, {faction:N} or [[slug]]`, t.line);

    const parsed = PostFrontMatter.safeParse(post.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) report(`front matter${issue.path.length ? ` ${issue.path.join(".")}` : ""}: ${issue.message}`);
      continue;
    }
    const fm = parsed.data;
    if (fm.slug !== slugOf(f.path)) report(`slug "${fm.slug}" must match the file name (${slugOf(f.path)}.md)`);
    posts.push({ file: f.path, fm, post });
  }

  const bySlug = new Map<string, CheckedPost>();
  for (const p of posts) {
    const same = bySlug.get(p.fm.slug);
    if (same) problems.push({ file: p.file, message: `slug "${p.fm.slug}" is already used by ${same.file}` });
    else bySlug.set(p.fm.slug, p);
  }

  for (const p of posts) checkPost(p, ctx, (message, line) => problems.push({ file: p.file, ...(line ? { line } : {}), message }));
  return { posts, problems };
}

function checkPost({ fm, post }: CheckedPost, ctx: NewsCheckContext, report: (message: string, line?: number) => void): void {
  const published = fm.status === "published";

  if (fm.updated && fm.updated < fm.published) report(`updated (${fm.updated}) is before published (${fm.published})`);
  if (published && fm.published > ctx.today) report(`a published post is dated ${fm.published}, after today (${ctx.today}); keep it a draft until then`);

  for (const block of post.blocks) {
    if (block.type === "heading" && block.level === 1) report("no # heading in the body; the title comes from the front matter", block.line);
    for (const run of inlines(block)) {
      for (const t of run) {
        if (t.kind !== "link") continue;
        if (!ctx.wikiPages.has(t.slug)) report(`[[${t.slug}]] links to a wiki page that is not published; link a published page or write the words`, block.line);
      }
    }
  }

  if (published) {
    const words = postWords(post.blocks);
    if (words < MIN_POST_WORDS) report(`a published post needs at least ${MIN_POST_WORDS} words of its own prose; this one has ${words}`);
  }
}
