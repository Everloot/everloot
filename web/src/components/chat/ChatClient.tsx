"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountShell, ShellCharacter } from "@/lib/account-shell-types";
import { signInPath } from "@/lib/auth/return-to";
import { answer, loadTools, searchOnly, signedIn, type ChatProgress, type ToolDef } from "@/lib/chat/agent";
import { chatProvider } from "@/lib/chat/providers";
import { providerStorage } from "@/lib/chat/provider-session";
import {
  deleteConversation, keyReady, loadConversations, loadProviders, newConversationId, pickModel, saveConversation,
  type ChatMessage, type Conversation, type SavedProvider,
} from "@/lib/chat/store";
import { crossesDocumentBoundary } from "@/lib/document-boundary";
import { askPrefill, validCharacterId } from "@/lib/profiles";
import type { AccountBuilds, SavedBuild } from "@/lib/saved-builds";
import Composer from "./Composer";
import ConversationRail from "./ConversationRail";
import { AssistantMessage, UserMessage } from "./Message";

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

/**
 * The /chat conversation: a full-screen thread, one composer, and the browser-local conversation list.
 * `savedBuilds` (EVERLOOT_SAVED_BUILDS) offers my_builds to a signed-in visitor's model; `profiles`
 * (EVERLOOT_PROFILES) offers the account's characters as context. Keys are set up on /account#chat-keys.
 */
export default function ChatClient({ savedBuilds = false, profiles = false }: { savedBuilds?: boolean; profiles?: boolean }) {
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

  const tools = useRef<ToolDef[] | null>(null);
  const stop = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const railToggle = useRef<HTMLButtonElement>(null);
  const stick = useRef(true);
  const prefilled = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const charactersOnce = useRef<Promise<Characters> | null>(null);
  // What ask() and the shortcuts read, current at every render even from an older closure.
  const latest = useRef({ providers, signed, context, own, busy, currentId });
  latest.current = { providers, signed, context, own, busy, currentId };

  // localStorage only exists in the browser; read it after the first render. A new chat opens each visit.
  // Not in a document that came with a public page's policy: DocumentBoundary reloads it first.
  useEffect(() => {
    if (crossesDocumentBoundary(window.location.pathname)) return;
    try { setProviders(loadProviders(providerStorage())); }
    catch { setError("Chat keys could not move to this tab. Allow browser storage and reload before saving a key."); }
    setConversations(loadConversations(localStorage));
    setCurrentId(newConversationId());
    setRailOpen(typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void signedIn().then((s) => { if (!cancelled) setSigned(s); });
    return () => { cancelled = true; };
  }, []);

  const characters = () => (charactersOnce.current ??= fetchCharacters(savedBuilds, profiles));
  useEffect(() => {
    if (signed !== true || !(savedBuilds || profiles)) return;
    let cancelled = false;
    void characters().then((c) => { if (!cancelled) setOwn(c); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `characters` is memoised in a ref
  }, [signed, savedBuilds, profiles]);

  // From the home's Ask box: /chat?q=<question>&character=<id>. The character becomes the context chip. With a key
  // ready the question is sent at once; without one it waits in the box. The URL drops both so a reload does not resend.
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
      if (q && keyReady(latest.current.providers)) void ask(q, character);
      else { setDraft(q); box.current?.focus(); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when storage and the session are known
  }, [ready, signed]);

  // Keep the newest text in view while the reader is at the bottom; leave them be when they scrolled up.
  useEffect(() => {
    const t = thread.current;
    if (t && stick.current) t.scrollTop = t.scrollHeight;
  }, [messages, live]);

  function commit(id: string, next: ChatMessage[]) {
    messagesRef.current = next;
    setMessages(next);
    setConversations(saveConversation(localStorage, { id, title: "", updatedAt: new Date().toISOString(), messages: next }));
  }

  async function ask(question: string, character: ShellCharacter | null = latest.current.context) {
    const q = question.trim().slice(0, 2000);
    if (!q || latest.current.busy) return;
    const { providers: saved, own: mine, currentId: id } = latest.current;
    const builds = character ? mine.builds.filter((b) => b.characterId === character.id) : [];
    const contextLine = character ? askPrefill("", character, builds) : "";
    const prior = messagesRef.current;
    const history = prior.map((m) => ({ role: m.role, text: m.context ? `${m.text}\n\n${m.context}` : m.text }));
    const asked: ChatMessage[] = [...prior, { role: "user", text: q, ...(contextLine ? { context: contextLine } : {}), at: new Date().toISOString(), model: null, sources: [], pages: [], steps: [] }];
    commit(id, asked);
    setDraft(""); setBusy(true); setError(""); setLive(null);
    latest.current.busy = true;
    stick.current = true;
    requestAnimationFrame(() => thread.current?.scrollTo?.({ top: thread.current.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" }));
    const ctl = new AbortController();
    stop.current = ctl;
    try {
      const active = saved[0];
      let r;
      if (!active) r = await searchOnly(q);
      else {
        tools.current ??= await loadTools(fetch, savedBuilds && latest.current.signed === true);
        r = await answer({
          provider: chatProvider(active.kind)!, model: active.model, key: active.key, history,
          question: contextLine ? `${q}\n\n${contextLine}` : q, tools: tools.current, onProgress: setLive, signal: ctl.signal,
        });
      }
      commit(id, [...asked, { role: "assistant", text: r.text, at: new Date().toISOString(), model: r.model, sources: r.sources, pages: r.pages, steps: r.steps }]);
    } catch (err) {
      setError(ctl.signal.aborted ? "Stopped." : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false); setLive(null); stop.current = null;
      latest.current.busy = false;
      box.current?.focus();
    }
  }

  const narrow = () => typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 1024px)").matches;

  function open(id: string, list: ChatMessage[]) {
    if (latest.current.busy) return;
    setCurrentId(id);
    messagesRef.current = list;
    setMessages(list);
    setError(""); setDraft("");
    stick.current = true;
    if (narrow()) setRailOpen(false);
    box.current?.focus();
  }
  const newChat = () => open(newConversationId(), []);

  function onDelete(c: Conversation) {
    setConversations(deleteConversation(localStorage, c.id));
    if (c.id === currentId) newChat();
  }

  async function copy(i: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* the browser refused; nothing to undo */ }
  }

  // Ctrl/Cmd+Shift+O starts a new chat, Shift+Esc goes back to the question box, Esc stops an answer.
  const keys = useRef({ newChat, stop: () => stop.current?.abort() });
  keys.current = { newChat, stop: () => stop.current?.abort() };
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

  return (
    <div data-chat-page className="fixed inset-x-0 bottom-0 top-header z-30 flex bg-canvas">
      {railOpen && (
        <ConversationRail conversations={conversations} currentId={currentId} busy={busy}
          onNew={newChat} onOpen={(c) => open(c.id, c.messages)} onDelete={onDelete}
          onClose={() => { if (narrow()) { setRailOpen(false); railToggle.current?.focus(); } }} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-3 py-2">
          <button ref={railToggle} type="button" className="btn min-h-9 px-3 text-sm" aria-expanded={railOpen} aria-controls="chat-rail" onClick={() => setRailOpen(!railOpen)}>
            Chats
          </button>
          {!railOpen && <button type="button" className="btn min-h-9 px-3 text-sm" disabled={busy} aria-keyshortcuts="Control+Shift+O" onClick={newChat}>New chat</button>}
        </div>

        {providers.length > 0 && <p className="px-4 text-xs text-muted">Keys last only in this tab. Closing it forgets them.</p>}
        <div ref={thread} className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 80; }}>
          <div className="mx-auto w-full max-w-reading px-4 py-6">
            {empty ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
                <h2 className="text-2xl font-semibold text-fg">What do you want to know about WoW: Forever?</h2>
                <ul aria-label="Suggestions" className="flex max-w-xl flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => <li key={s}><button type="button" className="btn min-h-9 px-3 text-sm" onClick={() => void ask(s)}>{s}</button></li>)}
                </ul>
              </div>
            ) : (
              <div role="log" aria-label="Conversation" aria-relevant="additions" className="space-y-6">
                {messages.map((m, i) => m.role === "user"
                  ? <UserMessage key={i} m={m} />
                  : <AssistantMessage key={i} m={m} copied={copied === i} onCopy={() => void copy(i, m.text)} />)}
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
          </div>
        </div>

        <Composer box={box} value={draft} onValue={setDraft} onSend={() => void ask(draft)} onStop={() => stop.current?.abort()} busy={busy}
          providers={providers} onPickModel={(kind, model) => { try { setProviders(pickModel(providerStorage(), kind, model)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}
          keysHref={keysHref} signed={signed}
          characters={own.characters} context={context} onContext={(c) => { setContext(c); box.current?.focus(); }} />
      </div>
    </div>
  );
}
