import { deleteConversation, loadConversations, newConversationId, type ChatMessage, type Conversation } from "./store";

/**
 * Chat's records in this browser once accounts can hold chats too. Old shared conversations stay where they
 * were; a signed-in player's new browser-only chats get a list named for their account; an imported old chat
 * stays as that account's backup and is never shown to, or claimed by, anyone else on this browser.
 */

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const SOURCE = "everloot.chat.source.v1";
const BINDINGS = "everloot.chat.imports.v1";

/** The same storage with every name suffixed by the account, so store.ts's lists become that account's own. */
export function scoped(storage: Storage, accountId: string): Storage {
  const name = (key: string) => `${key}@${accountId}`;
  return {
    getItem: (k) => storage.getItem(name(k)),
    setItem: (k, v) => storage.setItem(name(k), v),
    removeItem: (k) => storage.removeItem(name(k)),
  };
}

/** This browser's import source: one random id, so the account can tell its imports apart and repeat them safely. */
export function sourceIdFor(storage: Storage): string {
  const old = storage.getItem(SOURCE);
  if (old && /^[0-9a-f-]{36}$/.test(old)) return old;
  const id = newConversationId();
  storage.setItem(SOURCE, id);
  return id;
}

interface Binding { accountId: string; conversationId: string }

function bindings(storage: Storage): Record<string, Binding> {
  try {
    const raw = JSON.parse(storage.getItem(BINDINGS) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, Binding>) : {};
  } catch { return {}; }
}

/** The old shared chats: those nobody imported, and those `accountId` imported (its backups). Others' are left out. */
export function browserChats(storage: Storage, accountId: string | null): { unbound: Conversation[]; backups: Conversation[] } {
  const bound = bindings(storage);
  const all = loadConversations(storage);
  return {
    unbound: all.filter((c) => !bound[c.id]),
    backups: accountId ? all.filter((c) => bound[c.id]?.accountId === accountId) : [],
  };
}

export interface ImportResult { imported: number; total: number; error: string | null }

/**
 * Sends each unimported old chat to `accountId`, one at a time, and binds it to that account only after the account
 * acknowledged it. A failure stops there; what was sent stays bound, the rest stays unbound for a retry. The
 * originals are kept.
 */
export async function importBrowserChats(
  storage: Storage, accountId: string,
  post: (record: { sourceId: string; legacyId: string; conversation: { title: string; messages: ChatMessage[] } }) => Promise<{ id: string }>,
): Promise<ImportResult> {
  const sourceId = sourceIdFor(storage);
  const todo = browserChats(storage, accountId).unbound;
  let imported = 0;
  for (const c of todo) {
    let saved: { id: string };
    try {
      saved = await post({ sourceId, legacyId: c.id, conversation: { title: c.title, messages: c.messages } });
    } catch (err) {
      return { imported, total: todo.length, error: err instanceof Error ? err.message : String(err) };
    }
    const now = bindings(storage);
    // Another tab bound it to someone else meanwhile: theirs stays theirs.
    if (now[c.id] && now[c.id].accountId !== accountId) continue;
    storage.setItem(BINDINGS, JSON.stringify({ ...now, [c.id]: { accountId, conversationId: saved.id } }));
    imported++;
  }
  return { imported, total: todo.length, error: null };
}

/** Deletes the old copies `accountId` imported; their bindings stay, so they are never offered for import again. */
export function removeBackups(storage: Storage, accountId: string): number {
  const backups = browserChats(storage, accountId).backups;
  for (const c of backups) deleteConversation(storage, c.id);
  return backups.length;
}
