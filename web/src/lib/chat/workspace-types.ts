import type { Conversation } from "./store";

/**
 * The private Chat workspace as the browser sees it (docs/superpowers/specs/2026-10-25-chat-projects-design.md).
 * Client-safe: types and limits only. Every timestamp is an ISO string; every record carries the revision the
 * next update or delete must name, and revision 0 in a request means "create".
 */

export interface WorkspaceProject { id: string; name: string; description: string | null; revision: number; updatedAt: string }

export interface WorkspaceConversation extends Conversation { projectId: string | null; pinned: boolean; revision: number }

export type WorkspaceConversationSummary = Omit<WorkspaceConversation, "messages">;

export type WorkspaceEntryKind = "build" | "page" | "answer" | "note";

export interface WorkspaceEntry {
  id: string;
  projectId: string | null;
  kind: WorkspaceEntryKind;
  title: string;
  buildId: string | null;
  href: string | null;
  text: string | null;
  sources: string[];
  revision: number;
  updatedAt: string;
}

/** The error code of a 409: the record changed elsewhere since the revision the request named. */
export const REVISION_CONFLICT = "revision_conflict";

/** The reviewed bounds. The server and the database both enforce them; nothing saved is pruned to make room. */
export const WORKSPACE_LIMITS = {
  projects: 100,
  conversations: 500,
  entries: 1000,
  accountBytes: 10 * 1024 * 1024,
  messagesPerConversation: 200,
  conversationBytes: 1024 * 1024,
  text: 20_000,
  title: 100,
  description: 1000,
  url: 2048,
  sources: 20,
  source: 512,
  page: 50,
  mutationsPerDay: 300,
} as const;
