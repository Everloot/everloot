import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { validPlayerName, validRealm } from "@everloot/protocol";
import { intakeQuota } from "@/lib/intake-quota";
import { playerPagesOn, playerPath, rulesetOf, OPT_OUT_PATH } from "@/lib/player-pages";
import { playerStore } from "@/lib/player-store";
import { PLAYER_SEARCH_TAG } from "../../../players/player-view";

/**
 * POST /api/players/opt-out: hide a character, no account needed (docs/design/specs/2026-10-20-player-pages-design.md §7).
 * It records the opt-out in character_suppressions and deletes the row, and clears the page and search caches so the
 * character is gone at once. The form posts here without JavaScript, so it answers with a redirect back to the form.
 * Limited per address like every other write.
 */
export const dynamic = "force-dynamic";

function back(req: Request, query: string) {
  return NextResponse.redirect(new URL(`${OPT_OUT_PATH}?${query}`, req.url), { status: 303, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!playerPagesOn()) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const name = typeof form?.get("name") === "string" ? (form.get("name") as string).trim() : "";
  const realm = typeof form?.get("realm") === "string" ? (form.get("realm") as string).trim() : "";
  if (!validPlayerName(name) || !validRealm(realm)) return back(req, new URLSearchParams({ error: "invalid", name, realm }).toString());
  try {
    const admitted = await intakeQuota.request(req);
    if (!admitted.allowed) return back(req, new URLSearchParams({ error: "limit", name, realm }).toString());
    await playerStore().suppress(realm, name);
  } catch (err) {
    console.error("player opt-out failed", err);
    return back(req, new URLSearchParams({ error: "storage", name, realm }).toString());
  }
  revalidateTag(PLAYER_SEARCH_TAG);
  revalidatePath(playerPath({ ruleset: rulesetOf(realm), realm, name }));
  // Aliases normalize to the same character but have separate ISR entries.
  revalidatePath("/players/[ruleset]/[realm]/[name]", "page");
  return back(req, "done=1");
}
