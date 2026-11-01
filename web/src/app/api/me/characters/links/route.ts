import { NextResponse } from "next/server";
import { recordSchemas } from "@everloot/protocol";
import { censusAgrees, LINK_ROWS_PER_REQUEST, LINKS_PER_ACCOUNT, type LinkRow } from "@/lib/character-links";
import { fail, linkAccount, linkSession, listLinks, NO_STORE, redeemLink, unavailable, type LinkRefusal } from "@/lib/character-links-store";
import { characterSecret } from "@/lib/census-intake";
import { uploadStore } from "@/lib/upload-store";

/**
 * POST /api/me/characters/links: `{ records: [character_link rows] }`, from the signed-in upload page (session
 * cookie, this site's Origin) or the Desktop App (`Authorization: Bearer evl_...` with link:own). Each row's code
 * must be live and this account's; only then does the census answer count: when the census knows the character it
 * must agree on race, class and faction, and a mismatch spends the code. The GUID becomes a keyed hash here and goes
 * no further. A new link is private. A character another account has linked too is frozen on both. Each row gets its
 * own result; after a storage failure the remaining rows are marked to send again. 404 until EVERLOOT_CHARACTER_LINKS=1.
 */
export const dynamic = "force-dynamic";

/**
 * GET /api/me/characters/links: the signed-in account's own links, for its owner's list. Session only, never an API
 * key. Each link's name, realm, race, class, faction, level, status (linked or frozen) and dates; never its keyed
 * hashes, and nothing about another account, not even which one also linked a frozen character.
 */
export async function GET() {
  try {
    const account = await linkSession();
    if (account instanceof Response) return account;
    return NextResponse.json({ links: await listLinks(account) }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

type Result =
  | { index: number; status: "linked" | "frozen"; name: string; realm: string; message: string }
  | { index: number; status: "refused" | "retry"; message: string };

const REFUSED: Record<LinkRefusal, string> = {
  code_unknown: "This code is not one of yours, or it was never made.",
  code_foreign: "This code is not one of yours, or it was never made.",
  code_used: "This code was already used. Make a new one.",
  code_expired: "This code has expired. Make a new one.",
  // Says nothing about what the census holds; the code is spent.
  census_mismatch: "This character could not be linked with this code. Make a new code and type it on the character itself.",
  suppressed: "This character is hidden by a hide request, so it can't be linked. Write to us to lift it.",
  name_linked: "This account already links another character with this name and realm. Unlink it first.",
  link_limit: `You have ${LINKS_PER_ACCOUNT} linked characters. Unlink one to link another.`,
};
const RETRY = "This row could not be saved. Send it again in a minute.";

export async function POST(req: Request) {
  try {
    const account = await linkAccount(req, true);
    if (account instanceof Response) return account;
    let body: unknown = null;
    try { body = await req.json(); } catch {}
    const records = (body as { records?: unknown } | null)?.records;
    if (!Array.isArray(records) || records.length === 0 || records.length > LINK_ROWS_PER_REQUEST) {
      return fail(400, `Send { records: [...] } with 1 to ${LINK_ROWS_PER_REQUEST} character_link rows.`);
    }
    const secret = characterSecret();
    if (!secret) return unavailable();
    const rows = records.map((r) => {
      const parsed = recordSchemas.character_link.safeParse(r);
      return parsed.success ? parsed.data : null;
    });
    // The census is read once, and only when there is a row to check. If it cannot be read nothing is linked:
    // a link must not skip the check because storage was slow.
    let census = null;
    if (rows.some((r) => r !== null)) {
      census = await uploadStore.loadCensus();
      if (census.unreachable) return unavailable();
    }
    const results: Result[] = [];
    let failed = false;
    for (let index = 0; index < rows.length; index++) {
      const row: LinkRow | null = rows[index];
      if (!row) { results.push({ index, status: "refused", message: "Not a character_link row." }); continue; }
      // Rows after a storage failure are not tried: each says to send it again, and the rows before keep their answers.
      if (failed) { results.push({ index, status: "retry", message: RETRY }); continue; }
      // The census answer goes to the database, which uses it only once the code is found live and this account's.
      let linked: Awaited<ReturnType<typeof redeemLink>>;
      try {
        linked = await redeemLink(account, row, secret, censusAgrees(row, secret, census?.rows ?? []));
      } catch {
        failed = true;
        results.push({ index, status: "retry", message: RETRY });
        continue;
      }
      if ("refused" in linked) { results.push({ index, status: "refused", message: REFUSED[linked.refused] }); continue; }
      results.push({
        index, status: linked.status, name: row.name, realm: row.realm.trim(),
        message: linked.status === "linked"
          ? "Linked. It stays private until you choose what to show."
          : "Another account has linked this character too, so it is frozen on both accounts until we look at it.",
      });
    }
    // 503 only when no row got an answer; otherwise each row says what happened to it.
    return NextResponse.json({ results }, { status: results.some((r) => r.status !== "retry") ? 200 : 503, headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
