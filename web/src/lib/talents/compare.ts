import { extractCode, importPlan, readPlanHash, type ImportReport } from "./import";
import { prefixRanks } from "./order";
import { nodeMap, pointsAtLevel, pointsSpent, rankOf } from "./rules";
import { decodeBuild } from "./share";
import { summarizeBuild, type BuildSummary } from "./summary";
import type { PlanSet, Ranks, TalentCatalog, TalentNode } from "./types";

// Two plans of one class side by side, as the tree on screen places them: the talents whose rank or choice differs,
// the points in each tree, and the points each code asked for that the tree did not place. Each plan loads through the
// calculator's import (import.ts), so its report and its spend order are what the calculator would show. Levels are
// compared only when both spend orders are known: an unknown order is never filled in. Nothing here re-makes a code on
// this tree's build or saves anything; the codes and order tokens stay as they came.

/** One plan as the comparison's address carries it: a share code and the order token that rides with it. */
export interface PlanRef {
  code: string;
  order: string | null;
}

/** A plan to compare: a share code, or a calculator link when `order` is left out, and the order token that came
 *  with the code (null for none). */
export interface PlanInput {
  code: string;
  order?: string | null;
}

export type Side = "a" | "b";

/** Points a code asked for in one talent that this tree did not place, all or in part. `name` is null for a talent
 *  this tree does not have. The import report's sentences say why. */
export interface RejectedPoints {
  id: number;
  name: string | null;
  asked: number;
  placed: number;
}

export interface ComparedPlan {
  /** The share code and order token as they came: never re-made on this tree's build. */
  code: string;
  token: string | null;
  /** The plan as this tree placed it. Its order is known only when the token reads and every point is legal where it stands. */
  set: PlanSet;
  summary: BuildSummary;
  minLevel: number;
  report: ImportReport;
  rejected: RejectedPoints[];
}

/** One talent the two plans do not share: the rank each has, and for a choice node the entry each picked (null
 *  without a point). */
export interface TalentDifference {
  id: number;
  treeId: number;
  name: string;
  maxRanks: number;
  a: number;
  b: number;
  choices?: { a: string | null; b: string | null };
}

export interface TreeSplit {
  tree: string;
  a: number;
  b: number;
}

/** Both plans at one level: the points the levels give by then, the points each has spent, and what differs. */
export interface Milestone {
  level: number;
  points: number;
  a: BuildSummary;
  b: BuildSummary;
  differences: TalentDifference[];
}

export interface Comparison {
  a: ComparedPlan;
  b: ComparedPlan;
  /** No talent differs: the same talents at the same ranks, with the same choices. */
  same: boolean;
  /** Whether the two spend the points in the same order; null when either order is unknown. */
  sameOrder: boolean | null;
  splits: TreeSplit[];
  differences: TalentDifference[];
  /** Null unless both spend orders are known. */
  milestones: Milestone[] | null;
}

export type CompareResult = { ok: true; comparison: Comparison } | { ok: false; errors: { side: Side; message: string }[] };

const LETTER: Record<Side, string> = { a: "A", b: "B" };
const titleCase = (slug: string) => slug[0].toUpperCase() + slug.slice(1);
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The share code and order token a pasted text names. A calculator link gives its first set's pair, or its second
 *  set's when it has only that one (Copy for addon's set two); any other text is a code without an order. */
export function planRef(text: string): PlanRef {
  if (!/[#&]plan2?=/.test(text)) return { code: text.trim(), order: null };
  const hash = readPlanHash(text);
  if (hash.first) return { code: hash.first, order: hash.firstOrder ?? null };
  return { code: hash.second ?? text.trim(), order: hash.secondOrder ?? null };
}

/** A talent as the calculator names it: a choice node by both its entries. */
const talentName = (node: TalentNode) => (node.kind === "choice" ? node.entries.map((e) => e.name).join(" or ") : node.entries[0].name);

function load(catalog: TalentCatalog, side: Side, input: PlanInput): ComparedPlan | { side: Side; message: string } {
  const { code, order } = input.order === undefined ? planRef(input.code) : { code: extractCode(input.code), order: input.order || null };
  const plan = `Plan ${LETTER[side]}`;
  if (!code) return { side, message: `${plan} is empty. Paste a share code or a calculator link.` };
  const decoded = decodeBuild(code);
  if (decoded.ok && decoded.build.classSlug !== catalog.classSlug) {
    return { side, message: `${plan} is a ${titleCase(decoded.build.classSlug)} code. Both plans must be ${catalog.className} plans to compare them here.` };
  }
  const result = importPlan(catalog, code, order);
  if (!result.ok) return { side, message: `${plan}: ${result.message}` };
  const asked = pointsSpent(result.requested);
  if (asked === 0) return { side, message: `${plan} has no talent points to compare.` };
  // Nothing to compare, and an empty set's order would read as known.
  if (pointsSpent(result.set.ranks) === 0) {
    const none = asked === 1 ? `${plan}'s only point does not place` : `None of plan ${LETTER[side]}'s ${plural(asked, "point")} place`;
    return { side, message: `${none} on this tree. ${result.report.problems.join(" ")}` };
  }
  return {
    code, token: order, set: result.set, summary: summarizeBuild(catalog, result.set.ranks), minLevel: result.minLevel, report: result.report,
    rejected: rejectedPoints(catalog, result.requested, result.set.ranks),
  };
}

/** Talents in the tree's reading order, then those it does not have, by id. */
function rejectedPoints(catalog: TalentCatalog, asked: Ranks, placed: Ranks): RejectedPoints[] {
  const nodes = nodeMap(catalog);
  const place = new Map(catalog.nodes.map((n, i) => [n.id, i]));
  const at = (id: number) => place.get(id) ?? Infinity;
  return Object.entries(asked)
    .map(([key, r]) => {
      const id = Number(key);
      const node = nodes.get(id);
      return { id, name: node ? talentName(node) : null, asked: r.rank, placed: rankOf(placed, id) };
    })
    .filter((r) => r.placed < r.asked)
    .sort((x, y) => at(x.id) - at(y.id) || x.id - y.id);
}

/** Talents whose rank, or whose picked entry, differs, in the tree's reading order. */
function differences(catalog: TalentCatalog, a: Ranks, b: Ranks): TalentDifference[] {
  return catalog.nodes.flatMap((node): TalentDifference[] => {
    const ranks = { a: rankOf(a, node.id), b: rankOf(b, node.id) };
    const base = { id: node.id, treeId: node.treeId, name: talentName(node), maxRanks: node.maxRanks, ...ranks };
    if (node.kind !== "choice") return ranks.a === ranks.b ? [] : [base];
    const pick = (r: Ranks, rank: number) => (rank > 0 ? r[node.id]?.choice ?? 0 : null);
    const [pa, pb] = [pick(a, ranks.a), pick(b, ranks.b)];
    if (pa === pb) return [];
    const entry = (p: number | null) => (p === null ? null : (node.entries[p] ?? node.entries[0]).name);
    return [{ ...base, choices: { a: entry(pa), b: entry(pb) } }];
  });
}

/** Every tenth level after the one the first point arrives at, and the top level. */
function milestoneLevels(catalog: TalentCatalog): number[] {
  const { firstPointLevel, maxLevel } = catalog.rules;
  const levels: number[] = [];
  for (let level = (Math.floor(firstPointLevel / 10) + 1) * 10; level < maxLevel; level += 10) levels.push(level);
  return [...levels, maxLevel];
}

/** Compare two plans of the catalog's class. A plan that cannot be compared (empty, damaged, for another class, or
 *  none of its points placing on this tree) fails with one sentence per side. */
export function comparePlans(catalog: TalentCatalog, a: PlanInput, b: PlanInput): CompareResult {
  const [one, two] = [load(catalog, "a", a), load(catalog, "b", b)];
  const errors = [one, two].flatMap((p) => ("message" in p ? [p] : []));
  if ("message" in one || "message" in two) return { ok: false, errors };

  const diff = differences(catalog, one.set.ranks, two.set.ranks);
  const [oa, ob] = [one.set.order, two.set.order];
  const milestones = oa && ob
    ? milestoneLevels(catalog).map((level) => {
      const points = pointsAtLevel(catalog, level);
      const [pa, pb] = [prefixRanks(one.set, points)!, prefixRanks(two.set, points)!];
      return { level, points, a: summarizeBuild(catalog, pa), b: summarizeBuild(catalog, pb), differences: differences(catalog, pa, pb) };
    })
    : null;
  return {
    ok: true,
    comparison: {
      a: one,
      b: two,
      same: diff.length === 0,
      sameOrder: oa && ob ? oa.length === ob.length && oa.every((id, i) => id === ob[i]) : null,
      splits: one.summary.trees.map((t, i) => ({ tree: t.name, a: t.points, b: two.summary.trees[i].points })),
      differences: diff,
      milestones,
    },
  };
}

// ---- the address ------------------------------------------------------------------------------
//
// A comparison is shared as /tools/talents/<class>/compare#a=<code>&ao=<order>&b=<code>&bo=<order>. Like a plan link,
// it lives in the fragment, which never reaches the server; an order rides after its own code.

const SAFE = /^[A-Za-z0-9_.-]+$/;
const COMPARE_PART = /^(?:a|ao|b|bo)=/;

/** The two plans a page address carries; a side without a code is null. */
export function readCompareHash(hash: string): { a: PlanRef | null; b: PlanRef | null } {
  const part = (key: string) => new RegExp(`[#&]${key}=([A-Za-z0-9_.-]+)`).exec(hash)?.[1] ?? null;
  const side = (code: string | null, order: string | null) => (code ? { code, order } : null);
  return { a: side(part("a"), part("ao")), b: side(part("b"), part("bo")) };
}

/** The fragment for two plans; empty when neither has a code. Text that is not a code or a token stays out. */
export function compareHash(a: PlanRef | null, b: PlanRef | null): string {
  const safe = (value: string | null | undefined) => (value && SAFE.test(value) ? value : null);
  const parts = ([["a", a], ["b", b]] as const).flatMap(([key, ref]) => {
    const code = safe(ref?.code);
    const order = code && safe(ref?.order);
    return code ? [`${key}=${code}`, ...(order ? [`${key}o=${order}`] : [])] : [];
  });
  return parts.length ? `#${parts.join("&")}` : "";
}

/** `hash` with its comparison parts swapped for those of `compare`, a compareHash, which go first. Every other part,
 *  such as a cookie choice kept in the address, stays after them as it was. */
export function replaceCompareHash(hash: string, compare: string): string {
  const others = hash.replace(/^#/, "").split("&").filter((part) => part && !COMPARE_PART.test(part));
  const parts = [...(compare ? [compare.slice(1)] : []), ...others];
  return parts.length ? `#${parts.join("&")}` : "";
}
