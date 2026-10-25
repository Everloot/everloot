import type { ChatStep } from "./agent";
import { itemRef } from "./items";
import { MODEL_ID } from "./providers";
import type { ChatMessage } from "./store";
import { WORKSPACE_LIMITS as L, type WorkspaceEntryKind } from "./workspace-types";

/**
 * Checks for what the browser sends the private Chat workspace (/api/me/chat). Off until
 * EVERLOOT_CHAT_WORKSPACE=1, independent of the saved builds switch; with it unset every route answers 404.
 *
 * Every request body is rebuilt from the fields it may carry, so nothing else reaches the account. The database
 * checks the same bounds again (supabase/migrations/20261025191223_chat_workspace.sql).
 */
export function chatWorkspaceOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_CHAT_WORKSPACE === "1";
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; status: 400 | 413; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REVISION = 2 ** 31 - 1;
// A message's tool trail. Its whole conversation is held to 1 MiB as well.
const MESSAGE = { list: 100, ref: 2048, steps: 100, tool: 64, input: 2000 } as const;
const KINDS: readonly WorkspaceEntryKind[] = ["build", "page", "answer", "note"];

/** A lower-case UUID, or null. */
export const uuid = (raw: unknown): string | null => (typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null);

class Refused extends Error {
  constructor(readonly status: 400 | 413, message: string) { super(message); }
}
const refuse = (message: string, status: 400 | 413 = 400): never => { throw new Refused(status, message); };
function parsed<T>(read: () => T): Parsed<T> {
  try { return { ok: true, value: read() }; } catch (error) {
    if (error instanceof Refused) return { ok: false, status: error.status, error: error.message };
    throw error;
  }
}

const object = (raw: unknown, what: string): Record<string, unknown> =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : refuse(`Send ${what}.`);
const id = (raw: unknown, what: string): string => uuid(raw) ?? refuse(`That ${what} id is not valid.`);
const optionalId = (raw: unknown, what: string): string | null => (raw === null || raw === undefined ? null : id(raw, what));
const account = (raw: unknown): string => uuid(raw) ?? refuse("Say which account this is for.");
function revision(raw: unknown, min: 0 | 1): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= MAX_REVISION ? raw : refuse("Send the revision you last saw.");
}
function text(raw: unknown, what: string, max: number, { min = 0, trim = true } = {}): string {
  if (typeof raw !== "string") return refuse(`The ${what} must be text.`);
  const value = trim ? raw.trim() : raw;
  if (value.length > max) return refuse(`The ${what} is longer than ${max} characters.`, max >= L.text ? 413 : 400);
  if (value.trim().length < min) return refuse(`The ${what} is empty.`);
  return value;
}
function strings(raw: unknown, what: string, count: number, max: number): string[] {
  if (!Array.isArray(raw) || raw.length > count) return refuse(`Send at most ${count} ${what}.`);
  return raw.map((s) => (typeof s === "string" && s.length >= 1 && s.length <= max ? s : refuse(`Each of the ${what} is text of 1 to ${max} characters.`)));
}

/** A path on this site ("/item/2589?x=1"): never another origin, a protocol-relative URL or a backslash trick. */
export function sameSitePath(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > L.url || !/^\/[^/\\]/.test(raw) || /[\s\u0000-\u001f\u007f\\]/.test(raw)) return false;
  try { return new URL(raw, "https://everloot.app").origin === "https://everloot.app"; } catch { return false; }
}

function step(raw: unknown): ChatStep {
  const s = object(raw, "a tool step");
  if (typeof s.tool !== "string" || !/^[a-z_]{1,64}$/.test(s.tool) || typeof s.input !== "string" || s.input.length > MESSAGE.input
    || typeof s.chars !== "number" || !Number.isSafeInteger(s.chars) || s.chars < 0) {
    return refuse("A tool step is not valid.");
  }
  return { tool: s.tool, input: s.input, chars: s.chars };
}

function message(raw: unknown): ChatMessage {
  const m = object(raw, "each message as an object");
  if (m.role !== "user" && m.role !== "assistant") return refuse("A message is from the player or the assistant.");
  const at = typeof m.at === "string" && m.at.length <= 40 && Number.isFinite(Date.parse(m.at)) ? m.at : refuse("A message time is not valid.");
  const model = m.model === null || m.model === undefined ? null
    : typeof m.model === "string" && MODEL_ID.test(m.model) ? m.model : refuse("A message's model is not valid.");
  if (!Array.isArray(m.steps) || m.steps.length > MESSAGE.steps) return refuse("A message's tool steps are not valid.");
  const out: ChatMessage = {
    role: m.role, text: text(m.text, "message", L.text, { trim: false }), at, model,
    sources: strings(m.sources, "sources in a message", MESSAGE.list, MESSAGE.ref), steps: m.steps.map(step),
  };
  if (m.pages !== undefined) out.pages = strings(m.pages, "pages in a message", MESSAGE.list, MESSAGE.ref);
  if (m.context !== undefined) out.context = text(m.context, "context", L.text, { trim: false });
  if (m.item !== undefined) out.item = itemRef(m.item) ?? refuse("A message's item is not valid.");
  return out;
}

function messages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return refuse("Send the messages as a list.");
  if (raw.length > L.messagesPerConversation) return refuse(`A chat holds at most ${L.messagesPerConversation} messages.`, 413);
  const list = raw.map(message);
  if (new TextEncoder().encode(JSON.stringify(list)).length > L.conversationBytes) return refuse("This chat is larger than 1 MiB.", 413);
  return list;
}

export interface ProjectSave { expectedAccountId: string; expectedRevision: number; project: { id: string; name: string; description: string | null } }
export interface ConversationSave {
  expectedAccountId: string; expectedRevision: number;
  conversation: { id: string; title: string; projectId: string | null; pinned: boolean; messages: ChatMessage[] };
}
export interface EntrySave {
  expectedAccountId: string; expectedRevision: number;
  entry: { id: string; projectId: string | null; kind: WorkspaceEntryKind; title: string; buildId: string | null; href: string | null; text: string | null; sources: string[] };
}
export interface ImportSave { expectedAccountId: string; sourceId: string; legacyId: string; conversation: { title: string; messages: ChatMessage[] } }
export interface DeleteRequest { expectedAccountId: string; expectedRevision: number }

export const parseProjectSave = (raw: unknown): Parsed<ProjectSave> => parsed(() => {
  const body = object(raw, "a project");
  const p = object(body.project, "a project");
  const description = p.description === null || p.description === undefined ? "" : text(p.description, "description", L.description);
  return {
    expectedAccountId: account(body.expectedAccountId), expectedRevision: revision(body.expectedRevision, 0),
    project: { id: id(p.id, "project"), name: text(p.name, "project name", L.title, { min: 1 }), description: description || null },
  };
});

export const parseConversationSave = (raw: unknown): Parsed<ConversationSave> => parsed(() => {
  const body = object(raw, "a chat");
  const c = object(body.conversation, "a chat");
  if (typeof c.pinned !== "boolean") return refuse("Say whether the chat is pinned.");
  return {
    expectedAccountId: account(body.expectedAccountId), expectedRevision: revision(body.expectedRevision, 0),
    conversation: {
      id: id(c.id, "chat"), title: text(c.title, "chat title", L.title, { min: 1 }), projectId: optionalId(c.projectId, "project"),
      pinned: c.pinned, messages: messages(c.messages),
    },
  };
});

export const parseEntrySave = (raw: unknown): Parsed<EntrySave> => parsed(() => {
  const body = object(raw, "a saved entry");
  const e = object(body.entry, "a saved entry");
  const kind = KINDS.find((k) => k === e.kind) ?? refuse("A saved entry is a build, page, answer or note.");
  const none = (value: unknown, what: string) => (value === null || value === undefined ? null : refuse(`A ${kind} has no ${what}.`));
  const buildId = kind === "build" ? id(e.buildId, "build") : none(e.buildId, "build");
  const href = kind === "page" ? (sameSitePath(e.href) ? e.href : refuse("A page is a path on this site.")) : none(e.href, "page link");
  const body_ = kind === "answer" || kind === "note" ? text(e.text, kind, L.text, { min: 1, trim: false }) : none(e.text, "text");
  return {
    expectedAccountId: account(body.expectedAccountId), expectedRevision: revision(body.expectedRevision, 0),
    entry: {
      id: id(e.id, "entry"), projectId: optionalId(e.projectId, "project"), kind,
      title: e.title === null || e.title === undefined ? "" : text(e.title, "title", L.title),
      buildId, href, text: body_, sources: e.sources === undefined ? [] : strings(e.sources, "sources", L.sources, L.source),
    },
  };
});

export const parseImport = (raw: unknown): Parsed<ImportSave> => parsed(() => {
  const body = object(raw, "a browser chat");
  const c = object(body.conversation, "a browser chat");
  const legacyId = typeof body.legacyId === "string" && body.legacyId.length >= 1 && body.legacyId.length <= 200 ? body.legacyId : refuse("Send the chat's local id.");
  return {
    expectedAccountId: account(body.expectedAccountId), sourceId: id(body.sourceId, "browser"), legacyId,
    conversation: { title: text(c.title, "chat title", L.title, { min: 1 }), messages: messages(c.messages) },
  };
});

export const parseDelete = (raw: unknown): Parsed<DeleteRequest> => parsed(() => {
  const body = object(raw, "the account and revision");
  return { expectedAccountId: account(body.expectedAccountId), expectedRevision: revision(body.expectedRevision, 1) };
});

/** The account a request was meant for, read before anything else in it. */
export function expectedAccount(raw: unknown): string | null {
  return raw && typeof raw === "object" ? uuid((raw as Record<string, unknown>).expectedAccountId) : null;
}

// A page cursor is the last row shown: [pinned, updatedAt, id] for chats, [updatedAt, id] for entries.
export type Cursor = [boolean, string, string] | [string, string];

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(raw: string, pinned: true): [boolean, string, string] | null;
export function decodeCursor(raw: string, pinned: false): [string, string] | null;
export function decodeCursor(raw: string, pinned: boolean): Cursor | null {
  if (raw.length > 200) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(raw, "base64url").toString()); } catch { return null; }
  if (!Array.isArray(value) || value.length !== (pinned ? 3 : 2)) return null;
  const rest = pinned ? value.slice(1) : value;
  if (pinned && typeof value[0] !== "boolean") return null;
  const [at, row] = rest;
  if (typeof at !== "string" || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(at) || !Number.isFinite(Date.parse(at)) || !uuid(row)) return null;
  return pinned ? [value[0], at, uuid(row)!] : [at, uuid(row)!];
}
