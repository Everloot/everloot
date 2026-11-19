import { AwsClient } from "aws4fetch";
import { COVERAGE_SCHEMA, COVERAGE_TYPES, type CoverageCell, type CoverageReport } from "@kb/coverage";
import type { PlateauReport } from "@kb/plateau";
import { CLIENT_LAYER } from "./items";
import { keep } from "./kept";
import { r2Config, type R2Config } from "./upload-store";

/** Where the snapshot cron keeps the coverage score for a client build: counts only, beside the corpus snapshot. */
export const coverageKey = (build: string): string => `coverage/${build}.json`;

/**
 * The stored file's own version. 1 (no `version` field) is the score alone; 2 adds `plateau`, measured by the cron
 * from the same records. The score inside keeps its own `schema`; readers accept both versions.
 */
export const COVERAGE_STORED_VERSION = 2;

/**
 * The four numbers the home page shows, taken from the stored score (`coverage/<build>.json`) the cron already
 * writes, so no page view reads the corpus. Installs count every shown fact; confirmed and waiting count the released zones only.
 */
export interface CoverageSummary {
  /** Distinct folded installs behind every counted fact, as the score counts them. */
  installs: number;
  /** Entity-field facts at least 3 installs agree on, across the released zones (settled ones included). */
  confirmed: number;
  /** Reported facts that need one or two more installs to agree, across the released zones. */
  waiting: number;
  /** When the records behind the counts were current; null when the score does not say. */
  dataAsOf: string | null;
  build: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** The summary of a stored score, or null for anything that is not a score this code can read: unknown, never zero. */
export function summarizeCoverage(raw: unknown): CoverageSummary | null {
  if (!isObject(raw) || raw.schema !== COVERAGE_SCHEMA || !count(raw.installs) || !isObject(raw.totals) || !Array.isArray(raw.zones) || raw.zones.length === 0) return null;
  let confirmed = 0;
  for (const type of COVERAGE_TYPES) {
    const cell = raw.totals[type];
    if (!isObject(cell) || !count(cell.confirmed)) return null;
    confirmed += cell.confirmed;
  }
  let waiting = 0;
  for (const zone of raw.zones) {
    if (!isObject(zone) || !count(zone.needsTotal)) return null;
    waiting += zone.needsTotal;
  }
  const dataAsOf = typeof raw.dataAsOf === "string" && Number.isFinite(Date.parse(raw.dataAsOf)) ? raw.dataAsOf : null;
  return { installs: raw.installs, confirmed, waiting, dataAsOf, build: typeof raw.build === "string" ? raw.build : null };
}

const cellOf = (v: unknown): v is CoverageCell => isObject(v) && count(v.observed) && count(v.reported) && count(v.recheck) && count(v.confirmed) && count(v.settled)
  && (v.expected === null || count(v.expected)) && (v.denominator === null || count(v.denominator));
const cellsOf = (v: unknown) => isObject(v) && COVERAGE_TYPES.every((t) => cellOf(v[t]));
const needOf = (v: unknown) => isObject(v) && COVERAGE_TYPES.includes(v.type as never) && typeof v.field === "string" && typeof v.label === "string"
  && count(v.voters) && count(v.need) && (v.href === null || typeof v.href === "string");
const areaOf = (v: unknown) => isObject(v) && count(v.installs) && count(v.needsTotal) && cellsOf(v.types)
  && Array.isArray(v.fields) && v.fields.every((f) => cellOf(f) && isObject(f) && COVERAGE_TYPES.includes(f.type as never) && typeof f.field === "string")
  && Array.isArray(v.needs) && v.needs.every(needOf);

/**
 * The whole stored score, for the readers that need more than the four home-page numbers (the MCP coverage tool).
 * Null unless it is a score for `build` that has every field those readers print: a report for another build, or
 * one this code cannot read, is unusable, never a partial answer.
 */
export function readStoredReport(raw: unknown, build: string): CoverageReport | null {
  if (!isObject(raw) || raw.schema !== COVERAGE_SCHEMA || raw.build !== build || typeof raw.method !== "string" || !count(raw.installs)) return null;
  if (raw.dataAsOf !== null && typeof raw.dataAsOf !== "string") return null;
  if (raw.expected !== null && !(isObject(raw.expected) && (raw.expected.dataAsOf === null || typeof raw.expected.dataAsOf === "string"))) return null;
  if (!cellsOf(raw.totals) || !areaOf(raw.unplaced) || !isObject(raw.locate) || !Array.isArray(raw.locate.quests) || !Array.isArray(raw.locate.npcs)) return null;
  if (!Array.isArray(raw.zones) || raw.zones.length === 0 || !raw.zones.every((z) => areaOf(z) && Number.isInteger((z as { mapId?: unknown }).mapId) && typeof (z as { name?: unknown }).name === "string")) return null;
  // The stored file's envelope (version 2) is not part of the score.
  const { plateau: _plateau, version: _version, ...report } = raw;
  return report as unknown as CoverageReport;
}

const share = (v: unknown) => v === null || (typeof v === "number" && v >= 0 && v <= 1);
const typePlateauOf = (v: unknown) => isObject(v) && COVERAGE_TYPES.includes(v.type as never) && (v.denominator === null || count(v.denominator))
  && count(v.confirmed) && count(v.settled) && count(v.recheck) && (v.newlyConfirmed === null || count(v.newlyConfirmed))
  && isObject(v.shares) && share(v.shares.confirmed) && share(v.shares.settled) && share(v.shares.newlyConfirmed)
  && (v.atPlateau === null || typeof v.atPlateau === "boolean");

/**
 * The plateau a version-2 file stores beside `report`, or null: a version-1 file has none, and one that is malformed
 * or not measured on the same data date as the score is not shown beside it.
 */
export function readStoredPlateau(raw: unknown, report: CoverageReport): PlateauReport | null {
  if (!isObject(raw) || raw.version !== COVERAGE_STORED_VERSION) return null;
  const p = raw.plateau;
  if (!isObject(p) || p.dataAsOf !== report.dataAsOf || typeof p.method !== "string" || !count(p.installs) || !count(p.windowInstalls)) return null;
  if (p.windowStart !== null && typeof p.windowStart !== "string") return null;
  if (!(p.site === null || typeof p.site === "boolean") || !count(p.refreshDays)) return null;
  const types: unknown = p.types;
  if (!Array.isArray(types) || !COVERAGE_TYPES.every((t) => types.some((x) => isObject(x) && x.type === t)) || !types.every(typePlateauOf)) return null;
  return p as unknown as PlateauReport;
}

/** How long one server instance keeps the read: the cron rewrites the score at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;
/** A failed read is asked for again after a minute. */
const RETRY_MS = 60_000;

/**
 * The parts of the stored file the readers use. `okAt` is when the storage last answered for this file (a 200 or a
 * 304); a failed refresh keeps the last good parts but never moves `okAt`.
 */
type Read = { build: string; okAt: number; summary: CoverageSummary | null; report: CoverageReport | null; plateau: PlateauReport | null; etag?: string };

/** One read per caller (`share: false`): a Worker cancels work one request awaits on another's behalf (release.ts). */
const stored = keep<Read, { build: string; cloud: R2Config; fetch: typeof fetch }>(async ({ build, cloud, fetch: doFetch }, kept, now) => {
  const last = kept?.value.build === build ? kept.value : null;
  const retry = { keepMs: RETRY_MS };
  try {
    const client = new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });
    const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${coverageKey(build)}`;
    const etag = last?.summary ? last.etag : undefined;
    const res = await doFetch(await client.sign(url, { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } }));
    if (res.status === 304 && last?.summary) return { value: { ...last, okAt: now } };
    if (res.ok) {
      let raw: unknown = null;
      try { raw = JSON.parse(await res.text()); } catch { /* unreadable: summarize says null */ }
      const summary = summarizeCoverage(raw);
      if (!summary) return { value: { build, okAt: now, summary: null, report: null, plateau: null }, ...retry };
      const report = readStoredReport(raw, build);
      return { value: { build, okAt: now, summary, report, plateau: report && readStoredPlateau(raw, report), etag: res.headers.get("etag") ?? undefined } };
    }
    const keepLast = res.status !== 404;
    return { value: { build, okAt: last?.okAt ?? now, summary: keepLast ? last?.summary ?? null : null, report: keepLast ? last?.report ?? null : null, plateau: keepLast ? last?.plateau ?? null : null, etag: last?.etag }, ...retry };
  } catch {
    return { value: { build, okAt: last?.okAt ?? now, summary: last?.summary ?? null, report: last?.report ?? null, plateau: last?.plateau ?? null, etag: last?.etag }, ...retry };
  }
}, { ttlMs: KEEP_MS, share: false });

type Deps = { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number; build?: string };

/**
 * The summary for the build the site reads, from the stored score: one small GET per instance every five minutes,
 * conditional on the ETag so an unchanged file is not downloaded again. Null when storage is not configured, the file
 * is missing or unreadable: the page then says "unrecorded". A failed re-read keeps the last good summary, which
 * carries its own date: a display policy for the pages only, the tool's reader below does not share it. Never throws.
 */
export async function loadCoverageSummary(deps: Deps = {}): Promise<CoverageSummary | null> {
  return (await readKept(deps))?.summary ?? null;
}

/**
 * The whole stored score for the build, from the same read as the summary (one GET, one ETag, one five-minute keep),
 * so a reader of it never replays the corpus and agrees with the home page to the number. Null when storage is not
 * configured, the file is missing, unreadable or for another build, and also when a refresh has failed: a report
 * the storage has not confirmed within the keep window is not served (the home page may keep showing its summary,
 * dated; an answer that says "stored" must not be older than that), so the caller computes live or says unavailable.
 * Never throws.
 */
export async function loadStoredCoverage(deps: Deps = {}): Promise<CoverageReport | null> {
  const k = await readKept(deps);
  return k?.report && (deps.now ?? Date.now)() - k.okAt < KEEP_MS ? k.report : null;
}

/**
 * What the coverage pages show, from the same read: the stored score and, when the cron has stored it (version 2),
 * the plateau measured beside it. The pages never compute the score themselves: null (storage not configured, the
 * file missing, unreadable or for another build) renders "unreachable". Like the home page, a failed refresh keeps
 * the last good copy, which the pages print with its data date. Never throws.
 */
export async function loadCoverageForPages(deps: Deps = {}): Promise<{ report: CoverageReport; plateau: PlateauReport | null } | null> {
  const k = await readKept(deps);
  return k?.report ? { report: k.report, plateau: k.plateau } : null;
}

async function readKept(deps: Deps): Promise<Read | null> {
  const now = (deps.now ?? Date.now)();
  const build = deps.build ?? CLIENT_LAYER.build.version;
  const hit = stored.fresh(now);
  if (hit?.value.build === build) return hit.value;
  let cloud: R2Config | null;
  try { cloud = deps.cloud === undefined ? r2Config() : deps.cloud; } catch { return null; }
  if (!cloud) return null;
  // A fresh copy of another build would be served as-is: drop it and read this build's own file.
  if (hit) stored.forget();
  return stored.get({ build, cloud, fetch: deps.fetch ?? fetch }, now);
}

/** For tests: forget the kept read. */
export const forgetCoverageSummary = () => stored.forget();
