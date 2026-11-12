import { characterSecret } from "@/lib/census-intake";
import { characterLinksOn, completionRef } from "@/lib/character-links";
import { publicCharacter } from "@/lib/character-links-store";
import { characterPath, showcaseOn } from "@/lib/character-showcase";
import { authQuery } from "@/lib/supabase/server";
import { installKey } from "./metrics";

type Env = Record<string, string | undefined>;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type AttributionInput = { consent: true; uploadIds: string[]; installId: string; completionKeys: string[]; linkId: string };
export function validAttribution(value: unknown): value is AttributionInput {
  const v = value as Partial<AttributionInput> | null;
  return !!v && v.consent === true && typeof v.linkId === "string" && UUID.test(v.linkId)
    && typeof v.installId === "string" && v.installId.length > 0 && v.installId.length <= 128
    && Array.isArray(v.uploadIds) && v.uploadIds.length > 0 && v.uploadIds.length <= 100
    && v.uploadIds.every(id => typeof id === "string" && UUID.test(id)) && new Set(v.uploadIds).size === v.uploadIds.length
    && Array.isArray(v.completionKeys) && v.completionKeys.length > 0 && v.completionKeys.length <= 50
    && v.completionKeys.every(key => typeof key === "string" && /^[a-f0-9]{8}$/.test(key));
}
export function attributionOn(env: Env = process.env): boolean { return characterLinksOn(env) && showcaseOn(env); }

/** Explicit receipt association only. Repeated in the atomic SQL function to close read/write races. */
export async function attributeUploads(userId: string, value: unknown, env: Env = process.env): Promise<{ ok: boolean }> {
  if (!validAttribution(value) || !attributionOn(env)) return { ok: false };
  const secret = characterSecret(env), opsSecret = env.EVERLOOT_OPS_HMAC_SECRET?.trim();
  if (!secret || !opsSecret) throw new Error("Contribution attribution unavailable");
  const refs = value.completionKeys.map(key => completionRef(value.installId, key, secret));
  const links = await authQuery<Array<{ id: string; user_id: string; status: string; completion_ref: string; ruleset: string; realm: string; name: string }>>(
    `character_links?select=id,user_id,status,completion_ref,ruleset,realm,name&id=eq.${value.linkId}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  const link = links[0];
  if (!link || link.user_id !== userId || link.status !== "linked" || !refs.includes(link.completion_ref)) return { ok: false };
  if (!await publicCharacter(link.ruleset, link.realm, link.name)) return { ok: false };
  const uploads = await authQuery<Array<{ id: string; install_id: string }>>(
    `uploads?select=id,install_id&id=in.(${value.uploadIds.join(",")})&install_id=eq.${encodeURIComponent(value.installId)}&limit=100`,
  );
  if (uploads.length !== value.uploadIds.length || uploads.some(row => row.install_id !== value.installId || !value.uploadIds.includes(row.id))) return { ok: false };
  const saved = await authQuery<boolean>("rpc/attribute_ops_uploads", { method: "POST", body: JSON.stringify({
    p_user_id: userId, p_link_id: value.linkId, p_upload_ids: value.uploadIds, p_install_id: value.installId,
    p_install_key: installKey(value.installId, opsSecret), p_completion_refs: refs,
  }) });
  return { ok: saved === true };
}

export type ContributorIdentity = { identity: { name: string; realm: string; class: string; level: number; path: string; provenance: "contributor-opt-in"; attributedAt: string } | null;
  attribution: "anonymous" | "opted-in" | "unavailable" };

/** Read the current public/suppression/link state each time. Never derive names from the snapshot or observations. */
export async function contributorIdentity(id: string, env: Env = process.env): Promise<ContributorIdentity> {
  if (!/^[a-f0-9]{64}$/.test(id)) return { identity: null, attribution: "anonymous" };
  if (!attributionOn(env)) return { identity: null, attribution: "unavailable" };
  try {
    const rows = await authQuery<Array<{ name: string; realm: string; class: string; level: number; ruleset: string; opted_at: string }>>(
      "rpc/ops_contributor_identity", { method: "POST", body: JSON.stringify({ p_install_key: id }) },
    );
    const row = rows[0];
    if (!row) return { identity: null, attribution: "anonymous" };
    return { attribution: "opted-in", identity: { name: row.name, realm: row.realm, class: row.class, level: row.level,
      path: characterPath(row.ruleset, row.realm, row.name), provenance: "contributor-opt-in", attributedAt: row.opted_at } };
  } catch { return { identity: null, attribution: "unavailable" }; }
}

export async function revokeAttribution(userId: string): Promise<void> {
  await authQuery("rpc/revoke_ops_attribution", { method: "POST", body: JSON.stringify({ p_user_id: userId }) });
}
