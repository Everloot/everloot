import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/account-shell";
import { MODERATION_ACTIONS, NO_STORE, commentsOn, fail, isCommentModerator, moderateComment, unavailable, type ModerationAction } from "@/lib/comments";
import { validId } from "@/lib/saved-builds";
import { getUser, siteUrl } from "@/lib/supabase/server";

/**
 * POST /comments/moderate {commentId, action: hide | restore | dismiss}: a comment moderator's action, from
 * /ops/comments. Outside /api/ops because the middleware answers a browser fetch there with a page-load notice. Uncached,
 * unindexed, same-origin only. Anyone who is not a moderator, signed out included, gets the same 404 as a site with
 * comments off; the database checks the moderator again.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!commentsOn()) return fail(404, "Not found");
  if (req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  try {
    const user = await getUser();
    if (!user || !(await isCommentModerator(user.id))) return fail(404, "Not found");
    const body = await jsonBody(req);
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== "commentId" && k !== "action")) {
      return fail(400, "Send a comment and an action.");
    }
    const { commentId, action } = body as Record<string, unknown>;
    if (!validId(commentId) || !MODERATION_ACTIONS.includes(action as ModerationAction)) return fail(400, "Send a comment and an action.");
    const result = await moderateComment(user.id, commentId, action as ModerationAction);
    if ("refused" in result) {
      return result.refused === "wrong_status" ? fail(409, "That comment has changed since the page loaded. Reload it.") : fail(404, "Not found");
    }
    return NextResponse.json({ status: result.status }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
