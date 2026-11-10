import { COVERAGE_PAGE, type CoveragePageOut, type McpToolArgs } from "@everloot/protocol";
import { COVERAGE_TYPES, coverageShares, type CoverageCell, type CoverageReport, type CoverageType } from "./coverage.js";

/** The host lends the same score its public coverage page reads. No raw records or baseline are read here. */
export type CoverageLoader = () => Promise<CoverageReport | null>;
/** Counts only from the persisted list; never lend its ids or settled values to the tool. */
export type SettledSummaryLoader = (build: string) => Promise<{ build: string; dataAsOf: string | null; facts: number } | null>;

export interface CoverageAnswer {
  text: string;
  structured: {
    connected: boolean; dataAsOf: string | null; reason?: string; url?: string;
    scope: { zone: number | null; type: CoverageType | null };
    page?: CoveragePageOut;
  };
}

const unknown = "[?]";
const page = "https://everloot.app/database/coverage";
const pct = (value: number | null) => value === null ? unknown : `${Math.floor(value * 100)}%`;

function cellText(cell: CoverageCell): string {
  const shares = coverageShares(cell);
  const denominator = cell.denominator ?? unknown;
  return `${cell.settled}/${denominator} settled; ${cell.confirmed}/${denominator} confirmed (${pct(shares.settled)} / ${pct(shares.confirmed)}); `
    + `${cell.reported}/${denominator} reported; ${cell.recheck}/${denominator} to recheck; expected ${cell.expected ?? unknown}; observed ${cell.observed}`;
}

/** One zone's line in a summary: its share over the types in scope. */
function shortText(cell: CoverageCell): string {
  const shares = coverageShares(cell);
  const denominator = cell.denominator ?? unknown;
  return `${cell.settled}/${denominator} settled; ${cell.confirmed}/${denominator} confirmed (${pct(shares.settled)} / ${pct(shares.confirmed)}); ${cell.reported} reported`;
}

/** Cells added up. A denominator or expected count is unknown when any part is, and with no cells at all. */
function sumCells(cells: readonly CoverageCell[]): CoverageCell {
  const add = (key: "settled" | "confirmed" | "reported" | "recheck" | "observed") => cells.reduce((n, c) => n + c[key], 0);
  const known = (key: "expected" | "denominator") => cells.length && cells.every((c) => c[key] !== null) ? cells.reduce((n, c) => n + c[key]!, 0) : null;
  return {
    settled: add("settled"), confirmed: add("confirmed"), reported: add("reported"), recheck: add("recheck"),
    expected: known("expected"), observed: add("observed"), denominator: known("denominator"),
  };
}

const counts = (c: CoverageCell) => ({
  settled: c.settled, confirmed: c.confirmed, reported: c.reported, recheck: c.recheck,
  expected: c.expected, observed: c.observed, denominator: c.denominator,
});

/** "zones 4–6 of 43" or "entries 1–25 of 61"; "none of 43" past the end. */
const range = (what: string, offset: number, shown: number, total: number) =>
  shown ? `${what} ${offset + 1}–${offset + shown} of ${total}` : `none of ${total} ${what} (offset ${offset} is past the end)`;
const continuation = (what: string, next: number, total: number) =>
  `Continue: ${total - next} more ${what}; pass offset=${next} with the same arguments.`;

export async function answerCoverage(args: McpToolArgs<"coverage">, loader?: CoverageLoader, settledLoader?: SettledSummaryLoader): Promise<CoverageAnswer> {
  const scopeOut = { zone: args.zone ?? null, type: args.type ?? null };
  const scope = `Scope: ${args.zone === undefined ? "all released zones" : `zone ${args.zone}`}; ${args.type === undefined ? "all types" : `type ${args.type}`}. Unplaced facts and held-back zones are excluded.`;
  const unavailable = (reason: string): CoverageAnswer => ({
    text: `${scope}\nCoverage ${reason}; counts, denominators, data date and installs are ${unknown}, not measured zero.\nMore: ${page}`,
    structured: { connected: false, dataAsOf: null, reason: `Coverage ${reason}; counts are unknown, not zero.`, scope: scopeOut },
  });
  if (!loader) return unavailable("not connected");
  let report: CoverageReport | null;
  try { report = await loader(); } catch { return unavailable("unavailable"); }
  if (!report) return unavailable("unavailable");
  const zones = report.zones.filter((z) => args.zone === undefined || z.mapId === args.zone);
  const types = args.type === undefined ? COVERAGE_TYPES : [args.type];
  // A summary unless one zone is asked for: every zone's fields and entries is too long for one answer.
  const detail = args.detail ?? args.zone !== undefined;
  const offset = args.offset ?? 0;
  const lines = [scope,
    `Data as of ${report.dataAsOf ?? unknown}; build ${report.build ?? unknown}; ${report.installs} distinct folded installs overall, including unplaced facts, before zone/type filters. Each zone states its own installs across all types.`,
    `Method: ${report.method}`,
    "coverage = settled / expected; confirmed / expected beside it. Denominator = max(expected, observed), in entity-field facts. Confirmed includes settled. Reported counts are aggregate states, never unconfirmed values.",
    `Expected counts dated ${report.expected?.dataAsOf ?? unknown}, from game files and a local Classic baseline (counts only). Missing or zero denominators give [?] shares.`,
  ];
  let settled = null;
  try { settled = report.build ? await settledLoader?.(report.build) ?? null : null; } catch { /* Unknown, never a measured zero. */ }
  if (settled?.build !== report.build || !settled?.dataAsOf) settled = null;
  lines.push(`Whole-fact settled list: ${settled?.facts ?? unknown} facts; build ${report.build ?? unknown}; data as of ${settled?.dataAsOf ?? unknown}; distinct agreeing installs [?] (not stored in the list). Scope: the entire build, before zone/type filters. Method: persisted uploader skip list, one whole upload fact per key, not entity-field coverage; all reported fields must settle under the list's rules. An undated or unavailable list is unknown, not zero.`);
  const cells = zones.flatMap((z) => types.map((t) => z.types[t]));
  // needsTotal is computed before the page's cap, unlike needs. Only it is exhaustive.
  const needsInstalls = !zones.length ? null : args.type === undefined ? zones.reduce((n, z) => n + z.needsTotal, 0)
    : zones.every((z) => z.needs.length === z.needsTotal) ? zones.reduce((n, z) => n + z.needs.filter((f) => f.type === args.type).length, 0) : null;
  if (zones.length) {
    const sum = (key: "settled" | "confirmed" | "reported" | "recheck") => cells.reduce((n, c) => n + c[key], 0);
    lines.push(`Scoped entity-field totals: ${sum("settled")} settled; ${sum("confirmed")} confirmed (includes settled); ${sum("reported")} still reported; ${sum("recheck")} to recheck. Fields needing one or two more installs: ${needsInstalls ?? unknown}${needsInstalls === null ? " (the capped list cannot give an exhaustive type-filtered count)" : " (full count before the list cap)"}. Data date, method and overall/zone installs are stated above and below; scoped distinct installs [?] (not separately measured).`);
  }
  if (!zones.length) lines.push("No released zone matches this filter; no counts measured for this scope.");

  const zoneCell = (zone: (typeof zones)[number]) => sumCells(types.map((t) => zone.types[t]));
  const typeCells = types.map((t) => ({ type: t, cell: sumCells(zones.map((zone) => zone.types[t])) }));
  const totals = sumCells(cells);
  // One zone with detail pages its reported entries; otherwise the list is the zones.
  const list: "zones" | "entries" = detail && args.zone !== undefined && zones.length ? "entries" : "zones";
  const limit = args.limit ?? (list === "entries" ? COVERAGE_PAGE.entries : detail ? COVERAGE_PAGE.detailZones : COVERAGE_PAGE.summaryZones);
  const zonePage = list === "zones" ? zones.slice(offset, offset + limit) : zones;
  let total = zones.length;
  let next: number | undefined;

  if (!detail && zones.length) {
    lines.push(`All scoped zones and types: ${cellText(totals)}`);
    for (const { type, cell } of typeCells) lines.push(`${type}: ${cellText(cell)}`);
    lines.push(`\nShowing ${range("zones", offset, zonePage.length, zones.length)}, each over the types in scope.`);
    for (const zone of zonePage) lines.push(`  ${zone.name} (zone ${zone.mapId}); ${zone.installs} installs: ${shortText(zoneCell(zone))}`);
  }
  if (detail && list === "zones" && zones.length) lines.push(`\nShowing ${range("zones", offset, zonePage.length, zones.length)}, with per-field counts.`);
  if (detail) {
    for (const zone of zonePage) {
      lines.push(`\n${zone.name} (zone ${zone.mapId}); ${zone.installs} distinct folded installs; data as of ${report.dataAsOf ?? unknown}.`);
      for (const type of types) {
        lines.push(`${type}: ${cellText(zone.types[type])}`);
        for (const field of zone.fields.filter((f) => f.type === type)) lines.push(`  ${type}.${field.field}: ${cellText(field)}`);
      }
      const needs = zone.needs.filter((n) => args.type === undefined || n.type === args.type);
      // One zone pages its entries by offset; several zones each show their first few and say how to read the rest.
      const from = list === "entries" ? offset : 0;
      const shown = needs.slice(from, from + (list === "entries" ? limit : COVERAGE_PAGE.entriesPerZone));
      if (list === "entries") total = needs.length;
      // The score caps the combined list per zone, before a type filter. Never imply it is exhaustive.
      const capped = `from ${zone.needs.length}/${zone.needsTotal} listed across all types (the page's capped list). Values are withheld until 3 installs agree.`;
      lines.push(from === 0 && shown.length === needs.length
        ? `Reported fields needing installs: showing ${needs.length} matching entries ${capped}`
        : `Reported fields needing installs: showing ${range("entries", from, shown.length, needs.length)} matching, ${capped}`);
      for (const need of shown) {
        lines.push(`  ${need.type}.${need.field}: ${need.label}; ${need.voters}/3 agreeing installs; ${need.need} more needed; ${need.href ? `https://everloot.app${need.href}` : unknown}`);
      }
      const end = from + shown.length;
      if (list === "entries" && end < needs.length) next = end;
      if (list === "zones" && end < needs.length) {
        lines.push(`  ${needs.length - end} more entries here: call coverage with zone=${zone.mapId}${args.type ? ` and type=${args.type}` : ""}, offset=${end}.`);
      }
    }
  }
  if (list === "zones" && offset + zonePage.length < zones.length) next = offset + zonePage.length;
  if (next !== undefined) lines.push(`\n${continuation(list, next, total)}`);
  if (!detail && zones.length) lines.push("Per-field counts and the reported fields needing installs: pass detail=true, or zone=<id> for one zone.");

  return {
    text: `${lines.join("\n")}\nMore: ${page}`,
    structured: {
      connected: true, dataAsOf: report.dataAsOf, url: page, scope: scopeOut,
      page: {
        build: report.build, installs: report.installs, expectedAsOf: report.expected?.dataAsOf ?? null,
        settledList: { facts: settled?.facts ?? null, dataAsOf: settled?.dataAsOf ?? null },
        totals: counts(totals), needsInstalls,
        types: typeCells.map(({ type, cell }) => ({ type, counts: counts(cell) })),
        zones: zonePage.map((zone) => ({ mapId: zone.mapId, name: zone.name, installs: zone.installs, counts: counts(zoneCell(zone)) })),
        detail, list, total, offset, limit, ...(next !== undefined ? { nextOffset: next } : {}),
      },
    },
  };
}
