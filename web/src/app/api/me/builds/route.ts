import { NextResponse } from "next/server";
import { presentedKey } from "@/lib/api-keys";
import { BUILDS_PER_ACCOUNT, parseBuildInput, savedBuildsOn, SAVES_PER_DAY } from "@/lib/saved-builds";
import { fail, limitedText, listOwn, meAccount, NO_STORE, ownBuildsForKey, saveBuild, unavailable } from "@/lib/saved-builds-store";

/**
 * The player's saved builds (docs/design/specs/2026-10-20-saved-builds-design.md). Nothing works until
 * EVERLOOT_SAVED_BUILDS=1.
 * GET lists builds (newest first) and character labels, for the signed-in player or for a key with read:own
 * sent as `Authorization: Bearer evl_...` (the Desktop App, MCP and scripts).
 * POST saves one: without an id it makes a new build, with one it updates that build in place. Each set's spend order
 * (order, order2) is saved with its code in the same write. A new build says whether it is shared and shows its owner's
 * name; nothing here picks for it, so a page that forgets cannot publish a link by default.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!savedBuildsOn()) return fail(404, "Not found");
  try {
    const token = presentedKey(req);
    if (token) {
      const read = await ownBuildsForKey(token);
      if (read.ok) return NextResponse.json(read.value, { headers: NO_STORE });
      if (read.refusal === "no_scope") return fail(403, "This key can't read your saved builds");
      if (read.refusal === "limited") {
        return fail(429, limitedText(read.retryAfter), { "Retry-After": String(read.retryAfter) });
      }
      return fail(401, "This API key is not valid or was revoked.", { "WWW-Authenticate": 'Bearer error="invalid_token"' });
    }
    const user = await meAccount(req, false);
    if (user instanceof Response) return user;
    return NextResponse.json(await listOwn(user.id), { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

export async function POST(req: Request) {
  try {
    const user = await meAccount(req, true);
    if (user instanceof Response) return user;
    let body: unknown = null;
    try { body = await req.json(); } catch {}
    const input = parseBuildInput(body);
    if (!input.ok) return fail(400, input.error);
    if (!input.value.id && (input.value.shared === null || input.value.showName === null)) {
      return fail(400, "A new build needs shared and showName, each true or false.");
    }
    const saved = await saveBuild(user.id, input.value);
    if ("refused" in saved) {
      switch (saved.refused) {
        case "not_found": return fail(404, "No build or character with that id on this account.");
        case "class_mismatch": return fail(400, "That character is another class. Pick a character of the build's class.");
        case "build_limit": return fail(409, `You have ${BUILDS_PER_ACCOUNT} saved builds. Delete one to save another.`);
        case "daily_limit": return fail(429, `You saved ${SAVES_PER_DAY} times in the last day. Try again tomorrow.`);
      }
    }
    return NextResponse.json({ build: saved.build }, { status: saved.created ? 201 : 200, headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
