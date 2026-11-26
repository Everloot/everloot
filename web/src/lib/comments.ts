import { NextResponse } from "next/server";
import { readProfile } from "./account-shell";
import { COMMENT_LINK_HOSTS, parseComment } from "./comment-markup";
import { profilesOn } from "./profiles";
import { ACCOUNT_MISMATCH, EXPECTED_OWNER_HEADER, validId } from "./saved-builds";
import { authQuery, getUser, siteUrl, type AccountUser } from "./supabase/server";
import {
  COMMENT_LIMITS, COMMENT_STATUSES, REPORT_REASONS, isCommentType, type CommentEntityType, type CommentStatus, type ModerationAction,
  type PageComment, type QueuedComment, type ReportReason,
} from "./comments-shared";

export * from "./comments-shared";

/**
 * Comments on entity pages (supabase/migrations/20261125130000_entity_comments.sql): a signed-in player with a profile
 * handle comments on an item, quest, NPC, spell, zone or instance page, edits for 15 minutes and deletes their own;
 * other players report; moderators hide from /ops/comments. Off until EVERLOOT_COMMENTS=1, which needs
 * EVERLOOT_PROFILES=1 too, since a comment names its author by handle; with either unset nothing here is reachable.
 *
 * Site only (docs/DATA_POLICY.md, "Comments"): pages load comments in the browser from /comments, never into the
 * cached HTML, and the open data, the API, the MCP server, chat answers, exports and sitemaps read none of it.
 *
 * The server reads and writes only through the migration's functions, always for the session's account; they check the
 * owner, the statuses and the daily limits again. Nothing in a request names an author, a moderator or a status.
 */
export function commentsOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_COMMENTS === "1" && profilesOn(env);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Characters as Postgres counts them, so a limit here is the limit there. */
const length = (s: string) => Array.from(s).length;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Words as stored: line breaks as \n, no control character but the line break, no bidirectional override (which can
 * make text read differently from what it is), at most one blank line in a row, trimmed.
 */
export function cleanCommentBody(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const cleanNote = (value: string) => value.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "").trim();

/** An entity id a page could have: a positive 32-bit integer. */
export function parseEntityId(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 2_147_483_647 ? n : null;
}

export const ALLOWED_LINKS = `Links can go to ${COMMENT_LINK_HOSTS.join(", ")} or a page on this site.`;

export type CommentRequest =
  | { action: "post"; type: CommentEntityType; id: number; body: string }
  | { action: "edit"; commentId: string; body: string }
  | { action: "delete"; commentId: string }
  | { action: "report"; commentId: string; reason: ReportReason; note: string };

const FIELDS: Record<CommentRequest["action"], readonly string[]> = {
  post: ["action", "type", "id", "body"], edit: ["action", "commentId", "body"], delete: ["action", "commentId"],
  report: ["action", "commentId", "reason", "note"],
};

function readBody(value: unknown): Parsed<string> {
  if (typeof value !== "string") return { ok: false, error: "Write a comment." };
  const body = cleanCommentBody(value);
  if (!body) return { ok: false, error: "Write a comment." };
  if (length(body) > COMMENT_LIMITS.body) return { ok: false, error: `A comment can be up to ${COMMENT_LIMITS.body.toLocaleString("en-US")} characters.` };
  return { ok: true, value: body };
}

/** A write as the comments section sends it. Shapes and limits; links are checked by linkProblem. */
export function parseCommentRequest(value: unknown): Parsed<CommentRequest> {
  if (!isObject(value) || typeof value.action !== "string" || !Object.hasOwn(FIELDS, value.action)) return { ok: false, error: "Unknown action." };
  const action = value.action as CommentRequest["action"];
  const extra = Object.keys(value).find((k) => !FIELDS[action].includes(k));
  if (extra !== undefined) return { ok: false, error: `Unknown field "${extra}".` };
  if (action === "post") {
    const id = parseEntityId(value.id);
    if (!isCommentType(value.type) || id === null) return { ok: false, error: "Unknown page." };
    const body = readBody(value.body);
    return body.ok ? { ok: true, value: { action, type: value.type, id, body: body.value } } : body;
  }
  if (!validId(value.commentId)) return { ok: false, error: "Unknown comment." };
  const commentId = value.commentId;
  if (action === "delete") return { ok: true, value: { action, commentId } };
  if (action === "edit") {
    const body = readBody(value.body);
    return body.ok ? { ok: true, value: { action, commentId, body: body.value } } : body;
  }
  if (!REPORT_REASONS.includes(value.reason as ReportReason)) return { ok: false, error: "Choose a reason." };
  const note = typeof value.note === "string" ? cleanNote(value.note) : value.note === undefined ? "" : null;
  if (note === null || length(note) > COMMENT_LIMITS.note) return { ok: false, error: `A note can be up to ${COMMENT_LIMITS.note} characters.` };
  return { ok: true, value: { action, commentId, reason: value.reason as ReportReason, note } };
}

/** Why the words cannot be posted as they are: a link to a site not on the list. Null when they can. */
export function linkProblem(body: string): string | null {
  return parseComment(body).rejected.length ? ALLOWED_LINKS : null;
}

// Storage: the migration's functions, as the service role, for the session's account.

const rpc = <T>(name: string, args: object) => authQuery<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
const iso = (at: string | null) => (at === null ? null : new Date(at).toISOString());

interface CommentRow {
  id: string; author: string | null; body: string; status: CommentStatus; created_at: string; edited_at: string | null;
  mine: boolean; editable: boolean; reported: boolean;
}

/** One page's comments, newest first, as the viewer (null signed out) sees them. */
export async function commentsFor(type: CommentEntityType, id: number, viewer: string | null): Promise<PageComment[]> {
  const rows = await rpc<CommentRow[]>("entity_comments_for", { p_entity_type: type, p_entity_id: id, p_viewer: viewer });
  return rows.map((r) => ({
    id: r.id, author: r.author, body: r.body, status: r.status, createdAt: iso(r.created_at)!, editedAt: iso(r.edited_at),
    mine: r.mine, editable: r.editable, reported: r.reported,
  }));
}

export type CommentRefusal = "needs_handle" | "daily_limit" | "not_found" | "not_editable" | "own_comment" | "already_reported";
type Written = { comment_ref: string | null; refusal: string | null } | null;
export type CommentOutcome = { commentId: string } | { refused: CommentRefusal };

function outcome(row: Written, refusals: readonly CommentRefusal[]): CommentOutcome {
  if (row && row.comment_ref === null && refusals.includes(row.refusal as CommentRefusal)) return { refused: row.refusal as CommentRefusal };
  if (!row || typeof row.comment_ref !== "string" || row.refusal !== null) throw new Error("Comment was not saved");
  return { commentId: row.comment_ref };
}

/** Carries out a write for the account. */
export async function writeComment(userId: string, request: CommentRequest): Promise<CommentOutcome> {
  switch (request.action) {
    case "post":
      return outcome(await rpc<Written>("post_entity_comment", { p_user_id: userId, p_entity_type: request.type, p_entity_id: request.id, p_body: request.body }),
        ["needs_handle", "daily_limit"]);
    case "edit":
      return outcome(await rpc<Written>("edit_entity_comment", { p_user_id: userId, p_comment_id: request.commentId, p_body: request.body }),
        ["not_found", "not_editable", "daily_limit"]);
    case "delete":
      return outcome(await rpc<Written>("delete_entity_comment", { p_user_id: userId, p_comment_id: request.commentId }), ["not_found"]);
    case "report":
      return outcome(await rpc<Written>("report_entity_comment", { p_user_id: userId, p_comment_id: request.commentId, p_reason: request.reason, p_note: request.note }),
        ["not_found", "own_comment", "already_reported", "daily_limit"]);
  }
}

export async function viewerHandle(userId: string): Promise<string | null> {
  return (await readProfile(userId))?.handle ?? null;
}

// Moderation.

export async function isCommentModerator(userId: string): Promise<boolean> {
  return (await rpc<boolean>("is_comment_moderator", { p_user_id: userId })) === true;
}

interface QueueRow {
  id: string; entity_type: CommentEntityType; entity_id: number; author: string | null; body: string; status: CommentStatus;
  created_at: string; edited_at: string | null; moderated_at: string | null; open_reports: number; reasons: ReportReason[]; notes: string[];
}

export async function moderationQueue(moderatorId: string): Promise<QueuedComment[]> {
  const rows = await rpc<QueueRow[]>("comment_moderation_queue", { p_moderator_id: moderatorId });
  return rows.map((r) => ({
    id: r.id, entityType: r.entity_type, entityId: r.entity_id, author: r.author, body: r.body, status: r.status,
    createdAt: iso(r.created_at)!, editedAt: iso(r.edited_at), moderatedAt: iso(r.moderated_at), openReports: r.open_reports,
    reasons: r.reasons, notes: r.notes,
  }));
}

export type ModerationRefusal = "not_moderator" | "not_found" | "wrong_status";
export async function moderateComment(moderatorId: string, commentId: string, action: ModerationAction):
  Promise<{ status: CommentStatus } | { refused: ModerationRefusal }> {
  const row = await rpc<{ comment_ref: string | null; status: CommentStatus | null; refusal: string | null } | null>("moderate_entity_comment",
    { p_moderator_id: moderatorId, p_comment_id: commentId, p_action: action });
  if (row && ["not_moderator", "not_found", "wrong_status"].includes(row.refusal ?? "")) return { refused: row.refusal as ModerationRefusal };
  if (!row || row.refusal !== null || !COMMENT_STATUSES.includes(row.status as CommentStatus)) throw new Error("Comment was not moderated");
  return { status: row.status as CommentStatus };
}

// The routes: same-origin JSON, never cached, never indexed.

export const NO_STORE = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
export const unavailable = () => fail(503, "Comments are unavailable right now. Try again in a minute.");

/**
 * The account a write is for: 404 with the switch off, 403 for a write not from this site (a missing Origin too), 401
 * signed out, 409 when the page named another account than the session's (EXPECTED_OWNER_HEADER, as saved builds do).
 */
export async function commentAccount(req: Request): Promise<AccountUser | Response> {
  if (!commentsOn()) return fail(404, "Not found");
  if (req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  const user = await getUser();
  if (!user) return fail(401, "Sign in to comment.");
  const expected = req.headers.get(EXPECTED_OWNER_HEADER);
  if (expected !== null && expected !== user.id) {
    return NextResponse.json({ error: "This was meant for another account than the one signed in now. Nothing was saved.", code: ACCOUNT_MISMATCH },
      { status: 409, headers: NO_STORE });
  }
  return user;
}
