/**
 * What the post check reads from disk: the posts under kb/news and the published wiki slugs a post may link.
 * Kept apart from check.ts so the rules stay testable without files.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FrontMatter, parsePage } from "../wiki/page.js";
import { readWikiPages } from "../wiki/data.js";
import type { NewsFile } from "./check.js";

export const NEWS_DIR = fileURLToPath(new URL("../../news/", import.meta.url));
/** The site's static files, where a figure's `/news/figures/…` path is committed. */
export const WEB_PUBLIC = fileURLToPath(new URL("../../../web/public/", import.meta.url));

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

/**
 * A figure's width and height, read from its WebP header (lossy, lossless or extended), or null when the file is not
 * there or is not a WebP. The site never reads the file: it draws every figure at the size the check holds it to.
 */
export function figureSize(src: string, publicDir = WEB_PUBLIC): { width: number; height: number } | null {
  const path = join(publicDir, src);
  if (!existsSync(path)) return null;
  const b = readFileSync(path);
  if (b.length < 30 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return null;
  switch (b.toString("latin1", 12, 16)) {
    case "VP8 ": return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    case "VP8L": { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
    case "VP8X": return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    default: return null;
  }
}
