import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { fail, linkAccount, NO_STORE, ownLinkPath, setVisibility, unavailable, type VisibilityFlags } from "@/lib/character-links-store";
import { showcaseOn } from "@/lib/character-showcase";
import { privateSyncOn, SHOW_SWITCH } from "@/lib/private-sync";
import { validId } from "@/lib/saved-builds";

/**
 * POST /api/me/characters/links/<id>/visibility: `{ page_public?: boolean, indexable?: boolean }`, turning one of
 * the signed-in account's characters' public page on or off. Session only, from this site (Origin checked); an API
 * key cannot change it. Only these two switches: the section and ranking switches wait for their own contracts, and
 * `indexable` may only be turned off until indexing of character pages is accepted. Another account's link answers
 * exactly as an unknown one, 404. Any change clears the page and both cards from the Next cache. 404 unless both
 * EVERLOOT_CHARACTER_LINKS=1 and EVERLOOT_SHOWCASE=1.
 *
 * With EVERLOOT_PRIVATE_SYNC=1 the owner's section switches are taken too (showcase plan S6): show_gear, show_talents,
 * show_professions, show_reputations, show_raids and show_collections. Each publishes only that section's synced facts,
 * and only while sync for it stays on. Gold, guild and the rankings stay refused.
 */
export const dynamic = "force-dynamic";

const NONE = "No linked character with that id on this account.";
const SWITCHES = ["page_public", "indexable"] as const;
/** The section switches, only while private sync is on. */
const sections = (): readonly string[] => (privateSyncOn() ? [...new Set(Object.values(SHOW_SWITCH))] : []);

/** The flags to set, or null for a body that is not booleans under those names. */
function flags(body: unknown): VisibilityFlags | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  if (entries.length === 0) return null;
  const out: VisibilityFlags = {};
  const allowed = [...SWITCHES, ...sections()];
  for (const [key, value] of entries) {
    if (!allowed.includes(key) || typeof value !== "boolean") return null;
    out[key as keyof VisibilityFlags] = value;
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!showcaseOn()) return fail(404, "Not found");
    const account = await linkAccount(req, false);
    if (account instanceof Response) return account;
    const { id } = await params;
    if (!validId(id)) return fail(404, NONE);
    let body: unknown = null;
    try { body = await req.json(); } catch {}
    const wanted = flags(body);
    if (!wanted) return fail(400, "Send { page_public: true | false }.");
    if (wanted.indexable === true) return fail(400, "Search engines cannot index character pages yet.");
    // The address first: it also says whether the link is this account's, before anything is written.
    const path = await ownLinkPath(account, id);
    if (!path) return fail(404, NONE);
    if (!(await setVisibility(account, id, wanted))) return fail(404, NONE);
    for (const p of [path, `${path}/card.png`, `${path}/card-square.png`]) revalidatePath(p);
    return NextResponse.json({ id, ...wanted }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
