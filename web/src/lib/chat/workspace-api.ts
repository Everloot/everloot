import type { ChatMessage } from "./store";
import {
  REVISION_CONFLICT, WORKSPACE_LIMITS,
  type WorkspaceConversation, type WorkspaceConversationSummary, type WorkspaceEntry, type WorkspaceProject,
} from "./workspace-types";

/**
 * The browser's side of the private Chat workspace (docs/superpowers/plans/2026-10-25-chat-workspace.md). Every
 * call names the account it expects and every answer must name the same one, so a response that arrives after a
 * sign-out or an account switch is refused instead of shown or saved over. Nothing here is cached.
 */

export type WorkspaceErrorCode = "conflict" | "signed_out" | "forbidden" | "not_found" | "too_large" | "unavailable" | "account_changed" | "invalid";

export class WorkspaceError extends Error {
  constructor(readonly code: WorkspaceErrorCode, message: string) { super(message); this.name = "WorkspaceError"; }
}

export interface Identity { id: string; name: string }
export interface CallOptions { accountId: string; signal?: AbortSignal; send?: typeof fetch }
/** The options the workspace screens hold: the current account and the signal that aborts when it changes. */
export type Scoped = CallOptions & { signal: AbortSignal };

const MESSAGES: Record<WorkspaceErrorCode, string> = {
  conflict: "This changed somewhere else since it was opened here.",
  signed_out: "You are signed out. Sign in again to reach your projects.",
  forbidden: "The request was refused. Reload the page and try again.",
  not_found: "That is no longer in your account.",
  too_large: "That is over the workspace limits.",
  unavailable: "Your projects could not be reached. Check the connection and try again.",
  account_changed: "You are signed in as someone else now.",
  invalid: "That could not be saved as it is.",
};

function codeFor(status: number, body: { code?: unknown } | null): WorkspaceErrorCode {
  if (status === 409 && body?.code === REVISION_CONFLICT) return "conflict";
  if (status === 401) return "signed_out";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 413 || status === 429) return "too_large";
  if (status === 400 || status === 409 || status === 422) return "invalid";
  return "unavailable";
}

async function request(path: string, init: RequestInit, send: typeof fetch, signal?: AbortSignal): Promise<{ status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await send(path, { cache: "no-store", credentials: "same-origin", signal, ...init });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new WorkspaceError("unavailable", MESSAGES.unavailable);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = codeFor(res.status, body);
    // The server's own words for limits and invalid input say which limit; the rest read the same everywhere.
    const own = (code === "too_large" || code === "invalid") && typeof body?.error === "string" ? body.error : MESSAGES[code];
    throw new WorkspaceError(code, own);
  }
  return { status: res.status, body };
}

async function call<T>(path: string, { accountId, signal, send = fetch }: CallOptions, method = "GET", payload?: object): Promise<T> {
  const init: RequestInit = payload
    ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedAccountId: accountId, ...payload }) }
    : { method };
  const { body } = await request(path, init, send, signal);
  if (!body || body.accountId !== accountId) throw new WorkspaceError("account_changed", MESSAGES.account_changed);
  return body as T;
}

/** Who the session belongs to, as the server says; null when signed out. */
export async function whoAmI(send: typeof fetch = fetch, signal?: AbortSignal): Promise<Identity | null> {
  const { body } = await request("/api/auth/me", { method: "GET" }, send, signal);
  const user = body?.user as { id?: unknown; name?: unknown } | null | undefined;
  if (!user || typeof user.id !== "string") return null;
  return { id: user.id, name: typeof user.name === "string" && user.name ? user.name : "your account" };
}

const query = (params: Record<string, string | null | undefined>) => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  return q.size ? `?${q}` : "";
};

export const listProjects = (o: CallOptions) =>
  call<{ projects: WorkspaceProject[] }>("/api/me/chat/projects", o).then((r) => r.projects);

export const saveProject = (project: { id: string; name: string; description: string | null }, expectedRevision: number, o: CallOptions) =>
  call<{ project: WorkspaceProject }>("/api/me/chat/projects", o, "POST", { expectedRevision, project }).then((r) => r.project);

export const deleteProject = (id: string, expectedRevision: number, o: CallOptions) =>
  call<{ ok: true }>(`/api/me/chat/projects/${encodeURIComponent(id)}`, o, "DELETE", { expectedRevision });

export interface Page<T> { items: T[]; nextCursor: string | null }

export const listConversations = (f: { cursor?: string | null; query?: string; projectId?: string | null }, o: CallOptions) =>
  call<{ conversations: WorkspaceConversationSummary[]; nextCursor: string | null }>(
    `/api/me/chat/conversations${query({ cursor: f.cursor, query: f.query?.trim(), projectId: f.projectId })}`, o,
  ).then((r): Page<WorkspaceConversationSummary> => ({ items: r.conversations, nextCursor: r.nextCursor ?? null }));

export const getConversation = (id: string, o: CallOptions) =>
  call<{ conversation: WorkspaceConversation }>(`/api/me/chat/conversations/${encodeURIComponent(id)}`, o).then((r) => r.conversation);

export interface ConversationInput { id: string; title: string; projectId: string | null; pinned: boolean; messages: ChatMessage[] }

export const saveConversation = (conversation: ConversationInput, expectedRevision: number, o: CallOptions) =>
  call<{ conversation: WorkspaceConversation }>("/api/me/chat/conversations", o, "POST", { expectedRevision, conversation }).then((r) => r.conversation);

export const deleteConversation = (id: string, expectedRevision: number, o: CallOptions) =>
  call<{ ok: true }>(`/api/me/chat/conversations/${encodeURIComponent(id)}`, o, "DELETE", { expectedRevision });

export type EntryInput = Omit<WorkspaceEntry, "revision" | "updatedAt">;

export const listEntries = (f: { cursor?: string | null; projectId?: string | null }, o: CallOptions) =>
  call<{ entries: WorkspaceEntry[]; nextCursor: string | null }>(`/api/me/chat/entries${query({ projectId: f.projectId, cursor: f.cursor })}`, o)
    .then((r): Page<WorkspaceEntry> => ({ items: r.entries, nextCursor: r.nextCursor ?? null }));

export const saveEntry = (entry: EntryInput, expectedRevision: number, o: CallOptions) =>
  call<{ entry: WorkspaceEntry }>("/api/me/chat/entries", o, "POST", { expectedRevision, entry }).then((r) => r.entry);

export const deleteEntry = (id: string, expectedRevision: number, o: CallOptions) =>
  call<{ ok: true }>(`/api/me/chat/entries/${encodeURIComponent(id)}`, o, "DELETE", { expectedRevision });

/** One browser chat into the account; the server makes a repeat with the same source and id a no-op. */
export const importConversation = (
  record: { sourceId: string; legacyId: string; conversation: { title: string; messages: ChatMessage[] } }, o: CallOptions,
) => call<{ conversation: WorkspaceConversation; created: boolean }>("/api/me/chat/import", o, "POST", record);

/** Clears this account's projects, chats and saved entries; the login account and its builds stay. */
export const deleteWorkspace = (o: CallOptions) => call<{ ok: true }>("/api/me/chat/workspace", o, "DELETE", {});

export const EXPORT_PATH = "/api/me/chat/export";

/** A build an export entry names, as its owner made it. */
export interface ExportedBuild { id: string; name: string; notes: string | null; classSlug: string; code: string; code2: string | null; gameBuild: string; updatedAt: string }

/** Every page of one export section, in order. A record read twice (it moved while paging) is kept once, as last read. */
async function exportSection<T extends { id: string }>(section: "conversations" | "entries", o: CallOptions): Promise<T[]> {
  const records = new Map<string, T>();
  let cursor: string | null = null;
  for (let pages = 0; pages <= 2 * WORKSPACE_LIMITS.entries; pages++) {
    const page: Record<string, unknown> = await call(`${EXPORT_PATH}${query({ section, cursor })}`, o);
    o.signal?.throwIfAborted();
    for (const record of page[section] as T[]) records.set(record.id, record);
    const next = typeof page.nextCursor === "string" ? page.nextCursor : null;
    if (!next) return [...records.values()];
    if (next === cursor) break;
    cursor = next;
  }
  throw new WorkspaceError("unavailable", MESSAGES.unavailable);
}

/**
 * The account's whole workspace as one JSON file, read page by page (no answer may pass 4.5 MB, and an account
 * holds up to 10 MiB). Each page must name this account; a failed page, an account switch or the signal aborting
 * rejects with nothing returned. Records are as they were when each page was read, not one frozen moment.
 */
export async function exportWorkspace(o: CallOptions): Promise<Blob> {
  const exportedAt = new Date().toISOString();
  const { projects } = await call<{ projects: WorkspaceProject[] }>(`${EXPORT_PATH}?section=projects`, o);
  o.signal?.throwIfAborted();
  const conversations = await exportSection<WorkspaceConversation>("conversations", o);
  const entries = await exportSection<WorkspaceEntry>("entries", o);
  const ids = [...new Set(entries.flatMap((e) => (e.kind === "build" && e.buildId ? [e.buildId] : [])))];
  const builds: ExportedBuild[] = [];
  for (let i = 0; i < ids.length; i += WORKSPACE_LIMITS.page) {
    const page = await call<{ builds: ExportedBuild[] }>(`${EXPORT_PATH}?section=builds&ids=${ids.slice(i, i + WORKSPACE_LIMITS.page).join(",")}`, o);
    o.signal?.throwIfAborted();
    builds.push(...page.builds);
  }
  const data = { version: 1, accountId: o.accountId, exportedAt, projects, conversations, entries, builds };
  return new Blob([JSON.stringify(data)], { type: "application/json" });
}

const SITE = /^https:\/\/(?:www\.)?everloot\.app(?=[/?#]|$)/;

/** An everloot.app page as its path, or null for anything else: another site, a scheme, a protocol-relative URL. */
export function sameSitePath(input: string): string | null {
  const raw = input.trim();
  const path = SITE.test(raw) ? raw.replace(SITE, "") || "/" : raw;
  if (!/^\/(?![/\\])/.test(path) || /[\s\u0000-\u001f\\]/.test(path) || path.length > WORKSPACE_LIMITS.url) return null;
  return path;
}

/** Text cut to a limit, for titles taken from a question. */
export const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
