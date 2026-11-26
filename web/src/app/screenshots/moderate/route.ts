import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/account-shell";
import { validId } from "@/lib/saved-builds";
import {
  NO_STORE, SCREENSHOT_MODERATION_ACTIONS, fail, isScreenshotModerator, moderateScreenshot, pendingKey, publicKey, removeFiles, screenshotBindings,
  screenshotsOn, unavailable, type ScreenshotModerationAction,
} from "@/lib/screenshots";
import { getUser, siteUrl } from "@/lib/supabase/server";

/**
 * POST /screenshots/moderate {screenshotId, action: approve | reject}: a moderator's decision, from /ops/screenshots.
 * Moderators are the comment moderators (any row of comment_moderators). Outside /api/ops because the middleware
 * answers a browser fetch there with a page-load notice. Uncached, unindexed, same-origin only. Anyone who is not a
 * moderator, signed out included, gets the same 404 as a site with screenshots off; the database checks again.
 *
 * Approve copies the file from pending/ to public/ first, then marks the row: a public file with no approved row is
 * never served. Reject marks the row, then removes both files.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!screenshotsOn()) return fail(404, "Not found");
  if (req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  try {
    const user = await getUser();
    if (!user || !(await isScreenshotModerator(user.id))) return fail(404, "Not found");
    const body = await jsonBody(req);
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== "screenshotId" && k !== "action")) {
      return fail(400, "Send a screenshot and an action.");
    }
    const { screenshotId, action } = body as Record<string, unknown>;
    if (!validId(screenshotId) || !SCREENSHOT_MODERATION_ACTIONS.includes(action as ScreenshotModerationAction)) return fail(400, "Send a screenshot and an action.");
    const bindings = screenshotBindings();
    if (!bindings) return unavailable();

    if (action === "approve") {
      const waiting = await bindings.bucket.get(pendingKey(screenshotId));
      if (!waiting) return fail(409, "Its file is missing. Reject it instead.");
      await bindings.bucket.put(publicKey(screenshotId), new Uint8Array(await waiting.arrayBuffer()), { httpMetadata: { contentType: "image/webp" } });
    }
    const result = await moderateScreenshot(user.id, screenshotId, action as ScreenshotModerationAction);
    if ("refused" in result) {
      return result.refused === "wrong_status" ? fail(409, "That screenshot has changed since the page loaded. Reload it.") : fail(404, "Not found");
    }
    if (result.status === "approved") {
      try { await bindings.bucket.delete(pendingKey(screenshotId)); } catch { /* the pending copy is never served once approved */ }
    } else {
      await removeFiles(bindings.bucket, screenshotId);
    }
    return NextResponse.json({ status: result.status }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
