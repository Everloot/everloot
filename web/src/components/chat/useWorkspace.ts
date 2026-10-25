"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listConversations, listProjects, whoAmI, WorkspaceError, type Identity, type Scoped } from "@/lib/chat/workspace-api";
import type { WorkspaceConversationSummary, WorkspaceProject } from "@/lib/chat/workspace-types";

export interface Workspace {
  /** The session's account as /api/auth/me says; null signed out, undefined not known yet. */
  account: Identity | null | undefined;
  projects: WorkspaceProject[];
  /** The first page of the account's chats, newest first: the sidebar's Pinned and Recent. */
  recent: WorkspaceConversationSummary[];
  loaded: boolean;
  error: string;
  /** The current account and a signal that aborts when it changes; null without an account. */
  opts: () => Scoped | null;
  reload: () => void;
  upsert: (s: WorkspaceConversationSummary) => void;
  remove: (id: string) => void;
  setProjects: (update: (list: WorkspaceProject[]) => WorkspaceProject[]) => void;
  /** A failed call's words for the screen; a sign-out or another account reads the session again. */
  failed: (err: unknown) => string;
}

/**
 * The signed-in account's projects and recent chats while EVERLOOT_CHAT_WORKSPACE is on. The account is read again
 * when the tab comes back and whenever a call says it changed; a change aborts everything the old account started,
 * empties what it loaded and calls `onAccountChange` before the new account's records are read.
 */
export function useWorkspace(enabled: boolean, onAccountChange: () => void): Workspace {
  const [account, setAccount] = useState<Identity | null | undefined>(undefined);
  const [projects, setProjectList] = useState<WorkspaceProject[]>([]);
  const [recent, setRecent] = useState<WorkspaceConversationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const current = useRef<Identity | null | undefined>(undefined);
  const ctl = useRef(new AbortController());
  const changed = useRef(onAccountChange);
  changed.current = onAccountChange;

  const check = useCallback(async () => {
    let who: Identity | null;
    try { who = await whoAmI(); } catch {
      // Unknown: keep what is shown; on the first read, act as signed out so the browser's chats still work.
      if (current.current !== undefined) return;
      who = null;
    }
    const before = current.current;
    if (before !== undefined && (before?.id ?? null) === (who?.id ?? null)) return;
    ctl.current.abort();
    ctl.current = new AbortController();
    current.current = who;
    setProjectList([]); setRecent([]); setLoaded(false); setError("");
    if (before !== undefined) changed.current();
    setAccount(who);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const onVisible = () => { if (document.visibilityState !== "hidden") void check(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      ctl.current.abort();
    };
  }, [enabled, check]);

  const opts = useCallback((): Scoped | null => (current.current ? { accountId: current.current.id, signal: ctl.current.signal } : null), []);

  const failed = useCallback((err: unknown): string => {
    if (err instanceof WorkspaceError && (err.code === "account_changed" || err.code === "signed_out")) void check();
    return err instanceof Error ? err.message : String(err);
  }, [check]);

  const reload = useCallback(() => {
    const o = opts();
    if (!o) return;
    Promise.all([listProjects(o), listConversations({}, o)]).then(([p, c]) => {
      if (o.signal.aborted) return;
      setProjectList(p); setRecent(c.items); setLoaded(true); setError("");
    }, (err) => { if (!o.signal.aborted) setError(failed(err)); });
  }, [opts, failed]);

  useEffect(() => { if (account) reload(); }, [account, reload]);

  const upsert = useCallback(({ id, title, updatedAt, projectId, pinned, revision }: WorkspaceConversationSummary) => {
    setRecent((list) => [{ id, title, updatedAt, projectId, pinned, revision }, ...list.filter((c) => c.id !== id)]);
  }, []);
  const remove = useCallback((id: string) => setRecent((list) => list.filter((c) => c.id !== id)), []);

  return { account, projects, recent, loaded, error, opts, reload, upsert, remove, setProjects: setProjectList, failed };
}
