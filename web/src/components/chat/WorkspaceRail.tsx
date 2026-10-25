import { useState } from "react";
import { signInPath } from "@/lib/auth/return-to";
import type { Conversation } from "@/lib/chat/store";
import type { Identity } from "@/lib/chat/workspace-api";
import type { WorkspaceConversationSummary, WorkspaceProject } from "@/lib/chat/workspace-types";

const RECENT = 10;
const heading = "px-2 pt-3 pb-1 text-xs font-semibold text-muted";
const row = (current: boolean) => `min-h-9 min-w-0 flex-1 truncate rounded-control px-2 text-left text-sm ${current ? "bg-panel text-fg" : "text-fg-2 hover:text-fg"}`;

/** A browser chat in the sidebar: the player's own list for this account, or the old shared one. */
export interface LocalChat { conversation: Conversation; store: "browser" | "shared" }

/**
 * Chat's sidebar with the workspace on: New chat, the account's projects, pinned and recent chats, the chats kept
 * in this browser and View all. Signed out it keeps the browser's chats and asks for a sign-in to keep more. A
 * column on desktop; a drawer on a phone, where Escape or a choice closes it.
 */
export default function WorkspaceRail(p: {
  account: Identity | null | undefined;
  projects: WorkspaceProject[];
  recent: WorkspaceConversationSummary[];
  local: LocalChat[];
  currentId: string;
  currentProject: string | null;
  busy: boolean;
  error: string;
  importable: number;
  backups: number;
  onNew: () => void;
  onOpen: (s: WorkspaceConversationSummary) => void;
  onOpenLocal: (c: LocalChat) => void;
  onDeleteLocal: (c: LocalChat) => void;
  onProject: (id: string) => void;
  onCreateProject: (name: string) => Promise<string | null>;
  onViewAll: () => void;
  onImport: () => void;
  onRemoveBackups: () => void;
  onClose: () => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const pinned = p.recent.filter((c) => c.pinned);
  const recent = p.recent.filter((c) => !c.pinned).slice(0, RECENT);

  async function create() {
    const name = (naming ?? "").trim();
    if (!name) return;
    const failed = await p.onCreateProject(name);
    setProblem(failed ?? "");
    if (!failed) setNaming(null);
  }

  const accountRow = (c: WorkspaceConversationSummary) => (
    <li key={c.id} className="flex items-center rounded-control hover:bg-panel">
      <button type="button" disabled={p.busy} aria-current={c.id === p.currentId ? "true" : undefined} className={row(c.id === p.currentId)} onClick={() => p.onOpen(c)}>
        {c.title}
      </button>
    </li>
  );

  return (
    <nav id="chat-rail" aria-label="Conversations"
      className="absolute inset-y-0 left-0 z-10 flex w-72 flex-col border-r border-line bg-canvas lg:static lg:w-64 lg:shrink-0"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); p.onClose(); } }}>
      <div className="flex gap-2 p-3">
        <button type="button" className="btn min-h-9 min-w-0 flex-1 px-3 text-sm" disabled={p.busy} onClick={p.onNew}>New chat</button>
        <button type="button" aria-label="Close conversations" className="btn min-h-9 px-3 text-sm lg:hidden" onClick={p.onClose}>Close</button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {p.account ? (
          <>
            <h2 className={heading}>Projects</h2>
            <ul className="space-y-1">
              {p.projects.map((pr) => (
                <li key={pr.id} className="flex items-center rounded-control hover:bg-panel">
                  <button type="button" disabled={p.busy} aria-current={pr.id === p.currentProject ? "page" : undefined} className={row(pr.id === p.currentProject)} onClick={() => p.onProject(pr.id)}>
                    {pr.name}
                  </button>
                </li>
              ))}
            </ul>
            {naming === null
              ? <button type="button" className="min-h-9 px-2 text-sm text-fg underline decoration-edge underline-offset-4 hover:decoration-fg" disabled={p.busy} onClick={() => { setNaming(""); setProblem(""); }}>New project</button>
              : (
                <form className="space-y-2 px-2 py-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
                  <input aria-label="Project name" autoFocus maxLength={100} value={naming} onChange={(e) => setNaming(e.target.value)}
                    className="min-h-9 w-full rounded-control border border-line bg-panel px-2 text-sm text-fg focus:border-accent focus:outline-none" />
                  <div className="flex gap-2">
                    <button type="submit" className="btn btn-primary min-h-9 px-3 text-sm" disabled={!naming.trim()}>Create project</button>
                    <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setNaming(null)}>Cancel</button>
                  </div>
                </form>
              )}
            {problem && <p role="alert" className="px-2 text-xs text-danger">{problem}</p>}

            {pinned.length > 0 && (
              <>
                <h2 className={heading}>Pinned</h2>
                <ul aria-label="Pinned" className="space-y-1">{pinned.map(accountRow)}</ul>
              </>
            )}
            <h2 className={heading}>Recent</h2>
            {recent.length === 0
              ? <p className="px-2 text-sm text-muted">Chats you start here are kept in your account.</p>
              : <ul aria-label="Recent" className="space-y-1">{recent.map(accountRow)}</ul>}
            {p.error && <p role="alert" className="px-2 pt-2 text-xs text-danger">{p.error}</p>}
          </>
        ) : p.account === null && (
          <p className="px-2 pt-1 text-sm text-muted">
            <a href={signInPath("/chat")} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Sign in</a> to keep chats and projects in your account.
          </p>
        )}

        <h2 className={heading}>This browser</h2>
        {p.local.length === 0
          ? <p className="px-2 text-sm text-muted">No chats kept only in this browser.</p>
          : (
            <ul aria-label="This browser" className="space-y-1">
              {p.local.map((c) => (
                <li key={c.conversation.id} className="flex items-center rounded-control hover:bg-panel">
                  <button type="button" disabled={p.busy} aria-current={c.conversation.id === p.currentId ? "true" : undefined} className={row(c.conversation.id === p.currentId)} onClick={() => p.onOpenLocal(c)}>
                    {c.conversation.title}
                  </button>
                  <button type="button" disabled={p.busy} aria-label={`Delete ${c.conversation.title}`} onClick={() => p.onDeleteLocal(c)}
                    className="min-h-9 shrink-0 px-2 text-sm text-muted hover:text-danger">×</button>
                </li>
              ))}
            </ul>
          )}
        {p.account && p.importable > 0 && (
          <button type="button" className="min-h-9 px-2 text-left text-sm text-fg underline decoration-edge underline-offset-4 hover:decoration-fg" disabled={p.busy} onClick={p.onImport}>
            Import {p.importable} browser chat{p.importable === 1 ? "" : "s"}
          </button>
        )}
        {p.account && p.backups > 0 && (
          <button type="button" className="block min-h-9 px-2 text-left text-sm text-fg-2 underline underline-offset-4" disabled={p.busy} onClick={p.onRemoveBackups}>
            Remove local copies ({p.backups})
          </button>
        )}
      </div>
      {p.account && (
        <div className="border-t border-line p-3">
          <button type="button" className="btn min-h-9 w-full px-3 text-sm" disabled={p.busy} onClick={p.onViewAll}>View all chats</button>
        </div>
      )}
    </nav>
  );
}
