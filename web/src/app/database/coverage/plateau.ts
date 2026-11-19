import { computeCoverage, type CoverageReport } from "@kb/coverage";
import { measurePlateau, plateauInput, PLATEAU_WINDOW_DAYS, type PlateauReport, type TypePlateau } from "@kb/plateau";
import { COVERAGE_BUILD, loadCoverageExpected, RECHECK_SCOPES } from "@/lib/coverage-compute";
import { dataAgeLabel } from "@/lib/data-age";
import { PLACEHOLDER } from "@/lib/item-names";
import { uploadStore } from "@/lib/upload-store";
import { WORLD_MAP } from "@/lib/world-map";
import { placedEntrances, publicZones } from "@/lib/zones";

let memo: { key: string; plateau: PlateauReport } | null = null;

/**
 * The plateau beside the score the page already holds (`now`): the score of the reports captured 28 days before the
 * data date is computed here, with the same zones, entrances, expected counts and the scopes begun by then, once per
 * corpus version and expected file. Null when storage is out of reach.
 */
export async function loadPlateau(now: CoverageReport): Promise<PlateauReport | null> {
  const [corpus, expected] = await Promise.all([uploadStore.loadCorpus(), loadCoverageExpected()]);
  if (corpus.unreachable) return null;
  const key = `${corpus.uploads}|${corpus.dataAsOf ?? ""}|${corpus.records.length}|${JSON.stringify(expected)}`;
  if (memo?.key === key) return memo.plateau;
  const earlier = plateauInput({
    records: corpus.records, asOf: corpus.dataAsOf ?? null, build: COVERAGE_BUILD,
    zones: publicZones().map((z) => ({ mapId: z.mapId, name: z.name })),
    heldBack: WORLD_MAP.heldBackZones.map((z) => z.uiMapId),
    fileEntrances: placedEntrances(WORLD_MAP).flatMap((e) => (e.files && e.zone ? [{ instanceMapIds: e.instanceMapIds, zone: e.zone.mapId }] : [])),
    expected, recheck: RECHECK_SCOPES,
  });
  memo = { key, plateau: measurePlateau(now, earlier && computeCoverage(earlier), corpus.records) };
  return memo.plateau;
}

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
