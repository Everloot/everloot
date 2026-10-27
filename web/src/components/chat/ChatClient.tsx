"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountShell, ShellCharacter } from "@/lib/account-shell-types";
import { signInPath } from "@/lib/auth/return-to";
import { answer, answerFree, FREE_TOOLS, loadTools, marketReply, searchOnly, signedIn, type ChatProgress, type ToolDef } from "@/lib/chat/agent";
import { ITEM_FOUND, itemQuery, resolveItem, type ItemRef } from "@/lib/chat/items";
import { chatProvider } from "@/lib/chat/providers";
import { providerStorage } from "@/lib/chat/provider-session";
import {
  deleteConversation, keyReady, loadConversations, loadProviders, newConversationId, pickModel, saveConversation, titleFor,
  type ChatMessage, type Conversation, type SavedProvider,
} from "@/lib/chat/store";
import * as api from "@/lib/chat/workspace-api";
import { browserChats, importBrowserChats, removeBackups, scoped } from "@/lib/chat/workspace-local";
import { WORKSPACE_LIMITS, type WorkspaceConversation, type WorkspaceConversationSummary, type WorkspaceProject } from "@/lib/chat/workspace-types";
import { crossesDocumentBoundary } from "@/lib/document-boundary";
import { askPrefill, validCharacterId } from "@/lib/profiles";
import type { AccountBuilds, SavedBuild } from "@/lib/saved-builds";
import ChatLibrary, { type ConversationPatch } from "./ChatLibrary";
import Composer from "./Composer";
import ConversationRail from "./ConversationRail";
import { AssistantMessage, UserMessage } from "./Message";
import ProjectView, { type AttachedNote } from "./ProjectView";
import SaveToProject, { type SaveRequest } from "./SaveToProject";
import { useWorkspace } from "./useWorkspace";
import WorkspaceRail, { type LocalChat } from "./WorkspaceRail";

export const SUGGESTIONS = ["Where does Linen Cloth drop?", "Plan a level 40 Fury warrior", "What changed in the last build?", "What sells best on my realm?"];
export const KEYS_PATH = "/account#chat-keys";

interface Characters { characters: ShellCharacter[]; builds: SavedBuild[] }

/** The signed-in player's characters (and saved builds when that switch is on), for the context chip. */
async function fetchCharacters(savedBuilds: boolean, profiles: boolean): Promise<Characters> {
  try {
    if (savedBuilds) {
      const res = await fetch("/api/me/builds", { cache: "no-store" });
      if (res.ok) {
        const own = (await res.json()) as AccountBuilds;
        return { characters: own.characters.map(({ id, name, classSlug, realm }) => ({ id, name, classSlug, realm })), builds: own.builds };
      }
    }
    if (profiles) {
      const res = await fetch("/api/me/shell", { cache: "no-store" });
      if (res.ok) return { characters: ((await res.json()) as AccountShell).characters, builds: [] };
    }
  } catch { /* offline: no characters to offer */ }
  return { characters: [], builds: [] };
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where the open chat is kept: the account, this account's browser list, or the browser's old shared list. */
interface Meta { store: "account" | "browser" | "shared"; accountId: string | null; projectId: string | null; pinned: boolean; revision: number; title: string }
/** `full`: the chat is over a limit, so Retry would fail the same way. */
type SaveState = { state: "idle" | "saving" | "saved" | "conflict" } | { state: "failed"; message: string; full?: boolean };
/** An account chat's save that has not landed: what was sent, held in this tab's memory only, until it lands or the account changes. */
interface Unsaved { input: api.ConversationInput; state: SaveState; seq: number }
/** The workspace screen in the URL: /chat?view=all or /chat?project=<id>; the conversation otherwise. */
type View = { kind: "all" } | { kind: "project"; id: string } | null;
type Pending = { kind: "import" } | { kind: "backups" } | null;

const shared = (): Meta => ({ store: "shared", accountId: null, projectId: null, pinned: false, revision: 0, title: "" });
const MAX_NOTE = 4000;

function viewIn(search: string): View {
  const q = new URLSearchParams(search);
  const project = q.get("project");
  if (project && /^[0-9a-f-]{36}$/i.test(project)) return { kind: "project", id: project };
  return q.get("view") === "all" ? { kind: "all" } : null;
}

/**
 * The /chat conversation: a full-screen thread, one composer, and the conversation list.
 * `savedBuilds` (EVERLOOT_SAVED_BUILDS) offers my_builds to a signed-in visitor's model; `profiles`
 * (EVERLOOT_PROFILES) offers the account's characters as context. Keys are set up on /account#chat-keys.
 * `workspace` (EVERLOOT_CHAT_WORKSPACE) adds private account projects and chats; without it chats stay in the browser.
 * `freeChat` (EVERLOOT_FREE_CHAT_KEY) names the provider of Everloot (free), the built-in model a visitor without a
 * key of their own gets by default; null while it is off. A key the player added always comes first.
 */
export default function ChatClient({ savedBuilds = false, profiles = false, workspace = false, freeChat = null }: {
  savedBuilds?: boolean; profiles?: boolean; workspace?: boolean; freeChat?: string | null;
}) {
  const [providers, setProviders] = useState<SavedProvider[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<ChatProgress | null>(null);
  const [error, setError] = useState("");
  const [signed, setSigned] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [own, setOwn] = useState<Characters>({ characters: [], builds: [] });
  const [context, setContext] = useState<ShellCharacter | null>(null);
  // The workspace's own state; unused while it is off.
  const [meta, setMetaState] = useState<Meta>(shared);
  const [save, setSaveState] = useState<SaveState>({ state: "idle" });
  const [view, setViewState] = useState<View>(null);
  const [note, setNote] = useState<AttachedNote | null>(null);
  const [saving, setSaving] = useState<SaveRequest | null>(null);
  const [local, setLocal] = useState<{ mine: Conversation[]; unbound: Conversation[]; backups: Conversation[] }>({ mine: [], unbound: [], backups: [] });
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Unsaved[]>([]);
  const [full, setFull] = useState(false);
  // Without a key: the free model when it is on, or Everloot search.
  const [mode, setMode] = useState<"free" | "search">(freeChat ? "free" : "search");

  const tools = useRef<ToolDef[] | null>(null);
  const freeTools = useRef<ToolDef[] | null>(null);
  const stop = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const railToggle = useRef<HTMLButtonElement>(null);
  const stick = useRef(true);
  const prefilled = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const charactersOnce = useRef<Promise<Characters> | null>(null);
  const metaRef = useRef<Meta>(meta);
  const saveRef = useRef<SaveState>(save);
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  const opening = useRef(0);
  // Account chats' saves: the last revision each record was read or saved at, and those not landed yet.
  const revisions = useRef(new Map<string, number>());
  const unsaved = useRef(new Map<string, Unsaved>());
  const seq = useRef(0);
  const generation = useRef(0);
  // What ask() and the shortcuts read, current at every render even from an older closure.
  const latest = useRef({ providers, signed, context, own, busy, currentId, note, mode, known: !workspace });
  latest.current = { providers, signed, context, own, busy, currentId, note, mode, known: latest.current.known };

  const setMeta = (m: Meta) => { metaRef.current = m; setMetaState(m); };
  const setSave = (s: SaveState) => { saveRef.current = s; setSaveState(s); };
  const syncDrafts = () => setDrafts([...unsaved.current.values()].filter((u) => u.state.state === "failed" || u.state.state === "conflict"));

  /** Everything the departing account loaded or started goes before the next account's records are read. */
  function forgetAccount() {
    stop.current?.abort();
    opening.current++;
    generation.current++;
    saves.current = Promise.resolve();
    revisions.current.clear();
    unsaved.current.clear();
    setDrafts([]); setFull(false);
    const id = newConversationId();
    latest.current.currentId = id;
    setCurrentId(id);
    messagesRef.current = [];
    setMessages([]);
    setMeta(shared());
    setSave({ state: "idle" });
    setDraft(""); setError(""); setNotice(""); setNote(null); setSaving(null); setPending(null); setContext(null);
    setLocal({ mine: [], unbound: [], backups: [] });
    charactersOnce.current = null;
    tools.current = null;
    setOwn({ characters: [], builds: [] });
  }

  const ws = useWorkspace(workspace, forgetAccount);
  const accountId = workspace ? ws.account?.id ?? null : null;
  // Until the session's account is known nothing is sent or kept: a chat could land in the wrong place.
  latest.current.known = !workspace || ws.account !== undefined;

  // Unsaved account chats live only in this tab; leaving the page asks first.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (unsaved.current.size) e.preventDefault(); };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  // localStorage only exists in the browser; read it after the first render. A new chat opens each visit.
  // Not in a document that came with a public page's policy: DocumentBoundary reloads it first.
  useEffect(() => {
    if (crossesDocumentBoundary(window.location.pathname)) return;
    try { setProviders(loadProviders(providerStorage())); }
    catch { setError("Chat keys could not move to this tab. Allow browser storage and reload before saving a key."); }
    if (!workspace) setConversations(loadConversations(localStorage));
    const id = newConversationId();
    latest.current.currentId = id;
    setCurrentId(id);
    setRailOpen(typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the switch is fixed for the page's life
  }, []);

  useEffect(() => {
    if (workspace) return;
    let cancelled = false;
    void signedIn().then((s) => { if (!cancelled) setSigned(s); });
    return () => { cancelled = true; };
  }, [workspace]);

  // With the workspace on, the session's account decides: signed in or not, whose browser chats, where a new chat goes.
  useEffect(() => {
    if (!workspace || ws.account === undefined || !ready) return;
    setSigned(ws.account !== null);
    refreshLocal();
    if (messagesRef.current.length === 0 && metaRef.current.revision === 0) setMeta(freshMeta(null, "account"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the account is known or changes
  }, [workspace, ws.account, ready]);

  // The screen named in the URL, and Back and Forward between them.
  useEffect(() => {
    if (!workspace) return;
    setViewState(viewIn(window.location.search));
    const onPop = () => setViewState(viewIn(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [workspace]);

  function setView(next: View) {
    setViewState(next);
    const q = next?.kind === "all" ? "?view=all" : next?.kind === "project" ? `?project=${next.id}` : "";
    window.history.pushState(window.history.state, "", `${window.location.pathname}${q}`);
    // On a phone the sidebar closes over the new screen; focus goes back to the button that opens it.
    if (narrow()) { setRailOpen(false); railToggle.current?.focus(); }
  }

  const characters = () => (charactersOnce.current ??= fetchCharacters(savedBuilds, profiles));
  useEffect(() => {
    if (signed !== true || !(savedBuilds || profiles)) return;
    let cancelled = false;
    void characters().then((c) => { if (!cancelled) setOwn(c); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `characters` is memoised in a ref
  }, [signed, savedBuilds, profiles, accountId]);

  // From the home's Ask box: /chat?q=<question>&character=<id>. The character becomes the context chip. With a key
  // ready, or the free model on, the question is sent at once; otherwise it waits in the box. The URL drops both so a reload does not resend.
  useEffect(() => {
    if (!ready || signed === null || prefilled.current) return;
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") ?? "").trim().slice(0, 2000);
    const characterId = params.get("character");
    if (!q && !characterId) return;
    prefilled.current = true;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    void (async () => {
      let character: ShellCharacter | null = null;
      if (signed && validCharacterId(characterId) && (savedBuilds || profiles)) {
        character = (await characters()).characters.find((c) => c.id === characterId) ?? null;
        setContext(character);
      }
      if (q && (keyReady(latest.current.providers) || freeChat)) void ask(q, character);
      else { setDraft(q); box.current?.focus(); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when storage and the session are known
  }, [ready, signed]);

  // Keep the newest text in view while the reader is at the bottom; leave them be when they scrolled up.
  useEffect(() => {
    const t = thread.current;
    if (t && stick.current) t.scrollTop = t.scrollHeight;
  }, [messages, live]);

  /** The browser lists the current account may see: its own, and the old shared ones nobody imported. */
  function refreshLocal(id: string | null = accountIdNow()) {
    const old = browserChats(localStorage, id);
    setLocal({ mine: id ? loadConversations(scoped(localStorage, id)) : [], ...old });
  }
  function accountIdNow() { return ws.opts()?.accountId ?? null; }

  /** Where a new chat goes: a project's chat and, by default, a signed-in player's chat go to the account. */
  function freshMeta(projectId: string | null, choice: "account" | "browser"): Meta {
    const id = accountIdNow();
    if (!workspace || !id) return shared();
    const store = projectId || choice === "account" ? "account" : "browser";
    return { store, accountId: id, projectId, pinned: false, revision: 0, title: "" };
  }

  function commit(id: string, next: ChatMessage[]) {
    if (!workspace) {
      messagesRef.current = next;
      setMessages(next);
      setConversations(saveConversation(localStorage, { id, title: "", updatedAt: new Date().toISOString(), messages: next }));
      return;
    }
    // An answer that finishes after the player left its chat (or its account) writes nothing.
    if (id !== latest.current.currentId) return;
    messagesRef.current = next;
    setMessages(next);
    const m = metaRef.current;
    const at = new Date().toISOString();
    if (m.store === "shared") { saveConversation(localStorage, { id, title: "", updatedAt: at, messages: next }); refreshLocal(); return; }
    if (m.accountId !== accountIdNow()) return;
    if (m.store === "browser") { saveConversation(scoped(localStorage, m.accountId!), { id, title: "", updatedAt: at, messages: next }); refreshLocal(); return; }
    // A chat in conflict keeps its text here, and in its unsaved copy, until the player picks what to do.
    if (saveRef.current.state !== "conflict") persist();
    else { const u = unsaved.current.get(id); if (u) u.input = { ...u.input, messages: next }; }
  }

  /** Saves run one at a time, in the order they were asked for, whichever chat is open by then. */
  function queue<T>(work: () => Promise<T>): Promise<T> {
    const run = saves.current.then(work);
    saves.current = run.catch(() => undefined);
    return run;
  }

  /**
   * Saves one account chat as it was when asked (its messages, title, project and pin), naming the revision the
   * record was last read or saved at when its turn in the queue comes. Until it lands, the chat stays in
   * `unsaved`: a failure or conflict keeps it there to reopen, even after the player moved on; nothing retries alone.
   */
  function send(input: api.ConversationInput, owner: string): Promise<WorkspaceConversation> {
    const gen = generation.current;
    const n = ++seq.current;
    unsaved.current.set(input.id, { input, state: { state: "saving" }, seq: n });
    if (input.id === latest.current.currentId) setSave({ state: "saving" });
    const mine = () => unsaved.current.get(input.id)?.seq === n;
    return queue(async () => {
      const o = ws.opts();
      if (gen !== generation.current || !o || o.accountId !== owner) throw new api.WorkspaceError("account_changed", "You are signed in as someone else now.");
      try {
        const saved = await api.saveConversation(input, revisions.current.get(input.id) ?? 0, o);
        if (o.signal.aborted || gen !== generation.current) throw new api.WorkspaceError("account_changed", "You are signed in as someone else now.");
        revisions.current.set(saved.id, saved.revision);
        const last = mine();
        if (last) unsaved.current.delete(saved.id);
        ws.upsert(saved);
        if (saved.id === latest.current.currentId && metaRef.current.store === "account") {
          setMeta({ ...metaRef.current, revision: saved.revision, title: metaRef.current.title || saved.title });
          if (last) setSave({ state: "saved" });
        }
        syncDrafts();
        return saved;
      } catch (err) {
        if (o.signal.aborted || gen !== generation.current) throw err;
        const message = ws.failed(err);
        const code = err instanceof api.WorkspaceError ? err.code : null;
        const state: SaveState = code === "conflict" ? { state: "conflict" } : { state: "failed", message, full: code === "too_large" };
        if (mine()) {
          unsaved.current.get(input.id)!.state = state;
          if (input.id === latest.current.currentId) setSave(state);
        }
        syncDrafts();
        throw err;
      }
    });
  }

  /** The open account chat as shown, for a save. */
  function shown(): api.ConversationInput {
    const m = metaRef.current;
    const list = messagesRef.current;
    return { id: latest.current.currentId, title: m.title || api.clip(titleFor(list), WORKSPACE_LIMITS.title), projectId: m.projectId, pinned: m.pinned, messages: list };
  }

  function persist() {
    const m = metaRef.current;
    if (m.store !== "account" || !m.accountId) return;
    if (!messagesRef.current.length) { setSave({ state: "idle" }); return; }
    void send(shown(), m.accountId).catch(() => { /* said on the save line, or kept in Not saved */ });
  }

  /** The chat as saved elsewhere replaces what is shown here; offered only after a conflict, by choice. */
  async function loadNewer() {
    const o = ws.opts();
    if (!o || latest.current.busy) return;
    const id = latest.current.currentId;
    const token = ++opening.current;
    const here = () => !o.signal.aborted && token === opening.current && id === latest.current.currentId && !latest.current.busy;
    try {
      const c = await api.getConversation(id, o);
      if (!here()) return;
      unsaved.current.delete(id);
      syncDrafts();
      showAccountChat(c, o.accountId);
    } catch (err) { if (here()) setSave({ state: "failed", message: ws.failed(err) }); }
  }

  /** What is shown here becomes a new chat of its own, leaving the other device's version as it is. */
  function saveCopy() {
    unsaved.current.delete(latest.current.currentId);
    syncDrafts();
    const id = newConversationId();
    latest.current.currentId = id;
    setCurrentId(id);
    const m = metaRef.current;
    setMeta({ ...m, revision: 0, pinned: false, title: api.clip(`Copy of ${m.title || titleFor(messagesRef.current)}`, WORKSPACE_LIMITS.title) });
    setSave({ state: "idle" });
    persist();
  }

  function showAccountChat(c: WorkspaceConversation, owner: string) {
    if (latest.current.busy) return;
    revisions.current.set(c.id, c.revision);
    setMeta({ store: "account", accountId: owner, projectId: c.projectId, pinned: c.pinned, revision: c.revision, title: c.title });
    open(c.id, c.messages);
    setSave({ state: "saved" });
  }

  /** An account chat whose save has not landed, as this tab last had it. */
  function openUnsaved(u: Unsaved) {
    const owner = accountIdNow();
    if (latest.current.busy || !owner) return;
    opening.current++;
    const { input } = u;
    setMeta({ store: "account", accountId: owner, projectId: input.projectId, pinned: input.pinned, revision: revisions.current.get(input.id) ?? 0, title: input.title });
    if (view) setView(null);
    open(input.id, input.messages);
    setSave(u.state);
  }

  async function openAccountChat(s: WorkspaceConversationSummary) {
    if (latest.current.busy) return;
    const o = ws.opts();
    if (!o) return;
    // This tab's copy is newer than the account's until its save lands.
    const u = unsaved.current.get(s.id);
    if (u) { openUnsaved(u); return; }
    const token = ++opening.current;
    setError("");
    try {
      const c = await api.getConversation(s.id, o);
      if (o.signal.aborted || token !== opening.current || latest.current.busy) return;
      if (view) setView(null);
      showAccountChat(c, o.accountId);
    } catch (err) {
      if (!o.signal.aborted && token === opening.current) setError(ws.failed(err));
    }
  }

  function openLocal(c: LocalChat) {
    const id = accountIdNow();
    setMeta(c.store === "browser" && id ? { ...shared(), store: "browser", accountId: id } : shared());
    setSave({ state: "idle" });
    if (view) setView(null);
    open(c.conversation.id, c.conversation.messages);
  }

  function deleteLocal(c: LocalChat) {
    const id = accountIdNow();
    if (c.store === "browser" && id) deleteConversation(scoped(localStorage, id), c.conversation.id);
    else deleteConversation(localStorage, c.conversation.id);
    refreshLocal();
    if (c.conversation.id === currentId) newChat();
  }

  async function ask(question: string, character: ShellCharacter | null = latest.current.context) {
    const q = question.trim().slice(0, 2000);
    if (!q || latest.current.busy || !latest.current.known) return;
    opening.current++;
    const { providers: saved, own: mine, currentId: id, note: attached } = latest.current;
    const prior = messagesRef.current;
    if (workspace && metaRef.current.store === "account" && prior.length + 2 > WORKSPACE_LIMITS.messagesPerConversation) {
      setError(`This chat is full: it holds ${WORKSPACE_LIMITS.messagesPerConversation} messages. Start a new chat to go on; this one stays as it is.`);
      setFull(true);
      return;
    }
    const builds = character ? mine.builds.filter((b) => b.characterId === character.id) : [];
    // The character stays with the turn, so later turns still know it. The note goes with this question only:
    // the project keeps it, and the chat's history never carries a copy.
    const contextLine = character ? askPrefill("", character, builds) : "";
    const noteLine = attached ? `My note "${attached.title}":\n${attached.text.slice(0, MAX_NOTE)}` : "";
    const history = prior.map((m) => ({ role: m.role, text: m.context ? `${m.text}\n\n${m.context}` : m.text }));
    const asked: ChatMessage[] = [...prior, { role: "user", text: q, ...(contextLine ? { context: contextLine } : {}), at: new Date().toISOString(), model: null, sources: [], pages: [], steps: [] }];
    commit(id, asked);
    setDraft(""); setBusy(true); setError(""); setLive(null);
    if (attached) setNote(null);
    latest.current.busy = true;
    stick.current = true;
    requestAnimationFrame(() => thread.current?.scrollTo?.({ top: thread.current.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" }));
    const ctl = new AbortController();
    stop.current = ctl;
    try {
      const active = saved[0];
      // A price question is answered from the recorded market before anything else, with or without a key.
      const priced = await marketReply(q, { signal: ctl.signal });
      // An item question also finds its item, for the card under the answer; the model is never told of it.
      const name = priced ? null : itemQuery(q);
      let r;
      let item: ItemRef | null = null;
      if (priced) {
        r = priced;
      } else if (!active && !(freeChat && latest.current.mode === "free")) {
        item = name ? await resolveItem(name, ctl.signal) : null;
        r = item && "id" in item ? { text: ITEM_FOUND, model: null, sources: [], pages: [], steps: [] } : await searchOnly(q);
      } else if (!active) {
        // Everloot (free): the same loop through this site's proxy. It never gets my_builds, which reads the account.
        const lookup = name ? resolveItem(name, ctl.signal).catch(() => null) : Promise.resolve(null);
        freeTools.current ??= await loadTools(fetch, false, FREE_TOOLS);
        r = await answerFree({
          history, question: [q, contextLine, noteLine].filter(Boolean).join("\n\n"), tools: freeTools.current, onProgress: setLive, signal: ctl.signal,
        }, q);
        item = await lookup;
      } else {
        const lookup = name ? resolveItem(name, ctl.signal).catch(() => null) : Promise.resolve(null);
        tools.current ??= await loadTools(fetch, savedBuilds && latest.current.signed === true);
        r = await answer({
          provider: chatProvider(active.kind)!, model: active.model, key: active.key, history,
          question: [q, contextLine, noteLine].filter(Boolean).join("\n\n"), tools: tools.current, onProgress: setLive, signal: ctl.signal,
        });
        item = await lookup;
      }
      ctl.signal.throwIfAborted();
      commit(id, [...asked, { role: "assistant", text: r.text, at: new Date().toISOString(), model: r.model, sources: r.sources, pages: r.pages, steps: r.steps, ...(item ? { item } : {}) }]);
    } catch (err) {
      if (id === latest.current.currentId) setError(ctl.signal.aborted ? "Stopped." : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false); setLive(null); stop.current = null;
      latest.current.busy = false;
      box.current?.focus();
    }
  }

  // An answer the player leaves behind is stopped, so it writes nothing after the page is gone.
  useEffect(() => () => stop.current?.abort(), []);

  /** The item picked from an answer's choices replaces them, kept by id like any other. */
  function choose(i: number, item: number) {
    if (latest.current.busy) return;
    commit(latest.current.currentId, messagesRef.current.map((m, j) => (j === i
      ? { ...m, ...(!m.model ? { text: ITEM_FOUND, sources: [], pages: [], steps: [] } : {}), item: { id: item } }
      : m)));
  }

  const narrow = () => typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 1024px)").matches;

  function open(id: string, list: ChatMessage[]) {
    if (latest.current.busy) return;
    latest.current.currentId = id;
    setCurrentId(id);
    messagesRef.current = list;
    setMessages(list);
    setError(""); setDraft(""); setFull(false);
    stick.current = true;
    if (narrow()) setRailOpen(false);
    box.current?.focus();
  }

  function newChat(projectId: string | null = null) {
    if (latest.current.busy) return;
    if (workspace) {
      opening.current++;
      setMeta(freshMeta(projectId, "account"));
      setSave({ state: "idle" });
      if (view) setView(null);
    }
    open(newConversationId(), []);
  }

  function onDelete(c: Conversation) {
    setConversations(deleteConversation(localStorage, c.id));
    if (c.id === currentId) newChat();
  }

  async function copy(i: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* the browser refused; nothing to undo */ }
  }

  async function createProject(name: string): Promise<string | null> {
    const o = ws.opts();
    if (!o) return "Sign in to create projects.";
    try {
      const p = await api.saveProject({ id: newConversationId(), name: api.clip(name, WORKSPACE_LIMITS.title), description: null }, 0, o);
      if (o.signal.aborted) return null;
      ws.setProjects((list) => [...list, p]);
      setView({ kind: "project", id: p.id });
      return null;
    } catch (err) { return ws.failed(err); }
  }

  const putProject = (p: WorkspaceProject) => ws.setProjects((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]));

  /**
   * Renames, pins or moves an account chat, in the same queue as its turns' saves. The open one, and one this tab
   * still holds unsaved, are saved with what this tab has; any other is read and saved back with the change.
   */
  async function patchChat(s: WorkspaceConversationSummary, patch: ConversationPatch): Promise<WorkspaceConversationSummary> {
    const o = ws.opts();
    if (!o) throw new api.WorkspaceError("signed_out", "Sign in again to change your chats.");
    const summary = ({ messages: _m, ...rest }: WorkspaceConversation) => rest;
    if (s.id === latest.current.currentId && metaRef.current.store === "account") {
      setMeta({ ...metaRef.current, ...patch });
      return summary(await send(shown(), o.accountId));
    }
    const u = unsaved.current.get(s.id);
    if (u) return summary(await send({ ...u.input, ...patch }, o.accountId));
    return queue(async () => {
      const c = await api.getConversation(s.id, o);
      const saved = await api.saveConversation({ id: c.id, title: c.title, projectId: c.projectId, pinned: c.pinned, messages: c.messages, ...patch }, c.revision, o);
      if (o.signal.aborted) throw new api.WorkspaceError("account_changed", "You are signed in as someone else now.");
      revisions.current.set(saved.id, saved.revision);
      ws.upsert(saved);
      return summary(saved);
    });
  }

  /**
   * A removed project's chats come back Unfiled with a new revision. The open chat, and any this tab holds unsaved,
   * take that revision when nothing else changed on the account's side, so their next save is not a false conflict.
   */
  function projectRemoved(projectId: string) {
    const o = ws.opts();
    const ids = new Set<string>();
    if (metaRef.current.store === "account" && metaRef.current.projectId === projectId) {
      setMeta({ ...metaRef.current, projectId: null });
      ids.add(latest.current.currentId);
    }
    for (const u of unsaved.current.values()) if (u.input.projectId === projectId) { u.input = { ...u.input, projectId: null }; ids.add(u.input.id); }
    if (!o) return;
    for (const id of ids) {
      if (!revisions.current.has(id)) continue; // never saved: nothing on the account's side moved
      void queue(async () => {
        const c = await api.getConversation(id, o);
        if (o.signal.aborted) return;
        const here = id === latest.current.currentId ? messagesRef.current : unsaved.current.get(id)?.input.messages ?? [];
        const same = c.projectId === null && c.messages.length <= here.length
          && c.messages.every((m, i) => m.role === here[i].role && m.text === here[i].text && m.at === here[i].at);
        // Anything else changed it: the next save meets a conflict and offers the usual ways out.
        if (!same) return;
        revisions.current.set(id, c.revision);
        if (id === latest.current.currentId && metaRef.current.store === "account") setMeta({ ...metaRef.current, revision: c.revision });
      }).catch(() => { /* the next save says what went wrong */ });
    }
  }

  async function runImport() {
    const o = ws.opts();
    if (!o) return;
    setPending(null);
    setNotice("Importing…");
    const r = await importBrowserChats(localStorage, o.accountId, async (record) => {
      if (o.signal.aborted) throw new Error("Stopped: the account changed.");
      return (await api.importConversation(record, o)).conversation;
    });
    if (o.signal.aborted) return;
    refreshLocal(o.accountId);
    ws.reload();
    setNotice(r.error
      ? `${r.imported} of ${r.total} imported. The rest stay in this browser. ${r.error}`
      : `Imported ${r.imported} chat${r.imported === 1 ? "" : "s"}. The copies in this browser stay as a backup until you remove them.`);
  }

  function runRemoveBackups() {
    const id = accountIdNow();
    setPending(null);
    if (!id) return;
    const n = removeBackups(localStorage, id);
    refreshLocal(id);
    setNotice(`Removed ${n} local cop${n === 1 ? "y" : "ies"}. Your account keeps the imported chats.`);
  }

  // Ctrl/Cmd+Shift+O starts a new chat, Shift+Esc goes back to the question box, Esc stops an answer.
  const keys = useRef({ newChat: () => newChat(), stop: () => stop.current?.abort() });
  keys.current = { newChat: () => newChat(), stop: () => stop.current?.abort() };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); keys.current.newChat(); return; }
      if (e.key === "Escape" && e.shiftKey) { e.preventDefault(); box.current?.focus(); return; }
      if (e.key === "Escape" && latest.current.busy) keys.current.stop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const keysHref = signed === false ? signInPath(KEYS_PATH) : KEYS_PATH;
  const empty = messages.length === 0 && !busy;
  const inAccount = workspace && Boolean(ws.account);
  const project = view?.kind === "project" ? ws.projects.find((p) => p.id === view.id) ?? null : null;
  const localChats: LocalChat[] = [
    ...local.mine.map((conversation) => ({ conversation, store: "browser" as const })),
    ...local.unbound.map((conversation) => ({ conversation, store: "shared" as const })),
  ];
  const closeRail = () => { if (narrow()) { setRailOpen(false); railToggle.current?.focus(); } };
  const projectName = meta.projectId ? ws.projects.find((p) => p.id === meta.projectId)?.name ?? "a project" : null;
  const others = drafts.filter((u) => u.input.id !== currentId);
  const unknown = workspace && ws.account === undefined;

  const rail = !workspace
    ? (
      <ConversationRail conversations={conversations} currentId={currentId} busy={busy}
        onNew={() => newChat()} onOpen={(c) => open(c.id, c.messages)} onDelete={onDelete} onClose={closeRail} />
    )
    : (
      <WorkspaceRail key={accountId ?? "none"} account={ws.account} projects={ws.projects} recent={ws.recent} local={localChats}
        currentId={currentId} currentProject={view?.kind === "project" ? view.id : null} busy={busy} error={ws.error}
        importable={local.unbound.length} backups={local.backups.length}
        onNew={() => newChat()} onOpen={(s) => void openAccountChat(s)} onOpenLocal={openLocal} onDeleteLocal={deleteLocal}
        onProject={(id) => setView({ kind: "project", id })} onCreateProject={createProject} onViewAll={() => setView({ kind: "all" })}
        onImport={() => { setNotice(""); setPending({ kind: "import" }); }} onRemoveBackups={() => { setNotice(""); setPending({ kind: "backups" }); }}
        onClose={closeRail} />
    );

  return (
    <div data-chat-page className="fixed inset-x-0 bottom-0 top-header z-30 flex bg-canvas">
      {railOpen && rail}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-3 py-2">
          <button ref={railToggle} type="button" className="btn min-h-9 px-3 text-sm" aria-expanded={railOpen} aria-controls="chat-rail" onClick={() => setRailOpen(!railOpen)}>
            Chats
          </button>
          {!railOpen && <button type="button" className="btn min-h-9 px-3 text-sm" disabled={busy} aria-keyshortcuts="Control+Shift+O" onClick={() => newChat()}>New chat</button>}
          {workspace && !view && <SaveLine key={currentId} meta={meta} save={save} empty={messages.length === 0} projectName={projectName} busy={busy}
            onRetry={persist} onNewer={() => void loadNewer()} onCopy={saveCopy} onNew={() => newChat()} />}
        </div>

        {workspace && others.length > 0 && (
          <ul aria-label="Chats not saved" className="mx-auto w-full max-w-reading space-y-1 px-4 text-sm">
            {others.map((u) => (
              <li key={u.input.id} className="flex flex-wrap items-center gap-x-3 text-danger">
                <span className="min-w-0 truncate">Not saved: {u.input.title}</span>
                <button type="button" className="min-h-9 text-fg-2 underline underline-offset-4 hover:text-accent" disabled={busy}
                  aria-label={`Open unsaved chat ${u.input.title}`} onClick={() => openUnsaved(u)}>Open</button>
              </li>
            ))}
          </ul>
        )}

        {workspace && (pending || notice) && (
          <div className="mx-auto w-full max-w-reading px-4">
            {pending?.kind === "import" && ws.account && (
              <div role="alertdialog" aria-label="Import browser chats" className="space-y-2 rounded-card border border-edge bg-panel p-3 text-sm">
                <p className="text-fg">Copy {local.unbound.length} chat{local.unbound.length === 1 ? "" : "s"} from this browser into {ws.account.name}? The copies here stay as a backup, and nobody else signed in on this browser will see them.</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" onClick={() => void runImport()}>Import</button>
                  <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setPending(null)}>Cancel</button>
                </div>
              </div>
            )}
            {pending?.kind === "backups" && (
              <div role="alertdialog" aria-label="Remove local copies" className="space-y-2 rounded-card border border-edge bg-panel p-3 text-sm">
                <p className="text-fg">Remove the {local.backups.length} imported chat{local.backups.length === 1 ? "" : "s"} kept in this browser? Your account keeps them.</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary min-h-9 px-3 text-sm" onClick={runRemoveBackups}>Remove</button>
                  <button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => setPending(null)}>Cancel</button>
                </div>
              </div>
            )}
            {notice && !pending && <p role="status" className="text-sm text-fg-2">{notice}</p>}
          </div>
        )}

        {workspace && view?.kind === "all" && ws.account ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ChatLibrary key={accountId} projects={ws.projects} local={localChats} opts={ws.opts} failed={ws.failed} busy={busy}
              onBack={() => setView(null)} onOpen={(s) => void openAccountChat(s)} onOpenLocal={openLocal} onPatch={patchChat}
              onDeleted={(id) => { ws.remove(id); revisions.current.delete(id); unsaved.current.delete(id); syncDrafts(); if (id === currentId) newChat(); }}
              onCleared={() => { ws.reload(); if (metaRef.current.store === "account") newChat(); }} />
          </div>
        ) : workspace && view?.kind === "project" ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {project
              ? <ProjectView key={`${accountId}:${project.id}`} project={project} opts={ws.opts} failed={ws.failed} savedBuilds={savedBuilds} busy={busy}
                  onBack={() => setView(null)} onNewChat={() => newChat(project.id)} onOpenChat={(s) => void openAccountChat(s)}
                  onProject={putProject}
                  onRemoved={() => { ws.setProjects((list) => list.filter((p) => p.id !== project.id)); ws.reload(); projectRemoved(project.id); setView({ kind: "all" }); }}
                  onAttach={(n) => { setNote(n); setView(null); box.current?.focus(); }} />
              : <p className="mx-auto max-w-reading px-4 py-6 text-sm text-muted">{ws.account === null ? "Sign in to open your projects." : ws.loaded ? "That project is not in your account." : "Loading the project…"}</p>}
          </div>
        ) : (
          <>
            {providers.length > 0 && <p className="px-4 text-xs text-muted">Keys last only in this tab. Closing it forgets them.</p>}
            <div ref={thread} className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 80; }}>
              <div className="mx-auto w-full max-w-reading px-4 py-6">
                {empty ? (
                  <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
                    <h2 className="text-2xl font-semibold text-fg">What do you want to know about WoW: Forever?</h2>
                    <ul aria-label="Suggestions" className="flex max-w-xl flex-wrap justify-center gap-2">
                      {SUGGESTIONS.map((s) => <li key={s}><button type="button" className="btn min-h-9 px-3 text-sm" disabled={unknown} onClick={() => void ask(s)}>{s}</button></li>)}
                    </ul>
                    {inAccount && !meta.projectId && meta.revision === 0 && (
                      <div role="radiogroup" aria-label="Keep this chat in" className="flex flex-wrap items-center justify-center gap-3 text-sm text-fg-2">
                        <span>Keep this chat in</span>
                        {(["account", "browser"] as const).map((choice) => (
                          <label key={choice} className="inline-flex min-h-9 items-center gap-1">
                            <input type="radio" name="chat-store" checked={meta.store === choice} onChange={() => setMeta(freshMeta(null, choice))} />
                            {choice === "account" ? "Your account" : "This browser"}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div role="log" aria-label="Conversation" aria-relevant="additions" className="space-y-6">
                    {messages.map((m, i) => m.role === "user"
                      ? <UserMessage key={i} m={m} />
                      : <AssistantMessage key={i} m={m} copied={copied === i} onCopy={() => void copy(i, m.text)} onChoose={(item) => choose(i, item)}
                          {...(inAccount && !busy ? {
                            onSave: (text: string) => setSaving({ kind: "answer", title: messages[i - 1]?.text ?? "Saved answer", text, sources: m.sources }),
                            onSaveItem: (id: number) => setSaving({ kind: "page", href: `/database/items/${id}`, title: `/database/items/${id}` }),
                          } : {})} />)}
                    {busy && (
                      <div aria-busy="true" className="whitespace-pre-wrap break-words leading-7 text-fg">
                        {live?.text}
                        <span aria-hidden="true" className="text-accent">▍</span>
                      </div>
                    )}
                  </div>
                )}
                <p role="status" className="sr-only">{busy ? (live?.tool ? `Looking up ${live.tool}` : "Answering") : ""}</p>
                {busy && live?.tool && <p className="mt-2 text-xs text-muted">Looking up {live.tool}…</p>}
                {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
                {full && <button type="button" className="btn mt-2 min-h-9 px-3 text-sm" disabled={busy} onClick={() => newChat()}>Start a new chat</button>}
              </div>
            </div>

            {saving && inAccount && (
              <div className="px-4">
                <SaveToProject key={`${accountId}:${saving.kind}:${saving.kind === "page" ? saving.href : saving.text}`} request={saving} projects={ws.projects}
                  opts={ws.opts} failed={ws.failed} onProject={putProject} onClose={() => { setSaving(null); box.current?.focus(); }} />
              </div>
            )}
            {unknown ? (
              <div role="status" className="mx-auto w-full max-w-reading px-4 pb-3 text-sm text-fg-2">
                {ws.error
                  ? <>{ws.error} <button type="button" className="min-h-9 underline underline-offset-4 hover:text-accent" onClick={ws.recheck}>Try again</button></>
                  : "Checking whether you are signed in…"}
              </div>
            ) : <Composer box={box} value={draft} onValue={setDraft} onSend={() => void ask(draft)} onStop={() => stop.current?.abort()} busy={busy}
              providers={providers} onPickModel={(kind, model) => { try { setProviders(pickModel(providerStorage(), kind, model)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}
              keysHref={keysHref} signed={signed} free={freeChat} mode={mode} onMode={(m) => { setMode(m); box.current?.focus(); }}
              characters={own.characters} context={context} onContext={(c) => { setContext(c); box.current?.focus(); }}
              {...(workspace ? { sessionKey: `${currentId}:${meta.projectId ?? ""}`, note, onRemoveNote: () => { setNote(null); box.current?.focus(); } } : {})} />}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Where the open chat is kept and whether its last save landed, with the ways out of a failed or conflicting one.
 * Loading the newer version replaces what is shown, so it asks first; a chat over a limit offers a new chat, not Retry.
 */
function SaveLine({ meta, save, empty, projectName, busy, onRetry, onNewer, onCopy, onNew }: {
  meta: Meta; save: SaveState; empty: boolean; projectName: string | null; busy: boolean;
  onRetry: () => void; onNewer: () => void; onCopy: () => void; onNew: () => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const link = "min-h-9 underline underline-offset-4 hover:text-accent";
  const where = meta.store === "account" ? (projectName ? `In ${projectName}` : "In your account") : meta.store === "browser" ? "In this browser only" : "In this browser";
  return (
    <div role="status" className="flex min-w-0 flex-wrap items-center gap-x-3 text-xs text-fg-2">
      {save.state === "conflict" && replacing ? (
        <>
          <span className="text-danger">Replace this with the newer version? Turns not saved here will be gone.</span>
          <button type="button" className={link} disabled={busy} onClick={() => { setReplacing(false); onNewer(); }}>Replace mine</button>
          <button type="button" className={link} onClick={() => setReplacing(false)}>Keep mine</button>
        </>
      ) : save.state === "conflict" ? (
        <>
          <span className="text-danger">This chat changed on another device. Nothing here was lost.</span>
          <button type="button" className={link} disabled={busy} onClick={() => setReplacing(true)}>Load the newer version</button>
          <button type="button" className={link} disabled={busy} onClick={onCopy}>Save mine as a copy</button>
        </>
      ) : save.state === "failed" ? (
        <>
          <span className="text-danger">Not saved. {save.message}</span>
          {save.full
            ? <button type="button" className={link} disabled={busy} onClick={onNew}>Start a new chat</button>
            : <button type="button" className={link} disabled={busy} onClick={onRetry}>Retry</button>}
        </>
      ) : (
        <span>{where}{meta.store === "account" && !empty ? (save.state === "saving" ? " · Saving…" : save.state === "saved" ? " · Saved" : "") : ""}</span>
      )}
    </div>
  );
}
