import { createHash, createHmac, randomBytes } from "node:crypto";
import type { IntakeRecord, StoredCensusRecord } from "@everloot/protocol";
import { censusKey } from "./census-intake";

/**
 * Character links: a signed-in player ties one of their in-game characters to their account by typing a code
 * the site shows (`/everloot link EL-7K3Q-9P`) and sending the row it writes. Off until
 * EVERLOOT_CHARACTER_LINKS=1; with it unset the link endpoints answer 404 and nothing reads or writes the link
 * tables. Intake never stores a link row, switch or no switch: it carries a GUID and a code.
 *
 * A link shows that the holder of the account also held an addon file in which this character typed the code.
 * It is not checked with Blizzard. The database freezes a character that a second account claims
 * (supabase/migrations/20261021190000_character_links.sql).
 */

export type LinkRow = Extract<IntakeRecord, { kind: "character_link" }>;

export function isLinkRow(row: IntakeRecord): row is LinkRow {
  return row.kind === "character_link";
}

export function characterLinksOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EVERLOOT_CHARACTER_LINKS === "1";
}

export const CODES_PER_DAY = 10;
export const CODE_MINUTES = 15;
export const LINKS_PER_ACCOUNT = 50;
/** Link rows one request may carry. A player links one character at a time; a few cover a backlog. */
export const LINK_ROWS_PER_REQUEST = 10;

/** Crockford's base 32: no I, L, O or U, so a code read off the screen is typed right. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A fresh code, EL-XXXX-XX. 32 divides 256, so every character is equally likely. */
export function newLinkCode(): string {
  const chars = Array.from(randomBytes(6), (byte) => ALPHABET[byte % 32]).join("");
  return `EL-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** What the database keys a code by: the SHA-256 of the code in upper case. The code itself is never stored. */
export function linkCodeHash(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

/**
 * The key a link is stored under, in place of the GUID. The `link:` prefix makes it differ from the census key
 * of the same character, so links cannot be joined to census rows later.
 */
export function linkKey(guid: string, secret: string): string {
  return createHmac("sha256", secret).update(`link:${guid}`).digest("hex");
}

/**
 * The realm as one key however it was spelled, exactly as `public.link_realm_key` makes it: lower case, the curly
 * apostrophe as a straight one, any run of spaces and hyphens as one space. "Forever-Pioneer" and "forever  pioneer"
 * are one realm, so a spelling cannot dodge a freeze or a hide.
 */
export function linkRealmKey(realm: string): string {
  return realm.toLowerCase().replace(/\u2019/g, "'").replace(/[\s-]+/g, " ").trim();
}

/**
 * What is kept in place of the install id and completion key. The addon derives the completion key from the install
 * id and the GUID, so the two together would let the GUID be guessed back; the keyed hash cannot be. Completion rows
 * can still be joined later by hashing their install id and character key the same way.
 */
export function completionRef(installId: string, completionKey: string, secret: string): string {
  return createHmac("sha256", secret).update(`completion:${installId}:${completionKey}`).digest("hex");
}

/**
 * Whether the census agrees with a link row: every stored census row of the same character (by its census key,
 * computed here and not kept) has the row's race, class and faction. No census row for it is agreement.
 */
export function censusAgrees(row: LinkRow, secret: string, census: readonly StoredCensusRecord[]): boolean {
  const key = censusKey(row.guid, secret);
  return census.every((c) => c.characterKey !== key || (c.race === row.race && c.class === row.class && c.faction === row.faction));
}
