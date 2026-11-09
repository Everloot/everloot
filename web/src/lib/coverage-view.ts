import { COVERAGE_TYPES, coverageShares, type CoverageCell, type CoverageReport, type CoverageType, type ZoneCoverage } from "../../../kb/src/coverage";
import { dataAgeLabel } from "./data-age";
import { PLACEHOLDER } from "./item-names";
import { zoneSlug } from "./zones";

/** A zone's coverage page: `/database/coverage/1429-elwynn-forest`, the zone pages' own segment. */
export const zoneCoverageHref = (z: Pick<ZoneCoverage, "mapId" | "name">): string => `/database/coverage/${zoneSlug(z.mapId, z.name)}`;

/** The coverage table's column headings, in the spec's order. */
export const TYPE_LABEL: Record<CoverageType, string> = {
  quests: "Quests", npcs: "NPCs", pins: "Pins", vendors: "Vendors", drops: "Drops", rares: "Rares", entrances: "Entrances", bosses: "Bosses", treasures: "Treasures",
};
export const COVERAGE_SORTS = [...COVERAGE_TYPES, "zone"] as const;
export type CoverageSort = (typeof COVERAGE_SORTS)[number];

const pct = (share: number | null) => (share === null ? PLACEHOLDER : `${Math.floor(share * 100)}%`);

/**
 * Nothing of this type is expected in the zone and nobody has reported one: a zero denominator (an expected count
 * of 0, or an open-world zone's entrances, which the game files list none of). There is nothing to score.
 */
const noneExpected = (cell: CoverageCell): boolean => cell.denominator === 0 && cell.observed === 0 && cell.reported === 0;

/**
 * "12% / 40%": settled share, then confirmed share; `[?]` where there is no denominator. Rounded down, so 100% is all of it.
 * A dash where the zone expects none and holds none, such as an open-world zone's bosses.
 */
export function shareText(cell: CoverageCell): string {
  if (noneExpected(cell)) return "–";
  const s = coverageShares(cell);
  return `${pct(s.settled)} / ${pct(s.confirmed)}`;
}

/** The counts behind a share, for its tooltip and screen readers. */
export function cellDetail(cell: CoverageCell): string {
  if (noneExpected(cell)) return "none expected in this zone";
  const of = cell.denominator === null ? `no expected count (${cell.observed} reported)` : `of ${cell.denominator}`;
  return `${cell.settled} settled, ${cell.confirmed} confirmed, ${cell.reported} reported${cell.recheck ? `, ${cell.recheck} to recheck` : ""}, ${of}`;
}

/** The sort key of a cell: its settled share, then its confirmed share; null (sorted last) without a denominator. */
export function cellRank(cell: CoverageCell): number | null {
  const s = coverageShares(cell);
  return s.settled === null || s.confirmed === null ? null : s.settled * 1000 + s.confirmed;
}

/**
 * How the figures were measured, when the data was current and by how many installs, and where the expected counts
 * came from: counts only, from the game files and the local Classic baseline (docs/DATA_POLICY.md).
 */
export function measuredLine(report: Pick<CoverageReport, "installs" | "dataAsOf" | "expected" | "build">): string {
  const installs = `${report.installs.toLocaleString("en-US")} ${report.installs === 1 ? "install" : "installs"}`;
  const expected = report.expected
    ? `Expected counts for build ${report.build ?? PLACEHOLDER}, counted ${report.expected.dataAsOf?.slice(0, 10) ?? PLACEHOLDER} from the game files and a local Classic baseline: counts only.`
    : `No expected counts yet, so shares read ${PLACEHOLDER} except entrances, which the game files list.`;
  return `${dataAgeLabel(report.dataAsOf)}, from ${installs}. ${expected}`;
}
