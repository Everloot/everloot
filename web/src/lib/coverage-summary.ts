import { AwsClient } from "aws4fetch";
import { COVERAGE_SCHEMA, COVERAGE_TYPES, type CoverageCell, type CoverageReport } from "../../../kb/src/coverage";
import { CLIENT_LAYER } from "./items";
import { r2Config, type R2Config } from "./upload-store";

/** Where the snapshot cron keeps the coverage score for a client build: counts only, beside the corpus snapshot. */
export const coverageKey = (build: string): string => `coverage/${build}.json`;

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
  return raw as unknown as CoverageReport;
}

/** How long one server instance keeps the read: the cron rewrites the score at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;
/** A failed read is asked for again after a minute. */
const RETRY_MS = 60_000;

/** `okAt` is when the storage last answered for this file (a 200 or a 304); a failed refresh moves `at` but never `okAt`. */
type Kept = { build: string; at: number; okAt: number; summary: CoverageSummary | null; report: CoverageReport | null; etag?: string };
let kept: Kept | null = null;

type Deps = { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number; build?: string };

/**
 * The summary for the build the site reads, from the stored score: one small GET per instance every five minutes,
 * conditional on the ETag so an unchanged file is not downloaded again. Null when storage is not configured, the file
 * is missing or unreadable: the page then says "unrecorded". A failed re-read keeps the last good summary, which
 * carries its own date: a display policy for the page only, the tool's reader below does not share it. Never throws.
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

async function readKept(deps: Deps): Promise<Kept | null> {
  const now = (deps.now ?? Date.now)();
  const build = deps.build ?? CLIENT_LAYER.build.version;
  if (kept && kept.build === build && now - kept.at < KEEP_MS) return kept;
  const last = kept?.build === build ? kept : null;
  try {
    const cloud = deps.cloud === undefined ? r2Config() : deps.cloud;
    if (!cloud) return null;
    const client = new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });
    const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${coverageKey(build)}`;
    const etag = last?.summary ? last.etag : undefined;
    const res = await (deps.fetch ?? fetch)(await client.sign(url, { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } }));
    if (res.status === 304 && last?.summary) {
      kept = { ...last, at: now, okAt: now };
    } else if (res.ok) {
      let raw: unknown = null;
      try { raw = JSON.parse(await res.text()); } catch { /* unreadable: summarize says null */ }
      const summary = summarizeCoverage(raw);
      kept = summary ? { build, at: now, okAt: now, summary, report: readStoredReport(raw, build), etag: res.headers.get("etag") ?? undefined } : { build, at: now - KEEP_MS + RETRY_MS, okAt: now, summary: null, report: null };
    } else {
      const keep = res.status !== 404;
      kept = { build, at: now - KEEP_MS + RETRY_MS, okAt: last?.okAt ?? now, summary: keep ? last?.summary ?? null : null, report: keep ? last?.report ?? null : null, etag: last?.etag };
    }
  } catch {
    kept = { build, at: now - KEEP_MS + RETRY_MS, okAt: last?.okAt ?? now, summary: last?.summary ?? null, report: last?.report ?? null, etag: last?.etag };
  }
  return kept;
}

/** For tests: forget the kept read. */
export const forgetCoverageSummary = () => { kept = null; };
