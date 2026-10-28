import { importCode } from "./import";
import { pointsByTree, pointsSpent } from "./rules";
import { decodeBuild } from "./share";
import type { Ranks, TalentCatalog } from "./types";

// A build as players say it: the tree with the most points and the split ("Fire 17/34/0"). Used by
// the calculator's build bar and by the link previews, so the page and the card always agree.

export interface BuildSummary {
  /** The tree with the most points; null before the first point. */
  lead: string | null;
  /** Points per tree, in the catalog's order. */
  trees: { name: string; points: number }[];
  split: string;
  spent: number;
}

export function summarizeBuild(catalog: TalentCatalog, ranks: Ranks): BuildSummary {
  const per = pointsByTree(catalog, ranks);
  const trees = catalog.trees.map((t) => ({ name: t.name, points: per.get(t.id) ?? 0 }));
  const spent = pointsSpent(ranks);
  const lead = spent === 0 ? null : trees.reduce((best, t) => (t.points > best.points ? t : best)).name;
  return { lead, trees, split: trees.map((t) => t.points).join("/"), spent };
}

/** "Fire Mage 17/34/0", or "Mage" with no points. */
export function buildTitle(catalog: TalentCatalog, summary: BuildSummary): string {
  return summary.lead ? `${summary.lead} ${catalog.className} ${summary.split}` : catalog.className;
}

/** A path segment unescaped, or null when it does not unescape: then it is no code either. */
const unescapedSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/**
 * The share codes in a preview link's path, `/b/<first>/<second>`, with "-" for an empty first set.
 * Each must read as a code whole, as the calculator reads it, and is checked against the catalog; a
 * code that does not load is dropped, and none loading means the link is not a build.
 */
export function readPathCodes(catalog: TalentCatalog, segments: string[]): { first: string | null; second: string | null; sets: Ranks[] } | null {
  const [a, b] = segments.map(unescapedSegment);
  const load = (code: string | null | undefined) => {
    // importCode reads links too, and would find a code inside a segment that is not one.
    if (!code || code === "-" || !decodeBuild(code).ok) return null;
    const r = importCode(catalog, code);
    return r.ok ? { code, ranks: r.ranks } : null;
  };
  const one = load(a);
  const two = load(b);
  if (!one && !two) return null;
  return { first: one?.code ?? null, second: two?.code ?? null, sets: [one?.ranks ?? {}, two?.ranks ?? {}] };
}

/** The preview link for one or two sets; null when neither has a code. */
export function previewPath(classSlug: string, first: string | null, second: string | null): string | null {
  if (!first && !second) return null;
  return `/tools/talents/${classSlug}/b/${first ?? "-"}${second ? `/${second}` : ""}`;
}
