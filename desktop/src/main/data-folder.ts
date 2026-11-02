import { lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, parse, relative, resolve } from "node:path";
import { APP_STALE_MS } from "../../../web/src/lib/settled-cache";
import type { DataPart, DataUsage } from "../shared/types";

/**
 * Past this size the Overview says once that the data folder has grown. A busy account at its
 * steady state is about 135 MB (ten backups of a 13 MB save file, under 1 MB of upload history,
 * under 0.5 MB of chat), and a downloaded update adds about 110 MB until the next start. Two busy
 * accounts with an update waiting stay under it; more than that, or installers that were never
 * cleaned up, pass it.
 */
export const DATA_NOTICE_BYTES = 500 * 1024 * 1024;

const SETTINGS = new Set(["settings.json", "window.json", "config.json", "everloot-key.txt", "everloot-key-origin.txt"]);

/** Which part of the breakdown a top-level entry of the data folder belongs to. */
export function partOf(name: string): DataPart {
  if (name === "backups") return "backups";
  if (name === "updates") return "updates";
  if (name === "chat.json" || name === "answers.json") return "chat";
  if (name === "sent.json" || /^settled-[\d.]+\.json$/.test(name)) return "uploads";
  if (SETTINGS.has(name) || /^[a-z]+\.key$/.test(name)) return "settings";
  return "other";
}

/** Bytes under `path`; links are counted as themselves and never followed. */
function sizeOf(path: string): number {
  let st;
  try { st = lstatSync(path); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let names: string[];
  try { names = readdirSync(path); } catch { return 0; }
  return names.reduce((sum, n) => sum + sizeOf(join(path, n)), 0);
}

/** The data folder's size, in total and per part. A folder that does not exist yet is empty. */
export function dataUsage(folder: string): Omit<DataUsage, "notice"> {
  const parts: Record<DataPart, number> = { backups: 0, updates: 0, chat: 0, uploads: 0, settings: 0, other: 0 };
  let names: string[];
  try { names = readdirSync(folder); } catch { names = []; }
  for (const n of names) parts[partOf(n)] += sizeOf(join(folder, n));
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

/**
 * Deletes the cached settled lists (`settled-<build>.json`) not refreshed for a week. One is kept per
 * game build and the game patches every few weeks; past APP_STALE_MS a list is never read again, so
 * they would otherwise pile up. Returns the names deleted.
 */
export function pruneSettledLists(folder: string, now = Date.now(), maxAge = APP_STALE_MS): string[] {
  let names: string[];
  try { names = readdirSync(folder); } catch { return []; }
  const gone: string[] = [];
  for (const n of names) {
    if (!/^settled-[\d.]+\.json$/.test(n)) continue;
    try {
      if (now - statSync(join(folder, n)).mtimeMs <= maxAge) continue;
      rmSync(join(folder, n), { force: true });
      gone.push(n);
    } catch { /* in use or gone already; next time */ }
  }
  return gone;
}

const inside = (child: string, parent: string) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !parse(r).root);
};

/**
 * Empties the data folder: settings, keys, upload history, chat, backups and downloaded updates. The
 * folder itself stays. It refuses a folder that is a drive root or the home folder (a mistyped
 * EVERLOOT_DATA_DIR), and one that holds the game folder or sits inside it, so the game and its
 * Everloot.lua files are never reached. Returns the entries that could not be deleted (a file
 * another program holds open); everything else is gone.
 */
export function deleteLocalData(folder: string, gameFolder: string | null): string[] {
  const dir = resolve(folder);
  if (dir === parse(dir).root || dir === resolve(homedir())) throw new Error(`${dir} is not a folder the app can empty`);
  if (gameFolder && (inside(resolve(gameFolder), dir) || inside(dir, resolve(gameFolder)))) {
    throw new Error("The data folder and the game folder overlap, so nothing was deleted");
  }
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const failed: string[] = [];
  for (const n of names) {
    try { rmSync(join(dir, n), { recursive: true, force: true, maxRetries: 2 }); } catch { failed.push(n); }
  }
  return failed;
}
