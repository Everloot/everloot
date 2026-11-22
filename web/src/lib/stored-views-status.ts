import { r2Client, r2Config, type R2Config } from "./upload-store";

/**
 * What /api/health says about the stored views (#1354): when the stored-views job last finished and which views it
 * could not write (VIEWS_RUN_KEY, written by the job), and how the snapshot cron's last start of the job went, with
 * the start token's expiry as GitHub reports it (DISPATCH_KEY, written by the cron Worker). Before these, a job that
 * stopped running, or a token that expired, showed nowhere: the views just aged.
 */
export const VIEWS_RUN_KEY = "views/last-run.json";
export const DISPATCH_KEY = "cron/views-dispatch.json";

/** The job runs at least hourly (the cron starts it on the first run of each hour), so 90 minutes without one is a stop. */
export const VIEWS_BEHIND_MS = 90 * 60_000;
/** The site-health check warns this many days before the start token expires. */
export const TOKEN_WARN_DAYS = 7;

export interface ViewsRun { finishedAt: string; dataAsOf: string | null; failed: string[]; seconds: number; timings: Record<string, number> }
export interface DispatchRecord { at: string; httpStatus: number; sent: boolean; tokenExpiresAt: string | null }

export interface ViewsHealth {
  status: "current" | "behind" | "failing" | "missing" | "unavailable" | "local";
  finishedAt: string | null;
  ageSeconds: number | null;
  dataAsOf: string | null;
  failed: string[];
}
export interface DispatchHealth {
  status: "sent" | "refused" | "none" | "unavailable" | "local";
  at: string | null;
  httpStatus: number | null;
  tokenExpiresAt: string | null;
  tokenDaysLeft: number | null;
}

type Deps = { cloud?: R2Config | null; fetch?: typeof fetch; now?: () => number };

/** GitHub's `github-authentication-token-expiration` answer header, "2026-12-22 06:42:29 UTC", as ISO; null if absent. */
export function tokenExpiry(header: string | null): string | null {
  const m = header?.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  const zone = !m[3] || m[3] === "UTC" || m[3] === "Z" ? "Z" : m[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const at = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function url(cloud: R2Config, key: string): string {
  return `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${key}`;
}

async function put(key: string, body: unknown, deps: Deps): Promise<void> {
  const cloud = deps.cloud === undefined ? r2Config() : deps.cloud;
  if (!cloud) return;
  const req = await r2Client(cloud).sign(url(cloud, key), {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const res = await (deps.fetch ?? fetch)(req, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${key} write failed (${res.status})`);
}

async function get(key: string, cloud: R2Config, deps: Deps): Promise<unknown | null> {
  const req = await r2Client(cloud).sign(url(cloud, key), { method: "GET" });
  const res = await (deps.fetch ?? fetch)(req, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${key} read failed (${res.status})`);
  return res.json();
}

export const writeViewsRun = (run: ViewsRun, deps: Deps = {}) => put(VIEWS_RUN_KEY, run, deps);
export const writeDispatchRecord = (record: DispatchRecord, deps: Deps = {}) => put(DISPATCH_KEY, record, deps);

const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
const time = (v: unknown): string | null => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;

export async function viewsHealth(deps: Deps = {}): Promise<ViewsHealth> {
  const none = { finishedAt: null, ageSeconds: null, dataAsOf: null, failed: [] };
  const cloud = deps.cloud === undefined ? r2Config() : deps.cloud;
  if (!cloud) return { status: "local", ...none };
  try {
    const raw = await get(VIEWS_RUN_KEY, cloud, deps) as Partial<Record<keyof ViewsRun, unknown>> | null;
    if (!raw) return { status: "missing", ...none };
    const finishedAt = time(raw.finishedAt);
    if (!finishedAt) return { status: "unavailable", ...none };
    const age = Math.max(0, (deps.now ?? Date.now)() - Date.parse(finishedAt));
    const failed = strings(raw.failed);
    const status = age > VIEWS_BEHIND_MS ? "behind" : failed.length ? "failing" : "current";
    return { status, finishedAt, ageSeconds: Math.floor(age / 1000), dataAsOf: time(raw.dataAsOf), failed };
  } catch {
    return { status: "unavailable", ...none };
  }
}

export async function dispatchHealth(deps: Deps = {}): Promise<DispatchHealth> {
  const none = { at: null, httpStatus: null, tokenExpiresAt: null, tokenDaysLeft: null };
  const cloud = deps.cloud === undefined ? r2Config() : deps.cloud;
  if (!cloud) return { status: "local", ...none };
  try {
    const raw = await get(DISPATCH_KEY, cloud, deps) as Partial<Record<keyof DispatchRecord, unknown>> | null;
    if (!raw) return { status: "none", ...none };
    const tokenExpiresAt = time(raw.tokenExpiresAt);
    const left = tokenExpiresAt ? (Date.parse(tokenExpiresAt) - (deps.now ?? Date.now)()) / 86_400_000 : null;
    return {
      status: raw.sent === true ? "sent" : "refused",
      at: time(raw.at),
      httpStatus: typeof raw.httpStatus === "number" ? raw.httpStatus : null,
      tokenExpiresAt,
      tokenDaysLeft: left === null ? null : Math.floor(left),
    };
  } catch {
    return { status: "unavailable", ...none };
  }
}
