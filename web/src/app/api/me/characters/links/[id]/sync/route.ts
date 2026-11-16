import { bossKillSyncOn } from "@/lib/boss-kill-sync";
import { ownBossKills, setBossKillConsent } from "@/lib/boss-kill-sync-store";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { fail, linkAccount, linkSession, NO_STORE, ownLinkPath } from "@/lib/character-links-store";
import { isSyncCategory, privateSyncOn, SYNC_CATEGORIES, type SyncCategory } from "@/lib/private-sync";
import { ownCharacterFacts, ownSyncedLink, setSyncConsent, unavailable } from "@/lib/private-sync-store";
import { validId } from "@/lib/saved-builds";

/**
 * /api/me/characters/links/<id>/sync: the owner's private sync settings for one linked character. Session only; an
 * API key never reads or changes these, a sync:own key included. 404 until EVERLOOT_PRIVATE_SYNC=1. Another account's
 * link answers exactly as an unknown one, 404.
 *
 * GET: each category with whether sync is on, whether its public section is switched on, and the date of the stored
 * capture. With EVERLOOT_BOSS_KILL_SYNC=1, bossKills also holds the owner's private history and its own consent.
 * Never the facts' source, a hash or the account.
 * POST `{ gear?: boolean, talents?: ..., professions?, reputations?, raids?, achievements? }`, from this site (Origin
 * checked), plus bossKills when its separate gate is on: turns each named category's sync on or off. Off deletes that category's stored facts at once. A frozen
 * link cannot be turned on (409). Any change clears the page and both cards from the Next cache.
 */
export const dynamic = "force-dynamic";

const NONE = "No linked character with that id on this account.";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!privateSyncOn()) return fail(404, "Not found");
    const account = await linkSession();
    if (account instanceof Response) return account;
    const { id } = await params;
    if (!validId(id)) return fail(404, NONE);
    const switches = await ownSyncedLink(account, id);
    if (!switches) return fail(404, NONE);
    const facts = await ownCharacterFacts(account, id);
    const by = new Map(facts.map((f) => [f.category, f]));
    return NextResponse.json({
      id, status: switches.status, pagePublic: switches.pagePublic,
      ...(bossKillSyncOn() ? { bossKills: await ownBossKills(account, id) } : {}),
      categories: SYNC_CATEGORIES.map((category) => ({
        category, sync: by.get(category)?.consented === true, shown: switches.shown[category], capturedAt: by.get(category)?.fact?.capturedAt ?? null,
      })),
    }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

/** The categories to set, or null for a body that is not one or more category names with booleans. */
type ConsentCategory = SyncCategory | "bossKills";
function wanted(body: unknown): Partial<Record<ConsentCategory, boolean>> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  if (entries.length === 0) return null;
  const out: Partial<Record<ConsentCategory, boolean>> = {};
  for (const [key, value] of entries) {
    if ((!isSyncCategory(key) && !(key === "bossKills" && bossKillSyncOn())) || typeof value !== "boolean") return null;
    out[key] = value;
  }
  return out;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!privateSyncOn()) return fail(404, "Not found");
    const account = await linkAccount(req, false);
    if (account instanceof Response) return account;
    const { id } = await params;
    if (!validId(id)) return fail(404, NONE);
    let body: unknown = null;
    try { body = await req.json(); } catch {}
    const set = wanted(body);
    if (!set) return fail(400, `Send { <category>: true | false }, with categories from ${SYNC_CATEGORIES.join(", ")}.`);
    // The address first: it also says whether the link is this account's, before anything is written.
    const path = await ownLinkPath(account, id);
    if (!path) return fail(404, NONE);
    for (const [category, granted] of Object.entries(set) as [ConsentCategory, boolean][]) {
      const refusal = category === "bossKills" ? await setBossKillConsent(account, id, granted) : await setSyncConsent(account, id, category, granted);
      if (refusal === "unavailable") return unavailable();
      if (refusal === "not_found") return fail(404, NONE);
      if (refusal === "frozen") return fail(409, "This character is frozen because another account also linked it, so sync can't be turned on.");
    }
    for (const p of [path, `${path}/card.png`, `${path}/card-square.png`]) revalidatePath(p);
    return NextResponse.json({ id, ...set }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
