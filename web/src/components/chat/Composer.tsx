import { useLayoutEffect, type RefObject } from "react";
import type { ShellCharacter } from "@/lib/account-shell-types";
import type { SavedProvider } from "@/lib/chat/store";
import { modelOptions } from "./ChatKeys";
import DictationButton from "./Dictation";

const MAX_HEIGHT = 240;
const chip = "inline-flex min-h-8 items-center gap-1 rounded-full border border-line px-3 text-xs text-fg-2";
const menu = "min-h-8 max-w-[14rem] rounded-full border border-line bg-panel px-2 text-xs text-fg-2 hover:border-edge focus:border-accent";

const className = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

/**
 * The one question box, pinned under the conversation: it grows with the text, Enter sends and Shift+Enter
 * starts a new line, and Stop replaces Send while an answer streams. The model menu, the character attached
 * as context and whose limits the lookups use sit inside it. Without a key it says search is ready and that an AI model is optional.
 */
export default function Composer(p: {
  box: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onValue: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  providers: SavedProvider[];
  onPickModel: (kind: SavedProvider["kind"], model: string) => void;
  /** Where to set keys up: /account#chat-keys, through sign-in when signed out. */
  keysHref: string;
  signed: boolean | null;
  characters: ShellCharacter[];
  context: ShellCharacter | null;
  onContext: (c: ShellCharacter | null) => void;
  /** With the workspace on: the chat or project the draft belongs to. Dictation shows and stops when it changes. */
  sessionKey?: string;
  /** A project note the player attached to the next question. */
  note?: { title: string } | null;
  onRemoveNote?: () => void;
}) {
  const ready = p.providers.length > 0;
  const active = p.providers[0] ?? null;

  // Grow with the text up to MAX_HEIGHT, then scroll inside.
  useLayoutEffect(() => {
    const t = p.box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, MAX_HEIGHT)}px`;
  }, [p.value, p.box]);

  return (
    <form className="mx-auto w-full max-w-reading px-4 pb-3" aria-label="Ask Everloot"
      onSubmit={(e) => { e.preventDefault(); p.onSend(); }}>
      <div className="rounded-card border border-edge bg-panel focus-within:border-accent">
        {!ready && (
          <p className="border-b border-line px-4 py-2 text-sm text-fg-2">
            Everloot search is ready: Send shows its results. <a href={p.keysHref} className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">Assistant setup</a>{p.signed === false ? " (sign in first)" : ""} adds an optional AI model, which uses your own provider account.
          </p>
        )}
        <textarea ref={p.box} rows={1} value={p.value} aria-label="Your question" aria-keyshortcuts="Enter Shift+Enter"
          placeholder="Ask about WoW: Forever" maxLength={2000}
          className="block max-h-60 w-full resize-none border-0 bg-transparent px-4 pt-3 text-base text-fg placeholder:text-muted focus:outline-none"
          onChange={(e) => p.onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!p.busy) p.onSend(); }
            if (e.key === "Escape" && p.busy) { e.preventDefault(); p.onStop(); }
          }} />
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
          {ready && (
            <select aria-label="Model" className={menu} disabled={p.busy} value={`${active!.kind}|${active!.model}`}
              onChange={(e) => {
                if (e.target.value === "manage") { window.location.assign(p.keysHref); return; }
                const [kind, ...rest] = e.target.value.split("|");
                p.onPickModel(kind as SavedProvider["kind"], rest.join("|"));
              }}>
              {modelOptions(p.providers).map((g) => (
                <optgroup key={g.kind} label={g.label}>
                  {g.models.map((m) => <option key={m.id} value={`${g.kind}|${m.id}`}>{m.label}</option>)}
                </optgroup>
              ))}
              <option value="manage">Assistant setup…</option>
            </select>
          )}
          {/* With the workspace on the model menu shows without a key too: Everloot search now, a model after setup. */}
          {!ready && p.sessionKey !== undefined && (
            <select aria-label="Model" className={menu} disabled={p.busy} value="search"
              onChange={(e) => { if (e.target.value === "setup") window.location.assign(p.keysHref); }}>
              <option value="search">Everloot search</option>
              <option value="setup">Assistant setup…</option>
            </select>
          )}
          {p.note && (
            <span className={chip}>
              Note: {p.note.title}
              <button type="button" className="min-h-6 px-1 text-muted hover:text-fg" aria-label={`Remove note ${p.note.title} from the question`} onClick={p.onRemoveNote}>×</button>
            </span>
          )}
          {p.context ? (
            <span className={chip}>
              {p.context.name} · {className(p.context.classSlug)}
              <button type="button" className="min-h-6 px-1 text-muted hover:text-fg" aria-label={`Remove ${p.context.name} from the question`} onClick={() => p.onContext(null)}>×</button>
            </span>
          ) : p.characters.length > 0 && (
            <select aria-label="Add a character to the question" className={menu} value="" disabled={p.busy}
              onChange={(e) => p.onContext(p.characters.find((c) => c.id === e.target.value) ?? null)}>
              <option value="">Add a character</option>
              {p.characters.map((c) => <option key={c.id} value={c.id}>{c.name} · {className(c.classSlug)}</option>)}
            </select>
          )}
          {p.signed !== null && (
            <span className="text-xs text-muted">{p.signed ? "Game data through your Everloot account" : "Signed out: lookups use the public limits"}</span>
          )}
          {p.sessionKey !== undefined && <DictationButton value={p.value} onChange={p.onValue} disabled={p.busy} sessionKey={p.sessionKey} />}
          {p.busy
            ? <button type="button" className="btn ml-auto min-h-9 px-4 text-sm" aria-keyshortcuts="Escape" onClick={p.onStop}>Stop</button>
            : <button type="submit" className="btn btn-primary ml-auto min-h-9 px-4 text-sm" disabled={!p.value.trim()}>Send</button>}
        </div>
      </div>
      <p className="mt-2 hidden text-center text-xs text-muted sm:block">
        Enter sends, Shift+Enter adds a line, Esc stops, Ctrl+Shift+O starts a new chat.
      </p>
    </form>
  );
}
