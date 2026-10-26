"use client";

import { useEffect, useRef, useState } from "react";
import { sourceLink } from "@/lib/chat/agent";
import { newConversationId } from "@/lib/chat/store";
import {
  clip, deleteEntry, deleteProject, listConversations, listEntries, sameSitePath, saveEntry, saveProject,
  WorkspaceError, type EntryInput, type Scoped,
} from "@/lib/chat/workspace-api";
import { WORKSPACE_LIMITS, type WorkspaceConversationSummary, type WorkspaceEntry, type WorkspaceProject } from "@/lib/chat/workspace-types";
import { editPath, type AccountBuilds, type SavedBuild } from "@/lib/saved-builds";
import ItemResult from "./ItemResult";
import PrivateBuildForm from "./PrivateBuildForm";

const link = "underline underline-offset-4 hover:text-accent";
const field = "min-h-9 w-full rounded-control border border-line bg-panel px-2 text-sm text-fg focus:border-accent focus:outline-none";
const section = "space-y-2";
const sub = "text-sm font-semibold text-fg-2";
const ITEM_PAGE = /^\/database\/items\/([1-9]\d{0,9})$/;

/** A note the player chose to send with their next question, shown as a removable chip. */
export interface AttachedNote { title: string; text: string }

function SavedEntry({ e, builds, onDelete, onAttach, onEditBuild }: {
  e: WorkspaceEntry; builds: SavedBuild[] | null; onDelete: () => void; onAttach: () => void; onEditBuild: (b: SavedBuild) => void;
}) {
  const [card, setCard] = useState(false);
  const item = e.href ? ITEM_PAGE.exec(e.href) : null;
  // A build is kept by its id; the account's current code, name and sharing are read live.
  const build = e.kind === "build" ? builds?.find((b) => b.id === e.buildId) ?? null : null;
  return (
    <li className="space-y-1 rounded-card border border-line p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        {e.kind === "page" && e.href && <a href={e.href} className={`${link} text-fg`}>{e.title}</a>}
        {e.kind === "build" && (build
          ? <a href={build.link ?? editPath(build)} className={`${link} text-fg`}>{build.name}</a>
          : (
            <span className="text-muted">
              {builds ? "This build is no longer in your account." : `${e.title}: builds are unavailable right now.`}
            </span>
          ))}
        {(e.kind === "answer" || e.kind === "note") && <span className="font-semibold text-fg">{e.title}</span>}
        <span className="text-xs text-muted">{e.kind === "page" ? e.href : e.kind === "build" ? "Build" : e.kind === "answer" ? "Answer" : "Note"}</span>
      </div>
      {e.text && <p className="whitespace-pre-wrap break-words text-fg-2">{e.text}</p>}
      {e.sources.length > 0 && (
        <p className="text-xs text-fg-2">
          Cited:{" "}
          {e.sources.map((s, i) => {
            const l = sourceLink(s);
            return <span key={i}>{i > 0 && ", "}{l ? <a href={l.href} target="_blank" rel="noopener noreferrer" className={link}>{l.label}</a> : s}</span>;
          })}
        </p>
      )}
      {card && item && <ItemResult item={{ id: Number(item[1]) }} onChoose={() => {}} />}
      <div className="flex flex-wrap gap-x-3 text-xs">
        {item && <button type="button" className={`min-h-9 ${link}`} aria-expanded={card} onClick={() => setCard(!card)}>{card ? "Hide card" : "Show card"}</button>}
        {build && <button type="button" className={`min-h-9 ${link}`} onClick={() => onEditBuild(build)}>Edit build</button>}
        {(e.kind === "note" || e.kind === "answer") && <button type="button" className={`min-h-9 ${link}`} onClick={onAttach}>Use in question</button>}
        <button type="button" className={`min-h-9 ${link} hover:text-danger`} aria-label={`Delete ${e.title}`} onClick={onDelete}>Delete</button>
      </div>
    </li>
  );
}

/**
 * A project's overview under /chat?project=<id>: its Saved pages, builds and answers, its Chats and its Notes, with
 * New chat, rename and remove. Removing a project moves its chats and entries to Unfiled; builds and pages stay.
 */
export default function ProjectView({ project, opts, failed, busy, onBack, onNewChat, onOpenChat, onProject, onRemoved, onAttach }: {
  project: WorkspaceProject;
  opts: () => Scoped | null;
  failed: (err: unknown) => string;
  savedBuilds: boolean;
  busy: boolean;
  onBack: () => void;
  onNewChat: () => void;
  onOpenChat: (s: WorkspaceConversationSummary) => void;
  onProject: (p: WorkspaceProject) => void;
  onRemoved: () => void;
  onAttach: (note: AttachedNote) => void;
}) {
  const [chats, setChats] = useState<WorkspaceConversationSummary[] | null>(null);
  const [chatCursor, setChatCursor] = useState<string | null>(null);
  const [loadingChats, setLoadingChats] = useState(false);
  const chatPagePending = useRef(false);
  const projectRequest = useRef<Scoped | null>(null);
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const entryPagePending = useRef(false);
  const [builds, setBuilds] = useState<SavedBuild[] | null>(null);
  const [buildForm, setBuildForm] = useState<SavedBuild | "new" | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ name: string; description: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState({ title: "", text: "" });
  const [page, setPage] = useState({ href: "", label: "" });

  useEffect(() => {
    const account = opts();
    if (!account) return;
    const ctl = new AbortController();
    const abort = () => ctl.abort();
    account.signal.addEventListener("abort", abort, { once: true });
    if (account.signal.aborted) ctl.abort();
    const o = { ...account, signal: ctl.signal };
    projectRequest.current = o;
    chatPagePending.current = false;
    entryPagePending.current = false;
    setLoadingEntries(false); setMore(null);
    setLoadingChats(false); setChatCursor(null); setError("");
    setChats(null); setEntries(null);
    setBuilds(null); setBuildForm(null);
    listConversations({ projectId: project.id }, o).then((r) => { if (!o.signal.aborted) { setChats(r.items); setChatCursor(r.nextCursor); } }, (e) => { if (!o.signal.aborted) setError(failed(e)); });
    listEntries({ projectId: project.id }, o).then((r) => { if (!o.signal.aborted) { setEntries(r.items); setMore(r.nextCursor); } }, (e) => { if (!o.signal.aborted) setError(failed(e)); });
    fetch("/api/me/chat/builds", { cache: "no-store", signal: o.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Your builds could not be loaded. Try opening this project again.");
        const body = await res.json() as AccountBuilds & { accountId: string };
        if (o.signal.aborted) return;
        if (body.accountId !== o.accountId) throw new WorkspaceError("account_changed", "Your account changed. Reload Chat.");
        setBuilds(body.builds);
      }).catch((e) => { if (!o.signal.aborted) setError(failed(e)); });
    return () => { ctl.abort(); account.signal.removeEventListener("abort", abort); };
  }, [project.id, opts, failed]);

  async function run<T>(work: (o: Scoped) => Promise<T>): Promise<T | null> {
    const o = opts();
    if (!o) return null;
    setError("");
    try { return await work(o); } catch (e) { if (!o.signal.aborted) setError(failed(e)); return null; }
  }

  async function add(entry: Omit<EntryInput, "id" | "projectId">): Promise<boolean> {
    const saved = await run((o) => saveEntry({ id: newConversationId(), projectId: project.id, ...entry }, 0, o));
    if (saved) setEntries((list) => [saved, ...(list ?? [])]);
    return Boolean(saved);
  }

  async function loadMore() {
    const o = projectRequest.current;
    if (!o || o.signal.aborted || !more || entryPagePending.current) return;
    entryPagePending.current = true;
    setLoadingEntries(true); setError("");
    try {
      const r = await listEntries({ projectId: project.id, cursor: more }, o);
      if (o.signal.aborted) return;
      setEntries((list) => [...(list ?? []), ...r.items.filter((e) => !list?.some((old) => old.id === e.id))]);
      setMore(r.nextCursor);
    } catch (e) {
      if (!o.signal.aborted) setError(failed(e));
    } finally {
      if (!o.signal.aborted) { entryPagePending.current = false; setLoadingEntries(false); }
    }
  }

  async function loadMoreChats() {
    const o = projectRequest.current;
    if (!o || o.signal.aborted || !chatCursor || chatPagePending.current) return;
    chatPagePending.current = true;
    setLoadingChats(true); setError("");
    try {
      const r = await listConversations({ projectId: project.id, cursor: chatCursor }, o);
      if (o.signal.aborted) return;
      setChats((list) => [...(list ?? []), ...r.items.filter((c) => !list?.some((old) => old.id === c.id))]);
      setChatCursor(r.nextCursor);
    } catch (e) {
      if (!o.signal.aborted) setError(failed(e));
    } finally {
      if (!o.signal.aborted) { chatPagePending.current = false; setLoadingChats(false); }
    }
  }

  async function rename() {
    if (!editing?.name.trim()) return;
    const saved = await run((o) => saveProject({ id: project.id, name: clip(editing.name, WORKSPACE_LIMITS.title), description: editing.description.trim() || null }, project.revision, o));
    if (saved) { onProject(saved); setEditing(null); }
  }

  async function remove() {
    if (await run((o) => deleteProject(project.id, project.revision, o))) onRemoved();
  }

  async function addNote() {
    const text = note.text.trim();
    if (!text) return;
    if (await add({ kind: "note", title: clip(note.title || text, WORKSPACE_LIMITS.title), buildId: null, href: null, text: text.slice(0, WORKSPACE_LIMITS.text), sources: [] })) setNote({ title: "", text: "" });
  }

  async function addPage() {
    const href = sameSitePath(page.href);
    if (!href) { setError("Only Everloot pages can be saved, as a link like /database/items/2589."); return; }
    if (await add({ kind: "page", title: clip(page.label || href, WORKSPACE_LIMITS.title), buildId: null, href, text: null, sources: [] })) setPage({ href: "", label: "" });
  }

  async function addBuild(b: SavedBuild) {
    return add({ kind: "build", title: clip(b.name, WORKSPACE_LIMITS.title), buildId: b.id, href: null, text: null, sources: [] });
  }

  async function buildSaved(b: SavedBuild) {
    const created = buildForm === "new";
    setBuilds((list) => [b, ...(list ?? []).filter((x) => x.id !== b.id)]);
    setBuildForm(null);
    if (created && !await addBuild(b)) {
      setError((message) => `The build was saved privately, but its project reference was not confirmed. Choose it from Add a build to try again. ${message}`);
    }
  }

  async function removeEntry(e: WorkspaceEntry) {
    if (await run((o) => deleteEntry(e.id, e.revision, o))) setEntries((list) => (list ?? []).filter((x) => x.id !== e.id));
  }

  const saved = entries?.filter((e) => e.kind !== "note") ?? [];
  const notes = entries?.filter((e) => e.kind === "note") ?? [];
  const entry = (e: WorkspaceEntry) => (
    <SavedEntry key={e.id} e={e} builds={builds} onDelete={() => void removeEntry(e)}
      onAttach={() => onAttach({ title: e.title, text: e.text ?? "" })} onEditBuild={setBuildForm} />
  );

  return (
    <div className="mx-auto w-full max-w-reading space-y-6 px-4 py-6">
      <div className="space-y-2">
        <button type="button" className={`min-h-9 text-sm text-fg-2 ${link}`} onClick={onBack}>Back to chat</button>
        <h2 className="text-2xl font-semibold text-fg">{project.name}</h2>
        {project.description && <p className="text-fg-2">{project.description}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" disabled={busy} onClick={onNewChat}>New chat in this project</button>
          <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setEditing({ name: project.name, description: project.description ?? "" })}>Rename project</button>
          <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setRemoving(true)}>Remove project</button>
        </div>
        {editing && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <input aria-label="Project name" maxLength={WORKSPACE_LIMITS.title} className={field} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <textarea aria-label="Description" maxLength={WORKSPACE_LIMITS.description} rows={2} className={field} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary min-h-9 px-3 text-sm" disabled={!editing.name.trim()}>Save project</button>
              <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        )}
        {removing && (
          <div role="alertdialog" aria-label="Remove project" className="space-y-2 rounded-card border border-edge p-3 text-sm">
            <p className="text-fg">Remove {project.name}? Its chats and saved items move to Unfiled. Builds and pages are not deleted.</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" onClick={() => void remove()}>Yes, remove</button>
              <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setRemoving(false)}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>

      <section aria-labelledby="project-saved" className={section}>
        <h3 id="project-saved" className={sub}>Saved</h3>
        {entries === null ? <p className="text-sm text-muted">Loading…</p> : saved.length === 0
          ? <p className="text-sm text-muted">Nothing saved yet. Use Save to project under an answer or an item, or add a page or build here.</p>
          : <ul className="space-y-2">{saved.map(entry)}</ul>}
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void addPage(); }}>
          <input aria-label="Page link" placeholder="/database/items/2589" maxLength={WORKSPACE_LIMITS.url} className={`${field} flex-1`} value={page.href} onChange={(e) => setPage({ ...page, href: e.target.value })} />
          <input aria-label="Label (optional)" maxLength={WORKSPACE_LIMITS.title} className={`${field} flex-1`} value={page.label} onChange={(e) => setPage({ ...page, label: e.target.value })} />
          <button type="submit" className="btn min-h-9 px-3 text-sm" disabled={!page.href.trim()}>Save page</button>
        </form>
        <button type="button" className="btn min-h-9 px-3 text-sm" disabled={busy} onClick={() => setBuildForm("new")}>New private build</button>
        {buildForm && opts() && <PrivateBuildForm accountId={opts()!.accountId} build={buildForm === "new" ? undefined : buildForm}
          onSaved={(b) => void buildSaved(b)} onCancel={() => setBuildForm(null)} />}
        {builds && builds.length > 0 && (
          <select aria-label="Add a build" className={field} value="" onChange={(e) => { const b = builds.find((x) => x.id === e.target.value); if (b) void addBuild(b); }}>
            <option value="">Add a build from your account</option>
            {builds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </section>

      <section aria-labelledby="project-chats" className={section}>
        <h3 id="project-chats" className={sub}>Chats</h3>
        {chats === null ? <p className="text-sm text-muted">Loading…</p> : chats.length === 0
          ? <p className="text-sm text-muted">No chats in this project yet.</p>
          : (
            <ul className="space-y-1">
              {chats.map((c) => <li key={c.id}><button type="button" disabled={busy} className={`min-h-9 text-left text-sm text-fg ${link}`} onClick={() => onOpenChat(c)}>{c.title}</button></li>)}
            </ul>
          )}
        {chatCursor && <button type="button" className="btn min-h-9 px-3 text-sm" disabled={loadingChats || busy} onClick={() => void loadMoreChats()}>{loadingChats ? "Loading chats..." : "Load more chats"}</button>}
      </section>

      <section aria-labelledby="project-notes" className={section}>
        <h3 id="project-notes" className={sub}>Notes</h3>
        {notes.length > 0 && <ul className="space-y-2">{notes.map(entry)}</ul>}
        <p className="text-xs text-muted">Notes are not sent to a model unless you choose Use in question.</p>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void addNote(); }}>
          <input aria-label="Note title" maxLength={WORKSPACE_LIMITS.title} className={field} value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} />
          <textarea aria-label="Note" rows={3} maxLength={WORKSPACE_LIMITS.text} className={field} value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} />
          <button type="submit" className="btn min-h-9 px-3 text-sm" disabled={!note.text.trim()}>Add note</button>
        </form>
      </section>
      {more && <button type="button" className="btn min-h-9 px-3 text-sm" disabled={loadingEntries} onClick={() => void loadMore()}>{loadingEntries ? "Loading saved items..." : "Load more saved items"}</button>}
    </div>
  );
}
