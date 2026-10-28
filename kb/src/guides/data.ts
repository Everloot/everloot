/**
 * What the guide check reads from disk: the guides under kb/guides, the wiki's pages, the talent trees the site ships,
 * the committed game data and the repository's private path pattern. Kept apart from check.ts so the rules stay
 * testable without files.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { siteCatalogs } from "../talents/site-catalogs.js";
import { loadKnownData, loadPrivatePathPattern, readWikiPages } from "../wiki/data.js";
import { FrontMatter, parsePage } from "../wiki/page.js";
import type { GuideCheckContext, GuideFile } from "./check.js";

export const GUIDES_DIR = fileURLToPath(new URL("../../guides/", import.meta.url));

/** Every `*.md` guide in the folder except its README, with paths relative to kb/ for messages. A copy of the folder as
 *  it was before a change reads the same way, for the check's `previous`. */
export function readGuideFiles(dir = GUIDES_DIR): GuideFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort()
    .map((f) => ({ path: `guides/${f}`, source: readFileSync(join(dir, f), "utf8") }));
}

/** The wiki's pages by slug, with their status: what a guide's `[[slug]]` and /wiki/ links may name. */
export function wikiPageStatuses(dir?: string): Map<string, "draft" | "published"> {
  const out = new Map<string, "draft" | "published">();
  for (const f of readWikiPages(dir)) {
    try {
      const fm = FrontMatter.safeParse(parsePage(f.source).data);
      if (fm.success && !out.has(fm.data.slug)) out.set(fm.data.slug, fm.data.status);
    } catch {
      // A page that does not parse is the wiki check's problem, not this one's.
    }
  }
  return out;
}

/** Everything the check reads besides the guides themselves, from the repository as it is. */
export function loadGuideCheckContext(today = new Date().toISOString().slice(0, 10)): GuideCheckContext {
  const { items, zones } = loadKnownData();
  return {
    catalogs: new Map(siteCatalogs().map((c) => [c.classSlug, c])),
    wikiPages: wikiPageStatuses(),
    known: { items, zones },
    privatePaths: loadPrivatePathPattern(),
    today,
  };
}
