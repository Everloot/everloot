import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GuideFrontMatter, parseGuide, type GuideActivity, type GuideRole } from "../../../kb/src/guides/guide";
import type { Block } from "../../../kb/src/wiki/page";

/**
 * The guides under kb/guides, read from disk once per server instance (they change only with a deploy). Pure apart
 * from the read, so tests point GUIDES_DIR at fixture guides. Drafts are read but never shown: every lookup a page uses
 * skips them. A file that breaks the guide contract, such as a published guide with no review or with an order a tool
 * generated, is not read at all.
 */
export function guidesDir(): string {
  return process.env.GUIDES_DIR?.trim() || join(process.cwd(), "..", "kb", "guides");
}

export interface Guide extends GuideFrontMatter { blocks: Block[] }

function readGuide(source: string): Guide | null {
  try {
    const parsed = parseGuide(source);
    const fm = GuideFrontMatter.safeParse(parsed.data);
    return fm.success ? { ...fm.data, blocks: parsed.blocks } : null;
  } catch {
    return null;
  }
}

const loaded = new Map<string, Map<string, Guide>>();

/** Every guide that parses, drafts included, by slug. A guide that does not parse is left out; the guide check
 *  (kb/src/guides/check.ts) fails it. */
export function loadGuides(dir = guidesDir()): Map<string, Guide> {
  const known = loaded.get(dir);
  if (known) return known;
  const guides = new Map<string, Guide>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
    const guide = readGuide(readFileSync(join(dir, file), "utf8"));
    if (guide && `${guide.slug}.md` === file && !guides.has(guide.slug)) guides.set(guide.slug, guide);
  }
  loaded.set(dir, guides);
  return guides;
}

/** The published guides by title, the only ones the site builds. A draft answers 404 everywhere. */
export const publishedGuides = (guides: Map<string, Guide>): Guide[] =>
  [...guides.values()].filter((g) => g.status === "published").sort((a, b) => a.title.localeCompare(b.title));

export function publishedGuide(guides: Map<string, Guide>, slug: string): Guide | null {
  const guide = guides.get(slug);
  return guide && guide.status === "published" ? guide : null;
}

export interface GuideFilter {
  classSlug: string;
  activity?: GuideActivity;
  role?: GuideRole;
  /** A level the guide covers. */
  level?: number;
}

/** The published guides for one class, narrowed by activity, role and level, the lowest levels first. */
export function guidesFor(guides: Map<string, Guide>, filter: GuideFilter): Guide[] {
  return publishedGuides(guides)
    .filter((g) => g.classSlug === filter.classSlug)
    .filter((g) => filter.activity === undefined || g.activity === filter.activity)
    .filter((g) => filter.role === undefined || g.roles.includes(filter.role))
    .filter((g) => filter.level === undefined || (g.levels.from <= filter.level && filter.level <= g.levels.to))
    .sort((a, b) => a.levels.from - b.levels.from || a.title.localeCompare(b.title));
}

export const guideHref = (slug: string) => `/guides/${slug}`;
