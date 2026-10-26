"use client";

import { useEffect, useRef, useState } from "react";
import {
  clip, deleteConversation, deleteWorkspace, exportWorkspace, listConversations, type Scoped,
} from "@/lib/chat/workspace-api";
import { WORKSPACE_LIMITS, type WorkspaceConversationSummary, type WorkspaceProject } from "@/lib/chat/workspace-types";
import type { LocalChat } from "./WorkspaceRail";

const link = "underline underline-offset-4 hover:text-accent";
const field = "min-h-9 rounded-control border border-line bg-panel px-2 text-sm text-fg focus:border-accent focus:outline-none";
const UNFILED = "";

export type ConversationPatch = Partial<Pick<WorkspaceConversationSummary, "title" | "pinned" | "projectId">>;

/**
 * Every chat under /chat?view=all: the account's, searched by title and filtered by project, with rename, pin, move
 * and delete; then this browser's own. The account's chat data can be downloaded or cleared here; that clears Chat's
 * projects, chats and saved entries only, never the login account or its builds.
 */
export default function ChatLibrary({ projects, local, opts, failed, busy, onBack, onOpen, onOpenLocal, onPatch, onDeleted, onCleared }: {
  projects: WorkspaceProject[];
  local: LocalChat[];
  opts: () => Scoped | null;
  failed: (err: unknown) => string;
  busy: boolean;
  onBack: () => void;
  onOpen: (s: WorkspaceConversationSummary) => void;
  onOpenLocal: (c: LocalChat) => void;
  /** Renames, pins or moves a chat; resolves to its new summary. */
  onPatch: (s: WorkspaceConversationSummary, patch: ConversationPatch) => Promise<WorkspaceConversationSummary>;
  onDeleted: (id: string) => void;
  onCleared: () => void;
}) {
  const [search, setSearch] = useState({ query: "", projectId: UNFILED });
  const [typed, setTyped] = useState("");
  const [rows, setRows] = useState<WorkspaceConversationSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const listing = useRef(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const pagePending = useRef(false);

  useEffect(() => {
    const o = opts();
    if (!o) return;
    const request = ++listing.current;
    const current = () => request === listing.current && !o.signal.aborted;
    setRows(null);
    setCursor(null);
    setLoadingMore(false);
    pagePending.current = false;
    listConversations({ query: search.query, projectId: search.projectId || null }, o).then(
      (r) => { if (current()) { setRows(r.items); setCursor(r.nextCursor); setError(""); } },
      (e) => { if (current()) { setRows([]); setError(failed(e)); } },
    );
    return () => { listing.current = request + 1; };
  }, [search, opts, failed]);

  async function act(work: (o: Scoped) => Promise<void>) {
    const o = opts();
    if (!o) return false;
    setError("");
    try { await work(o); return !o.signal.aborted; } catch (e) { if (!o.signal.aborted) setError(failed(e)); return false; }
  }

  async function loadMore() {
    const o = opts();
    if (!o || pagePending.current || !cursor) return;
    pagePending.current = true;
    const request = listing.current;
    const current = () => request === listing.current && !o.signal.aborted;
    setLoadingMore(true);
    setError("");
    try {
      const r = await listConversations({ ...search, projectId: search.projectId || null, cursor }, o);
      if (current()) { setRows((list) => [...(list ?? []), ...r.items]); setCursor(r.nextCursor); }
    } catch (e) { if (current()) setError(failed(e)); }
    finally { if (current()) { pagePending.current = false; setLoadingMore(false); } }
  }

  /**
   * Reads every page of the account's Chat data and hands the browser one file. Nothing is written to disk
   * unless every page arrived for this account; the file's link is let go as soon as the download starts.
   */
  async function download() {
    const o = opts();
    if (!o || exporting) return;
    setExporting(true);
    setError("");
    try {
      const blob = await exportWorkspace(o);
      if (o.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `everloot-chat-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      if (!o.signal.aborted) setError(`Nothing was downloaded. ${failed(e)}`);
    } finally {
      if (!o.signal.aborted) setExporting(false);
    }
  }

  const replace = (s: WorkspaceConversationSummary) => setRows((list) => (list ?? []).map((r) => (r.id === s.id ? s : r)));
  const patch = (s: WorkspaceConversationSummary, p: ConversationPatch) => act(async () => replace(await onPatch(s, p)));

  const shownLocal = local.filter((c) => c.conversation.title.toLowerCase().includes(search.query.trim().toLowerCase()));
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "Unfiled";

  return (
    <div className="mx-auto w-full max-w-reading space-y-6 px-4 py-6">
      <div className="space-y-2">
        <button type="button" className={`min-h-9 text-sm text-fg-2 ${link}`} onClick={onBack}>Back to chat</button>
        <h2 className="text-2xl font-semibold text-fg">All chats</h2>
        <form role="search" className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setSearch({ ...search, query: typed }); }}>
          <input aria-label="Search chat titles" type="search" maxLength={WORKSPACE_LIMITS.title} className={`${field} flex-1`} value={typed} onChange={(e) => setTyped(e.target.value)} />
          <select aria-label="Project filter" className={field} value={search.projectId} onChange={(e) => setSearch({ query: typed, projectId: e.target.value })}>
            <option value={UNFILED}>All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="submit" className="btn min-h-9 px-3 text-sm">Search</button>
        </form>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>

      <section aria-labelledby="library-account" className="space-y-2">
        <h3 id="library-account" className="text-sm font-semibold text-fg-2">In your account</h3>
        {rows === null ? <p className="text-sm text-muted">Loading…</p> : rows.length === 0 ? <p className="text-sm text-muted">No chats found.</p> : (
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                {renaming?.id === s.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); const edit = renaming; const t = clip(edit.title, WORKSPACE_LIMITS.title); if (t) void patch(s, { title: t }).then((saved) => { if (saved) setRenaming((current) => current === edit ? null : current); }); }}>
                    <input aria-label="New title" autoFocus maxLength={WORKSPACE_LIMITS.title} className={`${field} flex-1`} value={renaming.title} onChange={(e) => setRenaming({ id: s.id, title: e.target.value })} />
                    <button type="submit" className="btn min-h-9 px-3 text-sm">Save title</button>
                    <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" disabled={busy} className={`min-h-9 min-w-0 flex-1 truncate text-left text-fg ${link}`} onClick={() => onOpen(s)}>
                    {s.pinned && <span className="text-accent">Pinned · </span>}{s.title}
                  </button>
                )}
                <span className="text-xs text-muted">{projectName(s.projectId)}</span>
                <button type="button" className={`min-h-9 text-xs ${link}`} aria-label={`Rename ${s.title}`} onClick={() => setRenaming({ id: s.id, title: s.title })}>Rename</button>
                <button type="button" className={`min-h-9 text-xs ${link}`} aria-label={`${s.pinned ? "Unpin" : "Pin"} ${s.title}`} onClick={() => void patch(s, { pinned: !s.pinned })}>{s.pinned ? "Unpin" : "Pin"}</button>
                <select aria-label={`Move ${s.title}`} className={`${field} text-xs`} value={s.projectId ?? UNFILED} onChange={(e) => void patch(s, { projectId: e.target.value || null })}>
                  <option value={UNFILED}>Unfiled</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" disabled={busy} className={`min-h-9 text-xs ${link} hover:text-danger`} aria-label={`Delete ${s.title}`} onClick={() => setDeleting(s.id)}>
                  Delete
                </button>
                {deleting === s.id && (
                  <div role="alertdialog" aria-label={`Delete ${s.title}?`} className="flex w-full flex-wrap items-center gap-2 text-xs">
                    <span className="text-fg">Delete this chat from your account? This cannot be undone.</span>
                    <button type="button" disabled={busy} className="btn btn-primary min-h-9 px-3 text-xs"
                      onClick={() => void act(async (o) => { await deleteConversation(s.id, s.revision, o); setDeleting(null); setRows((list) => (list ?? []).filter((r) => r.id !== s.id)); onDeleted(s.id); })}>
                      Yes, delete
                    </button>
                    <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => setDeleting(null)}>Cancel</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button type="button" className="btn min-h-9 px-3 text-sm" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </section>

      <section aria-labelledby="library-browser" className="space-y-2">
        <h3 id="library-browser" className="text-sm font-semibold text-fg-2">This browser</h3>
        {shownLocal.length === 0 ? <p className="text-sm text-muted">No chats kept only in this browser.</p> : (
          <ul className="divide-y divide-line">
            {shownLocal.map((c) => (
              <li key={c.conversation.id} className="py-2 text-sm">
                <button type="button" disabled={busy} className={`min-h-9 text-left text-fg ${link}`} onClick={() => onOpenLocal(c)}>{c.conversation.title}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="library-data" className="space-y-2 border-t border-line pt-4 text-sm">
        <h3 id="library-data" className="font-semibold text-fg-2">Your chat data</h3>
        <p className="text-fg-2">Projects, chats, notes and saved entries in your account. Chat keys are never part of it.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn min-h-9 px-3 text-sm" disabled={exporting} onClick={() => void download()}>
            {exporting ? "Preparing download…" : "Download my chat data"}
          </button>
          <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setClearing(true)}>Delete my chat workspace</button>
        </div>
        {clearing && (
          <div role="alertdialog" aria-label="Delete my chat workspace" className="space-y-2 rounded-card border border-edge p-3">
            <p className="text-fg">Delete every project, chat, note and saved entry in your account? Your login, builds and characters stay. Chats kept only in this browser stay too.</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary min-h-9 px-3 text-sm"
                onClick={() => void act(async (o) => { await deleteWorkspace(o); setRows([]); setCursor(null); setClearing(false); onCleared(); })}>
                Yes, delete everything in Chat
              </button>
              <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setClearing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
