import type { ChatStep } from "./agent";
import { itemRef, type ItemRef } from "./items";
import { chatProvider, MODEL_ID, type ChatProviderKind } from "./providers";

/**
 * What /chat and the Chat keys section of /settings keep in this tab's sessionStorage (providers and keys)
 * and this browser's localStorage (conversations). Nothing here is
 * sent to Everloot; a key goes only to its own provider. Clearing the site's data removes all of it.
 */

/** The result of the last Test of a saved key, so the provider's card can say "Invalid last time". */
export interface KeyCheck { ok: boolean; at: string }
export interface SavedProvider { kind: ChatProviderKind; model: string; key: string; check?: KeyCheck }
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
  /** The model that wrote an assistant message; null for search only. */
  model: string | null;
  sources: string[];
  /** The everloot.app pages the tools pointed to. Absent in messages saved before it existed. */
  pages?: string[];
  steps: ChatStep[];
  /** A user message's attached context ("I'm playing Jaina, a Mage."), sent to the model after the question. */
  context?: string;
  /** An answer's item, as a reference only: its card and drops are fetched fresh each time it is shown. */
  item?: ItemRef;
}
export interface Conversation { id: string; title: string; updatedAt: string; messages: ChatMessage[] }

/** The sessionStorage name of saved providers; provider-session.ts migrates the old localStorage entry. */
export const PROVIDERS = "everloot.chat.providers.v1";
/** The single transcript kept before conversations; read once, moved into a conversation and removed. */
const THREAD = "everloot.chat.thread.v1";
const CONVERSATIONS = "everloot.chat.conversations.v1";
const MAX_MESSAGES = 60;
const MAX_CONVERSATIONS = 30;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function read<T>(storage: Storage, name: string, fallback: T): T {
  try { const raw = storage.getItem(name); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}

/** The saved providers, the one in use first. Entries that no longer make sense are dropped. */
export function loadProviders(storage: Storage): SavedProvider[] {
  const list = read<unknown[]>(storage, PROVIDERS, []);
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const p = raw as Partial<SavedProvider>;
    const preset = chatProvider(String(p.kind));
    if (!preset || typeof p.model !== "string" || !MODEL_ID.test(p.model) || typeof p.key !== "string") return [];
    const check = p.check && typeof p.check.ok === "boolean" && typeof p.check.at === "string" ? { check: { ok: p.check.ok, at: p.check.at } } : {};
    return [{ kind: preset.kind, model: p.model, key: p.key, ...check }];
  });
}

/**
 * Saves a provider and puts it first, so Chat uses it. A provider already saved keeps its key when none is
 * pasted, so changing the model does not mean pasting the key again. With `asDefault: false` (the account page's
 * provider cards) the default stays as it was: a provider already saved keeps its place and a new one goes last,
 * unless it is the only one. A new key forgets the last Test's result.
 */
export function saveProvider(
  storage: Storage, choice: { kind: ChatProviderKind; model: string; key?: string }, { asDefault = true }: { asDefault?: boolean } = {},
): SavedProvider[] {
  const preset = chatProvider(choice.kind);
  if (!preset) throw new Error("Pick a provider");
  const model = choice.model.trim();
  if (!MODEL_ID.test(model)) throw new Error(model ? "That does not look like a model id" : "Pick or type a model");
  const list = loadProviders(storage);
  const old = list.find((p) => p.kind === preset.kind);
  const key = (choice.key ?? "").trim() || old?.key || "";
  if (preset.keyPattern && !preset.keyPattern.test(key)) throw new Error(key ? `That does not look like the right key. ${preset.keyHint}` : `Paste the key first. ${preset.keyHint}`);
  if (key.length > 500) throw new Error("That is too long for a key");
  const entry: SavedProvider = { kind: preset.kind, model, key, ...(old?.check && old.key === key ? { check: old.check } : {}) };
  const next = asDefault ? [entry, ...list.filter((p) => p !== old)] : old ? list.map((p) => (p === old ? entry : p)) : [...list, entry];
  storage.setItem(PROVIDERS, JSON.stringify(next));
  return next;
}

/** Changes a saved provider's model without changing which provider Chat uses. */
export function setModel(storage: Storage, kind: ChatProviderKind, model: string): SavedProvider[] {
  const list = loadProviders(storage);
  if (!list.some((p) => p.kind === kind)) throw new Error("That provider is not saved here");
  if (!MODEL_ID.test(model)) throw new Error("That does not look like a model id");
  const next = list.map((p) => (p.kind === kind ? { ...p, model } : p));
  storage.setItem(PROVIDERS, JSON.stringify(next));
  return next;
}

/** Makes a saved provider the one Chat uses, with the model it has. */
export function setDefault(storage: Storage, kind: ChatProviderKind): SavedProvider[] {
  const own = loadProviders(storage).find((p) => p.kind === kind);
  if (!own) throw new Error("That provider is not saved here");
  return pickModel(storage, kind, own.model);
}

/** Keeps the result of a Test with the saved key, for the card's status. */
export function recordCheck(storage: Storage, kind: ChatProviderKind, ok: boolean, at = new Date().toISOString()): SavedProvider[] {
  const list = loadProviders(storage);
  if (!list.some((p) => p.kind === kind)) return list;
  const next = list.map((p) => (p.kind === kind ? { ...p, check: { ok, at } } : p));
  storage.setItem(PROVIDERS, JSON.stringify(next));
  return next;
}

/** Switches to a saved provider's model, from the model menu. */
export function pickModel(storage: Storage, kind: ChatProviderKind, model: string): SavedProvider[] {
  const list = loadProviders(storage);
  const own = list.find((p) => p.kind === kind);
  if (!own) throw new Error("That provider is not saved here");
  if (!MODEL_ID.test(model)) throw new Error("That does not look like a model id");
  const next = [{ ...own, model }, ...list.filter((p) => p !== own)];
  storage.setItem(PROVIDERS, JSON.stringify(next));
  return next;
}

export function removeProvider(storage: Storage, kind: ChatProviderKind): SavedProvider[] {
  const next = loadProviders(storage).filter((p) => p.kind !== kind);
  if (next.length) storage.setItem(PROVIDERS, JSON.stringify(next)); else storage.removeItem(PROVIDERS);
  return next;
}

/** Whether chat can call a model: at least one provider is saved (Ollama needs no key, the others do). */
export const keyReady = (providers: SavedProvider[]) => providers.length > 0;

/** A key as the provider's card shows it: its last four characters only. */
export const maskKey = (key: string) => (key ? `ending ••••${key.slice(-4)}` : "no key needed");

function messagesIn(list: unknown): ChatMessage[] {
  if (!Array.isArray(list)) return [];
  return (list as ChatMessage[])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .map((m) => withItem({ ...m, sources: Array.isArray(m.sources) ? m.sources : [], steps: Array.isArray(m.steps) ? m.steps : [], model: m.model ?? null }))
    .slice(-MAX_MESSAGES);
}

/** A message with its item reference reduced to what is kept (lib/chat/items.ts), or without one. */
function withItem(m: ChatMessage): ChatMessage {
  const { item, ...rest } = m;
  const ref = itemRef(item);
  return ref ? { ...rest, item: ref } : rest;
}

/** A conversation's title: its first question, cut to fit the list. */
export function titleFor(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user")?.text.replace(/\s+/g, " ").trim() ?? "";
  return first.length > 60 ? `${first.slice(0, 59)}…` : first || "New chat";
}

export function newConversationId(): string {
  return globalThis.crypto.randomUUID();
}

/** The saved conversations, newest first. The old single transcript becomes the first conversation. */
export function loadConversations(storage: Storage): Conversation[] {
  const raw = read<unknown>(storage, CONVERSATIONS, []);
  let list: Conversation[] = (Array.isArray(raw) ? raw : []).flatMap((c: Partial<Conversation>) => {
    if (!c || typeof c.id !== "string") return [];
    const messages = messagesIn(c.messages);
    return messages.length ? [{ id: c.id, title: titleFor(messages), updatedAt: String(c.updatedAt ?? ""), messages }] : [];
  });
  const legacy = messagesIn(read<unknown>(storage, THREAD, []));
  if (legacy.length) {
    list = [{ id: newConversationId(), title: titleFor(legacy), updatedAt: legacy.at(-1)?.at ?? "", messages: legacy }, ...list];
    storage.setItem(CONVERSATIONS, JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
  }
  storage.removeItem(THREAD);
  return list.slice(0, MAX_CONVERSATIONS);
}

/** Saves a conversation at the top of the list; one with no messages is removed instead. */
export function saveConversation(storage: Storage, conversation: Conversation): Conversation[] {
  const others = loadConversations(storage).filter((c) => c.id !== conversation.id);
  const messages = conversation.messages.slice(-MAX_MESSAGES).map(withItem);
  const next = messages.length ? [{ ...conversation, title: titleFor(messages), messages }, ...others].slice(0, MAX_CONVERSATIONS) : others;
  if (next.length) storage.setItem(CONVERSATIONS, JSON.stringify(next)); else storage.removeItem(CONVERSATIONS);
  return next;
}

export function deleteConversation(storage: Storage, id: string): Conversation[] {
  const next = loadConversations(storage).filter((c) => c.id !== id);
  if (next.length) storage.setItem(CONVERSATIONS, JSON.stringify(next)); else storage.removeItem(CONVERSATIONS);
  return next;
}
