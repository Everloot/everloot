import { parseBossKillRow } from "@/lib/boss-kill-sync";
import { syncBossKills } from "@/lib/boss-kill-sync-store";
import { NextResponse } from "next/server";
import { validPlayerName } from "@everloot/protocol";
import { hashKey, presentedKey } from "@/lib/api-keys";
import { fail, NO_STORE } from "@/lib/character-links-store";
import { linkRealmKey } from "@/lib/character-links";
import { characterSecret } from "@/lib/census-intake";
import { intakeQuota } from "@/lib/intake-quota";
import { rulesetOf } from "@/lib/player-pages";
import { buildCharacterFacts, parseSyncRow, SYNC_CHARACTERS_PER_REQUEST, SYNC_ROWS_PER_REQUEST } from "@/lib/private-sync";
import { syncAccount, syncCharacterFacts, unavailable, type CharacterOutcome } from "@/lib/private-sync-store";

/**
 * POST /api/me/characters/sync: `{ characters: [{ name, realm, records: [...] }] }`, from the Desktop App with a key
 * that has sync:own (`Authorization: Bearer evl_...`). Never a session: consent and switches are set signed in, and
 * sending facts is the key's only power. Each character's rows (gear_snapshot, talent_owned, stats_owned, pvp_owned,
 * profession_owned, reputation_owned, lockout_owned, achievement_owned, title_owned; every other kind is skipped) become at most one fact
 * per category, and each is kept only when the key's account holds that character's live link with sync on for the
 * category, and only when it is newer than the stored one. A character the account has no live link for is
 * `not_linked` in the receipt, whoever else may hold it. The install id becomes a keyed hash here and goes no further.
 * Own boss_kill_owned rows use a separate, always-private consent and table, only with EVERLOOT_BOSS_KILL_SYNC=1.
 * 404 until EVERLOOT_PRIVATE_SYNC=1.
 *
 * Each key may send SYNC_PER_KEY_HOUR requests an hour (intakeQuota.syncKey); past that, 429 with Retry-After. Only
 * the newest capture of each category is kept, so sending more often adds nothing that waiting would lose.
 */
export const dynamic = "force-dynamic";

/** The install scope's hourly limit (consume_intake_quota), which the sync bucket borrows. */
const SYNC_PER_KEY_HOUR = 20;

type Receipt = { index: number } & (CharacterOutcome | { result: "synced"; categories: Record<string, string> } | { result: "invalid" | "retry" });

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
    // Counted only once the key is known to be live and sync:own, so a stranger's guesses never make a bucket.
    const admitted = await intakeQuota.syncKey(hashKey(presentedKey(req)!));
    if (!admitted.allowed) {
      return fail(429, `This key has sent ${SYNC_PER_KEY_HOUR} syncs in the last hour. Try again later; the newest state is kept.`, { "Retry-After": String(admitted.retryAfter) });
    }
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
      const bossRows = records.flatMap((r) => { const row = parseBossKillRow(r); return row ? [row] : []; });
      skipped += records.length - rows.length - bossRows.length;
      const keys = new Map<string, string>();
      let mixed = false;
      for (const r of [...rows, ...bossRows]) {
        if (!("characterKey" in r)) continue;
        if (keys.has(r.installId) && keys.get(r.installId) !== r.characterKey) mixed = true;
        keys.set(r.installId, r.characterKey);
      }
      if (mixed) { characters.push({ index, result: "invalid" }); continue; }
      const built = buildCharacterFacts(name, realm, rows, now);
      if (!built) { characters.push({ index, result: "invalid" }); continue; }
      skipped += built.skipped;
      try {
        const result = await syncCharacterFacts(account, rulesetOf(linkRealmKey(realm)), realm, name, built.class, built.facts, secret);
        if (result.result === "synced" && bossRows.length) {
          const outcome = await syncBossKills(account, rulesetOf(linkRealmKey(realm)), realm, name, bossRows, secret, now);
          if (outcome === "not_linked") { characters.push({ index, result: "not_linked" }); continue; }
          characters.push({ index, result: "synced", categories: { ...result.categories, boss_kills: outcome } });
        } else characters.push({ index, ...result });
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
