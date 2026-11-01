import { existsSync, readdirSync, statSync } from "node:fs";
import { join, posix, win32 } from "node:path";
import type { GameFolderCandidate } from "../shared/types";

/** The little of the file system detection needs, so tests pass a fake tree. */
export interface FsLike {
  isDir(path: string): boolean;
  isFile(path: string): boolean;
  readdir(path: string): string[];
}

export const realFs: FsLike = {
  isDir: (p) => { try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; } },
  isFile: (p) => { try { return existsSync(p) && statSync(p).isFile(); } catch { return false; } },
  readdir: (p) => { try { return readdirSync(p); } catch { return []; } },
};

export interface OsInfo { platform: string; env: Record<string, string | undefined>; home: string }

/** Where the Battle.net app and the usual Wine setups put the game, per OS. */
export function candidateRoots(os: OsInfo): string[] {
  const { env, home } = os;
  if (os.platform === "win32") {
    const roots = [
      env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      env.ProgramFiles ?? "C:\\Program Files",
      "C:\\", "D:\\", "E:\\",
      "C:\\Games", "D:\\Games", "E:\\Games",
      env.PUBLIC ? win32.join(env.PUBLIC, "Games") : "C:\\Users\\Public\\Games",
    ];
    // Explicit Windows joins, so the list is the same when the tests run on a Linux runner.
    return [...new Set(roots.map((r) => win32.join(r, "World of Warcraft")))];
  }
  if (os.platform === "darwin") return ["/Applications/World of Warcraft", posix.join(home, "Applications", "World of Warcraft")];
  const wine = "drive_c/Program Files (x86)/World of Warcraft";
  return [
    posix.join(home, "Games", "battlenet", wine),
    posix.join(home, "Games", "world-of-warcraft", wine),
    posix.join(home, ".wine", wine),
    posix.join(home, "Games", "World of Warcraft"),
  ];
}

const isProductName = (name: string) => /^_[a-z0-9_]+_$/i.test(name);
/** WoW: Forever's product folder: the client the addon is built for. */
export const FOREVER = "_forever_";
const lastName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

function countFiles(folder: string, fs: FsLike): { files: number; hasAccounts: boolean } {
  const accounts = join(folder, "WTF", "Account");
  if (!fs.isDir(accounts)) return { files: 0, hasAccounts: false };
  return { files: fs.readdir(accounts).filter((a) => fs.isFile(join(accounts, a, "SavedVariables", "Everloot.lua"))).length, hasAccounts: true };
}

/**
 * Product folders (`_forever_`, `_classic_era_`, `_classic_beta_`, ...) under the given roots,
 * plus any root that is itself a product folder. WoW: Forever comes first, since the addon is built
 * for it; the rest are ranked by how many account files already hold Everloot data, then by whether
 * the game has been played there at all (WTF/Account exists), so a beta or other client with old
 * data is still offered but is not the default.
 */
export function detectGameFolders(roots: string[], fs: FsLike): GameFolderCandidate[] {
  const seen = new Set<string>();
  const found: GameFolderCandidate[] = [];
  const consider = (folder: string, product: string) => {
    if (seen.has(folder)) return;
    seen.add(folder);
    found.push({ folder, product, ...countFiles(folder, fs) });
  };
  for (const root of roots) {
    if (!fs.isDir(root)) continue;
    const rootName = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
    if (isProductName(rootName) || fs.isDir(join(root, "WTF"))) consider(root, rootName);
    for (const name of fs.readdir(root)) if (isProductName(name) && fs.isDir(join(root, name))) consider(join(root, name), name);
  }
  const forever = (c: GameFolderCandidate) => Number(c.product.toLowerCase() === FOREVER);
  return found.sort((a, b) => forever(b) - forever(a) || b.files - a.files || Number(b.hasAccounts) - Number(a.hasAccounts) || a.product.localeCompare(b.product));
}

/**
 * The `_forever_` folder beside the chosen one, when the chosen folder is another client (the closed
 * beta, a classic realm) and the player has not chosen to keep it; null otherwise. The page offers it
 * in one click and never switches by itself, since the folder decides which save files are read.
 */
export function foreverSuggestion(current: string | null, kept: string | null, fs: FsLike): string | null {
  if (!current || lastName(current).toLowerCase() === FOREVER || (kept && kept === current)) return null;
  const sibling = join(current, "..", FOREVER);
  return fs.isDir(sibling) ? sibling : null;
}

/**
 * The product folder a Browse pick means. Players often pick `World of Warcraft` itself, or step
 * one level too deep into `WTF` or `Interface`; both land on the product folder the app needs.
 */
export function resolvePickedFolder(picked: string, fs: FsLike): string {
  if (fs.isDir(join(picked, "WTF"))) return picked;
  const best = detectGameFolders([picked], fs)[0];
  if (best) return best.folder;
  const parent = join(picked, "..");
  const name = picked.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return /^(WTF|Interface)$/i.test(name) && fs.isDir(join(parent, "WTF")) ? parent : picked;
}
