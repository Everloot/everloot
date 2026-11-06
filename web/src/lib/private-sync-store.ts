import { hashKey, KEY_PATTERN, presentedKey } from "./api-keys";
import { fail } from "./character-links-store";
import { isSyncCategory, privateSyncOn, SHOW_SWITCH, sourceRef, SYNC_CATEGORIES, type Fact, type SyncCategory } from "./private-sync";
import { authQuery } from "./supabase/server";

// Server side of private sync: every read and write goes through the security definer functions in
// 20261106120000_private_sync.sql, which find the link among the account's own and hold the newest-wins rule.

/** The account behind a key with sync:own, or why not. */
export async function syncAccountForKey(token: string): Promise<{ ok: true; userId: string } | { ok: false; refusal: "unknown_key" | "no_scope" }> {
  if (!KEY_PATTERN.test(token)) return { ok: false, refusal: "unknown_key" };
  const rows = await authQuery<Array<{ account: string | null; refusal: string | null }>>("rpc/sync_account_for_key", {
    method: "POST", body: JSON.stringify({ p_token_hash: hashKey(token) }),
  });
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (row?.refusal === "unknown_key" || row?.refusal === "no_scope") return { ok: false, refusal: row.refusal };
  if (!row || row.refusal !== null || typeof row.account !== "string") throw new Error("Invalid key response");
  return { ok: true, userId: row.account };
}

/**
 * For the sync route: 404 with the switch off; a sync:own key only, never a session (consent and switches are the
 * session's, sending facts is the key's). No key or a dead one is 401, a key without sync:own 403. Otherwise the
 * key's account id.
 */
export async function syncAccount(req: Request): Promise<string | Response> {
  if (!privateSyncOn()) return fail(404, "Not found");
  const token = presentedKey(req);
  const challenge = { "WWW-Authenticate": 'Bearer error="invalid_token"' };
  if (!token) return fail(401, "Send an API key with the sync:own permission.", { "WWW-Authenticate": "Bearer" });
  const owner = await syncAccountForKey(token);
  if (owner.ok) return owner.userId;
  if (owner.refusal === "no_scope") return fail(403, "This key can't sync characters. Make a key with \"Sync my linked characters\".");
  return fail(401, "This API key is not valid or was revoked.", challenge);
}

export type FactOutcome = "stored" | "duplicate" | "older" | "no_consent";
export type CharacterOutcome = { result: "not_linked" | "mismatch" } | { result: "synced"; categories: Partial<Record<SyncCategory, FactOutcome>> };
const FACT_OUTCOMES: readonly string[] = ["stored", "duplicate", "older", "no_consent"];

/**
 * Sends one character's facts for the account. The facts of one install go in one call, with that install's keyed
 * hash; the install id goes no further than this function. The database finds the character among the account's own
 * live links only, so another account's character answers exactly as one nobody linked: not_linked.
 */
export async function syncCharacterFacts(
  userId: string, ruleset: string, realm: string, name: string, cls: string | null, facts: readonly Fact[], secret: string,
): Promise<CharacterOutcome> {
  const categories: Partial<Record<SyncCategory, FactOutcome>> = {};
  const installs = [...new Set(facts.map((f) => f.installId))];
  // A character with nothing to store still asks once, so the receipt can say whether it is linked.
  for (const installId of installs.length ? installs : [null]) {
    const mine = facts.filter((f) => f.installId === installId);
    const rows = await authQuery<Array<{ category: string | null; outcome: string }>>("rpc/sync_character_facts", {
      method: "POST",
      body: JSON.stringify({
        p_user_id: userId, p_ruleset: ruleset, p_realm: realm, p_name: name, p_class: cls,
        // No install: nothing is written, so any well-formed hash does.
        p_source_ref: installId === null ? "0".repeat(64) : sourceRef(installId, secret),
        p_facts: mine.map((f) => ({ category: f.category, captured_at: f.capturedAt, data: f.data })),
      }),
    });
    if (!Array.isArray(rows)) throw new Error("Invalid sync response");
    const whole = rows.length === 1 && rows[0]!.category === null ? rows[0]!.outcome : null;
    if (whole === "not_linked" || whole === "mismatch") return { result: whole };
    for (const r of rows) {
      if (!isSyncCategory(r.category) || !FACT_OUTCOMES.includes(r.outcome)) throw new Error("Invalid sync response");
      categories[r.category] = r.outcome as FactOutcome;
    }
  }
  return { result: "synced", categories };
}

export type ConsentRefusal = "not_found" | "frozen";

/** Turns one category's sync on or off for one of the account's links; off deletes its stored facts. Null when done. */
export async function setSyncConsent(userId: string, linkId: string, category: SyncCategory, granted: boolean): Promise<ConsentRefusal | null> {
  const refusal = await authQuery<string | null>("rpc/set_sync_consent", {
    method: "POST", body: JSON.stringify({ p_user_id: userId, p_link_id: linkId, p_category: category, p_granted: granted }),
  });
  if (refusal === null || refusal === "not_found" || refusal === "frozen") return refusal;
  throw new Error("Invalid consent response");
}

/** One stored category as a read returns it. */
export interface StoredFact { category: SyncCategory; capturedAt: string; data: Record<string, unknown> }
/** The owner's view of one category: whether sync is on, and the stored capture when there is one. */
export interface OwnCategory { category: SyncCategory; consented: boolean; fact: StoredFact | null }

function storedFact(r: { category?: unknown; captured_at?: unknown; data?: unknown }): StoredFact | null {
  if (!isSyncCategory(r.category) || typeof r.captured_at !== "string" || Number.isNaN(Date.parse(r.captured_at))) return null;
  if (!r.data || typeof r.data !== "object" || Array.isArray(r.data)) return null;
  return { category: r.category, capturedAt: new Date(r.captured_at).toISOString(), data: r.data as Record<string, unknown> };
}

/**
 * The owner's own read of one link: every category with its consent and stored capture. Empty when the link is not
 * the account's. A frozen link's categories come back without facts (accepted D2).
 */
export async function ownCharacterFacts(userId: string, linkId: string): Promise<OwnCategory[]> {
  const rows = await authQuery<Array<{ category?: unknown; consented?: unknown; captured_at?: unknown; data?: unknown }>>("rpc/own_character_facts", {
    method: "POST", body: JSON.stringify({ p_user_id: userId, p_link_id: linkId }),
  });
  if (!Array.isArray(rows)) throw new Error("Invalid facts response");
  return rows.flatMap((r) => (isSyncCategory(r.category) ? [{ category: r.category, consented: r.consented === true, fact: storedFact(r) }] : []));
}

/** The switched-on, consented facts of a public character page; none when the page is a 404. */
export async function publicCharacterFacts(ruleset: string, realmSlug: string, name: string): Promise<StoredFact[]> {
  const rows = await authQuery<Array<{ category?: unknown; captured_at?: unknown; data?: unknown }>>("rpc/public_character_facts", {
    method: "POST", body: JSON.stringify({ p_ruleset: ruleset, p_realm_slug: realmSlug, p_name: name }),
  });
  if (!Array.isArray(rows)) throw new Error("Invalid facts response");
  return rows.flatMap((r) => { const f = storedFact(r); return f ? [f] : []; });
}

/**
 * One of the account's links as its owner's sync settings and preview read it: the identity, its status, the page
 * switch and each category's section switch. Never its keyed hashes.
 */
export interface OwnSyncedLink {
  ruleset: string; name: string; realm: string; race: string; class: string; faction: "Alliance" | "Horde"; level: number;
  lastUploadAt: string; status: "linked" | "frozen"; pagePublic: boolean; shown: Record<SyncCategory, boolean>;
}
const OWN_COLUMNS = "id,ruleset,name,realm,race,class,faction,level,status,last_upload_at";

/** One of the account's links, or null when the account has no link with that id. Only these columns are read. */
export async function ownSyncedLink(userId: string, linkId: string): Promise<OwnSyncedLink | null> {
  const switches = ["page_public", ...new Set(Object.values(SHOW_SWITCH))].join(",");
  const rows = await authQuery<Array<Record<string, unknown>>>(
    `character_links?select=${OWN_COLUMNS},character_visibility(${switches})&id=eq.${encodeURIComponent(linkId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  if (!Array.isArray(rows)) throw new Error("Invalid links response");
  const r = rows[0];
  if (!r) return null;
  if (typeof r.ruleset !== "string" || typeof r.name !== "string" || typeof r.realm !== "string" || typeof r.race !== "string"
    || typeof r.class !== "string" || (r.faction !== "Alliance" && r.faction !== "Horde") || typeof r.level !== "number"
    || typeof r.last_upload_at !== "string") {
    throw new Error("Invalid links response");
  }
  // PostgREST embeds the one-to-one visibility row as an object; older versions send a one-row array.
  const v = (Array.isArray(r.character_visibility) ? r.character_visibility[0] : r.character_visibility) as Record<string, unknown> | undefined;
  return {
    ruleset: r.ruleset, name: r.name, realm: r.realm, race: r.race, class: r.class, faction: r.faction, level: r.level,
    lastUploadAt: r.last_upload_at, status: r.status === "linked" ? "linked" : "frozen", pagePublic: v?.page_public === true,
    shown: Object.fromEntries(SYNC_CATEGORIES.map((c) => [c, v?.[SHOW_SWITCH[c]] === true])) as Record<SyncCategory, boolean>,
  };
}

export const unavailable = () => fail(503, "Character sync is unavailable right now. Try again in a minute.");
