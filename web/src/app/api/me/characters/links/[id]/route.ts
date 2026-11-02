import { NextResponse } from "next/server";
import { fail, linkAccount, NO_STORE, unavailable, unlinkCharacter } from "@/lib/character-links-store";
import { validId } from "@/lib/saved-builds";

/**
 * DELETE /api/me/characters/links/<id>: unlinks one of the signed-in account's characters. Session only, from this
 * site (Origin checked); an API key cannot unlink. Another account's link id answers exactly as an unknown one does,
 * 404, so nothing tells whether it exists. Another account's frozen link of the same character stays frozen.
 * 404 until EVERLOOT_CHARACTER_LINKS=1.
 */
export const dynamic = "force-dynamic";

const NONE = "No linked character with that id on this account.";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await linkAccount(req, false);
    if (account instanceof Response) return account;
    const { id } = await params;
    if (!validId(id)) return fail(404, NONE);
    if (!(await unlinkCharacter(account, id))) return fail(404, NONE);
    return NextResponse.json({ unlinked: id }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
