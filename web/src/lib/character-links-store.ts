import { NextResponse } from "next/server";
import { hashKey, KEY_PATTERN, presentedKey } from "./api-keys";
import { signInPath } from "./auth/return-to";
import { characterLinksOn, completionRef, linkCodeHash, linkKey, LINKS_PER_ACCOUNT, linkRealmKey, newLinkCode, type LinkRow } from "./character-links";
import { rulesetOf } from "./player-pages";
import { authQuery, getUser, siteUrl } from "./supabase/server";

// Server side of character links: every write goes through the security definer functions in
// 20261021190000_character_links.sql, which hold the limits and the freeze.

export type CodeRefusal = "daily_limit";

/** A new code for the account, live 15 minutes. A hash already live is drawn again. */
export async function createLinkCode(userId: string): Promise<{ code: string; expiresAt: string } | { refused: CodeRefusal }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newLinkCode();
    const rows = await authQuery<Array<{ code_expires_at: string | null; refusal: string | null }>>("rpc/create_link_code", {
      method: "POST", body: JSON.stringify({ p_user_id: userId, p_code_hash: linkCodeHash(code) }),
    });
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (row?.refusal === "code_taken") continue;
    if (row?.refusal === "daily_limit") return { refused: "daily_limit" };
    if (!row || row.refusal !== null || typeof row.code_expires_at !== "string") throw new Error("Code was not saved");
    return { code, expiresAt: new Date(row.code_expires_at).toISOString() };
  }
  throw new Error("No free code");
}

export type LinkRefusal =
  | "code_unknown" | "code_foreign" | "code_used" | "code_expired" | "census_mismatch" | "suppressed" | "name_linked" | "link_limit";
const LINK_REFUSALS: readonly string[] = [
  "code_unknown", "code_foreign", "code_used", "code_expired", "census_mismatch", "suppressed", "name_linked", "link_limit",
];

/**
 * Redeems the row's code for the account. The GUID goes no further than this function: the database gets keyed
 * hashes only, never the GUID, the install id or the completion key. `censusAgrees` is used only after the database
 * has found the code live and the account's, and a mismatch spends the code.
 */
export async function redeemLink(userId: string, row: LinkRow, secret: string, censusAgrees: boolean): Promise<{ id: string; status: "linked" | "frozen" } | { refused: LinkRefusal }> {
  const realm = row.realm.trim();
  const rows = await authQuery<Array<{ link_ref: string | null; link_status: string | null; refusal: string | null }>>("rpc/redeem_link", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: userId, p_code_hash: linkCodeHash(row.code), p_link_key: linkKey(row.guid, secret), p_ruleset: rulesetOf(linkRealmKey(realm)),
      p_realm: realm, p_name: row.name, p_race: row.race, p_class: row.class, p_faction: row.faction, p_level: row.level,
      p_completion_ref: completionRef(row.installId, row.completionKey, secret), p_census_agrees: censusAgrees,
    }),
  });
  const result = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (result && result.link_ref === null && LINK_REFUSALS.includes(result.refusal ?? "")) return { refused: result.refusal as LinkRefusal };
  if (!result || typeof result.link_ref !== "string" || result.refusal !== null || (result.link_status !== "linked" && result.link_status !== "frozen")) {
    throw new Error("Link was not saved");
  }
  return { id: result.link_ref, status: result.link_status };
}

/** One of the account's own links, as its owner's list shows it. No key, hash, code or other account. */
export interface OwnLink {
  id: string; name: string; realm: string; race: string; class: string; faction: "Alliance" | "Horde"; level: number;
  status: "linked" | "frozen"; linked_at: string; last_upload_at: string;
}
const OWN_LINK_COLUMNS = "id,name,realm,race,class,faction,level,status,linked_at,last_upload_at";

/** The account's links, oldest first. Only these columns are read, so nothing else can leave by mistake. */
export async function listLinks(userId: string): Promise<OwnLink[]> {
  const rows = await authQuery<OwnLink[]>(
    `character_links?select=${OWN_LINK_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&order=linked_at.asc,id.asc&limit=${LINKS_PER_ACCOUNT}`,
  );
  if (!Array.isArray(rows)) throw new Error("Invalid links response");
  return rows.map((r) => ({
    id: r.id, name: r.name, realm: r.realm, race: r.race, class: r.class, faction: r.faction, level: r.level,
    status: r.status === "linked" ? "linked" : "frozen", linked_at: r.linked_at, last_upload_at: r.last_upload_at,
  }));
}

/**
 * Unlinks one of the account's characters through `unlink_character`: the link and its visibility go. False when the
 * account has no link with that id, another account's included. Another account's frozen link of the character stays
 * frozen.
 */
export async function unlinkCharacter(userId: string, id: string): Promise<boolean> {
  return (await authQuery<boolean>("rpc/unlink_character", { method: "POST", body: JSON.stringify({ p_user_id: userId, p_id: id }) })) === true;
}

/** The account behind a key with link:own, or why not. */
export async function linkAccountForKey(token: string): Promise<{ ok: true; userId: string } | { ok: false; refusal: "unknown_key" | "no_scope" }> {
  if (!KEY_PATTERN.test(token)) return { ok: false, refusal: "unknown_key" };
  const rows = await authQuery<Array<{ account: string | null; refusal: string | null }>>("rpc/link_account_for_key", {
    method: "POST", body: JSON.stringify({ p_token_hash: hashKey(token) }),
  });
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (row?.refusal === "unknown_key" || row?.refusal === "no_scope") return { ok: false, refusal: row.refusal };
  if (!row || row.refusal !== null || typeof row.account !== "string") throw new Error("Invalid key response");
  return { ok: true, userId: row.account };
}

// The routes under /api/me/characters. Same-origin JSON for the signed-in player; nothing is cached.

export const NO_STORE = { "Cache-Control": "private, no-store" };
export const fail = (status: number, error: string, extra: Record<string, string> = {}) =>
  NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...extra } });
export const unavailable = () => fail(503, "Character links are unavailable right now. Try again in a minute.");

/**
 * 404 with the switch off. A session write must come from this site (a missing Origin too: 403); signed out is 401
 * with where to sign in. With `keys`, a request carrying an API key is answered for the key's account instead: 401
 * for a key that is not live, 403 for one without link:own. Otherwise the account id.
 */
export async function linkAccount(req: Request, keys: boolean): Promise<string | Response> {
  if (!characterLinksOn()) return fail(404, "Not found");
  const token = keys ? presentedKey(req) : null;
  if (token) {
    const owner = await linkAccountForKey(token);
    if (owner.ok) return owner.userId;
    if (owner.refusal === "no_scope") return fail(403, "This key can't link characters. Reconnect the app to allow it.");
    return fail(401, "This API key is not valid or was revoked.", { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  }
  if (req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to link a character.", signIn: signInPath("/account") }, { status: 401, headers: NO_STORE });
  return user.id;
}

/**
 * For reads: 404 with the switch off, 401 signed out, otherwise the account id. The session only: an API key is
 * never read here, so a key cannot list an account's links. A read changes nothing, so no Origin is needed.
 */
export async function linkSession(): Promise<string | Response> {
  if (!characterLinksOn()) return fail(404, "Not found");
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your linked characters.", signIn: signInPath("/account") }, { status: 401, headers: NO_STORE });
  return user.id;
}
