import { NextResponse } from "next/server";
import { validPlayerName } from "@everloot/protocol";
import { fail, NO_STORE } from "@/lib/character-links-store";
import { linkRealmKey } from "@/lib/character-links";
import { characterSecret } from "@/lib/census-intake";
import { rulesetOf } from "@/lib/player-pages";
import { buildCharacterFacts, parseSyncRow, SYNC_CHARACTERS_PER_REQUEST, SYNC_ROWS_PER_REQUEST } from "@/lib/private-sync";
import { syncAccount, syncCharacterFacts, unavailable, type CharacterOutcome } from "@/lib/private-sync-store";

/**
 * POST /api/me/characters/sync: `{ characters: [{ name, realm, records: [...] }] }`, from the Desktop App with a key
 * that has sync:own (`Authorization: Bearer evl_...`). Never a session: consent and switches are set signed in, and
 * sending facts is the key's only power. Each character's rows (gear_snapshot, talent_snapshot, profession_owned,
 * reputation_owned, lockout_owned, achievement_owned, title_owned; every other kind is skipped) become at most one fact
 * per category, and each is kept only when the key's account holds that character's live link with sync on for the
 * category, and only when it is newer than the stored one. A character the account has no live link for is
 * `not_linked` in the receipt, whoever else may hold it. The install id becomes a keyed hash here and goes no further.
 * 404 until EVERLOOT_PRIVATE_SYNC=1.
 */
export const dynamic = "force-dynamic";

type Receipt = { index: number } & (CharacterOutcome | { result: "invalid" | "retry" });

interface Group { name: string; realm: string; records: unknown[] }

/** The groups, or null for a body that is not `{ characters: [...] }` within the limits. */
function groups(body: unknown): Group[] | null {
  const characters = (body as { characters?: unknown } | null)?.characters;
  if (!Array.isArray(characters) || characters.length === 0 || characters.length > SYNC_CHARACTERS_PER_REQUEST) return null;
  let rows = 0;
  for (const c of characters) {
    const g = c as Partial<Group> | null;
    if (!g || typeof g.name !== "string" || !validPlayerName(g.name) || typeof g.realm !== "string" || !Array.isArray(g.records)) return null;
    const realm = g.realm.trim();
    if (realm.length < 2 || realm.length > 40) return null;
    rows += g.records.length;
  }
  return rows > SYNC_ROWS_PER_REQUEST ? null : (characters as Group[]);
}

export async function POST(req: Request) {
  try {
    const account = await syncAccount(req);
    if (account instanceof Response) return account;
    let body: unknown = null;
    try { body = await req.json(); } catch {}
    const list = groups(body);
    if (!list) {
      return fail(400, `Send { characters: [{ name, realm, records }] } with 1 to ${SYNC_CHARACTERS_PER_REQUEST} characters and at most ${SYNC_ROWS_PER_REQUEST} rows.`);
    }
    const secret = characterSecret();
    if (!secret) return unavailable();
    const now = new Date();
    const characters: Receipt[] = [];
    let skipped = 0;
    let failed = false;
    for (let index = 0; index < list.length; index++) {
      const { name, records } = list[index]!;
      const realm = list[index]!.realm.trim();
      if (failed) { characters.push({ index, result: "retry" }); continue; }
      const rows = records.flatMap((r) => { const row = parseSyncRow(r); return row ? [row] : []; });
      skipped += records.length - rows.length;
      const built = buildCharacterFacts(name, realm, rows, now);
      if (!built) { characters.push({ index, result: "invalid" }); continue; }
      skipped += built.skipped;
      try {
        characters.push({ index, ...(await syncCharacterFacts(account, rulesetOf(linkRealmKey(realm)), realm, name, built.class, built.facts, secret)) });
      } catch {
        failed = true;
        characters.push({ index, result: "retry" });
      }
    }
    // 503 only when no character got an answer; otherwise each says what happened to it.
    return NextResponse.json({ characters, skipped }, { status: characters.some((c) => c.result !== "retry") ? 200 : 503, headers: NO_STORE });
  } catch {
    return unavailable();
  }
}
