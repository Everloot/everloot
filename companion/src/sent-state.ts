import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readStateFile } from "./state-file";

/** Legacy receipt keys belong to production; other origins have independent confirmation sets. */
export function receiptKeyForSite(installId: string, endpoint: string): string {
  const origin = new URL(endpoint).origin;
  return origin === "https://everloot.app" ? installId : `${origin}|${installId}`;
}

/**
 * Event ids the intake has confirmed, per install. Only a durable receipt adds an id, so a failed or
 * interrupted batch is sent again next time; the server deduplicates replays either way.
 */
export function createSentState(path: string, onRecovery: (message: string) => void = console.warn) {
  const sent = new Map<string, Set<string>>();
  const raw = readStateFile(path, (value): value is Record<string, string[]> =>
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string")), onRecovery);
  for (const [install, ids] of Object.entries(raw ?? {})) sent.set(install, new Set(ids));
  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    // Write then rename, so a crash never leaves a half-written state file.
    writeFileSync(`${path}.tmp`, JSON.stringify(Object.fromEntries([...sent].map(([k, v]) => [k, [...v]]))));
    renameSync(`${path}.tmp`, path);
  };
  return {
    has(install: string, eventId: string): boolean {
      return sent.get(install)?.has(eventId) ?? false;
    },
    add(install: string, eventIds: string[]): void {
      const ids = sent.get(install) ?? new Set<string>();
      for (const id of eventIds) ids.add(id);
      sent.set(install, ids);
      save();
    },
    /**
     * Forgets this install's ids that are no longer in its save file. The addon drops rows it has
     * replaced (census days, player pages), and a row that left the file can never be sent again, so
     * without this the file grows for as long as the game is played. Returns how many were dropped.
     */
    keepOnly(install: string, inFile: ReadonlySet<string>): number {
      const ids = sent.get(install);
      if (!ids) return 0;
      const before = ids.size;
      for (const id of ids) if (!inFile.has(id)) ids.delete(id);
      const dropped = before - ids.size;
      if (dropped) save();
      return dropped;
    },
  };
}

export type SentState = ReturnType<typeof createSentState>;
