/**
 * The rules for API keys that the account page's form and the server share: the scopes a key can hold, when it
 * may expire, and what its purpose may say. No server code here, so the browser can import it.
 */

export interface KeyRow {
  id: string;
  hint: string;
  label: string;
  /** What the key is for. Absent before 20261022120000_api_key_expiry.sql is applied. */
  purpose?: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

/** The scopes a key can be made with, as the form lists them. read:public is on every key. */
export const KEY_SCOPES = [
  { id: "read:public", label: "Read public data", note: "The corpus, drop list, items, market prices and the MCP server, at a key's higher limits.", always: true },
  { id: "read:own", label: "Read my saved builds", note: "Your saved builds and character labels, for the Desktop App, MCP clients and scripts.", always: false },
  { id: "link:own", label: "Link my characters", note: "Send the in-game codes that link your characters to this account, as the Desktop App does.", always: false },
] as const;
export type KeyScope = (typeof KEY_SCOPES)[number]["id"];

/**
 * DELETE /api/keys's error, with a 404, when the key is no live key of the signed-in account: already revoked, or
 * another account's (after a switch in another tab). The keys list takes only this exact answer as "no longer on this
 * account's list"; any other 404 is an error. The route's test pins its answer to this text.
 */
export const NO_LIVE_KEY = "No live key with that id on this account.";

/** The expiry choices in days; 90 is the one we suggest. A custom date may be up to MAX_EXPIRY_DAYS ahead. */
export const EXPIRY_DAYS = [7, 30, 90, 365] as const;
export const DEFAULT_EXPIRY_DAYS = 90;
export const MAX_EXPIRY_DAYS = 366;
export const PURPOSE_MAX = 200;
const DAY_MS = 86_400_000;

/** True when a key is past its end date. A key with no end date never expires. */
export function keyExpired(key: Pick<KeyRow, "expires_at">, now = Date.now()): boolean {
  return key.expires_at !== null && Date.parse(key.expires_at) <= now;
}

/** A key that still works: not revoked and not expired. */
export function keyLive(key: Pick<KeyRow, "expires_at" | "revoked_at">, now = Date.now()): boolean {
  return !key.revoked_at && !keyExpired(key, now);
}

/** What a key is for: printable, single spaces, trimmed, PURPOSE_MAX characters at most. Kept for our records. */
export function cleanPurpose(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, PURPOSE_MAX).join("").trim();
}

/**
 * When a new key expires, from the form's choice: `days` (one of EXPIRY_DAYS) or `date` (YYYY-MM-DD; the key works
 * through the end of that UTC day; tomorrow at the earliest, MAX_EXPIRY_DAYS ahead at the latest).
 */
export function expiryFrom(choice: { days?: unknown; date?: unknown }, now = new Date()): { expiresAt: string } | { error: string } {
  if (choice.days !== undefined && choice.days !== null) {
    if (!EXPIRY_DAYS.includes(choice.days as (typeof EXPIRY_DAYS)[number])) return { error: "Pick when the key expires." };
    return { expiresAt: new Date(now.getTime() + Number(choice.days) * DAY_MS).toISOString() };
  }
  if (typeof choice.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(choice.date)) return { error: "Pick when the key expires." };
  // The last millisecond of the day: the key is live while expires_at > now(), here and in the database.
  const end = new Date(`${choice.date}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== choice.date) return { error: "That is not a date." };
  if (choice.date <= now.toISOString().slice(0, 10)) return { error: "Pick a date after today." };
  if (end.getTime() > now.getTime() + MAX_EXPIRY_DAYS * DAY_MS) return { error: "A key can last a year at most." };
  return { expiresAt: end.toISOString() };
}

/** Whole days until a time, rounded up, for "expires in 3 days". */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.ceil((Date.parse(iso) - now) / DAY_MS);
}
