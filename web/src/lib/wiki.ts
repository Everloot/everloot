import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { MIN_PROSE_WORDS, proseWords } from "../../../kb/src/wiki/check";
import { FrontMatter, parsePage, SECTIONS, type Block, type Inline, type PageType } from "../../../kb/src/wiki/page";

export type { Block, Inline, PageType };

/**
 * The wiki pages under kb/wiki, read from disk once per server instance (they change only with a deploy;
 * next.config.js traces the folder into the /wiki functions). Pure apart from the read, so tests point
 * WIKI_DIR at fixture pages. Drafts are read but never shown: every lookup the pages use skips them.
 */
export function wikiDir(): string {
  return process.env.WIKI_DIR?.trim() || join(process.cwd(), "..", "kb", "wiki");
}

export interface WikiPage {
  slug: string;
  title: string;
  type: PageType;
  binds: Record<string, unknown>;
  summary: string;
  categories: string[];
  origin: "original" | "adapted";
  adaptedFrom: { title: string; url: string }[];
  status: "draft" | "published";
  reviewed: { by: string; on: string } | null;
  blocks: Block[];
}

export interface Wiki {
  /** Every page that parses, drafts included, by slug. */
  pages: Map<string, WikiPage>;
  /** Category slug to the name categories.yaml gives it. */
  categories: Map<string, string>;
}

/** The name each type has on the hub, and the word its page title ends with. */
export const TYPE_LABEL: Record<PageType, { plural: string; word: string }> = {
  dungeon: { plural: "Dungeons", word: "dungeon" },
  raid: { plural: "Raids", word: "raid" },
  zone: { plural: "Zones", word: "zone" },
  npc: { plural: "Notable characters", word: "NPC" },
  faction: { plural: "Factions", word: "faction" },
  "item-set": { plural: "Item sets", word: "item set" },
  event: { plural: "Events", word: "event" },
  concept: { plural: "Concepts", word: "guide" },
  change: { plural: "Forever changes", word: "change" },
  race: { plural: "Races", word: "race" },
  class: { plural: "Classes", word: "class" },
};

/** A page that does not parse is left out here; `npm run kb -- wiki-check` fails it in CI. */
function readPage(source: string): WikiPage | null {
  try {
    const parsed = parsePage(source);
    const fm = FrontMatter.safeParse(parsed.data);
    if (!fm.success) return null;
    const { slug, title, type, binds, summary, categories, origin, adaptedFrom, status, reviewed } = fm.data;
    return { slug, title, type, binds, summary, categories, origin, adaptedFrom: adaptedFrom.map(({ title, url }) => ({ title, url })), status, reviewed, blocks: parsed.blocks };
  } catch {
    return null;
  }
}

function readCategories(source: string): Map<string, string> {
  const doc = (parseYaml(source) ?? {}) as Record<string, Record<string, string> | null>;
  return new Map(Object.values(doc).flatMap((group) => Object.entries(group ?? {})));
}

const loaded = new Map<string, Wiki>();

export function loadWiki(dir = wikiDir()): Wiki {
  const known = loaded.get(dir);
  if (known) return known;
  const pages = new Map<string, WikiPage>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort()) {
    const page = readPage(readFileSync(join(dir, file), "utf8"));
    if (page && `${page.slug}.md` === file && !pages.has(page.slug)) pages.set(page.slug, page);
  }
  const wiki = { pages, categories: readCategories(readFileSync(join(dir, "categories.yaml"), "utf8")) };
  loaded.set(dir, wiki);
  return wiki;
}

/** The published pages, the only ones the site builds. A draft answers 404 everywhere, previews included. */
export const publishedPages = (wiki: Wiki): WikiPage[] => [...wiki.pages.values()].filter((p) => p.status === "published");

export function publishedPage(wiki: Wiki, slug: string): WikiPage | null {
  const page = wiki.pages.get(slug);
  return page && page.status === "published" ? page : null;
}

export const wikiHref = (slug: string) => `/wiki/${slug}`;

/** The published zone page that binds this zone, for the zone's database page; a draft or an unreadable wiki gives none, never a failed page. */
export function zoneWikiPage(mapId: number, wiki: () => Wiki = loadWiki): WikiPage | null {
  try {
    return publishedPages(wiki()).find((p) => p.type === "zone" && p.binds.zone === mapId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a page binds anything. A dungeon, raid or race written from a Blizzard post before the game files
 * have it may bind nothing yet; it then has no infobox or data blocks to show.
 */
export const isBound = (page: Pick<WikiPage, "binds">): boolean => Object.values(page.binds).some((v) => v !== undefined && v !== null);

/**
 * Whether a published page is indexed: reviewed, bound to at least one id, with its own prose over the bar. An
 * adapted page stays out of search until the overlap check against the Warcraft Wiki dump exists, which is
 * what makes adapted text safe to index.
 */
export function wikiIndexable(page: WikiPage): boolean {
  return page.status === "published" && page.reviewed !== null && page.origin === "original" && isBound(page) && proseWords(page.blocks) >= MIN_PROSE_WORDS;
}

/** The hub is indexed once it lists at least one indexable page. */
export const hubIndexable = (wiki: Wiki): boolean => publishedPages(wiki).some(wikiIndexable);

const TITLE_MAX = 60;

/** "Deadmines · WoW Forever dungeon", shortened to fit 60 characters: the type word goes first, then the site words. */
export function wikiTitle(page: Pick<WikiPage, "title" | "type">): string {
  const full = `${page.title} · WoW Forever ${TYPE_LABEL[page.type].word}`;
  if (full.length <= TITLE_MAX) return full;
  const short = `${page.title} · WoW Forever`;
  return short.length <= TITLE_MAX ? short : page.title;
}

export interface WikiSection { heading: string; blocks: Block[] }

/** The `##` sections with the blocks under each, in the order the page type sets (a concept page keeps its own order). */
export function sectionsInOrder(page: Pick<WikiPage, "type" | "blocks">): WikiSection[] {
  const out: WikiSection[] = [];
  for (const b of page.blocks) {
    if (b.type === "heading" && b.level <= 2) out.push({ heading: b.text, blocks: [] });
    else out.at(-1)?.blocks.push(b);
  }
  const rule = SECTIONS[page.type];
  if (rule.free !== undefined) return out;
  const order = [...rule.required, ...rule.optional];
  const rank = (h: string) => (order.includes(h) ? order.indexOf(h) : order.length);
  return out.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.heading) - rank(b.s.heading) || a.i - b.i).map(({ s }) => s);
}

/** Every inline run of a block, quotes included. */
export function inlinesOf(b: Block): Inline[][] {
  return b.type === "list" ? b.items : b.type === "heading" ? [] : [b.inline];
}

/** The slugs a page links to with `[[slug]]`. */
export function linksOf(page: Pick<WikiPage, "blocks">): Set<string> {
  const out = new Set<string>();
  for (const b of page.blocks) for (const run of inlinesOf(b)) for (const t of run) if (t.kind === "link") out.add(t.slug);
  return out;
}

/** The published pages that link to this one, by title: the "Linked from" list. */
export function linkedFrom(wiki: Wiki, slug: string): WikiPage[] {
  return publishedPages(wiki)
    .filter((p) => p.slug !== slug && linksOf(p).has(slug))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Published pages, the most recently reviewed first. */
export function recentPages(wiki: Wiki, limit = 6): WikiPage[] {
  return publishedPages(wiki)
    .sort((a, b) => (b.reviewed?.on ?? "").localeCompare(a.reviewed?.on ?? "") || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** The sitemap's wiki entries: the hub once it is indexed, then each indexable page dated by its review. */
export function wikiSitemapPaths(wiki: Wiki = loadWiki()): { path: string; lastModified?: Date }[] {
  const pages = publishedPages(wiki).filter(wikiIndexable);
  if (!pages.length) return [];
  return [{ path: "/wiki" }, ...pages.map((p) => ({ path: wikiHref(p.slug), lastModified: new Date(p.reviewed!.on) }))];
}
