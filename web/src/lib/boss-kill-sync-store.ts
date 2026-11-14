import { bossKillCapture, bossKillSyncOn, type BossKillRow } from "./boss-kill-sync";
import { sourceRef } from "./private-sync";
import { authQuery } from "./supabase/server";

export type BossKillOutcome = "stored" | "duplicate" | "older" | "no_consent" | "not_linked";
export async function syncBossKills(userId: string, ruleset: string, realm: string, name: string, rows: readonly BossKillRow[], secret: string, now: Date): Promise<BossKillOutcome> {
  if (!bossKillSyncOn()) return "no_consent";
  const capture = bossKillCapture(rows, now);
  if (!capture) throw new Error("Invalid boss-kill capture");
  const result = await authQuery<string>("rpc/sync_boss_kills", { method: "POST", body: JSON.stringify({
    p_user_id: userId, p_ruleset: ruleset, p_realm: realm, p_name: name,
    p_source_ref: sourceRef(capture.installId, secret), p_captured_at: capture.capturedAt, p_kills: capture.kills,
  }) });
  if (["stored", "duplicate", "older", "no_consent", "not_linked"].includes(result)) return result as BossKillOutcome;
  throw new Error("Invalid boss-kill receipt");
}

export async function ownBossKills(userId: string, linkId: string): Promise<unknown> {
  if (!bossKillSyncOn()) return null;
  return authQuery("rpc/own_boss_kills", { method: "POST", body: JSON.stringify({ p_user_id: userId, p_link_id: linkId }) });
}
export async function setBossKillConsent(userId: string, linkId: string, granted: boolean): Promise<string | null> {
  if (!bossKillSyncOn()) return "unavailable";
  const result = await authQuery<string | null>("rpc/set_boss_kill_consent", { method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_link_id: linkId, p_granted: granted }) });
  if (result === null || result === "not_found" || result === "frozen") return result;
  throw new Error("Invalid boss-kill consent response");
}
