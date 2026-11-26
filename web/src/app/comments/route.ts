import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/account-shell";
import {
  COMMENT_LIMITS, NO_STORE, commentAccount, commentsFor, commentsOn, fail, isCommentType, linkProblem, parseCommentRequest, parseEntityId,
  unavailable, viewerHandle, writeComment, type CommentRefusal, type CommentsView,
} from "@/lib/comments";
import { getUser } from "@/lib/supabase/server";

/**
 * GET /comments?type=<item|quest|npc|spell|zone|instance>&id=<n>: one page's comments and who is reading, for the
 * comments section, which loads them in the browser so the page's cached HTML never carries a session or a comment.
 * POST {action}: "post" {type, id, body}, "edit" {commentId, body}, "delete" {commentId}, "report" {commentId, reason,
 * note}, for the signed-in account. Part of the site, not the API: it is left out of the API docs, the MCP server and
 * search engines, and answers 404 unless EVERLOOT_COMMENTS=1.
 */
export const dynamic = "force-dynamic";

const REFUSED: Record<CommentRefusal, [number, string]> = {
  needs_handle: [409, "Choose a handle on your settings page first. A comment names its author by handle, never by BattleTag."],
  daily_limit: [429, `That is today's limit (${COMMENT_LIMITS.postsPerDay} comments, ${COMMENT_LIMITS.editsPerDay} edits and ${COMMENT_LIMITS.reportsPerDay} reports a day). Try again tomorrow.`],
  not_found: [404, "That comment is not there any more."],
  not_editable: [409, `A comment can be edited for ${COMMENT_LIMITS.editMinutes} minutes after it is posted. You can still delete it.`],
  own_comment: [409, "You can't report your own comment. You can delete it."],
  already_reported: [409, "You already reported this comment. A moderator will look at it."],
};

export async function GET(req: Request) {
  if (!commentsOn()) return fail(404, "Not found");
  const params = new URL(req.url).searchParams;
  const type = params.get("type");
  const id = parseEntityId(params.get("id"));
  if (!isCommentType(type) || id === null) return fail(400, "Unknown page.");
  try {
    const user = await getUser();
    const [comments, handle] = await Promise.all([commentsFor(type, id, user?.id ?? null), user ? viewerHandle(user.id) : null]);
    const view: CommentsView = { viewer: user ? { id: user.id, handle } : null, comments };
    return NextResponse.json(view, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

export async function POST(req: Request) {
  try {
    const user = await commentAccount(req);
    if (user instanceof Response) return user;
    const parsed = parseCommentRequest(await jsonBody(req));
    if (!parsed.ok) return fail(400, parsed.error);
    const request = parsed.value;
    if (request.action === "post" || request.action === "edit") {
      const problem = linkProblem(request.body);
      if (problem) return fail(422, problem);
    }
    const result = await writeComment(user.id, request);
    if ("refused" in result) {
      const [status, error] = REFUSED[result.refused];
      return result.refused === "needs_handle"
        ? NextResponse.json({ error, settings: "/settings" }, { status, headers: NO_STORE })
        : fail(status, error);
    }
    return NextResponse.json({ commentId: result.commentId }, { status: request.action === "post" ? 201 : 200, headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
