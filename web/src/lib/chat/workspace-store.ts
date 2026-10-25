import { NextResponse } from "next/server";
import { signInPath } from "@/lib/auth/return-to";
import { authQuery, getUser, siteUrl, type AccountUser } from "@/lib/supabase/server";
import { chatWorkspaceOn, encodeCursor, uuid, type ConversationSave, type EntrySave, type ImportSave, type ProjectSave } from "./workspace";
import { REVISION_CONFLICT, WORKSPACE_LIMITS as L, type WorkspaceConversation, type WorkspaceConversationSummary, type WorkspaceEntry, type WorkspaceProject } from "./workspace-types";

// Server side of the private Chat workspace (/api/me/chat). Reads and writes go only through the functions in
// supabase/migrations/20261025191223_chat_workspace.sql, always with the session's user id as the owner, so a
// guessed id from another account is simply not found. Nothing here is cached and no API key reaches it.

export const NO_STORE = { "Cache-Control": "private, no-store" };
// The largest body any route reads: a chat of 1 MiB, with room for JSON escaping.
const MAX_BODY = 1.5 * 1024 * 1024;

export const fail = (status: number, error: string, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status, headers: NO_STORE });
export const unavailable = () => fail(503, "Chat projects are unavailable right now. Nothing was saved; try again in a minute.");
/** A private answer, always naming the account it belongs to, so the browser can drop one meant for an account it left. */
export const answer = (accountId: string, body: object, status = 200) => NextResponse.json({ accountId, ...body }, { status, headers: NO_STORE });

/** 404 with the switch off, 403 for a write not from this site (a missing Origin too), 401 with where to sign in, else the user. */
async function workspaceUser(req: Request, write: boolean): Promise<AccountUser | Response> {
  if (!chatWorkspaceOn()) return fail(404, "Not found");
  if (write && req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Sign in to keep Chat projects on your account.", signIn: signInPath("/chat") }, { status: 401, headers: NO_STORE });
  return user;
}

/** The JSON body, read no further than MAX_BODY. */
async function readBody(req: Request): Promise<unknown> {
  const tooLarge = () => fail(413, "That is too large to save.");
  if (Number(req.headers.get("content-length")) > MAX_BODY) return tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  for (;;) {
    const part = await reader?.read();
    if (!part || part.done) break;
    size += part.value.length;
    if (size > MAX_BODY) { await reader!.cancel(); return tooLarge(); }
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { return fail(400, "Send JSON."); }
}

/** A read for the signed-in player. */
export async function workspaceRead(req: Request, run: (user: AccountUser) => Promise<Response>): Promise<Response> {
  try {
    const user = await workspaceUser(req, false);
    return user instanceof Response ? user : await run(user);
  } catch {
    return unavailable();
  }
}

/** A change: same-origin, signed in, and meant for this account (checked before anything else in the body). */
export async function workspaceWrite(req: Request, run: (user: AccountUser, body: unknown) => Promise<Response>): Promise<Response> {
  try {
    const user = await workspaceUser(req, true);
    if (user instanceof Response) return user;
    const body = await readBody(req);
    if (body instanceof Response) return body;
    const expected = body && typeof body === "object" ? uuid((body as Record<string, unknown>).expectedAccountId) : null;
    if (!expected) return fail(400, "Say which account this is for.");
    if (expected !== user.id) return fail(409, "This was meant for another account. Reload Chat to see this account's projects.", "account_mismatch");
    return await run(user, body);
  } catch {
    return unavailable();
  }
}

export type Refusal = "not_found" | "project_not_found" | "build_not_found" | typeof REVISION_CONFLICT | "quota_exceeded" | "size_exceeded" | "daily_limit";
const REFUSALS = new Set<string>(["not_found", "project_not_found", "build_not_found", REVISION_CONFLICT, "quota_exceeded", "size_exceeded", "daily_limit"]);

export function refused(refusal: Refusal): Response {
  switch (refusal) {
    case "not_found": return fail(404, "There is nothing with that id on this account.", "not_found");
    case "project_not_found": return fail(404, "That project is not on this account.", "not_found");
    case "build_not_found": return fail(404, "That saved build is not on this account.", "not_found");
    case REVISION_CONFLICT: return fail(409, "This changed somewhere else since you opened it. Reload it, or save yours as a copy.", REVISION_CONFLICT);
    case "quota_exceeded": return fail(413,
      `This account holds up to ${L.projects} projects, ${L.conversations} chats and ${L.entries} saved entries. Delete one to save another.`, "quota_exceeded");
    case "size_exceeded": return fail(413, "That would take this account's Chat projects past 10 MiB, or one chat past 1 MiB. Delete something to save it.", "size_exceeded");
    case "daily_limit": return fail(429, `This account saved ${L.mutationsPerDay} times in the last day. Try again tomorrow.`, "daily_limit");
  }
}

const rpc = <T>(name: string, args: object) => authQuery<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

function iso(raw: unknown): string {
  const at = typeof raw === "string" ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) throw new Error("Invalid workspace time");
  return at.toISOString();
}
function record<T extends { updatedAt: string }>(raw: unknown): T {
  if (!raw || typeof raw !== "object" || !uuid((raw as { id?: unknown }).id)) throw new Error("Invalid workspace record");
  return { ...(raw as T), updatedAt: iso((raw as T).updatedAt) };
}
function records<T extends { updatedAt: string }>(raw: unknown): T[] {
  if (!Array.isArray(raw)) throw new Error("Invalid workspace list");
  return raw.map((r) => record<T>(r));
}

type Saved<T> = { refused: Refusal } | { record: T; created: boolean };

async function save<T extends { updatedAt: string }>(name: string, args: object, key: string): Promise<Saved<T>> {
  const rows = await rpc<Array<Record<string, unknown>>>(name, args);
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (row && typeof row.refusal === "string" && REFUSALS.has(row.refusal) && row[key] === null) return { refused: row.refusal as Refusal };
  if (!row || row.refusal !== null) throw new Error("Workspace record was not saved");
  return { record: record<T>(row[key]), created: row.created === true };
}

async function remove(name: string, userId: string, id: string, expectedRevision: number): Promise<Refusal | null> {
  const result = await rpc<unknown>(name, { p_user_id: userId, p_id: id, p_expected_revision: expectedRevision });
  if (result === null || result === undefined) return null;
  if (typeof result === "string" && REFUSALS.has(result)) return result as Refusal;
  throw new Error("Workspace record was not deleted");
}

/** One page of a list: at most 50 rows, and the cursor for the next when there is one. */
function page<T>(rows: T[], cursor: (last: T) => Parameters<typeof encodeCursor>[0]): { rows: T[]; nextCursor: string | null } {
  return rows.length > L.page ? { rows: rows.slice(0, L.page), nextCursor: encodeCursor(cursor(rows[L.page - 1])) } : { rows, nextCursor: null };
}

export const listProjects = async (userId: string) => records<WorkspaceProject>(await rpc("chat_list_projects", { p_user_id: userId }));

export const saveProject = (userId: string, input: ProjectSave) => save<WorkspaceProject>("chat_save_project", {
  p_user_id: userId, p_id: input.project.id, p_expected_revision: input.expectedRevision, p_name: input.project.name, p_description: input.project.description,
}, "project");

export const deleteProject = (userId: string, id: string, rev: number) => remove("chat_delete_project", userId, id, rev);

export async function listConversations(userId: string, f: { projectId: string | null; query: string | null; after: [boolean, string, string] | null }) {
  const rows = records<WorkspaceConversationSummary>(await rpc("chat_list_conversations", {
    p_user_id: userId, p_project_id: f.projectId, p_query: f.query, p_after_pinned: f.after?.[0] ?? null,
    p_after_updated_at: f.after?.[1] ?? null, p_after_id: f.after?.[2] ?? null, p_limit: L.page + 1,
  }));
  return page(rows, (c) => [c.pinned, c.updatedAt, c.id]);
}

export async function getConversation(userId: string, id: string): Promise<WorkspaceConversation | null> {
  const raw = await rpc<unknown>("chat_get_conversation", { p_user_id: userId, p_id: id });
  return raw === null || raw === undefined ? null : record<WorkspaceConversation>(raw);
}

export const saveConversation = (userId: string, input: ConversationSave) => save<WorkspaceConversation>("chat_save_conversation", {
  p_user_id: userId, p_id: input.conversation.id, p_expected_revision: input.expectedRevision, p_title: input.conversation.title,
  p_project_id: input.conversation.projectId, p_pinned: input.conversation.pinned, p_messages: input.conversation.messages,
}, "conversation");

export const deleteConversation = (userId: string, id: string, rev: number) => remove("chat_delete_conversation", userId, id, rev);

export async function listEntries(userId: string, f: { projectId: string | null; after: [string, string] | null }) {
  const rows = records<WorkspaceEntry>(await rpc("chat_list_entries", {
    p_user_id: userId, p_project_id: f.projectId, p_after_updated_at: f.after?.[0] ?? null, p_after_id: f.after?.[1] ?? null, p_limit: L.page + 1,
  }));
  return page(rows, (e) => [e.updatedAt, e.id]);
}

export const saveEntry = (userId: string, input: EntrySave) => save<WorkspaceEntry>("chat_save_entry", {
  p_user_id: userId, p_id: input.entry.id, p_expected_revision: input.expectedRevision, p_project_id: input.entry.projectId,
  p_kind: input.entry.kind, p_title: input.entry.title, p_build_id: input.entry.buildId, p_href: input.entry.href,
  p_text: input.entry.text, p_sources: input.entry.sources,
}, "entry");

export const deleteEntry = (userId: string, id: string, rev: number) => remove("chat_delete_entry", userId, id, rev);

export const importConversation = (userId: string, input: ImportSave) => save<WorkspaceConversation>("chat_import_conversation", {
  p_user_id: userId, p_source_id: input.sourceId, p_legacy_id: input.legacyId,
  p_title: input.conversation.title, p_messages: input.conversation.messages,
}, "conversation");

/** The account's whole workspace, for its own download. */
export async function exportWorkspace(userId: string) {
  const raw = await rpc<{ projects?: unknown; conversations?: unknown; entries?: unknown } | null>("chat_export", { p_user_id: userId });
  if (!raw || typeof raw !== "object") throw new Error("Invalid workspace export");
  return {
    projects: records<WorkspaceProject>(raw.projects),
    conversations: records<WorkspaceConversation>(raw.conversations),
    entries: records<WorkspaceEntry>(raw.entries),
  };
}

export async function clearWorkspace(userId: string): Promise<void> {
  if ((await rpc<unknown>("chat_clear_workspace", { p_user_id: userId })) !== true) throw new Error("Workspace was not cleared");
}
