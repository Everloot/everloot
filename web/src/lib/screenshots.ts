import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { readProfile } from "./account-shell";
import { profilesOn } from "./profiles";
import { ACCOUNT_MISMATCH, EXPECTED_OWNER_HEADER } from "./saved-builds";
import { authQuery, getUser, siteUrl, type AccountUser } from "./supabase/server";
import { cleanWebp, sniffImage } from "./webp";
import {
  SCREENSHOT_LIMITS, type GalleryScreenshot, type OwnScreenshot, type QueuedScreenshot, type ScreenshotEntityType,
  type ScreenshotModerationAction, type ScreenshotStatus,
} from "./screenshots-shared";

export * from "./screenshots-shared";

/**
 * Player screenshots on entity pages (supabase/migrations/20261125140000_entity_screenshots.sql): a signed-in player
 * with a profile handle uploads one for an item, quest, NPC, spell, zone or instance page; nothing shows until a comment
 * moderator approves it at /ops/screenshots; the uploader deletes their own. Off until EVERLOOT_SCREENSHOTS=1, which
 * needs EVERLOOT_PROFILES=1 too, since the gallery names an uploader by handle; with either unset nothing here is
 * reachable.
 *
 * Files: the upload is re-encoded on the server by Cloudflare Images (the IMAGES binding) to a WebP of at most 1920 px a
 * side, and cleanWebp then keeps only its pixel chunks, so what is stored holds no EXIF, XMP, colour profile or anything
 * else the camera or an editor wrote. It goes to the private bucket bound as SCREENSHOTS, under screenshots/pending/
 * until approved and screenshots/public/ after; the bucket itself is never public. The site serves a file only while its
 * row allows (entity_screenshot_access).
 *
 * Site only (docs/DATA_POLICY.md, "Screenshots"): the open data, the API, the MCP server, chat answers, exports and
 * sitemaps read none of it.
 */
export function screenshotsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_SCREENSHOTS === "1" && profilesOn(env);
}

// The two Worker bindings, as much of them as this uses (the Workers types are not a dependency of the site).

export interface ScreenshotBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}
interface ImageInfo { format: string; width?: number; height?: number }
interface ImageChain {
  transform(options: { width: number; height: number; fit: "scale-down" }): ImageChain;
  output(options: { format: "image/webp"; quality: number; anim: false }): Promise<{ response(): Response }>;
}
export interface ImagesBinding {
  info(stream: ReadableStream<Uint8Array>): Promise<ImageInfo>;
  input(stream: ReadableStream<Uint8Array>): ImageChain;
}
export interface ScreenshotBindings { bucket: ScreenshotBucket; images: ImagesBinding }

/** The bucket and Cloudflare Images, or null where either is not bound (local `next dev`, or before activation). */
export function screenshotBindings(): ScreenshotBindings | null {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const bucket = env.SCREENSHOTS as ScreenshotBucket | undefined;
    const images = env.IMAGES as ImagesBinding | undefined;
    return bucket && images ? { bucket, images } : null;
  } catch {
    return null;
  }
}

export const pendingKey = (id: string) => `screenshots/pending/${id}.webp`;
export const publicKey = (id: string) => `screenshots/public/${id}.webp`;

const stream = (bytes: Uint8Array) => new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>;

export type ReencodeRefusal = "not_an_image" | "unreadable" | "too_many_pixels" | "too_big";
export type Reencoded = { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; refused: ReencodeRefusal };

/**
 * The file as the site keeps it, or why not. The bytes must start like a PNG, JPEG or WebP whatever the file is called;
 * Cloudflare Images must read it as that same type, at most 40 megapixels; it comes back as a still WebP of at most
 * 1920 px a side (never enlarged), from which cleanWebp keeps only the pixels; and that must fit in 2,000,000 bytes.
 */
export async function reencodeScreenshot(bytes: Uint8Array, images: ImagesBinding): Promise<Reencoded> {
  const type = sniffImage(bytes);
  if (!type) return { ok: false, refused: "not_an_image" };
  let info: ImageInfo;
  try {
    info = await images.info(stream(bytes));
  } catch {
    return { ok: false, refused: "unreadable" };
  }
  const { width, height } = info;
  if (info.format !== type || !width || !height) return { ok: false, refused: "unreadable" };
  if (width * height > SCREENSHOT_LIMITS.maxPixels) return { ok: false, refused: "too_many_pixels" };
  let out: Uint8Array;
  try {
    const result = await images.input(stream(bytes))
      .transform({ width: SCREENSHOT_LIMITS.maxSide, height: SCREENSHOT_LIMITS.maxSide, fit: "scale-down" })
      .output({ format: "image/webp", quality: 85, anim: false });
    out = new Uint8Array(await result.response().arrayBuffer());
  } catch {
    return { ok: false, refused: "unreadable" };
  }
  const clean = cleanWebp(out);
  if (!clean || clean.width > SCREENSHOT_LIMITS.maxSide || clean.height > SCREENSHOT_LIMITS.maxSide) return { ok: false, refused: "unreadable" };
  if (clean.bytes.length > SCREENSHOT_LIMITS.storedBytes) return { ok: false, refused: "too_big" };
  return { ok: true, ...clean };
}

/** An entity id a page could have: a positive 32-bit integer. */
export function parseScreenshotEntityId(value: unknown): number | null {
  const n = typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n <= 2_147_483_647 ? n : null;
}

// Storage: the migration's functions, as the service role.

const rpc = <T>(name: string, args: object) => authQuery<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
const iso = (at: string | null) => (at === null ? null : new Date(at).toISOString());

export async function galleryFor(type: ScreenshotEntityType, id: number): Promise<GalleryScreenshot[]> {
  const rows = await rpc<Array<{ id: string; author: string | null; width: number; height: number; approved_at: string }>>(
    "entity_screenshots_for", { p_entity_type: type, p_entity_id: id });
  return rows.map((r) => ({ id: r.id, author: r.author, width: r.width, height: r.height, approvedAt: iso(r.approved_at)! }));
}

export async function ownScreenshots(userId: string, type: ScreenshotEntityType, id: number): Promise<OwnScreenshot[]> {
  const rows = await rpc<Array<{ id: string; status: OwnScreenshot["status"]; width: number; height: number; created_at: string }>>(
    "my_entity_screenshots", { p_user_id: userId, p_entity_type: type, p_entity_id: id });
  return rows.map((r) => ({ id: r.id, status: r.status, width: r.width, height: r.height, createdAt: iso(r.created_at)! }));
}

export type UploadRefusal = "needs_handle" | "too_many_pending" | "daily_limit" | "site_limit";
const UPLOAD_REFUSALS: readonly string[] = ["needs_handle", "too_many_pending", "daily_limit", "site_limit"];

/** Why an upload would be refused now, counting nothing; null when it would be taken. */
export async function uploadRefusal(userId: string): Promise<UploadRefusal | null> {
  const refusal = await rpc<string | null>("screenshot_upload_refusal", { p_user_id: userId });
  if (refusal === null) return null;
  if (UPLOAD_REFUSALS.includes(refusal)) return refusal as UploadRefusal;
  throw new Error("Unexpected refusal");
}

/** Records an upload (counting it) before its file is written. */
export async function submitScreenshot(userId: string, type: ScreenshotEntityType, id: number, file: { width: number; height: number; bytes: number }):
  Promise<{ screenshotId: string } | { refused: UploadRefusal }> {
  const row = await rpc<{ screenshot_ref: string | null; refusal: string | null } | null>("submit_entity_screenshot", {
    p_user_id: userId, p_entity_type: type, p_entity_id: id, p_width: file.width, p_height: file.height, p_bytes: file.bytes,
  });
  if (row && row.screenshot_ref === null && UPLOAD_REFUSALS.includes(row.refusal ?? "")) return { refused: row.refusal as UploadRefusal };
  if (!row || typeof row.screenshot_ref !== "string" || row.refusal !== null) throw new Error("Screenshot was not saved");
  return { screenshotId: row.screenshot_ref };
}

/** Deletes the account's own screenshot; null when it has none by that id. */
export async function deleteScreenshot(userId: string, screenshotId: string): Promise<{ was: Exclude<ScreenshotStatus, "deleted"> } | null> {
  const row = await rpc<{ screenshot_ref: string | null; was: string | null; refusal: string | null } | null>("delete_entity_screenshot",
    { p_user_id: userId, p_screenshot_id: screenshotId });
  if (row?.refusal === "not_found") return null;
  if (!row || row.refusal !== null || !["pending", "approved", "rejected"].includes(row.was ?? "")) throw new Error("Screenshot was not deleted");
  return { was: row.was as Exclude<ScreenshotStatus, "deleted"> };
}

/** 'public', 'review' (pending, and the viewer is its uploader or a moderator), or null. */
export async function screenshotAccess(screenshotId: string, viewer: string | null): Promise<"public" | "review" | null> {
  const access = await rpc<string | null>("entity_screenshot_access", { p_screenshot_id: screenshotId, p_viewer: viewer });
  return access === "public" || access === "review" ? access : null;
}

export async function isScreenshotModerator(userId: string): Promise<boolean> {
  return (await rpc<boolean>("is_comment_moderator", { p_user_id: userId })) === true;
}

interface QueueRow {
  id: string; entity_type: ScreenshotEntityType; entity_id: number; author: string | null; status: "pending" | "approved";
  width: number; height: number; bytes: number; created_at: string; moderated_at: string | null;
}

export async function screenshotQueue(moderatorId: string): Promise<QueuedScreenshot[]> {
  const rows = await rpc<QueueRow[]>("screenshot_moderation_queue", { p_moderator_id: moderatorId });
  return rows.map((r) => ({
    id: r.id, entityType: r.entity_type, entityId: r.entity_id, author: r.author, status: r.status, width: r.width, height: r.height,
    bytes: r.bytes, createdAt: iso(r.created_at)!, moderatedAt: iso(r.moderated_at),
  }));
}

export type ModerationRefusal = "not_moderator" | "not_found" | "wrong_status";
export async function moderateScreenshot(moderatorId: string, screenshotId: string, action: ScreenshotModerationAction):
  Promise<{ status: "approved" | "rejected" } | { refused: ModerationRefusal }> {
  const row = await rpc<{ screenshot_ref: string | null; status: string | null; refusal: string | null } | null>("moderate_entity_screenshot",
    { p_moderator_id: moderatorId, p_screenshot_id: screenshotId, p_action: action });
  if (row && ["not_moderator", "not_found", "wrong_status"].includes(row.refusal ?? "")) return { refused: row.refusal as ModerationRefusal };
  if (!row || row.refusal !== null || (row.status !== "approved" && row.status !== "rejected")) throw new Error("Screenshot was not moderated");
  return { status: row.status };
}

/** Removes a screenshot's files, both places. A failure leaves a file nobody is served (its row no longer allows it). */
export async function removeFiles(bucket: ScreenshotBucket, id: string): Promise<void> {
  try { await bucket.delete([pendingKey(id), publicKey(id)]); } catch { /* unserved either way */ }
}

export async function viewerHandle(userId: string): Promise<string | null> {
  return (await readProfile(userId))?.handle ?? null;
}

// The routes: same-origin, never indexed; private answers never cached.

export const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
export const unavailable = () => fail(503, "Screenshots are unavailable right now. Try again in a minute.");

/**
 * The account a write is for: 404 with the switch off, 403 for a write not from this site (a missing Origin too), 401
 * signed out, 409 when the page named another account than the session's.
 */
export async function screenshotAccount(req: Request): Promise<AccountUser | Response> {
  if (!screenshotsOn()) return fail(404, "Not found");
  if (req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  const user = await getUser();
  if (!user) return fail(401, "Sign in to upload a screenshot.");
  const expected = req.headers.get(EXPECTED_OWNER_HEADER);
  if (expected !== null && expected !== user.id) {
    return NextResponse.json({ error: "This was meant for another account than the one signed in now. Nothing was saved.", code: ACCOUNT_MISMATCH },
      { status: 409, headers: NO_STORE });
  }
  return user;
}

/**
 * A stored WebP as a response: always `image/webp` with `nosniff`, so a browser never reads it as anything else (the
 * site-wide CSP from next.config.js applies too). `shared` files are the same for everyone and cached for an hour, browser and edge. */
export function imageResponse(bytes: ArrayBuffer, shared: boolean): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "X-Robots-Tag": "noindex",
      ...(shared ? { "Cache-Control": "public, max-age=3600", "CDN-Cache-Control": "max-age=3600" } : { "Cache-Control": "private, no-store" }),
    },
  });
}
