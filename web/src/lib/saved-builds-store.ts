import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { hashKey, KEY_PATTERN } from "./api-keys";
import { signInPath } from "./auth/return-to";
import {
  ACCOUNT_MISMATCH, BUILD_COLUMNS, CHARACTER_COLUMNS, EXPECTED_OWNER_HEADER, ORDER_COLUMNS, savedBuildsOn, SLUG_PATTERN, toBuild, toCharacters,
  type AccountBuilds, type BuildCharacter, type BuildInput, type BuildRow, type CharacterInput, type CharacterRow, type SavedBuild,
} from "./saved-builds";
import { authQuery, getUser, siteUrl, type AccountUser } from "./supabase/server";

// Server side of saved builds: reads with the service role, writes through the security definer functions
// in 20261021150000_saved_builds.sql, which hold the limits. A build and its spend orders are saved together by
// save_build_plan (20261027120000_saved_build_point_order.sql), in one transaction.

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Eight random base62 characters. Bytes of 248 and up are skipped, so every character is equally likely. */
export function newSlug(): string {
  let slug = "";
  while (slug.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte < 248 && slug.length < 8) slug += BASE62[byte % 62];
    }
  }
  return slug;
}

export async function listOwn(userId: string): Promise<AccountBuilds> {
  const user = encodeURIComponent(userId);
  const [characters, builds] = await Promise.all([
    authQuery<CharacterRow[]>(`build_characters?select=${CHARACTER_COLUMNS}&user_id=eq.${user}`),
    authQuery<BuildRow[]>(`saved_builds?select=${BUILD_COLUMNS},${ORDER_COLUMNS}&user_id=eq.${user}&order=updated_at.desc,id.asc`),
  ]);
  const site = siteUrl();
  return { characters: toCharacters(characters), builds: builds.map((b) => toBuild(b, site)) };
}

export type BuildRefusal = "not_found" | "class_mismatch" | "build_limit" | "daily_limit";

/**
 * Creates (no id) or updates one of the user's builds, with its spend orders, in one call: when it fails nothing of
 * it was saved, and no second request is left to make. A taken slug is retried with a new one.
 */
export async function saveBuild(userId: string, input: BuildInput): Promise<{ build: SavedBuild; created: boolean } | { refused: BuildRefusal }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // The payload is the input as parsed, with the server's slug for a new build. An order left out stays left out.
    const row = await authQuery<{ build_ref: string | null; build_slug: string | null; refusal: string | null } | null>("rpc/save_build_plan", {
      method: "POST",
      body: JSON.stringify({ p_user_id: userId, p_payload: { ...input, slug: input.id ? null : newSlug() } }),
    });
    if (row?.refusal === "slug_taken") continue;
    if (row && row.build_ref === null && ["not_found", "class_mismatch", "build_limit", "daily_limit"].includes(row.refusal ?? "")) {
      return { refused: row.refusal as BuildRefusal };
    }
    if (!row || typeof row.build_ref !== "string" || row.refusal !== null) throw new Error("Build was not saved");
    const saved = await authQuery<BuildRow[]>(
      `saved_builds?select=${BUILD_COLUMNS},${ORDER_COLUMNS}&id=eq.${encodeURIComponent(row.build_ref)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    );
    if (!saved[0]) throw new Error("Build was not saved");
    return { build: toBuild(saved[0], siteUrl()), created: !input.id };
  }
  throw new Error("No free short link");
}

export async function deleteBuild(userId: string, id: string): Promise<boolean> {
  return (await authQuery<boolean>("rpc/delete_build", { method: "POST", body: JSON.stringify({ p_user_id: userId, p_id: id }) })) === true;
}

export type CharacterRefusal = "not_found" | "has_builds" | "character_limit" | "daily_limit";

export async function saveCharacter(userId: string, input: CharacterInput): Promise<{ character: BuildCharacter; created: boolean } | { refused: CharacterRefusal }> {
  const rows = await authQuery<Array<{ character_ref: string | null; refusal: string | null }>>("rpc/save_build_character", {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_id: input.id, p_name: input.name, p_class_slug: input.classSlug, p_realm: input.realm, p_note: input.note }),
  });
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (row && row.character_ref === null && ["not_found", "has_builds", "character_limit", "daily_limit"].includes(row.refusal ?? "")) {
    return { refused: row.refusal as CharacterRefusal };
  }
  if (!row || typeof row.character_ref !== "string" || row.refusal !== null) throw new Error("Character was not saved");
  return { character: { id: row.character_ref, name: input.name, classSlug: input.classSlug, realm: input.realm, note: input.note }, created: !input.id };
}

export async function deleteCharacter(userId: string, id: string): Promise<boolean> {
  return (await authQuery<boolean>("rpc/delete_build_character", { method: "POST", body: JSON.stringify({ p_user_id: userId, p_id: id }) })) === true;
}

/** A shared build behind /b/<slug>, or null when the slug is unknown, unshared or deleted. */
export interface SharedBuild {
  slug: string; name: string; notes: string | null; classSlug: string; code: string; code2: string | null; gameBuild: string;
  characterName: string | null; characterClass: string | null; ownerName: string | null; updatedAt: string;
  /** Each set's spend order token, null when unknown. */
  order: string | null; order2: string | null;
}

export async function sharedBuild(slug: string): Promise<SharedBuild | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const rows = await authQuery<Array<{
    name: string; notes: string | null; class_slug: string; code: string; code2: string | null; game_build: string;
    character_name: string | null; character_class: string | null; owner_name: string | null; updated_at: string;
  }>>("rpc/shared_build", { method: "POST", body: JSON.stringify({ p_slug: slug }) });
  const r = rows[0];
  if (!r) return null;
  // shared_build decides what is public. The orders are read beside it, for this build only while it is still shared,
  // and kept only with the codes shared_build gave: a build saved again in between opens without them.
  const [o] = await authQuery<Array<{ code: string; code2: string | null; point_order: string | null; point_order2: string | null }>>(
    `saved_builds?select=code,code2,${ORDER_COLUMNS}&slug=eq.${slug}&shared=is.true&limit=1`,
  );
  const same = o !== undefined && o.code === r.code && o.code2 === r.code2;
  return {
    slug, name: r.name, notes: r.notes, classSlug: r.class_slug, code: r.code, code2: r.code2, gameBuild: r.game_build,
    characterName: r.character_name, characterClass: r.character_class, ownerName: r.owner_name, updatedAt: r.updated_at,
    order: same ? o.point_order ?? null : null, order2: same ? o.point_order2 ?? null : null,
  };
}

export type KeyRead = { ok: true; value: AccountBuilds } | { ok: false; refusal: "unknown_key" | "no_scope" | "limited"; retryAfter: number };

/**
 * The key owner's builds, when the key is live and has read:own. Counts against the account's hourly allowance,
 * unless `count` is false: a request the data guard already counted (the MCP mount) is one request, not two.
 */
export async function ownBuildsForKey(token: string, count = true): Promise<KeyRead> {
  if (!KEY_PATTERN.test(token)) return { ok: false, refusal: "unknown_key", retryAfter: 0 };
  const rows = await authQuery<Array<{ refusal: string | null; retry_after: number; characters: CharacterRow[] | null; builds: BuildRow[] | null }>>(
    "rpc/own_builds_for_key", { method: "POST", body: JSON.stringify({ p_token_hash: hashKey(token), p_count: count }) },
  );
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row) throw new Error("Invalid key response");
  if (row.refusal === "unknown_key" || row.refusal === "no_scope" || row.refusal === "limited") {
    const retryAfter = Number.isInteger(row.retry_after) ? Math.min(Math.max(row.retry_after, 0), 3600) : 0;
    return { ok: false, refusal: row.refusal, retryAfter };
  }
  if (row.refusal !== null || !Array.isArray(row.characters) || !Array.isArray(row.builds)) throw new Error("Invalid key response");
  const site = siteUrl();
  return { ok: true, value: { characters: toCharacters(row.characters), builds: row.builds.map((b) => toBuild(b, site)) } };
}

/** Whether a live key has read:own, without counting a request. Decides if MCP lists my_builds for the key. */
export async function keyReadsOwn(token: string): Promise<boolean> {
  if (!KEY_PATTERN.test(token)) return false;
  const rows = await authQuery<Array<{ scopes: string[]; expires_at: string | null }>>(
    `api_keys?select=scopes,expires_at&token_hash=eq.${hashKey(token)}&revoked_at=is.null&limit=1`,
  );
  const key = rows[0];
  return !!key && key.scopes.includes("read:own") && (key.expires_at === null || Date.parse(key.expires_at) > Date.now());
}

export const limitedText = (retryAfter: number) => `This account's keys have used their requests for this hour. Try again in ${retryAfter} seconds.`;

// The routes under /api/me. Same-origin JSON for the signed-in player; nothing is cached.

export const NO_STORE = { "Cache-Control": "private, no-store" };
export const fail = (status: number, error: string, extra: Record<string, string> = {}) =>
  NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...extra } });
export const unavailable = () => fail(503, "Saved builds are unavailable right now. Try again in a minute.");

/**
 * 404 with the switch off, 403 for a write not from this site (a missing Origin too), 401 with where to sign in, 409
 * when the request names another account than the session's (EXPECTED_OWNER_HEADER), else the user.
 */
export async function meAccount(req: Request, write: boolean): Promise<AccountUser | Response> {
  if (!savedBuildsOn()) return fail(404, "Not found");
  if (write && req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to save builds.", signIn: signInPath("/me") }, { status: 401, headers: NO_STORE });
  // Before anything is read or written: a page that names the account it shows never writes into another one.
  const expected = req.headers.get(EXPECTED_OWNER_HEADER);
  if (expected !== null && expected !== user.id) {
    return NextResponse.json({ error: "This was meant for another account than the one signed in now. Nothing was saved.", code: ACCOUNT_MISMATCH },
      { status: 409, headers: NO_STORE });
  }
  return user;
}
