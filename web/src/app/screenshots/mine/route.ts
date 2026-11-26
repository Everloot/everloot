import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/account-shell";
import { validId } from "@/lib/saved-builds";
import {
  NO_STORE, deleteScreenshot, fail, isScreenshotType, ownScreenshots, parseScreenshotEntityId, removeFiles, screenshotAccount, screenshotBindings,
  screenshotsOn, unavailable, viewerHandle, type OwnScreenshotsView,
} from "@/lib/screenshots";
import { getUser } from "@/lib/supabase/server";

/**
 * GET /screenshots/mine?type=&id=: who is reading and their own screenshots on that page, any status but deleted, so
 * they can see what waits for review and delete their own. Never cached: it holds the session's account.
 * POST {action: "delete", screenshotId}: delete one of the account's own; its files go from the bucket.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!screenshotsOn()) return fail(404, "Not found");
  const params = new URL(req.url).searchParams;
  const type = params.get("type");
  const id = parseScreenshotEntityId(params.get("id"));
  if (!isScreenshotType(type) || id === null) return fail(400, "Unknown page.");
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ viewer: null, mine: [] } satisfies OwnScreenshotsView, { headers: NO_STORE });
    const [mine, handle] = await Promise.all([ownScreenshots(user.id, type, id), viewerHandle(user.id)]);
    return NextResponse.json({ viewer: { id: user.id, handle }, mine } satisfies OwnScreenshotsView, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

export async function POST(req: Request) {
  try {
    const user = await screenshotAccount(req);
    if (user instanceof Response) return user;
    const body = await jsonBody(req);
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== "action" && k !== "screenshotId")) {
      return fail(400, "Unknown action.");
    }
    const { action, screenshotId } = body as Record<string, unknown>;
    if (action !== "delete" || !validId(screenshotId)) return fail(400, "Unknown action.");
    const done = await deleteScreenshot(user.id, screenshotId);
    if (!done) return fail(404, "That screenshot is not there any more.");
    const bindings = screenshotBindings();
    if (bindings) await removeFiles(bindings.bucket, screenshotId);
    return NextResponse.json({ deleted: true }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
