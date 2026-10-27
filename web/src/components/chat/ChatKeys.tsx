"use client";

import { useEffect, useId, useRef, useState } from "react";
import { testKey } from "@/lib/chat/agent";
import { providerStorage } from "@/lib/chat/provider-session";
import { inkOn, listModels } from "@/lib/chat/catalogue";
import { CHAT_PROVIDERS, chatProvider, type ChatModel, type ChatProviderKind, type ChatProviderPreset } from "@/lib/chat/providers";
import { loadProviders, maskKey, recordCheck, removeProvider, saveProvider, setDefault, setModel, type SavedProvider } from "@/lib/chat/store";
import { crossesDocumentBoundary } from "@/lib/document-boundary";

const field = "w-full rounded-control border border-edge bg-canvas px-3 py-2 text-fg placeholder:text-muted focus:border-accent";
const small = "btn min-h-11 px-3 text-sm";
const OTHER = "__other__";

const providerName = (kind: ChatProviderKind) => chatProvider(kind)?.name ?? kind;
/** The cards shown open; the other providers wait under "More providers" until one is saved. */
const FIRST: ChatProviderKind[] = ["openrouter", "anthropic", "ollama"];

/** The provider's monogram on its own colour, in place of a logo (no third-party logo file is shipped). */
function ProviderTile({ preset }: { preset: ChatProviderPreset }) {
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-control border border-line text-sm font-bold tracking-tight"
      style={{ background: preset.colour, color: inkOn(preset.colour) }}>{preset.mark}</span>
  );
}

/**
 * The models the provider serves now, read from the provider (lib/chat/catalogue.ts listModels), or the catalogue's
 * shortlist until it answers or when it cannot. OpenRouter's list is public; the others need the saved key, and a
 * local Ollama is asked only once it is set up.
 */
function useModels(preset: ChatProviderPreset, key: string | null, open: boolean): ChatModel[] {
  const [live, setLive] = useState<ChatModel[] | null>(null);
  useEffect(() => {
    if (!open || (key === null && preset.list !== "openrouter")) return;
    let gone = false;
    void listModels(preset, key ?? "").then((m) => { if (!gone) setLive(m); });
    return () => { gone = true; };
  }, [preset, key, open]);
  return live ?? preset.models;
}

/** Every model the saved providers offer, the saved one first when it is not a preset. */
export function modelOptions(providers: SavedProvider[]) {
  return providers.map((p) => {
    const preset = chatProvider(p.kind)!;
    const models = preset.models.some((m) => m.id === p.model) ? preset.models : [{ id: p.model, label: p.model, note: "" }, ...preset.models];
    return { kind: p.kind, label: preset.label, models };
  });
}

/** What the card says about the key: Not set, Set ending ••••abcd, or that the last Test failed. */
function statusOf(preset: ChatProviderPreset, saved: SavedProvider | undefined): { text: string; bad: boolean } {
  if (!preset.keyPattern) {
    if (!saved) return { text: "Not set up", bad: false };
    return saved.check?.ok === false ? { text: "Not reachable last time", bad: true } : { text: "Set up, no key needed", bad: false };
  }
  if (!saved) return { text: "Not set", bad: false };
  const set = `Set, ${maskKey(saved.key)}`;
  return saved.check?.ok === false ? { text: `${set} · Invalid last time`, bad: true } : { text: set, bad: false };
}

/** A model picker: the provider's presets and "Another model id…", or a free text box when it has no presets. */
function ModelPicker({ preset, models, value, onPick, name }: { preset: ChatProviderPreset; models: ChatModel[]; value: string; onPick?: (model: string) => void; name?: string }) {
  const id = useId();
  const listed = models.some((m) => m.id === value);
  const [other, setOther] = useState(models.length === 0 || (value !== "" && !listed));
  const [choice, setChoice] = useState(listed ? value : models[0]?.id ?? "");
  const [text, setText] = useState(listed ? "" : value);
  const label = `${providerName(preset.kind)} model`;
  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-model`} className="block text-fg-2">Model</label>
      {models.length > 0 && (
        <select id={`${id}-model`} name={name} className={field} value={other ? OTHER : choice} aria-label={label}
          onChange={(e) => {
            if (e.target.value === OTHER) return setOther(true);
            setOther(false);
            setChoice(e.target.value);
            onPick?.(e.target.value);
          }}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.note ? ` · ${m.note}` : ""}</option>)}
          <option value={OTHER}>Another model id…</option>
        </select>
      )}
      {other && (
        <div className="flex flex-wrap gap-2">
          <input id={models.length ? `${id}-other` : `${id}-model`} name={name ? `${name}Text` : undefined} spellCheck={false} value={text}
            aria-label={models.length ? `${label} id` : label} onChange={(e) => setText(e.target.value)}
            className={`${field} min-w-0 flex-1`} placeholder={models.length ? "A model id from the provider" : "The model you pulled, like qwen3:4b"} />
          {onPick && <button type="button" className={small} onClick={() => onPick(text.trim())}>Use model</button>}
        </div>
      )}
    </div>
  );
}

function ProviderCard({ preset, saved, isDefault, busy, onSave, onTest, onRemove, onModel }: {
  preset: ChatProviderPreset; saved: SavedProvider | undefined; isDefault: boolean; busy: boolean;
  onSave: (form: HTMLFormElement) => boolean; onTest: () => void; onRemove: () => void; onModel: (model: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const id = useId();
  const name = preset.name;
  const tagline = /\((.*)\)$/.exec(preset.label)?.[1];
  const state = statusOf(preset, saved);
  const needsKey = preset.keyPattern !== null;
  const models = useModels(preset, saved?.key ?? null, Boolean(saved) || editing);
  // Back to the button that opened the form, once it is rendered again.
  const close = () => { setEditing(false); setTimeout(() => opener.current?.focus(), 0); };

  return (
    <section aria-labelledby={`${id}-name`} className="space-y-3 rounded-card border border-line bg-panel p-4">
      <div className="flex items-start gap-3">
        <ProviderTile preset={preset} />
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-name`} className="flex flex-wrap items-center gap-2 font-semibold text-fg">
            {name}
            {isDefault && <span className="rounded-full border border-line px-2 text-xs font-normal text-fg-2">Default</span>}
          </h3>
          {tagline && <p className="text-xs text-muted">{tagline}</p>}
          <p className={state.bad ? "text-fg" : "text-muted"}>{state.text}</p>
        </div>
      </div>

      {saved && !editing && <ModelPicker key={`${saved.model}|${models.length}`} preset={preset} models={models} value={saved.model} onPick={onModel} />}

      {editing ? (
        <form className="space-y-3" autoComplete="off" aria-label={needsKey ? `${saved ? "Replace" : "Add"} ${name} key` : `Set up ${name}`}
          onSubmit={(e) => { e.preventDefault(); if (onSave(e.currentTarget)) close(); }}>
          {needsKey && (
            <div className="space-y-1">
              <label htmlFor={`${id}-key`} className="block text-fg-2">{saved ? "New key" : "Key"}</label>
              <input id={`${id}-key`} type="password" name="key" spellCheck={false} autoFocus className={field} aria-describedby={`${id}-hint`} placeholder="Paste the key" />
              <p id={`${id}-hint`} className="text-xs text-muted">{preset.keyHint}</p>
            </div>
          )}
          {!saved && <ModelPicker key={models.length} preset={preset} models={models} value="" name="model" />}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary min-h-11 px-4 text-sm">{needsKey ? "Save key" : "Use Ollama"}</button>
            <button type="button" className={small} onClick={close}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(needsKey || !saved) && (
            <button ref={opener} type="button" className={small} aria-label={needsKey ? `${saved ? "Replace" : "Add"} ${name} key` : `Set up ${name}`} onClick={() => setEditing(true)}>
              {needsKey ? (saved ? "Replace key" : "Add key") : "Set up"}
            </button>
          )}
          {saved && (
            <>
              <button type="button" className={small} aria-label={`Test ${name}`} disabled={busy} onClick={onTest}>Test</button>
              <button type="button" className={small} aria-label={`Remove ${name}`} onClick={onRemove}>Remove</button>
            </>
          )}
        </div>
      )}

      <p className="text-xs text-muted">
        <a href={preset.getKey.href} target="_blank" rel="noopener noreferrer" className="text-fg underline decoration-edge underline-offset-4 hover:decoration-fg">
          {preset.getKey.text}<span className="sr-only"> (opens in a new tab)</span>
        </a>
        {" · "}{preset.dataNote}
      </p>
    </section>
  );
}

/**
 * The Chat keys section of /account: one card per provider Chat supports, each with its key's status, its model and
 * Add, Replace, Test and Remove, and the default provider Chat uses. Everything is read from and written to this
 * tab's sessionStorage (lib/chat/store.ts); nothing here talks to Everloot. Test sends the key to its own
 * provider only.
 */
export default function ChatKeys() {
  const [providers, setProviders] = useState<SavedProvider[]>([]);
  const [status, setStatus] = useState("");
  const [testing, setTesting] = useState<ChatProviderKind | null>(null);
  const legend = useId();

  // localStorage only exists in the browser; read it after the first render. Not in a document that came with
  // a public page's policy: DocumentBoundary reloads it first.
  useEffect(() => {
    if (crossesDocumentBoundary(window.location.pathname)) return;
    try { setProviders(loadProviders(providerStorage())); }
    catch { setStatus("Chat keys could not move to this tab. Allow browser storage and reload before saving a key."); }
  }, []);

  function attempt(action: () => string): boolean {
    try { setStatus(action()); return true; } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); return false; }
  }

  function onSave(kind: ChatProviderKind, form: HTMLFormElement): boolean {
    const f = new FormData(form);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const saved = providers.find((p) => p.kind === kind);
    const model = saved?.model ?? (text("model") === OTHER || !text("model") ? text("modelText") : text("model"));
    return attempt(() => {
      const next = saveProvider(providerStorage(), { kind, model, key: text("key") }, { asDefault: false });
      setProviders(next);
      return `${providerName(kind)} saved in this tab.${next[0].kind === kind ? ` Chat uses ${next[0].model}.` : ""}`;
    });
  }

  async function onTest(p: SavedProvider) {
    setTesting(p.kind);
    setStatus(`Testing ${providerName(p.kind)}…`);
    try {
      const said = await testKey(chatProvider(p.kind)!, p.model, p.key);
      setProviders(recordCheck(providerStorage(), p.kind, true));
      setStatus(said);
    } catch (e) {
      setProviders(recordCheck(providerStorage(), p.kind, false));
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(null);
    }
  }

  const active = providers[0] ?? null;
  const open = (p: ChatProviderPreset) => FIRST.includes(p.kind) || providers.some((s) => s.kind === p.kind);
  const shown = CHAT_PROVIDERS.filter(open);
  const more = CHAT_PROVIDERS.filter((p) => !open(p));

  const card = (preset: ChatProviderPreset) => {
    const saved = providers.find((p) => p.kind === preset.kind);
    return (
      <li key={preset.kind}>
        <ProviderCard preset={preset} saved={saved} isDefault={!!saved && active?.kind === preset.kind} busy={testing !== null}
          onSave={(form) => onSave(preset.kind, form)}
          onTest={() => void onTest(saved!)}
          onRemove={() => attempt(() => { setProviders(removeProvider(providerStorage(), preset.kind)); return `${providerName(preset.kind)} removed from this tab.`; })}
          onModel={(model) => attempt(() => { setProviders(setModel(providerStorage(), preset.kind, model)); return `${providerName(preset.kind)} uses ${model}.`; })} />
      </li>
    );
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-fg-2">
        Everloot search is free and needs no key. Add a model here only if you want AI-written answers: it runs on
        your own provider account, so that provider&apos;s pricing and limits apply, and some models have a limited
        free tier. A ChatGPT or Claude subscription is not an API key. Your keys are kept in this tab only and go
        from here straight to the provider; Everloot&apos;s servers never receive them. Closing the tab forgets them.
        Another tab, another device or the Desktop App needs its own setup; conversation history stays in this browser.
      </p>

      {providers.length > 0 && (
        <fieldset className="space-y-2" aria-describedby={`${legend}-note`}>
          <legend className="font-semibold text-fg">Default provider for Chat</legend>
          <p id={`${legend}-note`} className="text-muted">Chat starts with this one. You can switch models in Chat too.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {providers.map((p) => (
              <label key={p.kind} className="flex min-h-11 items-center gap-2 text-fg">
                <input type="radio" name={`${legend}-default`} className="size-5" checked={active?.kind === p.kind}
                  onChange={() => attempt(() => { setProviders(setDefault(providerStorage(), p.kind)); return `Chat now uses ${providerName(p.kind)}, ${p.model}.`; })} />
                {providerName(p.kind)} <span className="text-muted">· {p.model}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <ul aria-label="Chat providers" className="space-y-3">{shown.map(card)}</ul>

      {more.length > 0 && (
        <details className="group space-y-3">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-fg">
            More providers <span className="font-normal text-muted">· {more.map((p) => p.name).join(", ")}</span>
          </summary>
          <ul aria-label="More chat providers" className="space-y-3">{more.map(card)}</ul>
        </details>
      )}

      <p role="status" aria-live="polite" className="min-h-5 text-fg-2">{status}</p>
    </div>
  );
}
