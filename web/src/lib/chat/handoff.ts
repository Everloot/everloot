/**
 * The home page's question, handed to /chat in this tab's sessionStorage so it is never in the address or in the
 * router's history state. /chat reads it once, deletes it, and puts it in the box; it is never sent for the visitor.
 */
const ASK = "everloot.chat.ask.v1";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function tabStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** Keeps the question for /chat; false when this tab has no storage, so the caller falls back to the plain form. */
export function handOver(question: string, storage: Storage | null = tabStorage()): boolean {
  const q = question.trim().slice(0, 2000);
  if (!q || !storage) return false;
  try { storage.setItem(ASK, q); return true; } catch { return false; }
}

/** The handed-over question, removed as it is read; null when there is none. */
export function takeHandoff(storage: Storage | null = tabStorage()): string | null {
  if (!storage) return null;
  try {
    const q = storage.getItem(ASK);
    storage.removeItem(ASK);
    return q?.trim().slice(0, 2000) || null;
  } catch { return null; }
}
