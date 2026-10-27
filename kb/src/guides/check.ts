/**
 * The guide check: every rule a guide must pass before it merges. Pure: the caller passes the files, the talent trees,
 * the wiki's pages and what the game files know, so tests can use small fixtures. Given the guides as they were before
 * a change (`previous`), it also holds every published version to what it was.
 */
import { isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";
import type { ZodError } from "zod";
import { orderRefusalText, validateOrder } from "../../../web/src/lib/talents/order";
import { levelFor, pointsAtLevel, pointsSpent } from "../../../web/src/lib/talents/rules";
import { decodeBuild, decodeOrder, resolveBuild } from "../../../web/src/lib/talents/share";
import type { TalentCatalog } from "../../../web/src/lib/talents/types";
import { MIN_PROSE_WORDS, proseWords, type KnownData } from "../wiki/check.js";
import { MARKDOWN_LINK, wikiLinkTarget, type Block, type Inline, type ParsedPage } from "../wiki/page.js";
import { GUIDE_SECTIONS, GUIDE_SETS, GuideFrontMatter, guideLinkTarget, parseGuide, sitePath } from "./guide.js";

export interface GuideCheckContext {
  /** Each class's talent tree as the calculator reads it, by class slug: a guide's codes and orders must fit it. */
  catalogs: ReadonlyMap<string, TalentCatalog>;
  /** The wiki's pages by slug, with their status: a guide links only to pages that exist, a published one only to published ones. */
  wikiPages: ReadonlyMap<string, "draft" | "published">;
  /** Item and zone ids the committed game data knows, for `{item:N}` and `{zone:N}`. */
  known: Pick<KnownData, "items" | "zones">;
  /** The repository's private path pattern, read from its CI guard so the two cannot drift apart. */
  privatePaths: RegExp;
  /** Today, so a review or a source is never dated after it. */
  today: string;
  /** The guides as they were before the change, when the caller has them. */
  previous?: GuideFile[];
}

export interface GuideFile { path: string; source: string }
export interface Problem { file: string; line?: number; message: string }
export interface CheckedGuide { file: string; fm: GuideFrontMatter; page: ParsedPage }
export interface GuideCheckResult { guides: CheckedGuide[]; problems: Problem[] }

/** Where a guide's sources may be: Blizzard's own posts, on its WoW news sites and the US and EU forums. Everything else
 *  a guide says comes from Everloot's own data, linked on the site. */
const SOURCE_HOST = /^(?:worldofwarcraft\.blizzard\.com|news\.blizzard\.com|(?:us|eu)\.forums\.blizzard\.com)$/;

/** A site address that opens a talent plan: one that carries a set or its spend order, as the calculator's links do, or a
 *  build link (`/tools/talents/<class>/b/<code>`, the calculator's Copy link, and a saved build's `/b/<slug>`). */
const PLAN_IN_LINK = /[#?&](?:plan2?|order2?)=/;
const PLAN_PATH = /^\/(?:tools\/talents\/[^/]+\/b|b)\//;

const AI_CREDIT = new RegExp(
  String.raw`\b(?:generated|written|drafted|created|produced|authored)\s+(?:with|by|using)\s+(?:the\s+help\s+of\s+)?(?:an?\s+)?(?:ai|llm|claude|anthropic|chatgpt|gpt|openai|copilot|gemini|grok|codex|cursor|devin)\b` +
    String.raw`|co-authored-by:|\bai[- ]generated\b|\bas an ai\b|\bwith the help of (?:an? )?ai\b`,
  "i",
);

type LineOf = (path: readonly PropertyKey[]) => number;
type Report = (message: string, line?: number) => void;

/**
 * The line each front matter field is written on: a key's own line, or a list item's. A field that is not written
 * points at the nearest one around it that is, and at the opening --- when there is none.
 */
function fieldLines(source: string): LineOf {
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source.replace(/^﻿/, "").replace(/\r\n?/g, "\n"));
  if (!fm) return () => 1;
  const doc = parseDocument(fm[1]);
  // The front matter starts on the file's second line.
  const lineAt = (offset: number) => fm[1].slice(0, offset).split("\n").length + 1;
  return (path) => {
    let node: unknown = doc.contents;
    let line = 1;
    for (const key of path) {
      if (isMap(node)) {
        const pair = node.items.find((p) => isScalar(p.key) && p.key.value === key);
        if (!pair) break;
        if (isScalar(pair.key) && pair.key.range) line = lineAt(pair.key.range[0]);
        node = pair.value;
      } else if (isSeq(node) && typeof key === "number" && isNode(node.items[key])) {
        node = node.items[key];
        if (isNode(node) && node.range) line = lineAt(node.range[0]);
      } else break;
    }
    return line;
  };
}

/** The file line a YAML error names, when it names one. */
const errorLine = (e: unknown) => ((e as { linePos?: { line: number }[] }).linePos?.[0]?.line ?? 0) + 1;

const where = (path: readonly PropertyKey[]) => (path.length ? ` ${path.join(".")}` : "");

/** Each schema issue on the line of the field it is about, an unknown field on its own line. */
function reportIssues(error: ZodError, lineOf: LineOf, report: Report): void {
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") for (const key of issue.keys) report(`front matter${where(issue.path)}: unknown field "${key}"`, lineOf([...issue.path, key]));
    else report(issue.code === "custom" ? issue.message : `front matter${where(issue.path)}: ${issue.message}`, lineOf(issue.path));
  }
}
const slugOf = (path: string) => path.replace(/\\/g, "/").split("/").pop()!.replace(/\.md$/, "");

export function checkGuides(files: GuideFile[], ctx: GuideCheckContext): GuideCheckResult {
  const problems: Problem[] = [];
  const guides: CheckedGuide[] = [];
  const lines = new Map<CheckedGuide, LineOf>();

  for (const f of files) {
    const report: Report = (message, line) => problems.push({ file: f.path, ...(line ? { line } : {}), message });
    f.source.replace(/\r\n?/g, "\n").split("\n").forEach((text, n) => {
      if (ctx.privatePaths.test(text)) report("names a private path or internal workspace name; use generic wording", n + 1);
      if (AI_CREDIT.test(text)) report("credits an AI tool; guides name people only", n + 1);
    });

    let page: ParsedPage;
    try {
      page = parseGuide(f.source);
    } catch (e) {
      report((e as Error).message, errorLine(e));
      continue;
    }
    for (const t of page.badTokens) report(`"${t.text}" is not a token; use {item:N}, {npc:N}, {quest:N}, {zone:N}, {faction:N} or [[slug]]`, t.line);

    const lineOf = fieldLines(f.source);
    const parsed = GuideFrontMatter.safeParse(page.data);
    if (!parsed.success) {
      reportIssues(parsed.error, lineOf, report);
      continue;
    }
    const guide: CheckedGuide = { file: f.path, fm: parsed.data, page };
    if (guide.fm.slug !== slugOf(f.path)) report(`slug "${guide.fm.slug}" must match the file name (${slugOf(f.path)}.md)`, lineOf(["slug"]));
    guides.push(guide);
    lines.set(guide, lineOf);
  }

  const bySlug = new Map<string, CheckedGuide>();
  const byId = new Map<number, CheckedGuide>();
  for (const g of guides) {
    const lineOf = lines.get(g)!;
    const sameSlug = bySlug.get(g.fm.slug);
    const sameId = byId.get(g.fm.id);
    if (sameSlug) problems.push({ file: g.file, line: lineOf(["slug"]), message: `slug "${g.fm.slug}" is already used by ${sameSlug.file}` });
    else bySlug.set(g.fm.slug, g);
    if (sameId) problems.push({ file: g.file, line: lineOf(["id"]), message: `id ${g.fm.id} is already used by ${sameId.file}` });
    else byId.set(g.fm.id, g);
  }

  for (const g of guides) checkGuide(g, lines.get(g)!, ctx, bySlug, (message, line) => problems.push({ file: g.file, ...(line ? { line } : {}), message }));
  if (ctx.previous) checkVersions(guides, lines, ctx.previous, problems);
  return { guides, problems };
}

const prose = (b: Block): Inline[][] => (b.type === "paragraph" ? [b.inline] : b.type === "list" ? b.items : []);
const inlines = (b: Block): Inline[][] => (b.type === "quote" ? [b.inline] : prose(b));

/** The `##` sections in order, each with the blocks under it (`###` subsections included). */
function sectionsOf(blocks: Block[]): { heading: string; line: number; blocks: Block[] }[] {
  const out: { heading: string; line: number; blocks: Block[] }[] = [];
  for (const b of blocks) {
    if (b.type === "heading" && b.level === 2) out.push({ heading: b.text, line: b.line, blocks: [] });
    else out.at(-1)?.blocks.push(b);
  }
  return out;
}

function checkGuide(g: CheckedGuide, lineOf: LineOf, ctx: GuideCheckContext, bySlug: ReadonlyMap<string, CheckedGuide>, report: Report): void {
  const { fm, page } = g;
  const published = fm.status === "published";

  if (fm.reviewed && fm.reviewed.on > ctx.today) report(`reviewed.on (${fm.reviewed.on}) is after today (${ctx.today})`, lineOf(["reviewed"]));
  fm.sources.forEach((s, i) => {
    if (s.checkedOn > ctx.today) report(`sources.${i} was checked on ${s.checkedOn}, after today (${ctx.today})`, lineOf(["sources", i]));
  });

  const catalog = ctx.catalogs.get(fm.classSlug);
  if (catalog) checkPlan(fm, catalog, lineOf, report);
  else report(`there is no ${fm.classSlug} talent tree to check the plan against`, lineOf(["classSlug"]));

  // Sections: who, why, how and what is not known, in that order, with no text before the first.
  const sections = sectionsOf(page.blocks);
  const top = sections[0]?.line ?? page.bodyLine;
  for (const b of page.blocks) if (b.type === "heading" && b.level === 1) report("no # heading in the body; the title comes from the front matter", b.line);
  const first = page.blocks.findIndex((b) => b.type === "heading" && b.level === 2);
  const lead = page.blocks.slice(0, first === -1 ? page.blocks.length : first).find((b) => b.type !== "heading");
  if (lead) report(`text before the first ## section; start with "${GUIDE_SECTIONS[0]}"`, lead.line);
  const headings = sections.map((s) => s.heading);
  if (headings.length !== GUIDE_SECTIONS.length || headings.some((h, i) => h !== GUIDE_SECTIONS[i])) {
    report(`sections must be, in order: ${GUIDE_SECTIONS.join(", ")}; found: ${headings.join(", ") || "none"}`, top);
  }
  // An integrity floor: a published guide says something in each section and enough in all. It is not a target.
  if (published) {
    for (const s of sections) if (proseWords(s.blocks) === 0) report(`the "${s.heading}" section needs words of our own, not only quotes; a published guide says something in each`, s.line);
    const words = proseWords(page.blocks);
    if (words < MIN_PROSE_WORDS) report(`a published guide needs at least ${MIN_PROSE_WORDS} words of its own prose; this one has ${words}`, top);
  }

  // Tokens and links. A link off the site is evidence, so sources lists it; a link into the wiki or to a guide names
  // something that exists, and a published guide links only to what is published.
  const linkTo = (target: { status: string } | undefined, written: string, line: number) => {
    if (!target) report(`${written} links to a page that does not exist`, line);
    else if (published && target.status !== "published") report(`${written} links to a draft; a published guide links only to published pages`, line);
  };
  const wikiPage = (slug: string) => {
    const status = ctx.wikiPages.get(slug);
    return status && { status };
  };
  const cited = new Set<string>();
  for (const block of page.blocks) {
    for (const run of inlines(block)) {
      for (const t of run) {
        if (t.kind === "entity") {
          const why = tokenProblem(t.entity, t.id, ctx.known);
          if (why) report(`{${t.entity}:${t.id}} ${why}`, block.line);
        } else if (t.kind === "link") {
          linkTo(wikiPage(t.slug), `[[${t.slug}]]`, block.line);
        } else {
          for (const m of t.text.matchAll(MARKDOWN_LINK)) {
            const href = m[2]!;
            const wiki = wikiLinkTarget(href);
            const guide = guideLinkTarget(href);
            const path = sitePath(href);
            if (wiki !== null) linkTo(wikiPage(wiki), m[0], block.line);
            else if (guide !== null) linkTo(bySlug.get(guide)?.fm, m[0], block.line);
            else if (path === null) {
              cited.add(href);
              if (!fm.sources.some((s) => s.url === href)) report(`${href} is not in sources; list it there with the day it was checked`, block.line);
            } else if (PLAN_IN_LINK.test(href) || PLAN_PATH.test(path)) {
              report(`${m[0]} carries a talent plan; a guide's plan is its code and order, which the check reads`, block.line);
            }
          }
        }
      }
    }
  }
  fm.sources.forEach((s, i) => {
    const host = new URL(s.url).hostname;
    if (!SOURCE_HOST.test(host)) {
      report(`sources.${i} is on ${host}; a guide's sources are Blizzard's own posts (its WoW news sites and the US and EU forums), and the rest comes from Everloot's own data`, lineOf(["sources", i]));
    }
    if (!cited.has(s.url)) report(`sources.${i} is not cited in the body; link it where the claim it supports is made, or take it out`, lineOf(["sources", i]));
  });
}

/** Each set's code places exactly on the class's tree, within the points the levels give; its order is legal point by
 *  point; and the plan can be reached within the guide's levels. The build a code was made on may differ from the
 *  tree's: that is a question of how current the guide is, which readers answer, not of whether it is valid. */
function checkPlan(fm: GuideFrontMatter, catalog: TalentCatalog, lineOf: LineOf, report: Report): void {
  const last = catalog.rules.maxLevel;
  if (fm.levels.to > last) report(`levels.to (${fm.levels.to}) is above the tree's last level (${last})`, lineOf(["levels"]));
  for (const [codeKey, orderKey] of GUIDE_SETS) {
    const code = fm[codeKey];
    const decoded = code === undefined ? null : decodeBuild(code);
    // The schema has refused a code that does not read or is another class's.
    const resolved = decoded?.ok ? resolveBuild(catalog, decoded.build) : null;
    if (!decoded?.ok || !resolved?.ok) continue;
    const { ranks, unknown, clamped, rejected } = resolved.build;
    const at = lineOf([codeKey]);
    if (unknown.length) report(`${codeKey}: the ${catalog.className} tree does not have ${unknown.length === 1 ? "node" : "nodes"} ${unknown.map((u) => u.id).join(", ")}`, at);
    for (const c of clamped) {
      report(c.what === "rank" ? `${codeKey}: ${c.name} is at rank ${c.asked}, and the tree allows ${c.got}` : `${codeKey}: ${c.name} picks a choice the tree does not have`, at);
    }
    for (const r of rejected) report(`${codeKey}: ${r.name} cannot be placed: ${r.why}`, at);
    if (unknown.length || clamped.length || rejected.length) continue;

    const spent = pointsSpent(ranks);
    const most = pointsAtLevel(catalog, last);
    if (spent > most) {
      report(`${codeKey} spends ${spent} points, and the tree gives ${most} by level ${last}`, at);
      continue;
    }
    const needs = levelFor(catalog, spent);
    if (needs > fm.levels.to) report(`${codeKey === "code" ? "the plan" : "the second set"} needs level ${needs}, above levels.to (${fm.levels.to})`, lineOf(["levels"]));

    const token = fm[orderKey];
    const order = token === undefined ? null : decodeOrder(token, decoded.build.ranks);
    if (!order?.ok) continue;
    const verdict = validateOrder(catalog, ranks, order.order);
    if (!verdict.ok) report(`${orderKey}: ${orderRefusalText(catalog, ranks, order.order, verdict)}`, lineOf([orderKey]));
  }
}

/** Why an entity token cannot be shown, or null when it can. */
function tokenProblem(kind: string, id: number, known: GuideCheckContext["known"]): string | null {
  switch (kind) {
    case "item":
      return known.items.has(id) ? null : "is not an item in the game files";
    case "zone":
      return known.zones.has(id) ? null : "is not a released zone in the game files";
    default:
      return null;
  }
}

/** What a version is: everything in the file but its status, which withdrawing a guide changes. */
const contentOf = ({ fm, page }: { fm: GuideFrontMatter; page: ParsedPage }) =>
  JSON.stringify([{ ...fm, status: undefined }, page.blocks.map((b) => ({ ...b, line: undefined }))]);

/** A file as it was before the change, or null after saying why it does not read. Its published versions then cannot be
 *  held to what they were, so the check fails rather than let an edit or a deletion through unchecked. */
function readPrevious(f: GuideFile, report: Report): { fm: GuideFrontMatter; page: ParsedPage } | null {
  let page: ParsedPage;
  try {
    page = parseGuide(f.source);
  } catch (e) {
    report((e as Error).message, errorLine(e));
    return null;
  }
  const parsed = GuideFrontMatter.safeParse(page.data);
  if (parsed.success) return { fm: parsed.data, page };
  reportIssues(parsed.error, fieldLines(f.source), report);
  return null;
}

/**
 * Published versions stay as they were. Against the guides before the change: a published version that has changed
 * is a new version; versions only go up; history only grows; a guide that has been published keeps its slug and is
 * withdrawn as a draft, never deleted. A guide that was never published may change or go.
 */
function checkVersions(guides: CheckedGuide[], lines: ReadonlyMap<CheckedGuide, LineOf>, previous: GuideFile[], problems: Problem[]): void {
  const byId = new Map(guides.map((g) => [g.fm.id, g]));
  for (const f of previous) {
    const before: Report = (message, line) =>
      problems.push({ file: f.path, ...(line ? { line } : {}), message: `as it was before this change, the file does not read, so its published versions cannot be checked: ${message}` });
    const was = readPrevious(f, before);
    if (!was) continue;
    const g = byId.get(was.fm.id);
    if (!g) {
      if (was.fm.history.length) problems.push({ file: f.path, message: `guide ${was.fm.id} (${was.fm.slug}) was published and is gone; a published guide stays, with status: draft to withdraw it` });
      continue;
    }
    const lineOf = lines.get(g)!;
    const report: Report = (message, line) => problems.push({ file: g.file, ...(line ? { line } : {}), message });
    if (was.fm.history.length && g.fm.slug !== was.fm.slug) report(`slug "${g.fm.slug}" was "${was.fm.slug}"; a published guide keeps its slug, so its address stays`, lineOf(["slug"]));
    if (g.fm.version < was.fm.version) report(`version ${g.fm.version} is below version ${was.fm.version} already in the repository; versions only go up`, lineOf(["version"]));
    if (g.fm.version === was.fm.version && was.fm.version <= was.fm.history.length) {
      if (contentOf(g) !== contentOf(was)) {
        report(`version ${g.fm.version} is published and has changed; a change to a published guide is version ${g.fm.version + 1}, with its own review in history`, lineOf(["version"]));
      }
      continue;
    }
    for (const [i, entry] of was.fm.history.entries()) {
      const kept = g.fm.history[i];
      if (!kept) {
        report(`history lost version ${entry.version}; history only grows`, lineOf(["history"]));
        break;
      }
      if (JSON.stringify(kept) !== JSON.stringify(entry)) report(`history.${i} differs from version ${entry.version} as it was published; history only grows`, lineOf(["history", i]));
    }
  }
}
