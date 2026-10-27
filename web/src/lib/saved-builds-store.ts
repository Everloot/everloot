import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { hashKey, KEY_PATTERN } from "./api-keys";
import { signInPath } from "./auth/return-to";
import {
  ACCOUNT_MISMATCH, BUILD_COLUMNS, CHARACTER_COLUMNS, EXPECTED_OWNER_HEADER, ORDER_COLUMNS, savedBuildsOn, SLUG_PATTERN, toBuild, toCharacters, validId,
  type AccountBuilds, type BuildCharacter, type BuildInput, type BuildRow, type CharacterInput, type CharacterRow, type SavedBuild,
} from "./saved-builds";
import { authQuery, getUser, siteUrl, type AccountUser, type StorageError } from "./supabase/server";

// Server side of saved builds: reads with the service role, writes through the security definer functions
// in 20261021150000_saved_builds.sql, which hold the limits. A build and its spend orders are saved together by
// save_build_plan (20261027120000_saved_build_point_order.sql), in one transaction.
//
// This code can run before that migration is applied, or after its rollback, which drops save_build_plan and keeps the
// columns. Without the order columns, builds are read without orders. Without save_build_plan, a save that names no
// order goes through save_build, and one that names an order, an unknown one too, is refused before anything is
// written. Only PostgREST's exact answer counts as missing (ABSENT below), and it means nothing ran. Anything else, a
// similar name, a 5xx or a timeout included, is a failure: never retried another way, and never remembered.

/** How long this process goes on without a part of the migration it found missing before it asks again. */
export const ORDERS_RECHECK_MS = 60_000;
const missingUntil = { columns: 0, plan: 0 };
const missing = (part: keyof typeof missingUntil) => Date.now() < missingUntil[part];

/**
 * PostgREST's answers that a part of the migration is not there, word for word as PostgREST 12.2, 13.0, and Supabase's
 * 14.4, 14.8 and 16.4 give them: the HTTP status, the error code, and the whole message, naming exactly that column, or
 * that function with the parameters the site calls it with, in either order.
 */
const ABSENT: Record<keyof typeof missingUntil, { status: number; code: string; message: RegExp }[]> = {
  columns: [{ status: 400, code: "42703", message: /^column saved_builds\.point_order2? does not exist$/ }],
  plan: [
    // Not in PostgREST's schema cache.
    { status: 404, code: "PGRST202",
      message: /^Could not find the function public\.save_build_plan\((p_payload, p_user_id|p_user_id, p_payload)\) in the schema cache$/ },
    // In a stale schema cache, but not in PostgreSQL.
    { status: 404, code: "42883",
      message: /^function public\.save_build_plan\((p_user_id => uuid, p_payload => jsonb|p_payload => jsonb, p_user_id => uuid)\) does not exist$/ },
  ],
};

/** Whether `err` is PostgREST saying that part of the migration is not there. If so, this process goes on without it
 *  for ORDERS_RECHECK_MS. The answer is read from the status, code and message a StorageError carries. */
function foundMissing(err: unknown, part: keyof typeof missingUntil): boolean {
  const { status, code, reason } = (err ?? {}) as Partial<StorageError>;
  const said = ABSENT[part].some((a) => status === a.status && code === a.code && typeof reason === "string" && a.message.test(reason));
  if (said) missingUntil[part] = Date.now() + ORDERS_RECHECK_MS;
  return said;
}

/** A read of builds, with the order columns while the database has them. Without them the rows have no orders at all,
 *  so toBuild leaves them out rather than calling them unknown. `query` makes the path for a list of columns. */
async function readBuilds(query: (columns: string) => string): Promise<BuildRow[]> {
  if (!missing("columns")) {
    try {
      return await authQuery<BuildRow[]>(query(`${BUILD_COLUMNS},${ORDER_COLUMNS}`));
    } catch (err) {
      if (!foundMissing(err, "columns")) throw err;
    }
  }
  return authQuery<BuildRow[]>(query(BUILD_COLUMNS));
}

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
    readBuilds((columns) => `saved_builds?select=${columns}&user_id=eq.${user}&order=updated_at.desc,id.asc`),
  ]);
  const site = siteUrl();
  return { characters: toCharacters(characters), builds: builds.map((b) => toBuild(b, site)) };
}

/** orders_unavailable: the save names a spend order (null included) or a transfer key, and the database cannot keep them yet. */
export type BuildRefusal = "not_found" | "class_mismatch" | "build_limit" | "daily_limit" | "orders_unavailable";
const REFUSALS: string[] = ["not_found", "class_mismatch", "build_limit", "daily_limit", "orders_unavailable"];

/** A write's answer. `replayed`: a new build's transfer key the account had used, so this is the build it made then. */
type Written = { build_ref: string | null; build_slug: string | null; refusal: string | null; replayed?: boolean } | null;

/** One write: save_build_plan, or save_build while the database has no save_build_plan and the save names no order. */
async function writeBuild(userId: string, input: BuildInput, slug: string | null): Promise<Written> {
  if (!missing("plan")) {
    try {
      // The payload is the input as parsed, with the server's slug for a new build. An order left out stays left out.
      return await authQuery<Written>("rpc/save_build_plan", {
        method: "POST", body: JSON.stringify({ p_user_id: userId, p_payload: { ...input, slug } }),
      });
    } catch (err) {
      if (!foundMissing(err, "plan")) throw err;
    }
  }
  // save_build keeps neither orders nor a transfer key: a save that names one is refused, not saved without it.
  if (input.order !== undefined || input.order2 !== undefined || input.transferKey !== undefined) {
    return { build_ref: null, build_slug: null, refusal: "orders_unavailable" };
  }
  // save_build_plan's rule for a new build, kept here: it says whether it is shared and shows its owner's name.
  if (!input.id && (input.shared === null || input.showName === null)) throw new Error("A new build needs shared and showName");
  const rows = await authQuery<Written[]>("rpc/save_build", {
    method: "POST",
    body: JSON.stringify({
      p_user_id: userId, p_id: input.id, p_slug: slug, p_character_id: input.characterId,
      p_name: input.name, p_notes: input.notes, p_code: input.code, p_code2: input.code2,
      p_shared: input.shared, p_active: input.active, p_show_name: input.showName,
    }),
  });
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

/**
 * Creates (no id) or updates one of the user's builds, with its spend orders, in one call: when it fails nothing of
 * it was saved, and no second request is left to make. A taken slug is retried with a new one.
 */
export async function saveBuild(userId: string, input: BuildInput): Promise<{ build: SavedBuild; created: boolean } | { refused: BuildRefusal }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await writeBuild(userId, input, input.id ? null : newSlug());
    if (row?.refusal === "slug_taken") continue;
    if (row && row.build_ref === null && REFUSALS.includes(row.refusal ?? "")) return { refused: row.refusal as BuildRefusal };
    if (!row || typeof row.build_ref !== "string" || row.refusal !== null) throw new Error("Build was not saved");
    const ref = row.build_ref;
    const saved = await readBuilds((columns) =>
      `saved_builds?select=${columns}&id=eq.${encodeURIComponent(ref)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    if (!saved[0]) throw new Error("Build was not saved");
    // A replay made nothing now: the route answers it as an update, with the same body.
    return { build: toBuild(saved[0], siteUrl()), created: !input.id && row.replayed !== true };
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
  /** Each set's spend order token, null when unknown. Left out while the database has no order columns. */
  order?: string | null; order2?: string | null;
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
  let orders: Pick<SharedBuild, "order" | "order2"> = {};
  if (!missing("columns")) {
    try {
      const [o] = await authQuery<Array<{ code: string; code2: string | null; point_order: string | null; point_order2: string | null }>>(
        `saved_builds?select=code,code2,${ORDER_COLUMNS}&slug=eq.${slug}&shared=is.true&limit=1`,
      );
      const same = o !== undefined && o.code === r.code && o.code2 === r.code2;
      orders = { order: same ? o.point_order ?? null : null, order2: same ? o.point_order2 ?? null : null };
    } catch (err) {
      if (!foundMissing(err, "columns")) throw err;
    }
  }
  return {
    slug, name: r.name, notes: r.notes, classSlug: r.class_slug, code: r.code, code2: r.code2, gameBuild: r.game_build,
    characterName: r.character_name, characterClass: r.character_class, ownerName: r.owner_name, updatedAt: r.updated_at,
    ...orders,
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
  // The RPC alone authorizes these ids and counts usage. Never query a caller-supplied owner or id,
  // or merge an order with ranks saved again between the authorized snapshot and this read.
  if (row.builds.some((b) => !b || !validId(b.id) || typeof b.code !== "string"
    || (b.code2 !== null && typeof b.code2 !== "string"))) throw new Error("Invalid key response");
  let builds = row.builds;
  if (builds.length && !missing("columns")) {
    try {
      const orders = await authQuery<Array<Pick<BuildRow, "id" | "code" | "code2" | "point_order" | "point_order2">>>(
        `saved_builds?select=id,code,code2,${ORDER_COLUMNS}&id=in.(${builds.map((b) => b.id).join(",")})`,
      );
      builds = builds.map((b) => {
        const o = orders.find((o) => o.id === b.id && o.code === b.code && o.code2 === b.code2);
        return { ...b, point_order: o?.point_order ?? null, point_order2: o?.point_order2 ?? null };
      });
    } catch (err) {
      if (!foundMissing(err, "columns")) throw err;
    }
  }
  const site = siteUrl();
  return { ok: true, value: { characters: toCharacters(row.characters), builds: builds.map((b) => toBuild(b, site)) } };
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
