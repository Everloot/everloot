import { CENSUS_ROUND_TO } from "@kb/census";

/** Each census count is rounded from its own true number, so a table's rows can miss its total by a few. */
export const CENSUS_ROUNDING_NOTE = `Counts are rounded to the nearest ${CENSUS_ROUND_TO}, so parts may not add up exactly.`;

/** The footnote under every table of census counts (/census, /rankings). */
export default function CensusRoundingNote({ className = "mt-3" }: { className?: string }) {
  return <p className={`${className} text-meta text-muted`}>{CENSUS_ROUNDING_NOTE}</p>;
}
