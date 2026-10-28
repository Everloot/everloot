import { NextResponse } from "next/server";
import { jsonBody } from "@/lib/account-shell";
import {
  GUIDE_SAVES_PER_DAY, GUIDE_SUBMISSIONS_PER_DAY, GUIDES_PER_ACCOUNT, NO_STORE, REVISIONS_PER_GUIDE, fail, guideAccount, guideAuthor, listOwnGuides,
  parseGuideRequest, saveGuideDraft, submissionProblems, submitGuide, unavailable, withdrawGuide, type GuideRefusal,
} from "@/lib/guide-submissions";

/**
 * GET /api/me/guides: the signed-in player's guides with their revisions (titles and statuses, no text), and the name a
 * guide of theirs carries. POST {action}: "save" {guideId|null, draft} keeps a private draft; "submit" {guideId, draft,
 * alias} checks the draft as the guide it would be once published and sends it for review exactly as checked, under the
 * handle the player saw (alias); "withdraw" {guideId, revision} takes a revision waiting for review back. Nothing here
 * publishes anything.
 */
export const dynamic = "force-dynamic";

const NEEDS_HANDLE = "Choose a handle on your settings page first. A guide names its author by handle, never by BattleTag.";
const REFUSED: Record<GuideRefusal, [number, string]> = {
  not_found: [404, "There is no guide of yours with that id."],
  guide_limit: [409, `An account can keep ${GUIDES_PER_ACCOUNT} guides.`],
  revision_limit: [409, `A guide can keep ${REVISIONS_PER_GUIDE} revisions.`],
  daily_limit: [429, `You saved drafts ${GUIDE_SAVES_PER_DAY} times today. Try again tomorrow.`],
  needs_handle: [409, NEEDS_HANDLE],
  alias_changed: [409, "Your handle changed since you checked the name this guide carries. Check it and submit again."],
  already_submitted: [409, "Another revision of this guide is waiting for review. Withdraw it first to submit this one."],
  incomplete: [422, "This guide is not ready to submit."],
  submit_limit: [429, `You submitted guides ${GUIDE_SUBMISSIONS_PER_DAY} times today. Try again tomorrow.`],
  not_submitted: [409, "That revision is not waiting for review."],
};

function refused(why: GuideRefusal): Response {
  const [status, error] = REFUSED[why];
  // Where a handle is chosen, for the page to link.
  return why === "needs_handle" ? NextResponse.json({ error, settings: "/settings" }, { status, headers: NO_STORE }) : fail(status, error);
}

export async function GET(req: Request) {
  try {
    const user = await guideAccount(req, false);
    if (user instanceof Response) return user;
    const [guides, author] = await Promise.all([listOwnGuides(user.id), guideAuthor(user.id)]);
    return NextResponse.json({ guides, author }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

export async function POST(req: Request) {
  try {
    const user = await guideAccount(req, true);
    if (user instanceof Response) return user;
    const parsed = parseGuideRequest(await jsonBody(req));
    if (!parsed.ok) return fail(400, parsed.error);
    const request = parsed.value;
    let result;
    if (request.action === "save") result = await saveGuideDraft(user.id, request.guideId, request.draft);
    else if (request.action === "withdraw") result = await withdrawGuide(user.id, request.guideId, request.revision);
    else {
      // The name is the handle the player saw, checked here and again by the database under the account's lock.
      const author = await guideAuthor(user.id);
      if (!author.handle) return refused("needs_handle");
      if (request.alias !== author.handle) return refused("alias_changed");
      const problems = await submissionProblems(request.draft, author);
      if (problems.length) return NextResponse.json({ error: "Fix these before you submit:", problems }, { status: 422, headers: NO_STORE });
      result = await submitGuide(user.id, request.guideId, request.draft, request.alias);
    }
    if ("refused" in result) return refused(result.refused);
    const status = request.action === "save" ? "draft" : request.action === "submit" ? "submitted" : "withdrawn";
    return NextResponse.json({ guideId: result.guideId, revision: result.revision, status },
      { status: request.action === "save" && result.created ? 201 : 200, headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
