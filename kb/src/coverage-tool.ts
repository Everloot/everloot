import { type McpToolArgs } from "@everloot/protocol";
import { COVERAGE_TYPES, coverageShares, type CoverageCell, type CoverageReport } from "./coverage.js";

/**
 * Where a lent score came from: the report the snapshot cron stored for the build, or one computed from the corpus
 * because no stored report was usable. A host that does not say leaves the answer's date line as it was.
 */
export type CoverageSource = "stored" | "live";
export type LoadedCoverage = CoverageReport & { source?: CoverageSource };
/** The host lends the score the home page and coverage pages read. No raw records or baseline are read here. */
export type CoverageLoader = () => Promise<LoadedCoverage | null>;
/** Counts only from the persisted list; never lend its ids or settled values to the tool. */
export type SettledSummaryLoader = (build: string) => Promise<{ build: string; dataAsOf: string | null; facts: number } | null>;

const unknown = "[?]";
const page = "https://everloot.app/database/coverage";
const sourceText: Record<CoverageSource, string> = {
  stored: " (stored report, written by the snapshot cron for this build)",
  live: " (computed from the corpus now: no stored report for this build was usable)",
};
const pct = (value: number | null) => value === null ? unknown : `${Math.floor(value * 100)}%`;

function cellText(cell: CoverageCell): string {
  const shares = coverageShares(cell);
  const denominator = cell.denominator ?? unknown;
  return `${cell.settled}/${denominator} settled; ${cell.confirmed}/${denominator} confirmed (${pct(shares.settled)} / ${pct(shares.confirmed)}); `
    + `${cell.reported}/${denominator} reported; ${cell.recheck}/${denominator} to recheck; expected ${cell.expected ?? unknown}; observed ${cell.observed}`;
}

export async function answerCoverage(args: McpToolArgs<"coverage">, loader?: CoverageLoader, settledLoader?: SettledSummaryLoader): Promise<string> {
  const scope = `Scope: ${args.zone === undefined ? "all released zones" : `zone ${args.zone}`}; ${args.type === undefined ? "all types" : `type ${args.type}`}. Unplaced facts and held-back zones are excluded.`;
  const unavailable = (reason: string) => `${scope}\nCoverage ${reason}; counts, denominators, data date and installs are ${unknown}, not measured zero.\nMore: ${page}`;
  if (!loader) return unavailable("not connected");
  let report: LoadedCoverage | null;
  try { report = await loader(); } catch { return unavailable("unavailable"); }
  if (!report) return unavailable("unavailable");
  const zones = report.zones.filter((z) => args.zone === undefined || z.mapId === args.zone);
  const types = args.type === undefined ? COVERAGE_TYPES : [args.type];
  const lines = [scope,
    `Data as of ${report.dataAsOf ?? unknown}${report.source ? sourceText[report.source] : ""}; build ${report.build ?? unknown}; ${report.installs} distinct folded installs overall, including unplaced facts, before zone/type filters. Each zone states its own installs across all types.`,
    `Method: ${report.method}`,
    "coverage = settled / expected; confirmed / expected beside it. Denominator = max(expected, observed), in entity-field facts. Confirmed includes settled. Reported counts are aggregate states, never unconfirmed values.",
    `Expected counts dated ${report.expected?.dataAsOf ?? unknown}, from game files and a local Classic baseline (counts only). Missing or zero denominators give [?] shares.`,
  ];
  let settled = null;
  try { settled = report.build ? await settledLoader?.(report.build) ?? null : null; } catch { /* Unknown, never a measured zero. */ }
  if (settled?.build !== report.build || !settled?.dataAsOf) settled = null;
  lines.push(`Whole-fact settled list: ${settled?.facts ?? unknown} facts; build ${report.build ?? unknown}; data as of ${settled?.dataAsOf ?? unknown}; distinct agreeing installs [?] (not stored in the list). Scope: the entire build, before zone/type filters. Method: persisted uploader skip list, one whole upload fact per key, not entity-field coverage; all reported fields must settle under the list's rules. An undated or unavailable list is unknown, not zero.`);
  if (zones.length) {
    const cells = zones.flatMap((z) => types.map((t) => z.types[t]));
    const sum = (key: "settled" | "confirmed" | "reported" | "recheck") => cells.reduce((n, c) => n + c[key], 0);
    // needsTotal is computed before the page's cap, unlike needs. Only it is exhaustive.
    const needs = args.type === undefined ? zones.reduce((n, z) => n + z.needsTotal, 0)
      : zones.every((z) => z.needs.length === z.needsTotal) ? zones.reduce((n, z) => n + z.needs.filter((f) => f.type === args.type).length, 0) : null;
    lines.push(`Scoped entity-field totals: ${sum("settled")} settled; ${sum("confirmed")} confirmed (includes settled); ${sum("reported")} still reported; ${sum("recheck")} to recheck. Fields needing one or two more installs: ${needs ?? unknown}${needs === null ? " (the capped list cannot give an exhaustive type-filtered count)" : " (full count before the list cap)"}. Data date, method and overall/zone installs are stated above and below; scoped distinct installs [?] (not separately measured).`);
  }
  if (!zones.length) lines.push("No released zone matches this filter; no counts measured for this scope.");
  for (const zone of zones) {
    lines.push(`\n${zone.name} (zone ${zone.mapId}); ${zone.installs} distinct folded installs; data as of ${report.dataAsOf ?? unknown}.`);
    for (const type of types) {
      lines.push(`${type}: ${cellText(zone.types[type])}`);
      for (const field of zone.fields.filter((f) => f.type === type)) lines.push(`  ${type}.${field.field}: ${cellText(field)}`);
    }
    const needs = zone.needs.filter((n) => args.type === undefined || n.type === args.type);
    // The score caps the combined list per zone, before a type filter. Never imply it is exhaustive.
    lines.push(`Reported fields needing installs: showing ${needs.length} matching entries from ${zone.needs.length}/${zone.needsTotal} listed across all types (the page's capped list). Values are withheld until 3 installs agree.`);
    for (const need of needs) {
      lines.push(`  ${need.type}.${need.field}: ${need.label}; ${need.voters}/3 agreeing installs; ${need.need} more needed; ${need.href ? `https://everloot.app${need.href}` : unknown}`);
    }
  }
  return `${lines.join("\n")}\nMore: ${page}`;
}
