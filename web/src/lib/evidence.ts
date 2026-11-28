/**
 * How to read a number on this site.
 *
 * A bare count says nothing about who reported it or when, so what ships with a count is its
 * agreement, its date and its method, in the words the pages, the methodology and the design system
 * already use: a fact three installs agree on is public, what the game files give is unconfirmed
 * until players see it in play, and what nobody has reported is not recorded, which is not a
 * measured zero.
 */
import type { Edge } from "@kb/edges";
import { AGREEMENT_NEEDED, agreementLabel } from "@/components/ui/AgreementMeter";
import { timeAgo } from "./time";

/** The key, in the site's own words. Short enough to read and complete enough to trust. */
export const EVIDENCE_KEY: { term: string; meaning: string }[] = [
  { term: "3 of 3 installs agree", meaning: "A fact three installs reported the same way is public. One or two are not shown." },
  { term: "Found in the game files, unconfirmed", meaning: "Read from the client's own files for one build. Players confirm it in play." },
  { term: "Not recorded", meaning: "Nobody has reported it and the files do not say. That is not a measured zero." },
  { term: "Measured zero", meaning: "Players looked and found none. A zero with a method behind it." },
];

/**
 * The line that goes with a count: how many installs agree, and when it was last seen. A relation
 * read from the game files names the build it came from instead, because no install reported it.
 */
export function evidenceLine(edge: Edge, now: number): string {
  if (edge.evidence === "client") return edge.build ? `found in game files, build ${edge.build}` : "found in game files";
  const agree = agreementLabel(edge.installs ?? 0);
  return edge.lastSeen ? `${agree} · last seen ${timeAgo(Date.parse(edge.lastSeen), now)}` : agree;
}

/** Where an item's name came from, in the words the pages already use for it. */
export type NameFrom = "players" | "wiki" | "files" | "none";

export interface ItemSummaryInput {
  /** What the game files say it is, in one line: type, quality, level. */
  identity: string;
  /** Drop sources players reported: a rate shows from one install (reported, verified at two, confirmed at three). */
  dropSources: number;
  /** Of those, the ones three installs confirm (kb/src/drop-rollup.ts dropTier). */
  confirmedDropSources: number;
  /** Map positions with three installs agreeing. */
  mapPositions: number;
  /** Vendors seen selling it, recipes that make it, and recipes that use it as a reagent. */
  vendors: number;
  recipes: number;
  uses: number;
  /** Where the name on the page came from. */
  nameFrom: NameFrom;
  /** The newest last-seen date among the observed relations, if any. */
  lastSeen: string | null;
  /** The clock, so the line is testable. */
  now: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The page's four lines, in the order a reader wants them: what it is, what players observed, what
 * nobody has reported yet, and where the name came from. Every line is derived from the data on the
 * page, and a line that would be empty is left out rather than filled with a filler.
 */
export function itemSummary(i: ItemSummaryInput): string[] {
  const bullets: string[] = [i.identity];

  // A drop source shows from one install, a map position only once three agree: each says what is true of it.
  const observed: string[] = [];
  if (i.dropSources > 0) {
    const n = i.dropSources, c = i.confirmedDropSources;
    const confirmed = c >= n ? (n === 1 ? "confirmed" : "each confirmed") : c === 0 ? (n === 1 ? "not yet confirmed" : "none yet confirmed") : `${c} of them confirmed`;
    observed.push(`Players reported ${plural(n, "drop source", "drop sources")}, ${confirmed} by three installs.`);
  }
  if (i.mapPositions > 0) observed.push(`Three installs agree on ${plural(i.mapPositions, "map position", "map positions")}.`);
  if (observed.length) {
    if (i.lastSeen) observed.push(`Last seen ${timeAgo(Date.parse(i.lastSeen), i.now)}.`);
    bullets.push(observed.join(" "));
  } else {
    bullets.push("No player has reported a drop source or a map position yet.");
  }

  const known: string[] = [];
  if (i.vendors > 0) known.push(`${plural(i.vendors, "vendor sells", "vendors sell")} it`);
  if (i.recipes > 0) known.push(`${plural(i.recipes, "recipe makes", "recipes make")} it`);
  if (i.uses > 0) known.push(`${plural(i.uses, "recipe uses", "recipes use")} it`);
  bullets.push(known.length ? `${known.join(", and ")}.` : "No vendor or recipe is known to carry it yet.");

  bullets.push(nameLine(i.nameFrom));

  return bullets;
}

/**
 * The line that says what players reported, with the count and the date, or that nobody has. `nameReporters`: installs
 * that reported a name not yet agreed (short of 3); with nothing else to say, the line counts them, so it never says
 * nobody reported it beside the name's partly filled meter. The agreement rule is the meter's, unchanged.
 */
export function observedLine(parts: (string | null)[], lastSeen: string | null, now: number, agreed: readonly string[] = [], nameReporters = 0): string {
  const said = parts.filter((p): p is string => Boolean(p));
  // Facts 3 installs agree on (a level, a side) are reports too: a page that shows them never says nobody reported it.
  const facts = agreed.length ? `agree on its ${wordList(agreed)}.` : "";
  if (!said.length && !facts && nameReporters > 0) {
    return `${nameReporters} ${nameReporters === 1 ? "install" : "installs"} reported this name; it needs ${AGREEMENT_NEEDED}.`;
  }
  if (!said.length) return facts ? `Players ${facts}` : "No player has reported it yet.";
  const when = lastSeen ? `, last seen ${timeAgo(Date.parse(lastSeen), now)}` : "";
  return `Players reported ${wordList(said)}${when}.${facts ? ` They ${facts}` : ""}`;
}

/** "a", "a and b", "a, b and c". */
function wordList(words: readonly string[]): string {
  return words.length < 3 ? words.join(" and ") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * `observedLine` for counts that carry no date of their own: they are dated by the uploads they were read from
 * ("last upload 2 hours ago", as `asOfLine` words it), not by a last-seen time they do not have.
 */
export function reportedLine(parts: (string | null)[], dataAsOf: string | null, now: number): string {
  const said = parts.filter((p): p is string => Boolean(p));
  if (!said.length) return "No player has reported it yet.";
  const asOf = asOfLine(dataAsOf, now);
  return `Players reported ${said.join(" and ")}${asOf ? ` (${asOf})` : ""}.`;
}

/** The line that says where the name came from, in the site's own words: the same source the page's title uses. */
export function nameLine(from: NameFrom): string {
  return from === "players"
    ? "Players agree on the name."
    : from === "wiki"
      ? "The name is shown from the Warcraft Wiki; players have not reported it yet."
      : from === "files"
        ? "The name is shown from the game files; players have not reported it yet."
        : "It has no agreed name yet: that needs three installs reporting the same one.";
}

/** The pages that are not items: what it is, what players reported, and where the name came from. */
export function entitySummary(i: { identity: string; observed: string; nameFrom: NameFrom }): string[] {
  return [i.identity, i.observed, nameLine(i.nameFrom)];
}

/**
 * When the numbers behind a page were last current, in the site's words. The corpus carries the
 * moment its uploads were read; a page that shows a count says how fresh it is next to it.
 */
export function asOfLine(dataAsOf: string | null, now: number): string | null {
  if (!dataAsOf) return null;
  const at = Date.parse(dataAsOf);
  if (!Number.isFinite(at)) return null;
  return `last upload ${timeAgo(at, now)}`;
}
