import { createHash, createHmac } from "node:crypto";
import type { ActivityRow, CounterRow, OpsContributor, OpsDay, OpsSummary } from "./types";

const DAY = 86_400_000;
export function installKey(id: string, secret: string): string {
  if (!secret) throw new Error("Operations identity is not configured");
  return createHmac("sha256", secret).update(`everloot:ops:v1:${id}`).digest("hex");
}
export function exclusions(env: Record<string, string | undefined> = process.env) {
  const secret = env.EVERLOOT_OPS_HMAC_SECRET?.trim();
  if (!secret) throw new Error("Operations identity is not configured");
  const value: unknown = JSON.parse(env.EVERLOOT_OPS_EXCLUDED_INSTALLS || "[]");
  if (!Array.isArray(value) || value.some(x => typeof x !== "string" || !x.length)) throw new Error("Invalid operations exclusions");
  const keys = new Set((value as string[]).map(id => installKey(id, secret)));
  return { keys, version: createHash("sha256").update(installKey("namespace-version", secret)).update([...keys].sort().join(",")).digest("hex").slice(0, 16) };
}
export function contributorMetrics(rows: ActivityRow[], excluded: Set<string>, series: OpsContributor["series"] = "receipts"): OpsContributor[] {
  const contributors = new Map<string, OpsContributor>();
  for (const row of rows) {
    let entry = contributors.get(row.install_key);
    if (!entry) {
      entry = { id: row.install_key, alias: `Install ${row.install_key.slice(0, 12)}`, excluded: excluded.has(row.install_key),
        realms: [], kinds: [], successfulReceipts: 0, records: 0, lastReceivedAt: row.last_received_at, daysActive: [], series };
      contributors.set(row.install_key, entry);
    }
    entry.successfulReceipts += Number(row.receipts); entry.records += Number(row.records);
    if (row.last_received_at > entry.lastReceivedAt) entry.lastReceivedAt = row.last_received_at;
    entry.daysActive = [...new Set([...entry.daysActive, row.day])].sort();
    entry.realms = [...new Set([...entry.realms, ...row.realms])].sort();
    entry.kinds = [...new Set([...entry.kinds, ...row.kinds])].sort();
  }
  return [...contributors.values()].sort((a, b) => b.lastReceivedAt.localeCompare(a.lastReceivedAt) || a.id.localeCompare(b.id));
}
export function activityMetrics(rows: ActivityRow[], counters: CounterRow[] | null, excluded: Set<string>, since: string, now: string): Pick<OpsSummary, "activity" | "daily"> {
  const today = now.slice(0, 10), midnight = Date.parse(`${today}T00:00:00Z`);
  const dayAt = (offset: number) => new Date(midnight - offset * DAY).toISOString().slice(0, 10);
  const retainedSince = since.slice(0, 10) > dayAt(90) ? since.slice(0, 10) : dayAt(90);
  const kept = rows.filter(r => !excluded.has(r.install_key) && r.day >= retainedSince && r.day <= today);
  const distinct = (from: string, until: string) => new Set(kept.filter(r => r.day >= from && r.day < until).map(r => r.install_key));
  const earlier = distinct(dayAt(14), dayAt(7));
  const recent = distinct(dayAt(7), today);
  const returning = [...earlier].filter(k => recent.has(k)).length;
  const daily: OpsDay[] = [];
  for (let at = Date.parse(`${retainedSince}T00:00:00Z`); at <= midnight; at += DAY) {
    const day = new Date(at).toISOString().slice(0, 10), entries = kept.filter(r => r.day === day);
    const reasons = Object.fromEntries((counters ?? []).filter(r => r.day === day && r.metric.startsWith("ops.outcome.")).map(r => [r.metric.slice(12), Number(r.count)]));
    daily.push({ day, contributors: new Set(entries.map(r => r.install_key)).size,
      successfulReceipts: entries.reduce((s, r) => s + Number(r.receipts), 0), records: entries.reduce((s, r) => s + Number(r.records), 0),
      rejected: counters ? Object.entries(reasons).filter(([k]) => !["accepted", "limited", "storage_failure", "internal_failure"].includes(k)).reduce((s, [, n]) => s + n, 0) : null,
      limited: counters ? reasons.limited ?? 0 : null, storageFailures: counters ? (reasons.storage_failure ?? 0) + (reasons.internal_failure ?? 0) : null,
      reasons: counters ? reasons : null, partial: day === today || day === since.slice(0, 10) });
  }
  return { activity: { today: distinct(today, dayAt(-1)).size, past7Days: distinct(dayAt(6), dayAt(-1)).size,
    returning: since <= `${dayAt(14)}T00:00:00.000Z` ? { count: returning, earlier: earlier.size, rate: earlier.size ? returning / earlier.size : null } : null,
    historySince: since }, daily };
}
