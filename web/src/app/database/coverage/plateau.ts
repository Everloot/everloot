import { PLATEAU_WINDOW_DAYS, type PlateauReport, type TypePlateau } from "@kb/plateau";
import { dataAgeLabel } from "@/lib/data-age";
import { PLACEHOLDER } from "@/lib/item-names";

// How the coverage page prints the plateau. The plateau itself is measured by the snapshot cron and stored beside the
// score (src/lib/coverage-store.ts); no page view computes it.

/** A share to one decimal, rounded down so the 90% line is never shown as met before it is; `[?]` when unknown. */
export const plateauShare = (share: number | null): string => (share === null ? PLACEHOLDER : `${Math.floor(share * 1000) / 10}%`);

/** "yes", "not yet" or `[?]`. */
export const plateauVerdict = (at: boolean | null): string => (at === null ? PLACEHOLDER : at ? "yes" : "not yet");

/** The counts behind one type's shares, for its tooltip and screen readers. */
export function plateauDetail(t: TypePlateau): string {
  const of = t.denominator === null ? "no expected count" : `of ${t.denominator.toLocaleString("en-US")} expected`;
  return `${t.confirmed.toLocaleString("en-US")} confirmed, ${t.settled.toLocaleString("en-US")} settled, ${t.newlyConfirmed?.toLocaleString("en-US") ?? PLACEHOLDER} newly confirmed in ${PLATEAU_WINDOW_DAYS} days${t.recheck ? `, ${t.recheck.toLocaleString("en-US")} to recheck` : ""}, ${of}`;
}

/** When the data was current, the window, and by how many installs: the plateau's own measured line. */
export function plateauMeasured(p: Pick<PlateauReport, "dataAsOf" | "windowStart" | "installs" | "windowInstalls">): string {
  const n = (k: number) => `${k.toLocaleString("en-US")} ${k === 1 ? "install" : "installs"}`;
  const window = p.windowStart ? `${n(p.windowInstalls)} reported in the ${PLATEAU_WINDOW_DAYS} days from ${p.windowStart.slice(0, 10)}` : `the ${PLATEAU_WINDOW_DAYS}-day window is ${PLACEHOLDER} without a data date`;
  return `${dataAgeLabel(p.dataAsOf)}, from ${n(p.installs)}; ${window}.`;
}
