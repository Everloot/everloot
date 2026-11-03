import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { attachBuildLabel, fail, linkAccount, NO_STORE, ownLinkPath, unavailable } from "@/lib/character-links-store";
import { showcaseBuildsOn } from "@/lib/character-showcase";
import { validId } from "@/lib/saved-builds";

/**
 * POST /api/me/characters/links/<id>/label: `{ label: "<build label id>" | null }`. Attaches one of the signed-in
 * account's build labels (My builds) to one of its linked characters, so the character's public page lists that
 * label's shared builds as planned builds; null takes it off. Only an explicit choice attaches a label: nothing
 * matches one by name. The label must be of the character's class and the link not frozen. Session only, from this
 * site (Origin checked). Another account's link or label answers exactly as an unknown one, 404. A change clears the
 * page from the Next cache. 404 unless EVERLOOT_CHARACTER_LINKS=1 and EVERLOOT_SHOWCASE_BUILDS=1 (which needs
 * EVERLOOT_SHOWCASE=1 and EVERLOOT_SAVED_BUILDS=1).
 */
export const dynamic = "force-dynamic";

const NONE = "No linked character with that id on this account.";

/** The label to attach, null to take it off, or undefined for a body that is neither. */
function label(body: unknown): string | null | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("label" in body)) return undefined;
  const value = (body as { label: unknown }).label;
  return value === null || validId(value) ? value : undefined;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!showcaseBuildsOn()) return fail(404, "Not found");
    const account = await linkAccount(req, false);
    if (account instanceof Response) return account;
    const { id } = await params;
    if (!validId(id)) return fail(404, NONE);
    let body: unknown = null;
    try { body = await req.json(); } catch {}
    const wanted = label(body);
    if (wanted === undefined) return fail(400, "Send { label: \"<label id>\" } or { label: null }.");
    const path = await ownLinkPath(account, id);
    if (!path) return fail(404, NONE);
    const refusal = await attachBuildLabel(account, id, wanted);
    if (refusal === "not_found") return fail(404, "No linked character or build label with that id on this account.");
    if (refusal === "frozen") return fail(409, "This character is frozen, so its page can't change until that is settled.");
    if (refusal === "class_mismatch") return fail(409, "That label is for another class. Pick a label of this character's class.");
    revalidatePath(path);
    return NextResponse.json({ id, label: wanted }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
