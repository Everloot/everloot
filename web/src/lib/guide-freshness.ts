import type { GuideFrontMatter } from "../../../kb/src/guides/guide";
import { MIN_PROSE_WORDS, proseWords } from "../../../kb/src/wiki/check";
import type { Guide } from "./guides";
import { codeFreshness, compareGameBuilds, freshnessLines, type ClassTalentChanges, type PlanFreshness } from "./talents/freshness";
import { importPlan } from "./talents/import";
import { forSet, levelFor, pointsAtLevel, pointsSpent } from "./talents/rules";
import type { PlanSet, TalentCatalog } from "./talents/types";

// How current a published guide still is, for its readers: whether its plan still fits the talent tree, whether the
// game files changed the plan's talents after the build it was reviewed against, and whether it is due for another
// review. People set a guide's status through review; this only reads. Nothing here writes or re-stamps: a guide
// keeps its codes, the builds they were made on and its review, and the page shows what changed since. Pure: the
// caller passes the guide, its class's tree, the class's changes from the build watch's records (read on the
// server, by freshness-records.ts) and today's date. The change evidence is the talent lane's one engine (freshness.ts).

/** Days after its last review that a guide is due for another one. */
export const REVIEW_AFTER_DAYS = 60;

/**
 * - current: nothing to report.
 * - review-due: the last review is older than REVIEW_AFTER_DAYS, or a live build is newer than the one it was reviewed against.
 * - stale: the change records show a change to its plan's talents after the build it was reviewed against.
 * - broken: its plan no longer fits the talent tree.
 */
export type GuideState = "current" | "review-due" | "stale" | "broken";

/** How the guide pages name each state. */
export const GUIDE_STATE_LABEL: Record<GuideState, string> = { current: "Current", "review-due": "Review due", stale: "Stale", broken: "Broken" };

/** What freshness reads of a guide: its class, its levels, its plan and its review. */
export type GuidePlanFields = Pick<GuideFrontMatter, "classSlug" | "levels" | "code" | "order" | "code2" | "order2" | "reviewed">;

export interface GuideSet {
  /** The set's number, as the calculator names it. */
  set: 1 | 2;
  /** The share code and the spend order token, as the guide stores them. */
  code: string;
  order: string | null;
  /** The set as the calculator opens it from the guide's link (importPlan); null when the code does not load. */
  plan: PlanSet | null;
  /** Why the set no longer fits the tree, one sentence each; empty when it fits. */
  problems: string[];
  /** What the change records say about the set's talents since its plan was made, in the change engine's words
   *  (freshnessLines); empty when the plan was made on the tree's build. */
  changes: string[];
  /** A change the records show to the set's talents came after the build the guide was reviewed against. */
  stale: boolean;
  /** When it is stale, those changes alone, with what the records cannot say about the builds since the review, in the
   *  change engine's words; empty otherwise. A change at or before the reviewed build is one the review saw. */
  sinceReview: string[];
}

export interface GuideFreshness {
  state: GuideState;
  /** Why the guide is not current, one sentence each, the worst first; empty when it is current. */
  reasons: string[];
  sets: GuideSet[];
}

const PROVISIONAL = "The spend order is provisional, made by the calculator when asked; a published guide carries only an order a player planned.";

/** The part of a plan's freshness after `build`, the one its guide was reviewed against: the changes the records place
 *  after it, and the gaps that leave the builds after it unknown. A build that cannot be compared with it counts as
 *  after; with no review, everything does. */
function afterReview(f: PlanFreshness, build: string | null): PlanFreshness {
  const after = (b: string) => build === null || (compareGameBuilds(b, build) ?? 1) === 1;
  return {
    ...f,
    touched: f.touched.map((t) => ({ ...t, changes: t.changes.filter((c) => after(c.build)) })).filter((t) => t.changes.length > 0),
    pointLevels: f.pointLevels.filter((p) => after(p.build)),
    gaps: f.gaps.filter((g) => g.kind === "unplaced" || after(g.kind === "unrecorded" ? g.to : g.build)),
  };
}

function readSet(set: 1 | 2, code: string, order: string | null, guide: GuidePlanFields, catalog: TalentCatalog, changes: ClassTalentChanges): GuideSet {
  // The levels the set's points come at, as the calculator gives them: the second set's wait for the level it opens at.
  const schedule = forSet(catalog, set === 1 ? 0 : 1);
  const opened = importPlan(catalog, code, order, schedule);
  if (!opened.ok) return { set, code, order, plan: null, problems: [opened.message], changes: [], stale: false, sinceReview: [] };
  // The calculator's own sentences for what did not place and why the order was lost. Its first, when the code was made
  // on another build, is for the change records to explain (`changes`).
  const { report } = opened;
  const problems = report.problems.slice(report.codeBuild === report.treeBuild ? 0 : 1);
  if (opened.set.orderOrigin === "provisional") problems.push(PROVISIONAL);
  const asked = pointsSpent(opened.requested);
  const most = pointsAtLevel(schedule, catalog.rules.maxLevel);
  const opens = levelFor(schedule, 1);
  const needs = levelFor(schedule, asked);
  if (asked > most) problems.push(`It spends ${asked} points, and this tree gives ${most} by level ${catalog.rules.maxLevel}.`);
  // A guide that ends before its second set opens cannot use that set.
  else if (set === 2 && opens > guide.levels.to) problems.push(`The second set opens at level ${opens}, after this guide's levels end.`);
  else if (needs > guide.levels.to) problems.push(`It needs level ${needs}, above level ${guide.levels.to}, the last this guide covers.`);
  const f = codeFreshness(catalog, changes, code);
  const since = f && afterReview(f, guide.reviewed?.build ?? null);
  const stale = since !== null && (since.touched.length > 0 || since.pointLevels.length > 0);
  // Without the engine's first line, which dates the plan: the note dates the review itself.
  return { set, code, order, plan: opened.set, problems, changes: f ? freshnessLines(f) : [], stale, sinceReview: since && stale ? freshnessLines(since).slice(1) : [] };
}

const DAY = 86_400_000;
const dayOf = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Why a guide is due for review: its last review is old, or a build players can play is newer than it. */
function dueReasons(review: GuidePlanFields["reviewed"], changes: ClassTalentChanges, today: string): string[] {
  if (!review) return ["This version has no review on record."];
  const out: string[] = [];
  const days = Math.floor((dayOf(today) - dayOf(review.on)) / DAY);
  if (days >= REVIEW_AFTER_DAYS) out.push(`Last reviewed ${days} days ago, on ${review.on}; a guide is due for another review after ${REVIEW_AFTER_DAYS} days.`);
  // A record that reads and is no spoiler is of a build players can play. The steps run oldest first.
  const live = changes.steps.filter((s) => s.readable && !s.spoiler && compareGameBuilds(s.build, review.build) === 1).at(-1);
  if (live) out.push(`Game build ${live.build} is live and newer than ${review.build}, the build this guide was reviewed against.`);
  return out;
}

/** How current a guide is, and why. `changes` is its class's, from the published change records; `today` a YYYY-MM-DD date. */
export function guideFreshness(guide: GuidePlanFields, catalog: TalentCatalog, changes: ClassTalentChanges, today: string): GuideFreshness {
  const sets = [readSet(1, guide.code, guide.order ?? null, guide, catalog, changes)];
  if (guide.code2 !== undefined) sets.push(readSet(2, guide.code2, guide.order2 ?? null, guide, catalog, changes));
  const named = (s: GuideSet, line: string) => (sets.length > 1 ? `Set ${s.set}: ${line}` : line);
  const broken = sets.flatMap((s) => s.problems.map((p) => named(s, p)));
  const stale = sets.flatMap((s) => s.sinceReview.map((l) => named(s, l)));
  const due = dueReasons(guide.reviewed, changes, today);
  const state: GuideState = broken.length ? "broken" : stale.length ? "stale" : due.length ? "review-due" : "current";
  return { state, reasons: [...broken, ...stale, ...due], sets };
}

/** Whether a guide is indexed, by the one rule its page's robots and the sitemap both use: published and reviewed, with
 *  the guides' floor of its own prose (an integrity check, not a target), and neither stale nor broken. */
export function guideIndexable(guide: Pick<Guide, "status" | "reviewed" | "blocks">, freshness: Pick<GuideFreshness, "state">): boolean {
  return guide.status === "published" && guide.reviewed !== null && proseWords(guide.blocks) >= MIN_PROSE_WORDS
    && (freshness.state === "current" || freshness.state === "review-due");
}
