/**
 * The page check (`npm run kb -- wiki-check`): every rule a wiki page must pass before it merges. Pure: the
 * caller passes the files, the category list and what the game files know, so tests can use small fixtures.
 * The overlap check against the Warcraft Wiki dump is not here; it needs the dump, which CI does not have.
 */
import { BINDS, BLIZZARD_SOURCED, FrontMatter, inlineText, parsePage, PREP_SECTION, SECTIONS, type Block, type Inline, type ParsedPage } from "./page.js";

/** Ids the committed game data knows. Kinds with no committed list (NPCs, quests, factions) are checked for shape and range only. */
export interface KnownData {
  items: ReadonlySet<number>;
  /** Released zones (UiMap ids); zones the map holds back are not here. */
  zones: ReadonlySet<number>;
  /** Dungeon and raid entrances by the slug of their name. */
  entrances: ReadonlyMap<string, { raid: boolean }>;
  itemSets: ReadonlySet<number>;
  /** Entry ids of the /changes timeline. */
  changes: ReadonlySet<string>;
}

export interface CheckContext {
  categories: ReadonlySet<string>;
  known: KnownData;
  /** The repository's private path pattern, read from its CI guard so the two cannot drift apart. */
  privatePaths: RegExp;
}

export interface WikiFile { path: string; source: string }
export interface Problem { file: string; line?: number; message: string }
export interface CheckedPage { file: string; fm: FrontMatter; page: ParsedPage }
export interface CheckResult { pages: CheckedPage[]; problems: Problem[] }

/** The index bar: an indexable page has at least this many words of its own prose. */
export const MIN_PROSE_WORDS = 150;

/** Credit lines name the Warcraft Wiki's contributors, so an adapted page can only come from there. */
const WIKI_HOST = /(^|\.)warcraft\.wiki\.gg$/;

/** Blizzard's own posts: its WoW news site and the US and EU forums. */
const BLIZZARD_HOST = /^(?:worldofwarcraft\.blizzard\.com|(?:us|eu)\.forums\.blizzard\.com)$/;

export const hasBlizzardSource = (fm: FrontMatter): boolean => fm.sources.some((s) => BLIZZARD_HOST.test(new URL(s.url).hostname));

const AI_CREDIT = new RegExp(
  String.raw`\b(?:generated|written|drafted|created|produced|authored)\s+(?:with|by|using)\s+(?:the\s+help\s+of\s+)?(?:an?\s+)?(?:ai|llm|claude|anthropic|chatgpt|gpt|openai|copilot|gemini|grok|codex|cursor|devin)\b` +
    String.raw`|co-authored-by:|\bai[- ]generated\b|\bas an ai\b|\bwith the help of (?:an? )?ai\b`,
  "i",
);

const UNITS = "levels?|lvls?|ilvl|players?|man|gold|silver|copper|yards?|yds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|hp|health|mana|rage|energy|damage|dps|armou?r|stamina|strength|agility|intellect|spirit|resistance|reputation|rep|xp|experience|slots?|stacks?|bosses|boss|quests?|drops?|charges?|kills?|honou?r";
/** A gameplay number written by hand: a digit next to a unit, a level, a percentage or a map coordinate. */
const GAMEPLAY_NUMBER = [
  new RegExp(String.raw`\d(?:[\d,.]*\d)?\s*(?:-\s*)?(?:${UNITS})\b`, "i"),
  /\b\d+g\b/,
  /\b(?:level|levels|lvl|ilvl|item level|rank)\s+\d+/i,
  /\d\s*%/,
  /\b\d{1,3}\.\d+\s*,\s*\d{1,3}\.\d+\b|\(\s*\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?\s*\)/,
];

/** Text with quotes, links' addresses and URLs taken out: what the number rule reads. */
function ownText(text: string): string {
  return text.replace(/\]\([^)]*\)/g, "]").replace(/https?:\/\/\S+/g, " ").replace(/"[^"\n]*"|“[^”\n]*”/g, " ");
}

export const typedNumber = (text: string): string | null => {
  const own = ownText(text);
  for (const re of GAMEPLAY_NUMBER) {
    const m = re.exec(own);
    if (m) return m[0].trim();
  }
  return null;
};

const prose = (b: Block): Inline[][] => (b.type === "paragraph" ? [b.inline] : b.type === "list" ? b.items : []);
const inlines = (b: Block): Inline[][] => (b.type === "quote" ? [b.inline] : prose(b));

/** Words of the page's own prose: paragraphs and lists, not headings or quotes. A token counts as one word. */
export function proseWords(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) for (const i of prose(b)) n += (inlineText(i).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  return n;
}

/** The `##` sections in order, each with the blocks under it (`###` subsections included). */
function sectionsOf(blocks: Block[]): { heading: string; line: number; blocks: Block[] }[] {
  const out: { heading: string; line: number; blocks: Block[] }[] = [];
  for (const b of blocks) {
    if (b.type === "heading" && b.level === 2) out.push({ heading: b.text, line: b.line, blocks: [] });
    else out.at(-1)?.blocks.push(b);
  }
  return out;
}

function slugOf(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop()!.replace(/\.md$/, "");
}

export function checkWiki(files: WikiFile[], ctx: CheckContext): CheckResult {
  const problems: Problem[] = [];
  const pages: CheckedPage[] = [];

  for (const f of files) {
    const report = (message: string, line?: number) => problems.push({ file: f.path, ...(line ? { line } : {}), message });
    f.source.replace(/\r\n?/g, "\n").split("\n").forEach((text, n) => {
      if (ctx.privatePaths.test(text)) report("names a private path or internal workspace name; use generic wording", n + 1);
      if (AI_CREDIT.test(text)) report("credits an AI tool; pages name people only", n + 1);
    });

    let page: ParsedPage;
    try {
      page = parsePage(f.source);
    } catch (e) {
      report((e as Error).message);
      continue;
    }
    for (const t of page.badTokens) report(`"${t.text}" is not a token; use {item:N}, {npc:N}, {quest:N}, {zone:N}, {faction:N} or [[slug]]`, t.line);

    const parsed = FrontMatter.safeParse(page.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) report(`front matter${issue.path.length ? ` ${issue.path.join(".")}` : ""}: ${issue.message}`);
      continue;
    }
    const fm = parsed.data;
    if (fm.slug !== slugOf(f.path)) report(`slug "${fm.slug}" must match the file name (${slugOf(f.path)}.md)`);
    pages.push({ file: f.path, fm, page });
  }

  const bySlug = new Map<string, CheckedPage>();
  const byId = new Map<number, CheckedPage>();
  for (const p of pages) {
    const sameSlug = bySlug.get(p.fm.slug);
    const sameId = byId.get(p.fm.id);
    if (sameSlug) problems.push({ file: p.file, message: `slug "${p.fm.slug}" is already used by ${sameSlug.file}` });
    else bySlug.set(p.fm.slug, p);
    if (sameId) problems.push({ file: p.file, message: `id ${p.fm.id} is already used by ${sameId.file}` });
    else byId.set(p.fm.id, p);
  }

  for (const p of pages) checkPage(p, ctx, bySlug, (message, line) => problems.push({ file: p.file, ...(line ? { line } : {}), message }));
  return { pages, problems };
}

function checkPage(p: CheckedPage, ctx: CheckContext, bySlug: ReadonlyMap<string, CheckedPage>, report: (message: string, line?: number) => void): void {
  const { fm, page } = p;
  const { known } = ctx;
  const published = fm.status === "published";

  for (const c of fm.categories) if (!ctx.categories.has(c)) report(`category "${c}" is not in categories.yaml`);

  // Bindings: the shape for the type, then each id against the game data.
  const binds = BINDS[fm.type].safeParse(fm.binds);
  if (!binds.success) for (const issue of binds.error.issues) report(`binds${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`);
  const b = fm.binds as Record<string, unknown>;
  if (binds.success) {
    const sourced = BLIZZARD_SOURCED[fm.type];
    if (sourced && b[sourced] === undefined && !hasBlizzardSource(fm)) {
      report(`binds.${sourced}: required unless the page lists a Blizzard post (worldofwarcraft.blizzard.com or the US or EU forums) in sources`);
    }
    if (typeof b.entrance === "string") {
      const e = known.entrances.get(b.entrance);
      if (!e) report(`binds.entrance "${b.entrance}" is not a dungeon or raid entrance in the game files`);
      else if (e.raid !== (fm.type === "raid")) report(`binds.entrance "${b.entrance}" is a ${e.raid ? "raid" : "dungeon"}, but the page type is ${fm.type}`);
    }
    if (typeof b.zone === "number" && !known.zones.has(b.zone)) report(`binds.zone ${b.zone} is not a released zone in the game files`);
    if (typeof b.itemSet === "number" && !known.itemSets.has(b.itemSet)) report(`binds.itemSet ${b.itemSet} is not an item set in the game files`);
    for (const c of Array.isArray(b.changes) ? (b.changes as string[]) : []) if (!known.changes.has(c)) report(`binds.changes "${c}" is not an entry on /changes`);
  }

  // Tokens and links in the body.
  for (const block of page.blocks) {
    for (const run of inlines(block)) {
      for (const t of run) {
        if (t.kind === "entity") {
          const why = tokenProblem(t.entity, t.id, known);
          if (why) report(`{${t.entity}:${t.id}} ${why}`, block.line);
        } else if (t.kind === "link") {
          const target = bySlug.get(t.slug);
          if (!target) report(`[[${t.slug}]] links to a page that does not exist`, block.line);
          else if (published && target.fm.status !== "published") report(`[[${t.slug}]] links to a draft; a published page links only to published pages`, block.line);
        }
      }
    }
  }

  // No hand-typed gameplay numbers outside a quote.
  for (const [field, text] of [["title", fm.title], ["summary", fm.summary]] as const) {
    const n = typedNumber(text);
    if (n) report(`${field} has a hand-typed gameplay number ("${n}"); numbers come from the infobox and data blocks`);
  }
  for (const block of page.blocks) {
    const texts = block.type === "heading" ? [block.text] : prose(block).map((i) => inlineText(i));
    for (const text of texts) {
      const n = typedNumber(text);
      if (n) report(`hand-typed gameplay number ("${n}") outside a quote; numbers come from the infobox and data blocks`, block.line);
    }
  }

  // Sections: the type's order, `##` for sections, no text before the first one.
  const rule = SECTIONS[fm.type];
  for (const block of page.blocks) if (block.type === "heading" && block.level === 1) report("no # heading in the body; the title comes from the front matter", block.line);
  const firstSection = page.blocks.findIndex((x) => x.type === "heading" && x.level === 2);
  const lead = page.blocks.slice(0, firstSection === -1 ? page.blocks.length : firstSection).find((x) => x.type !== "heading");
  if (lead) report("text before the first ## section; start with the type's first section", lead.line);
  const sections = sectionsOf(page.blocks);
  const headings = sections.map((s) => s.heading);
  if (rule.free !== undefined) {
    if (headings.length > rule.free) report(`a ${fm.type} page has at most ${rule.free} sections; this one has ${headings.length}`);
  } else {
    const allowed = [...rule.required, ...rule.optional];
    const fits = headings.length >= rule.required.length && headings.length <= allowed.length && headings.every((h, i) => h === allowed[i]);
    if (!fits) report(`sections must be, in order: ${rule.required.join(", ")}${rule.optional.length ? ` (then optionally ${rule.optional.join(", ")})` : ""}; found: ${headings.join(", ") || "none"}`);
  }

  // Advice for a group about to go in: Everloot's own words only, and never a bare heading on a built page.
  const prep = rule.optional.includes(PREP_SECTION) ? sections.find((s) => s.heading === PREP_SECTION) : undefined;
  if (prep && fm.origin === "adapted") report(`a "${PREP_SECTION}" section is original advice; an adapted page has none`, prep.line);
  if (prep && published && !prep.blocks.some((x) => x.type !== "heading")) {
    report(`a published page's "${PREP_SECTION}" section needs advice in it; leave the heading out until there is some`, prep.line);
  }

  // Origin and credit.
  if (fm.origin === "adapted") {
    if (!fm.adaptedFrom.length) report("an adapted page needs adaptedFrom (title, url, extId, revision of each Warcraft Wiki page it reuses) for its credit line");
    for (const a of fm.adaptedFrom) if (!WIKI_HOST.test(new URL(a.url).hostname)) report(`adaptedFrom ${a.url} is not a Warcraft Wiki page; the credit line names the Warcraft Wiki contributors`);
    if (published) report("an adapted page cannot be published until the overlap check against the wiki dump exists");
  } else if (fm.adaptedFrom.length) {
    report("an original page has no adaptedFrom; set origin: adapted if it reuses wiki text");
  }

  // The index bar, for published pages.
  if (published) {
    if (!fm.reviewed) report("a published page needs reviewed: { by, on } from the maintainer who approved it");
    const words = proseWords(page.blocks);
    if (words < MIN_PROSE_WORDS) report(`a published page needs at least ${MIN_PROSE_WORDS} words of its own prose; this one has ${words}`);
    if (!Object.values(b).some((v) => v !== undefined && v !== null)) report("a published page binds at least one id, so it shows at least one live data block");
    const forever = sections.find((s) => s.heading === rule.forever);
    if (!forever || !forever.blocks.some((x) => x.type !== "heading")) report(`a published page needs a "${rule.forever}" section with something in it`);
  }
}

/** Why an entity token cannot be shown, or null when it can. */
function tokenProblem(kind: string, id: number, known: KnownData): string | null {
  switch (kind) {
    case "item":
      return known.items.has(id) ? null : "is not an item in the game files";
    case "zone":
      return known.zones.has(id) ? null : "is not a released zone in the game files";
    default:
      return null;
  }
}
