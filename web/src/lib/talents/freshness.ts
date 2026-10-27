import beta70532 from "@/data/game-data/changes/wow_classic_beta-70532.json";
import wowf70630 from "@/data/game-data/changes/wowf-70630.json";
import { ChangeEntry, type TalentChanges } from "../../../../kb/src/build-watch/changes";
import { decodeBuild } from "./share";
import type { Ranks, TalentCatalog } from "./types";

// What the game files changed in a plan's talents between the build it was made on and the tree on screen,
// read from the build watch's change records (web/src/data/game-data/changes/, shape in
// kb/src/build-watch/changes.ts). The one change engine for plans, guides and watches. It reports evidence
// only: a change a record shows, or why the records cannot say. A missing record, or one that says it could not
// make a comparison, never reads as "nothing changed". Whether a guide is due for review, and since when, is the
// content's call: nothing here reads a date, and nothing here writes, so a plan keeps the build it was made on.

/** The build watch's published records, bundled with the pages that read them. A new build's pull request adds
 *  its record to the folder; list it here in the same pull request (freshness.test.ts fails until it is). */
export const PUBLISHED_CHANGES: readonly unknown[] = [beta70532, wowf70630];

const BUILD = /^\d+(?:\.\d+)*$/;

/** Order of two game builds such as "1.60.1.70450": -1, 0 or 1, each part compared as a whole number, so
 *  9999 comes before 70450. Null when either is not a build (empty, a letter, a stray dot or space, another
 *  number of parts): no order is guessed. */
export function compareGameBuilds(a: unknown, b: unknown): -1 | 0 | 1 | null {
  if (typeof a !== "string" || typeof b !== "string" || !BUILD.test(a) || !BUILD.test(b)) return null;
  const x = a.split(".");
  const y = b.split(".");
  if (x.length !== y.length) return null;
  for (let i = 0; i < x.length; i++) {
    // Digits without leading zeros: the longer is the larger, and at equal length text order is number order.
    const p = x[i].replace(/^0+(?=\d)/, "");
    const q = y[i].replace(/^0+(?=\d)/, "");
    if (p !== q) return (p.length === q.length ? p < q : p.length < q.length) ? -1 : 1;
  }
  return 0;
}

type Unlock = TalentChanges["gates"][number]["before"];

/** A talent's place in its tree, 1-based as on the calculator. */
export interface Place {
  tree: string | null;
  row: number;
  col: number;
}

/** One change a record shows to one talent of the class. `spoiler`: from a build players cannot play yet. */
export type TalentChange = { build: string; nodeId: number; name: string; spoiler: boolean } & (
  | { kind: "added" | "removed" | "prereqs" | "replaced" }
  | { kind: "moved"; from: Place; to: Place }
  | { kind: "ranks"; before: number; after: number }
  | { kind: "gates"; before: Unlock; after: Unlock }
  /** The spell's fields that changed; "text" is the tooltip text, compared by a hash and never kept. */
  | { kind: "spellValues"; fields: string[] }
);

/** A comparison a record says it could not make: the spell numbers of talents, or one a warning names that this
 *  site does not know, read as missing. */
export type Limit = "spellValues" | "unknown";

/** One record, read for one class. */
export interface BuildStep {
  build: string;
  /** The build the record compares with; null for a baseline or a record that does not read. */
  previous: string | null;
  /** False when the file names its build but does not read as a change record. */
  readable: boolean;
  /** The record starts a history: it lists no changes. */
  baseline: boolean;
  spoiler: boolean;
  /** The build added or removed the class's talent trees, so its talents cannot be compared across it. */
  classChanged: boolean;
  talents: TalentChange[];
  /** The levels talent points arrive at, where the build changed them. */
  pointLevels: { before: number[]; after: number[]; spoiler: boolean }[];
  /** Comparisons the record could not make, from its warnings: what it lists may not be everything. */
  limits: Limit[];
}

// The warnings the build watch writes (kb/src/build-watch/diff.ts and client-digests.ts). Three leave the talent
// comparison whole: differing table layouts say where a listed change may come from, and the client digests and
// tables are the read set. One says the spell numbers were not compared. Any other warning is read as a comparison
// that may be missing, so a new one can never let a record say nothing changed.
const WHOLE = [/^table definitions differ \(/, /^no committed client digests to compare with\b/, /^client table \S+ was read before and is absent from this build\b/];
const NO_SPELL_VALUES = /^no committed spell values to compare with\b/;

function limitsOf(warnings: string[]): Limit[] {
  const limits = warnings.map((w): Limit | null => (NO_SPELL_VALUES.test(w) ? "spellValues" : WHOLE.some((p) => p.test(w)) ? null : "unknown"));
  return (["spellValues", "unknown"] as const).filter((l) => limits.includes(l));
}

export interface ClassTalentChanges {
  classId: number;
  /** Oldest build first. */
  steps: BuildStep[];
  /** Records that do not even say which build they are for. */
  unplaced: number;
}

const place = (p: { tree: string | null; row: number; col: number }): Place => ({ tree: p.tree, row: p.row + 1, col: p.col + 1 });

function stepOf(entry: ChangeEntry, classId: number): BuildStep {
  const build = entry.build.version;
  const t = entry.talents;
  const mine = <T extends { classId: number }>(list: T[]) => list.filter((x) => x.classId === classId);
  // A record from a build players cannot play yet makes every item in it a spoiler, whatever its flags say.
  const spoiler = entry.spoiler || !entry.live;
  const where = (x: { nodeId: number; name: string; spoiler: boolean }) => ({ build, nodeId: x.nodeId, name: x.name, spoiler: spoiler || x.spoiler });
  const talents: TalentChange[] = t ? [
    ...mine(t.added).map((x) => ({ ...where(x), kind: "added" as const })),
    ...mine(t.removed).map((x) => ({ ...where(x), kind: "removed" as const })),
    ...mine(t.moved).map((x) => ({ ...where(x), kind: "moved" as const, from: place(x.from), to: place(x.to) })),
    ...mine(t.ranks).map((x) => ({ ...where(x), kind: "ranks" as const, before: x.before, after: x.after })),
    ...mine(t.gates).map((x) => ({ ...where(x), kind: "gates" as const, before: x.before, after: x.after })),
    ...mine(t.prereqs).map((x) => ({ ...where(x), kind: "prereqs" as const })),
    ...mine(t.replaced).map((x) => ({ ...where(x), kind: "replaced" as const })),
    ...mine(t.spellValues).map((x) => ({ ...where(x), kind: "spellValues" as const, fields: x.changes.map((c) => c.field) })),
  ] : [];
  return {
    build,
    previous: entry.previous?.version ?? null,
    readable: true,
    baseline: entry.initial || t === null || entry.previous === null,
    spoiler,
    classChanged: t !== null && [...t.classesAdded, ...t.classesRemoved].some((c) => c.classId === classId),
    talents,
    pointLevels: t ? mine(t.pointLevels).map((p) => ({ before: p.before, after: p.after, spoiler: spoiler || p.spoiler })) : [],
    limits: limitsOf(entry.warnings),
  };
}

/** One class's talent changes in the change records, oldest build first. A record that does not read is kept at
 *  its build when it names one, so the history stops there, and counted when it does not. */
export function classTalentChanges(entries: readonly unknown[], classId: number): ClassTalentChanges {
  if (!Array.isArray(entries)) return { classId, steps: [], unplaced: 1 };
  const steps: BuildStep[] = [];
  let unplaced = 0;
  for (const raw of entries) {
    const parsed = ChangeEntry.safeParse(raw);
    if (parsed.success && compareGameBuilds(parsed.data.build.version, parsed.data.build.version) === 0) {
      steps.push(stepOf(parsed.data, classId));
      continue;
    }
    const build = (raw as { build?: { version?: unknown } } | null)?.build?.version;
    if (typeof build === "string" && compareGameBuilds(build, build) === 0) {
      steps.push({ build, previous: null, readable: false, baseline: false, spoiler: false, classChanged: false, talents: [], pointLevels: [], limits: [] });
    } else unplaced++;
  }
  steps.sort((a, b) => compareGameBuilds(a.build, b.build) ?? 0);
  return { classId, steps, unplaced };
}

/** Why the records cannot say everything that changed between the plan's build and the tree's. */
export type HistoryGap =
  /** `build` is where the history stops: changes between the plan's build and it are unknown. */
  | { kind: "missing" | "baseline" | "unreadable" | "conflict" | "class"; build: string }
  /** The plan's build falls inside one record's comparison, after `from` and before `to`, so that record's changes
   *  may predate the plan. A build a record compares with needs no record of its own: it is that record's `from`. */
  | { kind: "unrecorded"; build: string; from: string; to: string }
  /** The record for `build`, between the plan's build and the tree's, could not make this comparison. */
  | { kind: "limited"; build: string; comparison: Limit }
  | { kind: "unplaced"; count: number };

/** One of the plan's talents that a later build changed, with each change, oldest first. A talent is named only on
 *  its changes, each beside its spoiler flag, so a spoiler build's name for it never stands for a public change. */
export interface TouchedTalent {
  nodeId: number;
  /** Points the plan spends in it. */
  points: number;
  changes: TalentChange[];
}

/** A later build moved the levels talent points arrive at. The levels are those of the plan's points, null where
 *  that schedule has fewer points than the plan spends. */
export interface PointLevelChange {
  build: string;
  spoiler: boolean;
  before: number[];
  after: number[];
  points: number;
  levelBefore: number | null;
  levelAfter: number | null;
}

export interface PlanFreshness {
  /** The plan's build against the tree's: the same, older, newer (a build this site does not show, or no longer
   *  does), or unknown when either cannot be read or compared. */
  relation: "same" | "older" | "newer" | "unknown";
  madeOn: string;
  treeBuild: string;
  touched: TouchedTalent[];
  pointLevels: PointLevelChange[];
  /** Empty when the records cover every build in between. */
  gaps: HistoryGap[];
  /** Other talents of the class the covered records changed. */
  others: number;
  /** True when a record shows a change to the plan's talents or point levels; false only when the records cover
   *  every build in between, made every comparison, and show none; null when they cannot say. */
  changed: boolean | null;
}

/** Points the plan asks for, per node: whole positive ranks under whole node ids. Anything else is left out. */
function askedPoints(ranks: Ranks): Map<number, number> {
  const out = new Map<number, number>();
  if (!ranks || typeof ranks !== "object") return out;
  for (const [key, value] of Object.entries(ranks)) {
    const rank = (value as { rank?: unknown } | null)?.rank;
    if (/^\d+$/.test(key) && typeof rank === "number" && Number.isInteger(rank) && rank > 0) out.set(Number(key), rank);
  }
  return out;
}

/** What the records show changed in a plan's talents since `madeOn`, the build its code carries. `askedRanks` are
 *  the ranks the code asked for, before the tree on screen placed them, so a removed talent still counts. */
export function planFreshness(catalog: TalentCatalog, changes: ClassTalentChanges, madeOn: string, askedRanks: Ranks): PlanFreshness {
  const treeBuild = catalog.build;
  const order = compareGameBuilds(madeOn, treeBuild);
  const relation = order === null ? "unknown" : order < 0 ? "older" : order > 0 ? "newer" : "same";
  const result: PlanFreshness = { relation, madeOn, treeBuild, touched: [], pointLevels: [], gaps: [], others: 0, changed: relation === "same" ? false : null };
  if (relation !== "older") return result;

  // Walk back from the tree's build to the plan's, one record at a time. Each record names the build it was
  // compared with, so an unbroken chain shows that no build in between is missing.
  const steps = changes.classId === catalog.classId ? changes.steps : [];
  const covered: BuildStep[] = [];
  const gaps: HistoryGap[] = [];
  for (let build = treeBuild; ;) {
    const here = steps.filter((s) => compareGameBuilds(s.build, build) === 0);
    const step = here[0];
    const stop = here.length === 0 ? "missing" : here.length > 1 ? "conflict" : !step.readable ? "unreadable" : step.baseline ? "baseline" : step.classChanged ? "class" : null;
    if (stop) {
      gaps.push({ kind: stop, build });
      break;
    }
    // A record compares its build with an older one it names; any other record does not read.
    const back = compareGameBuilds(step.previous, build);
    const reach = compareGameBuilds(step.previous, madeOn);
    if (back !== -1 || reach === null) {
      gaps.push({ kind: "unreadable", build });
      break;
    }
    // The record spans the plan's build: its changes may come from before the plan, so none is claimed.
    if (reach < 0) {
      gaps.push({ kind: "unrecorded", build: madeOn, from: step.previous!, to: step.build });
      break;
    }
    covered.unshift(step);
    if (reach === 0) break;
    build = step.previous!;
  }
  for (const step of covered) for (const comparison of step.limits) gaps.push({ kind: "limited", build: step.build, comparison });
  if (changes.unplaced > 0) gaps.push({ kind: "unplaced", count: changes.unplaced });

  const asked = askedPoints(askedRanks);
  const points = [...asked.values()].reduce((sum, n) => sum + n, 0);
  const byNode = new Map<number, TalentChange[]>();
  const others = new Set<number>();
  for (const change of covered.flatMap((s) => s.talents)) {
    if (asked.has(change.nodeId)) byNode.set(change.nodeId, [...(byNode.get(change.nodeId) ?? []), change]);
    else others.add(change.nodeId);
  }
  const touched = [...byNode].map(([nodeId, list]) => ({ nodeId, points: asked.get(nodeId)!, changes: list }))
    .sort((a, b) => (compareGameBuilds(a.changes[0].build, b.changes[0].build) ?? 0) || a.nodeId - b.nodeId);
  const level = (schedule: number[]) => (points > 0 ? schedule[points - 1] ?? null : null);
  const pointLevels = covered.flatMap((s) => s.pointLevels.map((p) => ({
    build: s.build, spoiler: p.spoiler, before: p.before, after: p.after, points, levelBefore: level(p.before), levelAfter: level(p.after),
  })));
  const changed = touched.length > 0 || pointLevels.length > 0 ? true : gaps.length === 0 ? false : null;
  return { ...result, touched, pointLevels, gaps, others: others.size, changed };
}

/** The freshness of the plan a share code carries; null when the code does not read or is for another class
 *  (the calculator's import report says why). */
export function codeFreshness(catalog: TalentCatalog, changes: ClassTalentChanges, code: string): PlanFreshness | null {
  const decoded = decodeBuild(code);
  if (!decoded.ok || decoded.build.classSlug !== catalog.classSlug) return null;
  return planFreshness(catalog, changes, decoded.build.build, decoded.build.ranks);
}

// ---- words ------------------------------------------------------------------------------------

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const readable = (build: string) => compareGameBuilds(build, build) === 0;
const CHECK = "Check each talent before you follow the plan.";

const at = (p: Place, other: Place) => `${p.tree !== other.tree ? `${p.tree ?? "another tree"}, ` : ""}row ${p.row}, column ${p.col}`;

function gateText(unlock: Unlock): string {
  const parts: string[] = [];
  const spent = unlock.spentRequired;
  if (spent) parts.push(`${plural(spent.amount, "point")}${spent.scope === "tree" ? " in its tree" : spent.scope === "class" ? " in the class's trees" : ", where they count is unconfirmed"}`);
  const ranks = unlock.ranksInNodes?.length ?? 0;
  if (ranks) parts.push(`ranks in ${plural(ranks, "other talent")}`);
  return parts.join(" and ") || "nothing";
}

function describe(c: TalentChange, points: number): string {
  const spends = ` (this plan spends ${plural(points, "point")} in it)`;
  switch (c.kind) {
    case "added": return `added in build ${c.build}, after this plan was made`;
    case "removed": return `removed in build ${c.build}${spends}`;
    case "moved": return `moved from ${at(c.from, c.to)} to ${at(c.to, c.from)} in build ${c.build}`;
    case "ranks": return `its maximum rank went from ${c.before} to ${c.after} in build ${c.build}${points > c.after ? spends : ""}`;
    case "gates": {
      const [before, after] = [gateText(c.before), gateText(c.after)];
      return `what unlocks it changed in build ${c.build}${before === after ? "" : ` (before: ${before}; after: ${after})`}`;
    }
    case "prereqs": return `the talents it needs first changed in build ${c.build}`;
    case "replaced": return `it holds a different spell from build ${c.build}`;
    case "spellValues": {
      const numbers = c.fields.filter((f) => f !== "text").length;
      const parts = [numbers > 0 && plural(numbers, "number"), c.fields.includes("text") && "the tooltip text"].filter(Boolean);
      return `its spell changed in build ${c.build}${parts.length ? `: ${parts.join(" and ")}` : ""}`;
    }
  }
}

function levelLine(p: PointLevelChange): string {
  const head = `The levels talent points arrive at changed in build ${p.build}`;
  const plan = `this plan's ${plural(p.points, "point")}`;
  const need = p.points === 1 ? "needs" : "need";
  if (p.levelBefore === null && p.levelAfter === null) return `${head}.`;
  if (p.levelAfter === null) return `${head}: it gives ${plural(p.after.length, "point")}, fewer than this plan's ${p.points}.`;
  if (p.levelBefore === null) return `${head}: from that build, ${plan} ${need} level ${p.levelAfter}.`;
  if (p.levelBefore === p.levelAfter) return `${head}; ${plan} still ${need} level ${p.levelAfter}.`;
  return `${head}: ${plan} needed level ${p.levelBefore}, and from that build ${p.points === 1 ? "it needs" : "they need"} level ${p.levelAfter}.`;
}

function gapLine(gap: HistoryGap, madeOn: string): string {
  const unknown = (build: string) => `so changes between ${madeOn} and ${build} are unknown`;
  switch (gap.kind) {
    case "missing": return `There is no change record for game build ${gap.build}, ${unknown(gap.build)}.`;
    case "baseline": return `The change records start at game build ${gap.build}, ${unknown(gap.build)}.`;
    case "unreadable": return `The change record for game build ${gap.build} cannot be read, ${unknown(gap.build)}.`;
    case "conflict": return `More than one change record describes game build ${gap.build}, ${unknown(gap.build)}.`;
    case "class": return `Game build ${gap.build} added or removed this class's talent trees, so changes between ${madeOn} and ${gap.build} cannot be compared.`;
    case "unrecorded": return `Game build ${gap.build} has no change record of its own: the record for build ${gap.to} compares ${gap.from} with ${gap.to}, so which of its changes came after this plan is unknown.`;
    case "limited": return gap.comparison === "spellValues"
      ? `The change record for game build ${gap.build} had no spell numbers to compare with, so changes to spell numbers in that build are unknown.`
      : `The change record for game build ${gap.build} warns that part of its comparison may be missing, so changes in that build may not all be listed.`;
    case "unplaced": return `${plural(gap.count, "change record")} ${gap.count === 1 ? "does" : "do"} not say which game build ${gap.count === 1 ? "it is" : "they are"} for, so changes may be missing.`;
  }
}

/** The plan's freshness in sentences, the first one a summary; empty when the plan was made on the tree's build.
 *  Shared by the calculator, guides and watches. With spoilers off (the default) a spoiler build's changes are
 *  counted and its build named, but the talents and numbers are not shown. */
export function freshnessLines(f: PlanFreshness, { spoilers = false }: { spoilers?: boolean } = {}): string[] {
  if (f.relation === "same") return [];
  if (f.relation === "newer") {
    return [`Made on game build ${f.madeOn}, which is newer than this tree (build ${f.treeBuild}).`, `This site does not show that build's tree, so what differs is unknown. ${CHECK}`];
  }
  if (f.relation === "unknown") {
    if (!readable(f.madeOn)) return ["This plan's game build cannot be read.", `What changed since it was made is unknown. ${CHECK}`];
    const head = readable(f.treeBuild) ? `Game build ${f.madeOn} cannot be compared with this tree's build, ${f.treeBuild}.` : "This tree's game build cannot be read.";
    return [head, `What changed since the plan was made is unknown. ${CHECK}`];
  }

  const lines = [`Made on game build ${f.madeOn}; this tree is build ${f.treeBuild}.`];
  const shown = (c: { spoiler: boolean }) => spoilers || !c.spoiler;
  const hiddenBuilds = new Set<string>();
  let hiddenTalents = 0;
  let shownTalents = 0;
  for (const t of f.touched) {
    const visible = t.changes.filter(shown);
    if (visible.length < t.changes.length) hiddenTalents++;
    for (const c of t.changes) if (!shown(c)) hiddenBuilds.add(c.build);
    if (visible.length > 0) {
      shownTalents++;
      // Named as the latest change shown has it: a spoiler build's name for the talent stays hidden with its change.
      lines.push(`${visible[visible.length - 1].name}: ${visible.map((c) => describe(c, t.points)).join("; ")}.`);
    }
  }
  for (const p of f.pointLevels) {
    if (shown(p)) lines.push(levelLine(p));
    else hiddenBuilds.add(p.build);
  }
  if (hiddenBuilds.size > 0) {
    const levels = f.pointLevels.some((p) => !shown(p));
    const what = [hiddenTalents > 0 && `${hiddenTalents} of this plan's talents`, levels && "the levels talent points arrive at"].filter(Boolean).join(" and ");
    const builds = [...hiddenBuilds].sort((a, b) => compareGameBuilds(a, b) ?? 0);
    lines.push(`${what[0].toUpperCase()}${what.slice(1)} changed in ${builds.length === 1 ? "a build" : "builds"} players cannot play yet (${builds.join(", ")}). Spoilers are not shown here.`);
  }
  if (f.changed === false) {
    const others = f.others > 0 ? `; they changed ${plural(f.others, "other talent")} of this class` : "";
    lines.push(`Since then, the game files changed none of this plan's talents, nor the levels talent points arrive at${others}.`);
  }
  for (const gap of f.gaps) lines.push(gapLine(gap, f.madeOn));
  if (f.changed !== false) lines.push(shownTalents > 0 && hiddenBuilds.size === 0 && f.gaps.length === 0 ? "Check these talents before you follow the plan." : CHECK);
  return lines;
}
