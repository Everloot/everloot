import { AwsClient } from "aws4fetch";
import { COVERAGE_SCHEMA, COVERAGE_TYPES } from "../../../kb/src/coverage";
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

/** How long one server instance keeps the read: the cron rewrites the score at most every 10 minutes. */
const KEEP_MS = 5 * 60_000;
/** A failed read is asked for again after a minute. */
const RETRY_MS = 60_000;

let kept: { build: string; at: number; summary: CoverageSummary | null; etag?: string } | null = null;

/**
 * The summary for the build the site reads, from the stored score: one small GET per instance every five minutes,
 * conditional on the ETag so an unchanged file is not downloaded again. Null when storage is not configured, the file
 * is missing or unreadable: the page then says "unrecorded". A failed re-read keeps the last good summary, which
 * carries its own date. Never throws.
 */
export async function loadCoverageSummary(deps: { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number; build?: string } = {}): Promise<CoverageSummary | null> {
  const now = (deps.now ?? Date.now)();
  const build = deps.build ?? CLIENT_LAYER.build.version;
  if (kept && kept.build === build && now - kept.at < KEEP_MS) return kept.summary;
  const last = kept?.build === build ? kept : null;
  try {
    const cloud = deps.cloud === undefined ? r2Config() : deps.cloud;
    if (!cloud) return null;
    const client = new AwsClient({ accessKeyId: cloud.r2AccessKeyId, secretAccessKey: cloud.r2SecretAccessKey, service: "s3", region: "auto" });
    const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${coverageKey(build)}`;
    const etag = last?.summary ? last.etag : undefined;
    const res = await (deps.fetch ?? fetch)(await client.sign(url, { method: "GET", headers: { "accept-encoding": "identity", ...(etag ? { "if-none-match": etag } : {}) } }));
    if (res.status === 304 && last?.summary) {
      kept = { ...last, at: now };
    } else if (res.ok) {
      let raw: unknown = null;
      try { raw = JSON.parse(await res.text()); } catch { /* unreadable: summarize says null */ }
      const summary = summarizeCoverage(raw);
      kept = summary ? { build, at: now, summary, etag: res.headers.get("etag") ?? undefined } : { build, at: now - KEEP_MS + RETRY_MS, summary: null };
    } else {
      kept = { build, at: now - KEEP_MS + RETRY_MS, summary: res.status === 404 ? null : last?.summary ?? null, etag: last?.etag };
    }
  } catch {
    kept = { build, at: now - KEEP_MS + RETRY_MS, summary: last?.summary ?? null, etag: last?.etag };
  }
  return kept.summary;
}

/** For tests: forget the kept read. */
export const forgetCoverageSummary = () => { kept = null; };
