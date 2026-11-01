import { NextResponse } from "next/server";
import {
  cleanLabel, cleanPurpose, createKey, deleteKey, expiryFrom, issueKey, KEY_SCOPES, KEYS_MADE_PER_DAY, KEYS_PER_ACCOUNT,
  OWN_SCOPES, readKeys, revokeKey, rollKey, validKeyId, type Issue,
} from "@/lib/api-keys";
import { characterLinksOn } from "@/lib/character-links";
import { guardOn } from "@/lib/data-guard";
import { DESKTOP_KEY_LABEL } from "@/lib/desktop-connect";
import { savedBuildsOn } from "@/lib/saved-builds";
import { getUser, siteUrl } from "@/lib/supabase/server";

/**
 * The signed-in player's free API keys. Battle.net sign-in is the identity; nothing works until EVERLOOT_DATA_GUARD=1.
 * GET lists them, with `records` true once 20261022120000_api_key_expiry.sql is applied (purpose and expiry).
 * POST { label, purpose, scopes, expiresInDays | expiresOn } makes one from the account page's form (shown once).
 * POST { label, builds } is the older call, kept for the Desktop App's connect page (label DESKTOP_KEY_LABEL): no
 * purpose and no end date. Any other label gets a 400 once the expiry migration is applied; before it, the form uses it.
 * POST ?roll=<id> gives a key a new secret with the same settings and revokes the old one.
 * DELETE ?id= revokes one; DELETE ?id=&erase=1 deletes a revoked or expired one with its counts.
 * Every write must come from this site: a request with another Origin, or none, is refused.
 */
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers });
const NOT_YET = "Key expiry is not switched on yet. Reload the page and try again.";
const LEGACY_REFUSED = "Say what the key is for, pick its permissions and when it expires (purpose, scopes and expiresInDays or expiresOn).";

async function account(req: Request, write: boolean) {
  if (!guardOn()) return fail(503, "API keys are not switched on yet.");
  if (write && req.headers.get("origin") !== siteUrl()) return fail(403, "Invalid origin");
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in with Battle.net to manage keys.", signIn: "/api/auth/bnet" }, { status: 401, headers });
  return user;
}

/**
 * The scopes this site offers now: read:own while saved builds are on, link:own while character links are on and
 * the expiry migration is applied (the older call has no way to ask for it).
 */
function offered(records = true): string[] {
  const on: Record<string, boolean> = { "read:own": savedBuildsOn(), "link:own": characterLinksOn() && records };
  return KEY_SCOPES.filter((s) => on[s.id] ?? true).map((s) => s.id);
}

function refusal(made: Issue | Awaited<ReturnType<typeof createKey>>): Response | null {
  if ("missing" in made) return fail(503, NOT_YET);
  if (!("refused" in made)) return null;
  if (made.refused === "live_limit") return fail(409, `You already have ${KEYS_PER_ACCOUNT} active keys. Revoke one first.`);
  if (made.refused === "daily_limit") return fail(429, `You made ${KEYS_MADE_PER_DAY} keys in the last day. Try again tomorrow.`);
  return fail(404, "No active or expired key with that id on this account.");
}

export async function GET(req: Request) {
  try {
    const user = await account(req, false);
    if (user instanceof Response) return user;
    const { keys, records } = await readKeys(user.id);
    return NextResponse.json({ ok: true, keys, limit: KEYS_PER_ACCOUNT, ownScope: savedBuildsOn(), records, scopes: offered(records) }, { headers });
  } catch {
    return fail(503, "Keys are temporarily unavailable.");
  }
}

export async function POST(req: Request) {
  try {
    const user = await account(req, true);
    if (user instanceof Response) return user;
    const roll = new URL(req.url).searchParams.get("roll");
    if (roll !== null) {
      if (!validKeyId(roll)) return fail(400, "Give the id of the key to roll.");
      const made = await rollKey(user.id, roll);
      return refusal(made) ?? NextResponse.json({ ok: true, ...made }, { status: 201, headers });
    }
    let body: unknown = {};
    try { body = await req.json(); } catch {}
    const fields = (body ?? {}) as { label?: unknown; builds?: unknown; links?: unknown; purpose?: unknown; scopes?: unknown; expiresInDays?: unknown; expiresOn?: unknown };
    if (!Array.isArray(fields.scopes)) {
      const legacyLabel = cleanLabel(fields.label);
      // Only the Desktop App's key skips purpose and expiry; any other caller must send them once the migration is in.
      if (legacyLabel !== DESKTOP_KEY_LABEL && (await readKeys(user.id)).records) return fail(400, LEGACY_REFUSED);
      // The Desktop App's key may also send link codes while character links are on, when its connect page asks.
      const links = fields.links === true && legacyLabel === DESKTOP_KEY_LABEL && characterLinksOn();
      const reads: readonly string[] | undefined = fields.builds === true && savedBuildsOn() ? OWN_SCOPES : undefined;
      const made = await createKey(user.id, legacyLabel, links ? [...(reads ?? ["read:public"]), "link:own"] : reads);
      return refusal(made) ?? NextResponse.json({ ok: true, ...made }, { status: 201, headers });
    }
    const label = cleanLabel(fields.label);
    if (!label) return fail(400, "Give the key a name.");
    const purpose = cleanPurpose(fields.purpose);
    if (!purpose) return fail(400, "Say what the key is for.");
    const allowed = offered();
    if (!fields.scopes.every((s) => typeof s === "string" && allowed.includes(s))) return fail(400, "One of those permissions does not exist.");
    const expiry = expiryFrom({ days: fields.expiresInDays, date: fields.expiresOn });
    if ("error" in expiry) return fail(400, expiry.error);
    const scopes = ["read:public", ...fields.scopes.filter((s) => s !== "read:public")];
    const made = await issueKey(user.id, { label, purpose, scopes, expiresAt: expiry.expiresAt });
    return refusal(made) ?? NextResponse.json({ ok: true, ...made }, { status: 201, headers });
  } catch {
    return fail(503, "Keys are temporarily unavailable.");
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await account(req, true);
    if (user instanceof Response) return user;
    const id = new URL(req.url).searchParams.get("id");
    if (!validKeyId(id)) return fail(400, "Give the id of the key to revoke.");
    if (new URL(req.url).searchParams.get("erase") === "1") {
      if (!(await deleteKey(user.id, id))) return fail(404, "No revoked or expired key with that id on this account. Revoke it first.");
      return NextResponse.json({ ok: true }, { headers });
    }
    if (!(await revokeKey(user.id, id))) return fail(404, "No live key with that id on this account.");
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return fail(503, "Keys are temporarily unavailable.");
  }
}
