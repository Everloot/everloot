import { r2Client, r2Config } from "@/lib/upload-store";
import type { OpsContributorHints, OpsSummary } from "./types";
import { exclusions } from "./metrics";

export const OPS_KEY = "private/ops/summary-v1.json";
export const OPS_FRESH_MS = 90 * 60 * 1000;
export const OPS_HINTS_KEY = "ops/contributor-hints.json";

/** Optional one-off historical observation map. It has no receipt dates, counts, account or character names. */
export async function readOpsContributorHints(): Promise<OpsContributorHints | null> {
  const cloud = r2Config();
  if (!cloud) return null;
  try {
    const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${OPS_HINTS_KEY}`;
    const response = await fetch(await r2Client(cloud).sign(url, { method: "GET" }), { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 1_048_576) return null;
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_048_576) { await reader.cancel(); return null; }
      chunks.push(chunk.value);
    }
    const hints = JSON.parse(Buffer.concat(chunks).toString("utf8")) as OpsContributorHints;
    if (hints.version !== 1 || !Number.isFinite(Date.parse(hints.generatedAt)) || !Array.isArray(hints.contributors) || hints.contributors.length > 1000) return null;
    const strings = (values: unknown, max: number) => Array.isArray(values) && values.length <= 64 && values.every(v => typeof v === "string" && v.length > 0 && v.length <= max);
    if (hints.contributors.some(c => !c || !/^[a-f0-9]{64}$/.test(c.id) || !strings(c.realms, 120) || !strings(c.kinds, 64))) return null;
    // Select fields explicitly so an unexpected private property can never join a snapshot.
    return { version: 1, generatedAt: hints.generatedAt, contributors: hints.contributors.map(c => ({ id: c.id, realms: c.realms, kinds: c.kinds })) };
  } catch { return null; }
}

export function markOpsFreshness(summary: OpsSummary, now = Date.now()): OpsSummary {
  return { ...summary, sources: Object.fromEntries(Object.entries(summary.sources).map(([name, source]) => [name,
    (source.status === "fresh" || source.status === "partial") && (!source.asOf || now - Date.parse(source.asOf) > OPS_FRESH_MS)
      ? { ...source, status: "stale" as const, detail: source.status === "partial" ? `${source.detail}; coverage remains partial` : source.detail } : source])) };
}
/** One private object read; never fall back to rebuilding the corpus during a page request. */
export async function readOpsSummary(): Promise<OpsSummary | null> {
  const cloud = r2Config();
  if (!cloud) return null;
  const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${OPS_KEY}`;
  try {
    const response = await fetch(await r2Client(cloud).sign(url, { method: "GET" }), { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const summary = await response.json() as OpsSummary;
    if (summary.version !== 1 || !summary.generatedAt || !summary.sources || !Array.isArray(summary.contributors)) return null;
    if (Date.now() - Date.parse(summary.generatedAt) > 90 * 86_400_000) return null;
    const current = exclusions();
    if (current.version !== summary.exclusionVersion) return { ...summary, exclusionVersion: current.version, excludedInstalls: current.keys.size,
      activity: { today: null, past7Days: null, returning: null, historySince: null }, daily: [], contributors: [], historical: null,
      sources: { ...summary.sources, receipts: { status: "unavailable", asOf: null, detail: "Exclusions changed; bounded history recomputation pending" },
        historical: { status: "unavailable", asOf: null, detail: "Exclusions changed; bounded history recomputation pending" } } };
    return markOpsFreshness(summary);
  } catch { return null; }
}
export async function writeOpsSummary(summary: OpsSummary): Promise<void> {
  const cloud = r2Config();
  if (!cloud) throw new Error("Operations snapshot storage unavailable");
  const url = `https://${cloud.r2AccountId}.r2.cloudflarestorage.com/${cloud.r2Bucket}/${OPS_KEY}`;
  const response = await fetch(await r2Client(cloud).sign(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(summary) }),
    { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Operations snapshot write failed");
}
