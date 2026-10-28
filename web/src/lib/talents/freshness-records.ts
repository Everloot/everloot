import beta70532 from "@/data/game-data/changes/wow_classic_beta-70532.json";
import wowf70630 from "@/data/game-data/changes/wowf-70630.json";
import wowf70634 from "@/data/game-data/changes/wowf-70634.json";
import { ChangeEntry } from "../../../../kb/src/build-watch/changes";
import { compareGameBuilds, type BuildStep, type ClassTalentChanges, type Limit, type Place, type TalentChange } from "./freshness";

// The build watch's change records (web/src/data/game-data/changes/), loaded and checked against their schema
// (kb/src/build-watch/changes.ts) and read for one class, for the change engine in freshness.ts. They are kept apart
// from it so that a page's browser code never carries the records or the schemas: a page or server component reads a
// class's changes here and hands them on, and freshness.ts only compares them.

/** The build watch's published records, bundled with the pages that read them. A new build's pull request adds
 *  its record to the folder; list it here in the same pull request (freshness.test.ts fails until it is). */
export const PUBLISHED_CHANGES: readonly unknown[] = [beta70532, wowf70630, wowf70634];

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
