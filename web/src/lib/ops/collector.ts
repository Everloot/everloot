import { authQuery } from "@/lib/supabase/server";
import { uploadStore } from "@/lib/upload-store";
import { activityMetrics, contributorMetrics, exclusions, installKey } from "./metrics";
import { readOpsContributorHints, readOpsSummary, writeOpsSummary } from "./store";
import type { ActivityRow, CounterRow, OpsContributorHints, OpsCpu, OpsSource, OpsSummary } from "./types";

const DAY = 86_400_000;
const PAGE = 1000, MAX_PAGES = 10;
type Query = <T>(path: string, init?: RequestInit) => Promise<T>;
type UploadRow = { id: string; install_id: string; received_at: string; record_count: number };
/** A bounded query is marked partial if another page could exist, never silently treated as complete. */
async function bounded<T>(query: Query, path: string): Promise<{ rows: T[]; partial: boolean }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await query<T[]>(`${path}&limit=${PAGE}&offset=${page * PAGE}`);
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, partial: false };
  }
  return { rows, partial: true };
}
const unavailable = (detail: string): OpsSource => ({ status: "unavailable", asOf: null, detail });
const source = (now: string, detail: string, partial = false): OpsSource => ({ status: partial ? "partial" : "fresh", asOf: now,
  detail: partial ? `${detail}; bounded source truncated; any contributor counts shown are lower bounds` : detail });

/** Adaptive analytics cost equivalent, before shared allowances; this is never a billed total. */
export async function collectCpu(env: Record<string, string | undefined>, now: string, doFetch: typeof fetch = fetch): Promise<OpsCpu | null> {
  const token = env.EVERLOOT_OPS_CF_ANALYTICS_TOKEN, account = env.R2_ACCOUNT_ID, script = env.EVERLOOT_OPS_WORKER_NAME;
  if (!token || !account || !script) return null;
  const until = `${now.slice(0, 10)}T00:00:00.000Z`, since = `${now.slice(0, 7)}-01T00:00:00.000Z`;
  const days = Math.round((Date.parse(until) - Date.parse(since)) / DAY);
  if (days < 1) return null;
  // One bounded month-to-date query, at most 31 date groups. Never query the provider on page views.
  const response = await doFetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: `{ viewer { accounts(filter: {accountTag: ${JSON.stringify(account)}}) { workersInvocationsAdaptive(limit: 32, filter: {scriptName: ${JSON.stringify(script)}, datetime_geq: ${JSON.stringify(since)}, datetime_lt: ${JSON.stringify(until)}}, orderBy: [date_ASC]) { dimensions { date } sum { cpuTimeUs } } } } }` }),
    });
    if (!response.ok) throw new Error("Cloudflare analytics unavailable");
    const data = await response.json() as { errors?: unknown[]; data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: { sum?: { cpuTimeUs?: number } }[] }[] } } };
    const rows = data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
    if (data.errors?.length || !rows?.length || rows.length > 31 || rows.some(row => typeof row.sum?.cpuTimeUs !== "number" || !Number.isFinite(row.sum.cpuTimeUs) || row.sum.cpuTimeUs < 0)) throw new Error("Cloudflare CPU data unavailable");
  const cpuUs = rows.reduce((n, row) => n + row.sum!.cpuTimeUs!, 0);
  const cpuMs = cpuUs / 1000, estimatedUsd = cpuMs / 1_000_000 * 0.02;
  return { cpuMs, estimatedUsd, monthlyPaceUsd: estimatedUsd / days * 30, since, until,
    formula: "cpuTimeUs / 1000 / 1,000,000 × $0.02; before account-shared allowance/base; adaptive estimate; 30-day pace from completed UTC days",
    pricingDate: "2026-11-12", includedServices: ["Configured website Worker CPU only; excludes requests, base plan, R2, database, logs and other services"] };
}

export async function collectOpsSummary(deps: {
  env?: Record<string, string | undefined>; query?: Query; now?: string; previous?: OpsSummary | null;
  health?: () => Promise<{ status: string; updatedAt?: string | null }>; write?: (summary: OpsSummary) => Promise<void>; fetch?: typeof fetch;
  hints?: () => Promise<OpsContributorHints | null>;
} = {}): Promise<OpsSummary> {
  const env = deps.env ?? process.env, query = deps.query ?? authQuery, now = deps.now ?? new Date().toISOString();
  const previous = deps.previous === undefined ? await readOpsSummary() : deps.previous;
  const excluded = exclusions(env), since = new Date(Date.parse(`${now.slice(0, 10)}T00:00:00Z`) - 90 * DAY).toISOString();
  const compatible = previous?.exclusionVersion === excluded.version ? previous : null;
  const summary: OpsSummary = { version: 1, generatedAt: now, exclusionVersion: excluded.version, excludedInstalls: excluded.keys.size,
    sources: {}, activity: { today: null, past7Days: null, returning: null, historySince: null }, daily: [], contributors: [], historical: null,
    health: { snapshot: null, attention: [] }, costs: { cpu: null, actualBilled: null }, usage: { mcp: null, browser: null } };
  const failed = (name: string, detail: string, prior = previous) => {
    const old = prior?.sources[name];
    summary.sources[name] = old?.asOf ? { ...old, status: "stale", detail: `${detail}; last-good values retained` } : unavailable(detail);
  };
  let counters: CounterRow[] | null = null;
  if (env.EVERLOOT_USAGE_METRICS === "1" || env.EVERLOOT_OPS_METRICS === "1") {
    try {
      const result = await bounded<CounterRow>(query, `usage_counters?select=day,metric,count&day=gte.${since.slice(0, 10)}&order=day.desc,metric.asc`);
      counters = result.partial ? null : result.rows;
      summary.usage.mcp = env.EVERLOOT_USAGE_METRICS === "1" && !result.partial ? Object.fromEntries([...new Set(result.rows.filter(r => /^mcp(_public)?\./.test(r.metric)).map(r => r.metric))].map(metric => [metric, result.rows.filter(r => r.metric === metric).reduce((n, r) => n + Number(r.count), 0)])) : null;
      summary.sources.outcomes = env.EVERLOOT_OPS_METRICS === "1" ? source(now, "Finite intake outcome/rejection categories; all attempts, owner/test attempts included; best-effort instrumentation", result.partial) : unavailable("Intake counters disabled");
      summary.sources.mcp = env.EVERLOOT_USAGE_METRICS === "1" ? source(now, "MCP tool calls in retained 90-day window; all traffic, probes unexcluded", result.partial) : unavailable("Usage counters disabled");
    } catch {
      summary.usage.mcp = previous?.usage.mcp ?? null;
      failed("mcp", "Usage counters unavailable"); failed("outcomes", "Outcome counters unavailable");
    }
  } else {
    summary.sources.mcp = unavailable("Usage counters disabled"); summary.sources.outcomes = unavailable("Intake counters disabled");
  }
  if (env.EVERLOOT_OPS_METRICS === "1") {
    try {
      const state = await query<{ started_at: string }[]>("ops_state?select=started_at&key=eq.intake&limit=1");
      if (!state[0]?.started_at) throw new Error("No receipt history");
      const result = await bounded<ActivityRow>(query, `ops_install_days?select=day,install_key,receipts,records,last_received_at,realms,kinds&day=gte.${since.slice(0, 10)}&order=day.desc,install_key.asc`);
      Object.assign(summary, activityMetrics(result.rows, counters, excluded.keys, state[0].started_at, now));
      summary.contributors = contributorMetrics(result.rows, excluded.keys);
      if (result.partial) {
        summary.activity = { ...summary.activity, today: null, past7Days: null, returning: null };
        summary.daily = [];
      }
      summary.sources.receipts = source(now, "Best-effort fully successful intake receipts by server UTC receive day; installations, not people; known owner/test installs excluded; 7-day total includes partial today, retention uses two completed UTC weeks", result.partial);
      if (counters?.some(r => r.metric === "ops.activity_missing" && Number(r.count) > 0)) {
        summary.sources.receipts.status = "partial";
        summary.sources.receipts.detail += "; instrumentation observed successful receipts without an installation key";
        summary.activity.returning = null;
      }
    } catch {
      if (compatible) { summary.activity = compatible.activity; summary.daily = compatible.daily; summary.contributors = compatible.contributors; }
      failed("receipts", "Receipt activity unavailable or not yet instrumented", compatible);
    }
  } else summary.sources.receipts = unavailable("Receipt telemetry disabled");
  // Privacy retention continues even after collection has been switched off.
  try {
    await query("rpc/prune_ops_activity", { method: "POST", body: "{}" });
    summary.sources.retention = source(now, "Pseudonymous day rows retained for 90 completed days; anonymous totals retained thereafter");
  } catch { summary.sources.retention = unavailable("Receipt retention cleanup unavailable"); }
  try {
    const result = await bounded<UploadRow>(query, `uploads?select=id,install_id,received_at,record_count&received_at=gte.${encodeURIComponent(since)}&order=received_at.desc,id.asc`);
    const rows: ActivityRow[] = result.rows.map(r => ({ day: r.received_at.slice(0, 10), install_key: installKey(r.install_id, env.EVERLOOT_OPS_HMAC_SECRET!), receipts: 1, records: Number(r.record_count), last_received_at: r.received_at, realms: [], kinds: [] }));
    const external = rows.filter(r => !excluded.keys.has(r.install_key));
    summary.historical = result.partial ? null : { contributors: new Set(external.map(r => r.install_key)).size, uploads: external.length, records: external.reduce((n, r) => n + r.records, 0), since };
    const known = new Set(summary.contributors.map(r => r.id));
    summary.contributors.push(...contributorMetrics(rows, excluded.keys, "stored-uploads").filter(c => !known.has(c.id)));
    summary.sources.historical = source(now, "Stored-upload index only; excludes successful receipts without a stored upload; observed realms unknown before telemetry", result.partial);
  } catch {
    summary.historical = compatible?.historical ?? null;
    failed("historical", "Upload index unavailable", compatible);
  }
  try {
    const hints = await (deps.hints ?? readOpsContributorHints)();
    if (!hints) throw new Error("Historical observation hints unavailable");
    const byId = new Map(hints.contributors.map(c => [c.id, c]));
    summary.contributors = summary.contributors.map(c => {
      const hint = c.series === "stored-uploads" ? byId.get(c.id) : null;
      return hint ? { ...c, realms: [...new Set([...c.realms, ...hint.realms])].sort(), kinds: [...new Set([...c.kinds, ...hint.kinds])].sort() } : c;
    });
    summary.sources.hints = { status: Date.parse(now) - Date.parse(hints.generatedAt) > 90 * 60_000 ? "stale" : "fresh", asOf: hints.generatedAt,
      detail: "One-off historical observed realms/kinds matched only by installation HMAC; no account or submitting character association; never used for receipt activity" };
  } catch { summary.sources.hints = unavailable("Historical observed realms/kinds unknown; optional private hints absent"); }
  try {
    const health = await (deps.health ?? (() => uploadStore.snapshotHealth()))();
    summary.health.snapshot = { status: health.status, generatedAt: health.updatedAt };
    summary.sources.health = health.status === "fresh" ? source(now, "Existing snapshot cron heartbeat") : { status: "stale", asOf: health.updatedAt ?? null, detail: "Snapshot heartbeat is not fresh" };
  } catch { summary.health.snapshot = previous?.health.snapshot ?? null; failed("health", "Snapshot health unavailable"); }
  try {
    summary.costs.cpu = await collectCpu(env, now, deps.fetch);
    summary.sources.cpu = summary.costs.cpu ? source(now, "Cloudflare adaptive CPU estimate, completed UTC month-to-date") : unavailable("Scoped Cloudflare analytics token/Worker missing or no completed UTC days");
  } catch { summary.costs.cpu = previous?.costs.cpu ?? null; failed("cpu", "Cloudflare CPU analytics unavailable"); }
  summary.sources.browser = unavailable("Browser beacon estimate not connected; owner exclusion unavailable");
  summary.sources.billing = unavailable("Actual billed totals not connected");
  summary.daily = summary.daily.filter(day => day.day >= since.slice(0, 10));
  summary.contributors = summary.contributors.filter(c => c.lastReceivedAt >= since).map(c => ({ ...c, daysActive: c.daysActive.filter(day => day >= since.slice(0, 10)) }));
  summary.health.attention = Object.entries(summary.sources).filter(([name, s]) => ["receipts", "health", "outcomes", "retention"].includes(name) && s.status !== "fresh").map(([name, s]) => `${name}: ${s.detail}`);
  if (summary.daily.at(-1)?.storageFailures) summary.health.attention.push("Intake storage failures recorded today");
  await (deps.write ?? writeOpsSummary)(summary);
  return summary;
}
