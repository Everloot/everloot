import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "../shared/types";

/**
 * The player's everloot.app account, as one of its free API keys (made after Battle.net sign-in on
 * /docs/api/keys). It goes to the site's public MCP server with Chat and the in-game /ask, which raises their
 * limits; uploads never carry it. Kept in a file in the data folder, like the provider keys.
 */
export const ACCOUNT_KEY_FILE = "everloot-key.txt";
/** The site's key shape (web/src/lib/api-keys.ts KEY_PATTERN). */
export const EVERLOOT_KEY = /^evl_[a-f0-9]{64}$/;

const keyPath = (dataFolder: string) => join(dataFolder, ACCOUNT_KEY_FILE);
/** The site origin the key was checked against at sign-in. Only that site is sent the key in the background. */
export const KEY_ORIGIN_FILE = "everloot-key-origin.txt";
const originPath = (dataFolder: string) => join(dataFolder, KEY_ORIGIN_FILE);
/** Keys pasted before the origin was kept were checked against the only site there was. */
const FIRST_ORIGIN = "https://everloot.app";

export function readKeyOrigin(dataFolder: string): string {
  try { return readFileSync(originPath(dataFolder), "utf8").trim() || FIRST_ORIGIN; } catch { return FIRST_ORIGIN; }
}

export function writeKeyOrigin(dataFolder: string, endpoint: string): void {
  mkdirSync(dataFolder, { recursive: true });
  writeFileSync(`${originPath(dataFolder)}.tmp`, new URL(endpoint).origin + "\n");
  renameSync(`${originPath(dataFolder)}.tmp`, originPath(dataFolder));
}

export function readAccountKey(dataFolder: string): string | null {
  try {
    const key = readFileSync(keyPath(dataFolder), "utf8").trim();
    return EVERLOOT_KEY.test(key) ? key : null;
  } catch { return null; }
}

/** Account keys travel over https, or to a local development server. */
export function keySiteOrigin(endpoint: string): string | null {
  let u: URL;
  try { u = new URL(endpoint); } catch { return null; }
  if (u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return u.origin;
  return null;
}

/** A changed site can still answer anonymously, but never receives the saved account key. */
export function accountKeyForSite(dataFolder: string, endpoint: string): string | null {
  const origin = keySiteOrigin(endpoint);
  return origin && origin === readKeyOrigin(dataFolder) ? readAccountKey(dataFolder) : null;
}

export function accountInfo(dataFolder: string): Account {
  const key = readAccountKey(dataFolder);
  return key ? { signedIn: true, hint: key.slice(-4) } : { signedIn: false, hint: null };
}

/**
 * Checks the key with the site before keeping it: one market request with a realm the site refuses,
 * so it costs one request on the key and reads nothing. 401 is a wrong or revoked key.
 */
export async function signIn(dataFolder: string, endpoint: string, raw: string, send: typeof fetch = fetch): Promise<Account> {
  const key = raw.trim();
  if (!EVERLOOT_KEY.test(key)) throw new Error("That is not an Everloot key. It starts with evl_ and is shown once when you make it on everloot.app.");
  const origin = keySiteOrigin(endpoint);
  if (!origin) throw new Error("The site address must use https before your key is sent to it.");
  let status: number;
  try {
    const res = await send(`${origin}/api/market/prices?realm=!`, {
      headers: { authorization: `Bearer ${key}`, "user-agent": "everloot-desktop" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
  } catch {
    throw new Error("Could not reach everloot.app to check the key. Try again in a moment.");
  }
  if (status === 401) throw new Error("everloot.app does not know that key, or it was revoked. Make a new one.");
  if (status === 429) throw new Error("That key has used its requests for this hour. Try again later.");
  if (status >= 500) throw new Error(`everloot.app could not check the key (${status}). Try again in a moment.`);
  mkdirSync(dataFolder, { recursive: true });
  writeFileSync(`${keyPath(dataFolder)}.tmp`, key + "\n", { mode: 0o600 });
  renameSync(`${keyPath(dataFolder)}.tmp`, keyPath(dataFolder));
  writeKeyOrigin(dataFolder, endpoint);
  return accountInfo(dataFolder);
}

/** The site's refusal of the account key, in place of the transport's raw error; other errors pass through. */
export function explainKeyError(message: string): string {
  if (/API key is not valid or was revoked/.test(message)) return "everloot.app refused your account key; it may have been revoked. Paste a new one under Settings > Account, or sign out there to ask without it.";
  if (/This account's keys have used their/.test(message)) return "Your account's keys have used their requests for this hour. Try again later, or sign out under Settings > Account to ask without the key.";
  return message;
}

/** Forgets the key on this computer. The key itself stays on the account until it is revoked on everloot.app. */
export function signOut(dataFolder: string): Account {
  if (existsSync(keyPath(dataFolder))) rmSync(keyPath(dataFolder));
  if (existsSync(originPath(dataFolder))) rmSync(originPath(dataFolder));
  return accountInfo(dataFolder);
}
