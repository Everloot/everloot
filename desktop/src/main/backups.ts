import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { BackupInfo } from "../shared/types";
import { accountOf } from "./engine";

export const BACKUPS_KEPT = 10;

/**
 * Keeps a copy of an account's Everloot.lua in the data folder before each upload attempt, the newest
 * BACKUPS_KEPT per account. A game crash during a write, or a CurseForge update that resets the
 * addon, no longer costs the player the scans and records they had not uploaded yet.
 */
export function backupSavedVariables(file: string, dataFolder: string, keep = BACKUPS_KEPT, now = new Date()): string {
  const dir = join(dataFolder, "backups");
  mkdirSync(dir, { recursive: true });
  const account = safeAccount(accountOf(file));
  // This account's copies only: "A" must not count "A-B"'s files.
  const own = (n: string) => n.startsWith(`${account}-`) && /^\d{8}T\d{6}Z\.lua$/.test(n.slice(account.length + 1));
  // A file that has not changed since the newest copy (an app start, an upload with nothing new)
  // gets no second copy, so ten starts in a row cannot push the useful history out.
  const newest = readdirSync(dir).filter(own).sort().at(-1);
  if (newest && sameBytes(join(dir, newest), file)) return join(dir, newest);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const target = join(dir, `${account}-${stamp}.lua`);
  copyFileSync(file, `${target}.tmp`);
  renameSync(`${target}.tmp`, target);
  const mine = readdirSync(dir).filter(own).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - keep))) rmSync(join(dir, old), { force: true });
  return target;
}


const safeAccount = (account: string) => account.replace(/[^A-Za-z0-9#_-]/g, "_");
const sameBytes = (a: string, b: string) => statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));

export function listBackups(dataFolder: string): BackupInfo[] {
  const dir = join(dataFolder, "backups");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".lua")).map((n) => {
    const m = /^(.*)-(\d{8}T\d{6}Z)\.lua$/.exec(n);
    const at = m ? `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}T${m[2].slice(9, 11)}:${m[2].slice(11, 13)}:${m[2].slice(13, 15)}Z` : "";
    return { file: join(dir, n), account: m ? m[1] : n, at, bytes: statSync(join(dir, n)).size };
  }).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Copies a backup back over the live Everloot.lua of the same account. The file it replaces is
 * backed up first, so a restore can itself be undone. Only files inside the backups folder are
 * accepted, and only for an account the app is watching. The player does this logged out: the
 * game rewrites the file on logout and would overwrite the restore otherwise.
 */
export function restoreBackup(backupFile: string, dataFolder: string, watchedFiles: string[], now = new Date()): string {
  const dir = resolve(dataFolder, "backups");
  const target = resolve(backupFile);
  if (!target.startsWith(dir + (process.platform === "win32" ? "\\" : "/")) || !target.endsWith(".lua")) throw new Error("Only a file from the backups folder can be restored");
  const m = /^(.*)-\d{8}T\d{6}Z\.lua$/.exec(basename(target));
  const account = m ? m[1] : "";
  const live = watchedFiles.find((f) => safeAccount(accountOf(f)) === account);
  if (!live) throw new Error(`No watched account file for ${account || basename(target)}`);
  if (existsSync(live)) backupSavedVariables(live, dataFolder, BACKUPS_KEPT, now);
  mkdirSync(join(live, ".."), { recursive: true });
  copyFileSync(target, `${live}.tmp`);
  renameSync(`${live}.tmp`, live);
  return live;
}
