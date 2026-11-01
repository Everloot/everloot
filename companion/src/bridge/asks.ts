import { validRealmName } from "../../../web/src/lib/chat/market-question";
import { parseEverlootTable } from "../../../web/src/lib/sv-parse";
import type { Player } from "./engine";

/**
 * `realm`: the realm the player was on when asking, when the addon recorded one that is a realm name. `player`: their
 * class token, level and zone, for this answer only (never stored with the answer, never uploaded).
 */
export interface Ask { id: string; question: string; askedAt: string; realm?: string; player?: Player }

/** The class token, level and zone the addon wrote, each only when it has the shape the addon writes. */
function playerOf(r: Record<string, unknown>): Player | undefined {
  const player: Player = {
    ...(typeof r.class === "string" && /^[A-Z]{2,20}$/.test(r.class) ? { class: r.class } : {}),
    ...(typeof r.level === "number" && Number.isInteger(r.level) && r.level >= 1 && r.level <= 100 ? { level: r.level } : {}),
    ...(typeof r.zone === "string" && r.zone.trim().length >= 2 && r.zone.length <= 60 && !/[\p{Cc}|]/u.test(r.zone) ? { zone: r.zone.trim() } : {}),
  };
  return Object.keys(player).length ? player : undefined;
}

const ID = /^[A-Za-z0-9:_-]{3,64}$/;
export const MAX_QUESTION = 500;

/** Questions the addon stored with /ask. Anything malformed or oversized is skipped, never guessed. */
export function readAsks(savedVariables: string): Ask[] {
  return asksIn(parseEverlootTable(savedVariables));
}

/** As readAsks, from a table already parsed. */
export function asksIn(db: Record<string, unknown>): Ask[] {
  const asks = db.asks;
  if (!Array.isArray(asks)) return [];
  return asks.flatMap((row) => {
    const r = row as Record<string, unknown>;
    if (typeof r?.id !== "string" || !ID.test(r.id)) return [];
    if (typeof r.question !== "string" || r.question.trim().length === 0 || r.question.length > MAX_QUESTION) return [];
    if (typeof r.askedAt !== "string") return [];
    // Older asks have no realm, and a malformed one is dropped without dropping the question.
    const realm = typeof r.realm === "string" && validRealmName(r.realm) ? r.realm.trim() : null;
    const player = playerOf(r);
    return [{ id: r.id, question: r.question.trim(), askedAt: r.askedAt, ...(realm ? { realm } : {}), ...(player ? { player } : {}) }];
  }).slice(-20);
}
