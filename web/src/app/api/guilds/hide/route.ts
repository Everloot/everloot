import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { validGuildName, validRealm } from "@everloot/protocol";
import { intakeQuota } from "@/lib/intake-quota";
import { GUILD_SEARCH_TAG, GUILDS_PATH, guildPath, guildsOn, HIDE_GUILD_PATH } from "@/lib/guilds";
import { playerStore } from "@/lib/player-store";

/**
 * POST /api/guilds/hide: hide a guild, no account and no proof of office (docs/design/specs/2026-10-24-guild-board-design.md,
 * decision 9c). It records the hide in guild_suppressions; the ladder, the directory, the guild's page and its seen roster
 * leave it out at once, and intake drops its guild_kill rows from then on. The form posts here without JavaScript, so it
 * answers with a redirect back to the form. Limited per address like every other write.
 */
export const dynamic = "force-dynamic";

function back(req: Request, query: string) {
  return NextResponse.redirect(new URL(`${HIDE_GUILD_PATH}?${query}`, req.url), { status: 303, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!guildsOn()) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const guild = typeof form?.get("guild") === "string" ? (form.get("guild") as string).trim() : "";
  const realm = typeof form?.get("realm") === "string" ? (form.get("realm") as string).trim() : "";
  if (guild.length > 24 || !validGuildName(guild) || !validRealm(realm) || realm.length > 40) {
    return back(req, new URLSearchParams({ error: "invalid", guild, realm }).toString());
  }
  try {
    const admitted = await intakeQuota.request(req);
    if (!admitted.allowed) return back(req, new URLSearchParams({ error: "limit", guild, realm }).toString());
    await playerStore().suppressGuild(realm, guild);
  } catch (err) {
    console.error("guild hide failed", err);
    return back(req, new URLSearchParams({ error: "storage", guild, realm }).toString());
  }
  revalidateTag(GUILD_SEARCH_TAG);
  revalidatePath(GUILDS_PATH);
  revalidatePath(guildPath(realm, guild));
  return back(req, "done=1");
}
