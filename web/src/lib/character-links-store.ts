import { NextResponse } from "next/server";
import { hashKey, KEY_PATTERN, presentedKey } from "./api-keys";
import { signInPath } from "./auth/return-to";
import { characterLinksOn, completionRef, linkCodeHash, linkKey, LINKS_PER_ACCOUNT, linkRealmKey, newLinkCode, type LinkRow } from "./character-links";
import { characterPath, showcaseBuildsOn, showcaseOn } from "./character-showcase";
import { leaderboardsOn } from "./leaderboard-switch";
import { privateSyncOn, SHOW_SWITCH, SYNC_CATEGORIES, type SyncCategory } from "./private-sync";
import { DEFAULT_RULESET, rulesetOf } from "./player-pages";
import { SLUG_PATTERN } from "./saved-builds";
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
  /**
   * Only with EVERLOOT_SHOWCASE=1: whether the character's public page is on, and its address. `label` only with
   * EVERLOOT_SHOWCASE_BUILDS=1 as well: the build label whose shared builds the page lists, or null for none.
   * `sections` only with EVERLOOT_PRIVATE_SYNC=1 as well: each category's section switch (achievements is
   * show_collections). A section shows only while the page is on and that category's sync is on too. `ranked` only
   * with EVERLOOT_LEADERBOARDS=1: the "Rank my gear" switch (ranked_gear).
   */
  page?: { public: boolean; path: string; label?: { id: string; name: string } | null; sections?: Record<SyncCategory, boolean>; ranked?: boolean };
  /**
   * Only with EVERLOOT_PRIVATE_SYNC=1, added by the list route: each category's sync, in page order, and the date of
   * the stored capture. Never the facts themselves.
   */
  sync?: { category: SyncCategory; on: boolean; capturedAt: string | null }[];
}
const OWN_LINK_COLUMNS = "id,name,realm,race,class,faction,level,status,linked_at,last_upload_at";
/** With the showcase on, the list also reads each link's ruleset and page switch; with private sync too, its section switches. */
const showcaseColumns = (sync: boolean, ranked: boolean) =>
  `ruleset,character_visibility(${["page_public", ...(sync ? new Set(Object.values(SHOW_SWITCH)) : []), ...(ranked ? ["ranked_gear"] : [])].join(",")})`;
/** With planned builds on, also the label attached to each link (build_characters.link_id). */
const LABEL_COLUMNS = "build_characters(id,name)";

type Embedded<T> = T | T[] | null | undefined;
const one = <T>(e: Embedded<T>): T | undefined => (Array.isArray(e) ? e[0] : e ?? undefined);

type ListedRow = Omit<OwnLink, "page"> & {
  ruleset?: string;
  // PostgREST embeds the one-to-one visibility row as an object; older versions send a one-row array.
  character_visibility?: Embedded<Record<string, unknown>>;
  // A link has at most one label (a unique index), sent as an object or a one-row array.
  build_characters?: Embedded<{ id?: unknown; name?: unknown }>;
};

/** The account's links, oldest first. Only these columns are read, so nothing else can leave by mistake. */
export async function listLinks(userId: string): Promise<OwnLink[]> {
  const showcase = showcaseOn();
  const labels = showcaseBuildsOn();
  const sync = privateSyncOn();
  const ranked = leaderboardsOn();
  const columns = [OWN_LINK_COLUMNS, ...(showcase ? [showcaseColumns(sync, ranked)] : []), ...(labels ? [LABEL_COLUMNS] : [])].join(",");
  const rows = await authQuery<ListedRow[]>(
    `character_links?select=${columns}&user_id=eq.${encodeURIComponent(userId)}&order=linked_at.asc,id.asc&limit=${LINKS_PER_ACCOUNT}`,
  );
  if (!Array.isArray(rows)) throw new Error("Invalid links response");
  return rows.map((r) => {
    const link: OwnLink = {
      id: r.id, name: r.name, realm: r.realm, race: r.race, class: r.class, faction: r.faction, level: r.level,
      status: r.status === "linked" ? "linked" : "frozen", linked_at: r.linked_at, last_upload_at: r.last_upload_at,
    };
    if (!showcase) return link;
    const visibility = one(r.character_visibility);
    const page: NonNullable<OwnLink["page"]> = {
      public: visibility?.page_public === true, path: characterPath(r.ruleset ?? DEFAULT_RULESET, r.realm, r.name),
    };
    if (sync) page.sections = Object.fromEntries(SYNC_CATEGORIES.map((c) => [c, visibility?.[SHOW_SWITCH[c]] === true])) as Record<SyncCategory, boolean>;
    if (ranked) page.ranked = visibility?.ranked_gear === true;
    if (labels) {
      const label = one(r.build_characters);
      page.label = label && typeof label.id === "string" && typeof label.name === "string" ? { id: label.id, name: label.name } : null;
    }
    return { ...link, page };
  });
}

/** What `public_character` returns for a live, public, unhidden link. No account, key or hash is among it. */
export interface PublicCharacter {
  name: string; realm: string; race: string; class: string; faction: "Alliance" | "Horde"; level: number;
  linkedAt: string; lastUploadAt: string;
}

/**
 * The public read of one character through `public_character`, or null: not linked, frozen, hidden by a hide
 * request, or its page switched off all look the same. Only the identity columns are kept; the section switches it
 * also returns are for later slices.
 */
export async function publicCharacter(ruleset: string, realmSlug: string, name: string): Promise<PublicCharacter | null> {
  const rows = await authQuery<Array<Record<string, unknown>>>("rpc/public_character", {
    method: "POST", body: JSON.stringify({ p_ruleset: ruleset, p_realm_slug: realmSlug, p_name: name }),
  });
  if (!Array.isArray(rows)) throw new Error("Invalid character response");
  const r = rows[0];
  if (!r) return null;
  if (typeof r.name !== "string" || typeof r.realm !== "string" || typeof r.race !== "string" || typeof r.class !== "string"
    || (r.faction !== "Alliance" && r.faction !== "Horde") || typeof r.level !== "number"
    || typeof r.linked_at !== "string" || typeof r.last_upload_at !== "string") {
    throw new Error("Invalid character response");
  }
  return {
    name: r.name, realm: r.realm, race: r.race, class: r.class, faction: r.faction, level: r.level,
    linkedAt: r.linked_at, lastUploadAt: r.last_upload_at,
  };
}

/** A planned build on a public page, as `public_character_builds` returns it: never its codes, notes or owner. */
export interface PlannedBuild { name: string; slug: string; updatedAt: string }

/**
 * The shared builds under the label the character's owner attached, through `public_character_builds`, which asks
 * everything `public_character` asks: a page that is a 404 has none. Rows of any other shape are dropped.
 */
export async function publicCharacterBuilds(ruleset: string, realmSlug: string, name: string): Promise<PlannedBuild[]> {
  const rows = await authQuery<Array<Record<string, unknown>>>("rpc/public_character_builds", {
    method: "POST", body: JSON.stringify({ p_ruleset: ruleset, p_realm_slug: realmSlug, p_name: name }),
  });
  if (!Array.isArray(rows)) throw new Error("Invalid builds response");
  return rows.flatMap((r) => {
    if (typeof r.name !== "string" || typeof r.slug !== "string" || !SLUG_PATTERN.test(r.slug)) return [];
    if (typeof r.updated_at !== "string" || Number.isNaN(Date.parse(r.updated_at))) return [];
    return [{ name: r.name, slug: r.slug, updatedAt: r.updated_at }];
  });
}

export type LabelRefusal = "not_found" | "frozen" | "class_mismatch";

/**
 * Attaches one of the account's build labels to one of its links through `attach_build_label`, or with `labelId` null
 * takes the link's label off. Null when done. Nothing is ever attached without this call: no match by name.
 */
export async function attachBuildLabel(userId: string, linkId: string, labelId: string | null): Promise<LabelRefusal | null> {
  const refusal = await authQuery<string | null>("rpc/attach_build_label", {
    method: "POST", body: JSON.stringify({ p_user_id: userId, p_link_id: linkId, p_label_id: labelId }),
  });
  if (refusal === null || refusal === "not_found" || refusal === "frozen" || refusal === "class_mismatch") return refusal;
  throw new Error("Invalid label response");
}

/** The page address of one of the account's links, or null when the account has no link with that id. */
export async function ownLinkPath(userId: string, id: string): Promise<string | null> {
  const rows = await authQuery<Array<{ ruleset: string; realm: string; name: string }>>(
    `character_links?select=ruleset,realm,name&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  if (!Array.isArray(rows)) throw new Error("Invalid links response");
  return rows[0] ? characterPath(rows[0].ruleset, rows[0].realm, rows[0].name) : null;
}

/**
 * The switches the owner may set. The section switches only with private sync on (the visibility route checks);
 * `ranked_gear` only with the gear boards on; gold, guild and the other rankings wait for their own contracts.
 */
export type VisibilityFlags = {
  page_public?: boolean; indexable?: boolean;
  show_gear?: boolean; show_talents?: boolean; show_professions?: boolean; show_reputations?: boolean; show_raids?: boolean; show_collections?: boolean;
  ranked_gear?: boolean;
};

/** Sets the given switches through `set_visibility`. False when the link is not the account's. */
export async function setVisibility(userId: string, id: string, flags: VisibilityFlags): Promise<boolean> {
  return (await authQuery<boolean>("rpc/set_visibility", {
    method: "POST", body: JSON.stringify({ p_user_id: userId, p_id: id, p_flags: flags }),
  })) === true;
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
