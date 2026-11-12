import { after } from "next/server";
import { authQuery } from "@/lib/supabase/server";
import { installKey } from "./metrics";

export const OUTCOME_REASONS = ["accepted", "limited", "body_too_large", "invalid_request", "validation", "storage_failure", "internal_failure"] as const;
export type OutcomeReason = typeof OUTCOME_REASONS[number];
export type IntakeTelemetry = { reason: OutcomeReason; installId?: string; records?: number; rejectedRecords?: number; realms?: string[]; kinds?: string[] };
export function outcomeReason(status: number): OutcomeReason {
  if (status >= 200 && status < 300) return "accepted";
  if (status === 429) return "limited";
  if (status === 413) return "body_too_large";
  if (status === 422) return "validation";
  if (status === 503) return "storage_failure";
  if (status >= 500) return "internal_failure";
  return "invalid_request";
}
export async function writeIntakeTelemetry(event: IntakeTelemetry, deps: { env?: Record<string, string | undefined>; query?: typeof authQuery } = {}): Promise<void> {
  const env = deps.env ?? process.env;
  if (env.EVERLOOT_OPS_METRICS !== "1") return;
  try {
    const key = event.reason === "accepted" && event.installId && env.EVERLOOT_OPS_HMAC_SECRET?.trim()
      ? installKey(event.installId, env.EVERLOOT_OPS_HMAC_SECRET.trim()) : null;
    await (deps.query ?? authQuery)("rpc/record_ops_intake", { method: "POST", body: JSON.stringify({
      p_reason: event.reason, p_install_key: key, p_records: Math.max(0, event.records ?? 0),
      p_rejected_records: Math.max(0, event.rejectedRecords ?? 0),
      p_realms: [...new Set(event.realms ?? [])].filter(r => r.length > 0 && r.length <= 120).slice(0, 16),
      p_kinds: [...new Set(event.kinds ?? [])].filter(k => /^[a-z_]{1,64}$/.test(k)).slice(0, 64),
    }) });
  } catch { /* Best effort; never change ingestion admission or persistence. */ }
}
export function recordIntakeTelemetry(event: IntakeTelemetry): void {
  if (process.env.EVERLOOT_OPS_METRICS !== "1") return;
  const work = () => writeIntakeTelemetry(event);
  try { after(work); } catch { void work(); }
}
