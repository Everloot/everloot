/**
 * What the post check reads from disk: the posts under kb/news and the published wiki slugs a post may link.
 * Kept apart from check.ts so the rules stay testable without files.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FrontMatter, parsePage } from "../wiki/page.js";
import { readWikiPages } from "../wiki/data.js";
import type { NewsFile } from "./check.js";

export const NEWS_DIR = fileURLToPath(new URL("../../news/", import.meta.url));

/** Every `*.md` post in the folder except its README, with paths relative to kb/ for messages. */
export function readNewsPosts(dir = NEWS_DIR): NewsFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => ({ path: `news/${f}`, source: readFileSync(join(dir, f), "utf8") }));
}

/** The slugs of the wiki's published pages: the only ones a published post may link with `[[slug]]`. */
export function publishedWikiSlugs(dir?: string): Set<string> {
  const out = new Set<string>();
  for (const f of readWikiPages(dir)) {
    try {
      const fm = FrontMatter.safeParse(parsePage(f.source).data);
      if (fm.success && fm.data.status === "published") out.add(fm.data.slug);
    } catch {
      // A page that does not parse is the wiki check's problem, not this one's.
    }
  }
  return out;
}
