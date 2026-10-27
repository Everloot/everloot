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
  return {
    has(install: string, eventId: string): boolean {
      return sent.get(install)?.has(eventId) ?? false;
    },
    add(install: string, eventIds: string[]): void {
      const ids = sent.get(install) ?? new Set<string>();
      for (const id of eventIds) ids.add(id);
      sent.set(install, ids);
      mkdirSync(dirname(path), { recursive: true });
      // Write then rename, so a crash never leaves a half-written state file.
      writeFileSync(`${path}.tmp`, JSON.stringify(Object.fromEntries([...sent].map(([k, v]) => [k, [...v]]))));
      renameSync(`${path}.tmp`, path);
    },
  };
}

export type SentState = ReturnType<typeof createSentState>;
